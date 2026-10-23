import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/**
 * The camera look: a physically based (Preetham) sky with drifting clouds, stars at night, haze
 * that meets the fog at the horizon, filmic tone mapping, bloom and a light colour grade.
 * Quality steps let a 2 GB laptop GPU keep a steady frame rate.
 */

/** Sky.js's fragment shader with clouds, stars, horizon haze and rain darkening added. */
const SKY_FRAG = (Sky.SkyShader as { fragmentShader: string }).fragmentShader
  .replace(
    "uniform vec3 up;",
    /* glsl */ `uniform vec3 up;
uniform vec3 hazeColor;
uniform float haze, night, time, cover, skyGain;
uniform vec3 cloudLit, cloudShade;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise2(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}`,
  )
  .replace(
    "gl_FragColor = vec4( retColor, 1.0 );",
    /* glsl */ `vec3 col = retColor * skyGain * (1.0 - cover * 0.45);
float up01 = clamp(direction.y, 0.0, 1.0);
col += mix(vec3(0.010, 0.014, 0.028), vec3(0.002, 0.003, 0.010), up01) * night;
// Stars, hashed per direction cell.
vec3 sc = floor(direction * 260.0);
float star = step(0.9975, fract(sin(dot(sc, vec3(12.99, 78.23, 37.71))) * 43758.55));
col += vec3(star) * night * up01 * (1.0 - cover) * 0.9;
// Cloud deck: a plane high overhead, scrolled by the wind.
if (direction.y > 0.0) {
  vec2 p = direction.xz / (direction.y + 0.12) * 0.9 + vec2(time * 0.006, time * 0.0025);
  float n = fbm(p);
  float c = smoothstep(0.62 - cover * 0.5, 0.98 - cover * 0.45, n) * smoothstep(0.0, 0.16, direction.y);
  float lit = clamp((n - fbm(p + vSunDirection.xz * 0.06)) * 4.0 + 0.55, 0.0, 1.0);
  float glow = pow(max(dot(direction, vSunDirection), 0.0), 8.0);
  vec3 cloud = mix(cloudShade, cloudLit, lit) + cloudLit * glow * 0.5;
  col = mix(col, cloud, c);
}
// Haze toward the horizon, matching the fog so distant hills melt into the sky.
float hz = pow(1.0 - up01, 6.0);
col = mix(col, hazeColor, clamp(hz * haze + (direction.y < 0.0 ? 1.0 : 0.0), 0.0, 1.0));
// The sun disc is far brighter than a half-float target holds; keep it finite for bloom.
gl_FragColor = vec4( clamp(col, 0.0, 24.0), 1.0 );`,
  );

const GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    saturation: { value: 0.9 },
    contrast: { value: 1.06 },
    shadowTint: { value: new THREE.Vector3(0.95, 0.99, 1.03) },
    highTint: { value: new THREE.Vector3(1.04, 1.0, 0.93) },
    vignette: { value: 0.3 },
    grain: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float time, saturation, contrast, vignette, grain;
uniform vec3 shadowTint, highTint;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, saturation);
  c *= mix(shadowTint, highTint, smoothstep(0.05, 0.85, l));
  c = (c - 0.5) * contrast + 0.5;
  c = c / (1.0 + max(c - 0.92, 0.0) * 2.0);
  float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.15, 1.0)) * 1.25);
  c *= mix(1.0 - vignette, 1.0, v);
  c += (hash(vUv * 1000.0 + time) - 0.5) * grain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

export const QUALITY_NAMES = ["Low", "Medium", "High", "Ultra"];

export class FilmLook {
  readonly sky: Sky;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private fxaa: ShaderPass | null = null;
  private ao: GTAOPass | null = null;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** 0 no post or shadows, 1 FXAA, 2 MSAA and bloom, 3 adds ambient occlusion. */
  quality = 2;
  /** 0 clear to 1 heavy rain; the game eases this. */
  rain = 0;
  private size = new THREE.Vector2(1, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    this.sky = new Sky();
    const m = this.sky.material as THREE.ShaderMaterial;
    m.fragmentShader = SKY_FRAG;
    Object.assign(m.uniforms, {
      hazeColor: { value: new THREE.Color() },
      haze: { value: 0.85 },
      night: { value: 0 },
      time: { value: 0 },
      cover: { value: 0.35 },
      skyGain: { value: 1 },
      cloudLit: { value: new THREE.Color() },
      cloudShade: { value: new THREE.Color() },
    });
    m.uniforms.turbidity.value = 4;
    m.uniforms.rayleigh.value = 3;
    m.uniforms.mieCoefficient.value = 0.006;
    m.uniforms.mieDirectionalG.value = 0.84;
    this.sky.scale.setScalar(800);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    scene.fog = new THREE.FogExp2("#cfc5ad", 0.0045);
    const envSky = new THREE.Mesh(this.sky.geometry, m);
    envSky.scale.setScalar(800);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.build();
  }

  private build(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.fxaa = null;
    this.ao?.dispose();
    this.ao = null;
    if (this.quality === 0) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.quality >= 2 ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality >= 3) {
      this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.1, samples: 12 });
      this.ao.blendIntensity = 0.85;
      composer.addPass(this.ao);
    }
    if (this.quality >= 2) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.5, 0.95);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    if (this.quality === 1) {
      this.fxaa = new ShaderPass(FXAAShader);
      composer.addPass(this.fxaa);
    }
    this.grade = new ShaderPass(GRADE);
    composer.addPass(this.grade);
    this.composer = composer;
    this.setSize(this.size.x, this.size.y);
  }

  setQuality(q: number): void {
    if (q === this.quality) return;
    this.quality = q;
    this.build();
  }

  setSize(w: number, h: number): void {
    this.size.set(w, h);
    if (!this.composer) return;
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom?.setSize(w / 2, h / 2);
    // Ambient occlusion at half resolution keeps it affordable.
    this.ao?.setSize(Math.floor((w * pr) / 2), Math.floor((h * pr) / 2));
    if (this.fxaa) (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
  }

  /** Sets the sky and fog for the time of day. `day` is 0 at night to 1 at noon; `dusk` peaks at sunrise and sunset. */
  setTime(day: number, dusk: number, sunDir: THREE.Vector3): void {
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    const night = 1 - Math.min(1, day * 1.6);
    const rain = this.rain;
    (u.sunPosition.value as THREE.Vector3).copy(sunDir);
    u.night.value = night;
    u.cover.value = 0.32 + rain * 0.66;
    // The analytic sky runs hot at midday; tame it so bloom doesn't veil the scene.
    u.skyGain.value = (0.5 + dusk * 0.35) * (1 - rain * 0.3);
    u.turbidity.value = 4 + rain * 8 + dusk * 2;
    const haze = new THREE.Color("#c4ccd0").lerp(new THREE.Color("#d79a68"), Math.min(1, dusk * 0.75)).lerp(new THREE.Color("#8e9396"), rain * 0.8).lerp(new THREE.Color("#0b0e15"), night);
    (u.hazeColor.value as THREE.Color).copy(haze);
    u.haze.value = 0.62 + rain * 0.38;
    const sunCol = new THREE.Color("#fff4e2").lerp(new THREE.Color("#ff9c58"), Math.min(1, dusk));
    (u.cloudLit.value as THREE.Color).copy(sunCol).multiplyScalar((0.25 + day * 0.85) * (1 - rain * 0.55)).lerp(new THREE.Color("#141822"), night * 0.92);
    (u.cloudShade.value as THREE.Color).set("#8a909a").multiplyScalar((0.2 + day * 0.6) * (1 - rain * 0.45)).lerp(new THREE.Color("#07090e"), night * 0.95);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(haze);
    fog.density = 0.0026 + night * 0.0016 + dusk * 0.0008 + rain * 0.006;
    if (this.bloom) this.bloom.strength = 0.3 + night * 0.45 + rain * 0.1;
    if (this.grade) this.grade.uniforms.saturation.value = 0.9 - rain * 0.2;
  }

  /** Re-bakes the sky into the reflection map. Cheap enough to do every game half hour. */
  bakeEnvironment(): void {
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    this.scene.environment = this.envTarget.texture;
  }

  render(time: number): void {
    this.sky.position.copy((this.camera as THREE.PerspectiveCamera).position);
    (this.sky.material as THREE.ShaderMaterial).uniforms.time.value = time % 10000;
    if (this.composer) {
      if (this.grade) this.grade.uniforms.time.value = time % 100;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }
}
