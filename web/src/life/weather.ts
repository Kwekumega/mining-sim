import * as THREE from "three";
import { Random } from "../sim/random";

/**
 * Weather and particles: rain streaks that follow the camera, and red dust kicked up by trucks
 * and bikes on dry laterite. Both run on the GPU from a time uniform, so they cost little.
 */

const RAIN_BOX = new THREE.Vector3(70, 40, 70);

export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, count = 5000) {
    const rng = new Random(5);
    const seeds = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = rng.next() * RAIN_BOX.x;
      const y = rng.next() * RAIN_BOX.y;
      const z = rng.next() * RAIN_BOX.z;
      for (let k = 0; k < 2; k++) {
        seeds.set([x, y, z], (i * 2 + k) * 3);
        ends[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute("end", new THREE.BufferAttribute(ends, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        centre: { value: new THREE.Vector3() },
        box: { value: RAIN_BOX },
        amount: { value: 0 },
        colour: { value: new THREE.Color("#b9c2c8") },
      },
      vertexShader: /* glsl */ `
uniform float time, amount;
uniform vec3 centre, box;
attribute float end;
varying float vFade;
void main() {
  vec3 p = position;
  p.y -= time * 32.0;
  p.x += time * 3.0;
  // Wrap the drop into a box that travels with the camera.
  p = mod(p - centre + box * 0.5, box) - box * 0.5 + centre;
  p += vec3(0.08, 1.3, 0.0) * end;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fewer drops in light rain; fade the far ones.
  float keep = step(fract(position.x * 7.13 + position.z * 3.71), amount);
  vFade = keep * (1.0 - smoothstep(15.0, 34.0, -mv.z)) * (0.35 + end * 0.65);
}`,
      fragmentShader: /* glsl */ `
uniform vec3 colour;
uniform float amount;
varying float vFade;
void main() {
  if (vFade < 0.01) discard;
  gl_FragColor = vec4(colour, vFade * 0.45);
}`,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(time: number, camera: THREE.Camera, amount: number, nightLight: number): void {
    const u = this.material.uniforms;
    u.time.value = time % 1000;
    (u.centre.value as THREE.Vector3).copy(camera.position);
    u.amount.value = amount;
    (u.colour.value as THREE.Color).set("#b9c2c8").multiplyScalar(0.35 + nightLight * 0.65);
    this.mesh.visible = amount > 0.01;
  }
}

/** A pool of soft dust puffs. `emit` adds one; they rise, spread and fade. */
export class Dust {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private next = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, private readonly count = 400) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("life", new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { colour: { value: new THREE.Color("#b98560") }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
attribute float life, size;
uniform float scale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * (0.4 + life * 1.6) * scale / -mv.z;
  vAlpha = (1.0 - life) * smoothstep(0.0, 0.08, life) * 0.42;
}`,
      fragmentShader: /* glsl */ `
uniform vec3 colour;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(d)) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(colour, a);
}`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, size: number, rng: Random): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos.set([x + rng.between(-0.5, 0.5), y + 0.3, z + rng.between(-0.5, 0.5)], i * 3);
    this.vel.set([rng.between(-0.8, 0.8), rng.between(0.6, 1.6), rng.between(-0.8, 0.8)], i * 3);
    this.life[i] = 0;
    this.size[i] = size * rng.between(0.7, 1.3);
  }

  update(dt: number, light: THREE.Color): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] >= 1) continue;
      this.life[i] = Math.min(1, this.life[i] + dt / 3.2);
      for (let k = 0; k < 3; k++) {
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
        this.vel[i * 3 + k] *= 1 - dt * 0.6;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.life.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    (this.material.uniforms.colour.value as THREE.Color).set("#b98560").multiply(light);
  }

  setViewport(height: number): void {
    this.material.uniforms.scale.value = height * 0.6;
  }
}

/** Today's weather: a dry morning, maybe a downpour in the afternoon. */
export class WeatherClock {
  private day = -1;
  private start = 0;
  private end = 0;
  private peak = 0;
  /** Forced rain until this game minute, for events. */
  forcedUntil = 0;
  current = 0;

  constructor(private readonly rng: Random) {}

  /** Rain intensity wanted at this time, 0 to 1. */
  target(minutes: number): number {
    const day = Math.floor(minutes / 1440);
    if (day !== this.day) {
      this.day = day;
      const wet = this.rng.next() < 0.35;
      this.start = wet ? this.rng.between(10, 20) : 99;
      this.end = this.start + this.rng.between(1, 3.5);
      this.peak = this.rng.between(0.5, 1);
    }
    if (minutes < this.forcedUntil) return 1;
    const h = (minutes % 1440) / 60;
    return h > this.start && h < this.end ? this.peak : 0;
  }

  /** Eases the rain toward its target; returns the new value. */
  step(minutes: number, dtMinutes: number): number {
    const t = this.target(minutes);
    const rate = dtMinutes / 20;
    this.current += Math.max(-rate, Math.min(rate, t - this.current));
    return this.current;
  }
}
