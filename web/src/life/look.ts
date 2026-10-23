import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * The camera look: a hazy sky with a sun glow, smoggy fog, filmic tone mapping, bloom, and a
 * grade that pulls colour out and pushes it to sodium yellow in the highlights and grey-green in
 * the shadows, with a vignette and a little grain. Drops effects on slow devices.
 */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunSize;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.4));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 900.0) * 30.0 * sunSize + pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
}`;

const GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    saturation: { value: 0.74 },
    contrast: { value: 1.1 },
    shadowTint: { value: new THREE.Vector3(0.9, 0.98, 1.0) },
    highTint: { value: new THREE.Vector3(1.08, 1.0, 0.82) },
    vignette: { value: 0.42 },
    grain: { value: 0.045 },
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
  // Soft shoulder so the yellow highlights don't clip.
  c = c / (1.0 + max(c - 0.9, 0.0) * 2.0);
  float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.15, 1.0)) * 1.25);
  c *= mix(1.0 - vignette, 1.0, v);
  c += (hash(vUv * 1000.0 + time) - 0.5) * grain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

export class FilmLook {
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** 2 is everything, 1 drops bloom and MSAA, 0 drops post-processing and shadows. */
  quality = 2;
  private size = new THREE.Vector2(1, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          ground: { value: new THREE.Color() },
          sunDir: { value: new THREE.Vector3(0, 1, 0) },
          sunColor: { value: new THREE.Color() },
          sunSize: { value: 1 },
        },
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    scene.fog = new THREE.FogExp2("#cfc5ad", 0.0045);
    this.envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.build();
  }

  private build(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (this.quality === 0) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.quality >= 2 ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality >= 2) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.65, 0.86);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
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
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom?.setSize(w / 2, h / 2);
  }

  /** Sets the sky and fog for the time of day. `day` is 0 at night to 1 at noon; `dusk` peaks at sunrise and sunset. */
  setTime(day: number, dusk: number, sunDir: THREE.Vector3): void {
    const u = this.sky.material.uniforms;
    const night = 1 - Math.min(1, day * 1.5);
    const zenith = new THREE.Color("#5f86ad").lerp(new THREE.Color("#060a14"), night);
    const horizon = new THREE.Color("#d8cfb4").lerp(new THREE.Color("#e39a5c"), Math.min(1, dusk * 0.8)).lerp(new THREE.Color("#141820"), night);
    (u.zenith.value as THREE.Color).copy(zenith);
    (u.horizon.value as THREE.Color).copy(horizon);
    (u.ground.value as THREE.Color).copy(horizon).multiplyScalar(0.55);
    (u.sunDir.value as THREE.Vector3).copy(sunDir);
    (u.sunColor.value as THREE.Color).set("#fff0d0").lerp(new THREE.Color("#ff8a3c"), Math.min(1, dusk)).multiplyScalar(sunDir.y > -0.05 ? 1 : 0);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(horizon).lerp(zenith, 0.15);
    fog.density = 0.0036 + night * 0.002 + dusk * 0.001;
    if (this.bloom) this.bloom.strength = 0.38 + night * 0.5;
  }

  /** Re-bakes the sky into the reflection map. Cheap enough to do every game half hour. */
  bakeEnvironment(): void {
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    this.scene.environment = this.envTarget.texture;
  }

  render(time: number): void {
    this.sky.position.copy((this.camera as THREE.PerspectiveCamera).position);
    if (this.composer) {
      if (this.grade) this.grade.uniforms.time.value = time % 100;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }
}
