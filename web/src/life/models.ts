import * as THREE from "three";
import { blob, concrete, grain, normalMap, plaster, worldUV, zinc } from "./textures";

/**
 * The models, built from primitives with physically based materials and procedural textures,
 * so the whole game stays one file and still reads as a grimy, lived-in place.
 */

const materials = new Map<string, THREE.MeshStandardMaterial>();

/** A plain rough surface: cloth, rubber, earth, painted steel that has seen some years. */
export function mat(color: string | number, emissive?: string): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive ?? ""}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, bumpMap: grain(), bumpScale: 0.6 });
    if (emissive) m.emissive = new THREE.Color(emissive);
    materials.set(key, m);
  }
  return m;
}

/** Vehicle paint: a little metallic, glossy enough to catch the sky. */
export function paint(color: string): THREE.MeshStandardMaterial {
  const key = `paint|${color}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.35 });
    materials.set(key, m);
  }
  return m;
}

/** Vehicle paint caked in red dust in patches, for anything that works on the lease. */
export function dustyPaint(color: string): THREE.MeshStandardMaterial {
  const key = `dusty|${color}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vWorld;
float dh(vec3 p) { return fract(sin(dot(p, vec3(12.99, 78.23, 45.16))) * 43758.55); }
float dn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dh(i), dh(i + vec3(1,0,0)), f.x), mix(dh(i + vec3(0,1,0)), dh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dh(i + vec3(0,0,1)), dh(i + vec3(1,0,1)), f.x), mix(dh(i + vec3(0,1,1)), dh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float dust = 0.0;`,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
dust = smoothstep(0.45, 0.8, dn(vWorld * 0.9) * 0.6 + dn(vWorld * 3.1) * 0.4);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.24, 0.15), dust * 0.75);`,
        )
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, dust);")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - dust;");
    };
    m.customProgramCacheKey = () => "dusty";
    materials.set(key, m);
  }
  return m;
}

/** A soft dark disc that grounds people and vehicles, even beyond the shadow map. */
const blobMat = new THREE.MeshBasicMaterial({ color: "#000000", alphaMap: blob(), transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function contactShadow(w: number, d: number, opacity = 0.5): THREE.Mesh {
  const m = new THREE.Mesh(blobGeo, opacity === 0.5 ? blobMat : Object.assign(blobMat.clone(), { opacity }));
  m.scale.set(w, 1, d);
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

/** Bare steel, chrome-ish. */
export const steel = new THREE.MeshStandardMaterial({ color: "#9a9ea2", roughness: 0.35, metalness: 0.85 });
/** Tyres. */
export const rubber = new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.95, metalness: 0 });

function surface(kind: "plaster" | "zinc" | "concrete", color: string): THREE.MeshStandardMaterial {
  const key = `${kind}|${color}`;
  let m = materials.get(key);
  if (!m) {
    const map = kind === "plaster" ? plaster() : kind === "zinc" ? zinc() : concrete();
    m = new THREE.MeshStandardMaterial({
      color,
      map,
      roughness: kind === "zinc" ? 0.55 : 0.92,
      metalness: kind === "zinc" ? 0.45 : 0,
      // Relief from the texture itself: zinc ridges, plaster cracks and pitting, block joints.
      normalMap: normalMap(map, kind, kind === "zinc" ? 3 : 2.2),
      normalScale: new THREE.Vector2(1, 1),
    });
    materials.set(key, m);
  }
  return m;
}
export const wallMat = (c: string) => surface("plaster", c);
export const roofMat = (c: string) => surface("zinc", c);
export const concreteMat = (c = "#bdb8ae") => surface("concrete", c);

/** Window glass: dark and reflective by day, warm light at night (the game sets emissiveIntensity). */
export const windowGlow = new THREE.MeshStandardMaterial({
  color: "#1a2026", roughness: 0.12, metalness: 0.7, emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0,
});
/** Street lamps and headlights, brighter than windows so they bloom at night. */
export const lampGlow = new THREE.MeshStandardMaterial({ color: "#f3efe0", roughness: 0.3, emissive: new THREE.Color("#ffd9a0"), emissiveIntensity: 0 });

export function box(w: number, h: number, d: number, color: string | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "string" ? mat(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A box whose texture tiles in world units, for walls, slabs and roofs. */
export function slab(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, tile = 8, fullHeight = false): THREE.Mesh {
  const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), tile, fullHeight), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cylinder(rTop: number, rBottom: number, h: number, color: string | THREE.Material, segments = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), typeof color === "string" ? mat(color) : color);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function capsule(r: number, len: number, material: THREE.Material, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 10), material);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

function ball(r: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function pivot(x: number, y: number, z: number, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(...children);
  return g;
}

export interface Look {
  skin: string;
  shirt: string;
  trousers: string;
  /** Hard hat colour; none for townspeople. */
  hat?: string;
  /** Hi-vis stripes on the shirt. */
  vest?: boolean;
}

export const SKINS = ["#5b3a24", "#6e4529", "#4a2e1c", "#7d5233", "#3d2516"];

const cloth = (c: string) => {
  const key = `cloth|${c}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, bumpMap: grain(), bumpScale: 1.2 });
    materials.set(key, m);
  }
  return m;
};
const skinMat = (c: string) => {
  const key = `skin|${c}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
    materials.set(key, m);
  }
  return m;
};

/** A jointed person: hips, knees, shoulders and elbows, with clothes, hair and kit. Faces +z. */
export class Person {
  readonly group = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private readonly arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  private readonly body: THREE.Group;
  /** Whatever the person is holding sits here, in front of the chest. */
  readonly hands = new THREE.Group();
  carrying = false;
  sitting = false;
  private phase = Math.random() * 6;

  constructor(look: Look) {
    const skin = skinMat(look.skin);
    const shirt = cloth(look.shirt);
    const trousers = cloth(look.trousers);
    const shoe = mat("#1e1914");
    for (const side of [-1, 1]) {
      const shin = capsule(0.12, 0.42, trousers, -0.26);
      const foot = box(0.24, 0.13, 0.42, shoe, 0, -0.58, 0.07);
      const knee = pivot(0, -0.48, 0, shin, foot);
      const hip = pivot(side * 0.17, 1.12, 0, capsule(0.145, 0.38, trousers, -0.24), knee);
      this.legs.push({ hip, knee });
    }
    for (const side of [-1, 1]) {
      const forearm = capsule(0.085, 0.3, side > 0 && look.vest ? skin : skin, -0.2);
      const hand = ball(0.085, skin, 0, -0.43, 0.02);
      const elbow = pivot(0, -0.38, 0, forearm, hand);
      const sleeve = capsule(0.105, 0.24, shirt, -0.17);
      const shoulder = pivot(side * 0.4, 1.86, 0, sleeve, elbow);
      this.arms.push({ shoulder, elbow });
    }
    const pelvis = capsule(0.22, 0.12, trousers, 1.18);
    pelvis.scale.set(1.15, 1, 0.75);
    const chest = capsule(0.3, 0.42, shirt, 1.56);
    chest.scale.set(1.2, 1, 0.68);
    const neck = cylinder(0.085, 0.1, 0.18, skin, 8);
    neck.position.y = 2.02;
    const head = ball(0.21, skin, 0, 2.27, 0.01);
    head.scale.set(0.92, 1.12, 1);
    const nose = ball(0.045, skin, 0, 2.25, 0.21);
    const eyes = [ball(0.028, mat("#120c08"), -0.075, 2.31, 0.18), ball(0.028, mat("#120c08"), 0.075, 2.31, 0.18)];
    this.body = pivot(0, 0, 0, pelvis, chest, neck, head, nose, ...eyes, ...this.arms.map((a) => a.shoulder), this.hands);
    if (look.vest) {
      const vest = capsule(0.315, 0.36, new THREE.MeshStandardMaterial({ color: "#c8e830", roughness: 0.7, emissive: new THREE.Color("#3a4400") }), 1.58);
      vest.scale.set(1.22, 0.95, 0.72);
      const stripe = new THREE.MeshStandardMaterial({ color: "#d8d8d8", roughness: 0.25, metalness: 0.6 });
      const band = (y: number) => {
        const b = cylinder(0.38, 0.38, 0.06, stripe, 16);
        b.scale.set(1.0, 1, 0.6);
        b.position.y = y;
        return b;
      };
      this.body.add(vest, band(1.45), band(1.68));
    }
    if (look.hat) {
      const hatMat = paint(look.hat);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
      dome.position.y = 2.38;
      dome.scale.set(1, 0.95, 1.1);
      dome.castShadow = true;
      const brim = cylinder(0.31, 0.31, 0.03, hatMat, 18);
      brim.scale.set(1, 1, 1.15);
      brim.position.set(0, 2.39, 0.03);
      this.body.add(dome, brim);
    } else {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat("#16100c"));
      hair.position.set(0, 2.29, -0.01);
      hair.scale.set(0.95, 1.1, 1.03);
      this.body.add(hair);
    }
    this.hands.position.set(0, 1.45, 0.5);
    this.group.add(...this.legs.map((l) => l.hip), this.body, contactShadow(1.3, 1.3, 0.45));
  }

  /** Call every frame with the ground speed in units per second. */
  animate(dt: number, speed: number): void {
    const [l, r] = this.legs;
    const [al, ar] = this.arms;
    if (this.sitting) {
      l.hip.rotation.x = r.hip.rotation.x = -1.45;
      l.knee.rotation.x = r.knee.rotation.x = 1.45;
      this.body.position.y = -0.5;
      l.hip.position.y = r.hip.position.y = 0.62;
      al.shoulder.rotation.x = ar.shoulder.rotation.x = -0.5;
      al.elbow.rotation.x = ar.elbow.rotation.x = -0.9;
      return;
    }
    l.hip.position.y = r.hip.position.y = 1.12;
    this.phase += dt * (speed > 0.1 ? 1.6 + speed * 0.62 : 2);
    const amount = Math.min(1, speed / 6.5);
    const s = Math.sin(this.phase);
    l.hip.rotation.x = s * 0.62 * amount;
    r.hip.rotation.x = -s * 0.62 * amount;
    // Knees bend on the swing-through.
    l.knee.rotation.x = Math.max(0, Math.cos(this.phase)) * 1.1 * amount;
    r.knee.rotation.x = Math.max(0, -Math.cos(this.phase)) * 1.1 * amount;
    if (this.carrying) {
      al.shoulder.rotation.x = ar.shoulder.rotation.x = -0.9;
      al.elbow.rotation.x = ar.elbow.rotation.x = -0.9;
    } else {
      al.shoulder.rotation.x = -s * 0.55 * amount;
      ar.shoulder.rotation.x = s * 0.55 * amount;
      al.elbow.rotation.x = ar.elbow.rotation.x = -0.25 - 0.45 * amount;
    }
    al.shoulder.rotation.z = -0.06;
    ar.shoulder.rotation.z = 0.06;
    const breathe = speed < 0.1 ? Math.sin(this.phase) * 0.012 : 0;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.07 * amount + breathe;
    this.body.rotation.y = s * 0.08 * amount;
  }

  setPose(raiseArms: number): void {
    for (const a of this.arms) a.shoulder.rotation.x = -raiseArms;
  }
}

/** A tyre with a steel rim, axle along x. */
function wheel(r: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 8, 18), rubber);
  tyre.rotation.y = Math.PI / 2;
  tyre.scale.z = w / (r * 0.6);
  tyre.castShadow = true;
  const rim = cylinder(r * 0.48, r * 0.48, w * 0.8, steel, 14);
  rim.rotation.z = Math.PI / 2;
  const hub = cylinder(r * 0.16, r * 0.16, w * 0.95, mat("#3a3a3a"), 8);
  hub.rotation.z = Math.PI / 2;
  g.add(tyre, rim, hub);
  return g;
}

/** Red dust on the lower body of anything that works in the pit. */
const grime = new THREE.MeshStandardMaterial({ color: "#7a4a30", roughness: 1, bumpMap: grain(), bumpScale: 1.5 });

/** A rigid-frame haul truck. Faces +z. The tray tips by rotating `bed`. */
export class HaulTruck {
  readonly group = new THREE.Group();
  readonly bed: THREE.Group;
  private readonly load: THREE.Mesh;
  private readonly wheels: THREE.Group[] = [];

  constructor(colour = "#e8a700") {
    const g = this.group;
    const body = dustyPaint(colour);
    g.add(contactShadow(7.5, 12.5, 0.6));
    g.add(box(3.6, 1, 9.6, mat("#2d2d2d"), 0, 1.95, 0)); // chassis rails
    g.add(box(4.9, 1.0, 1.4, body, 0, 2.95, 4.55)); // front deck
    g.add(box(3.7, 1.6, 0.7, mat("#1b1b1b"), 0, 2.4, 5.0)); // radiator
    for (let i = 0; i < 6; i++) g.add(box(3.3, 0.08, 0.05, steel, 0, 1.85 + i * 0.22, 5.37)); // grille bars
    const cab = box(1.9, 1.8, 2, body, -1.35, 4.35, 3.95);
    g.add(cab);
    g.add(box(1.92, 0.8, 1.6, windowGlow, -1.35, 4.65, 3.95)); // side glass
    g.add(box(1.7, 0.85, 0.06, windowGlow, -1.35, 4.65, 4.97)); // windscreen
    g.add(box(0.12, 2.2, 0.12, steel, -2.6, 3.6, 4.9), box(0.6, 0.12, 0.12, steel, -2.35, 2.6, 4.9)); // ladder rail
    for (let i = 0; i < 4; i++) g.add(box(0.7, 0.06, 0.4, steel, -2.4, 1.2 + i * 0.5, 4.9));
    const stack = cylinder(0.14, 0.14, 1.6, mat("#222"), 8);
    stack.position.set(1.4, 4.1, 3.6);
    g.add(stack);
    for (const x of [-1.6, 1.6]) {
      const lamp = box(0.5, 0.3, 0.08, lampGlow, x, 3.15, 5.27);
      g.add(lamp);
    }
    for (const [x, z] of [[-2.1, 3.4], [2.1, 3.4], [-2.15, -2.6], [2.15, -2.6], [-1.15, -2.6], [1.15, -2.6]] as const) {
      const w = wheel(1.4, x * x > 3 ? 1.0 : 0.9);
      w.position.set(x, 1.4, z);
      this.wheels.push(w);
      g.add(w);
    }
    g.add(box(1.2, 0.3, 3, grime, -2.1, 2.9, 3.4), box(1.2, 0.3, 3, grime, 2.1, 2.9, 3.4)); // mudguards
    // The tray hinges at the back; children sit forward of the hinge. Tip with a negative rotation.x.
    const tray = new THREE.Group();
    tray.add(box(5, 0.35, 7.6, body, 0, 0, 3.8));
    for (const x of [-2.45, 2.45]) {
      tray.add(box(0.25, 2.3, 7.6, body, x, 1.15, 3.8));
      for (let z = 0.6; z < 7.6; z += 1.5) tray.add(box(0.18, 2.3, 0.22, body, x + Math.sign(x) * 0.18, 1.15, z)); // ribs
    }
    tray.add(box(5, 2.7, 0.3, body, 0, 1.35, 7.5)); // headboard
    tray.add(box(5.2, 0.3, 1.9, body, 0, 2.6, 8.3)); // canopy over the cab
    tray.add(box(5.05, 0.6, 7.65, grime, 0, -0.1, 3.8));
    this.load = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat("#7a4026"));
    this.load.scale.set(0.9, 0.7, 1.45);
    this.load.position.set(0, 0.6, 3.8);
    this.load.visible = false;
    tray.add(this.load);
    this.bed = pivot(0, 2.6, -4.4, tray);
    g.add(this.bed);
  }

  setLoad(kind: "ore" | "waste" | null): void {
    this.load.visible = kind !== null;
    if (kind) this.load.material = mat(kind === "ore" ? "#7a4026" : "#9a9184");
  }

  get loaded(): boolean {
    return this.load.visible;
  }

  roll(distance: number): void {
    for (const w of this.wheels) w.rotation.x += distance / 1.4;
  }
}

/** A hydraulic excavator. Faces +z; `house` swings on the tracks, `boom` and `stick` lift. */
export class Excavator {
  readonly group = new THREE.Group();
  readonly house = new THREE.Group();
  readonly boom = new THREE.Group();
  readonly stick = new THREE.Group();
  readonly bucketLoad: THREE.Mesh;

  constructor() {
    const body = paint("#e8a700");
    const track = mat("#262626");
    for (const x of [-2, 2]) {
      this.group.add(box(1.4, 1.2, 6.4, track, x, 0.7, 0));
      for (const z of [-3.2, 3.2]) {
        const end = cylinder(0.6, 0.6, 1.4, track, 12);
        end.rotation.z = Math.PI / 2;
        end.position.set(x, 0.7, z);
        this.group.add(end);
      }
      for (let z = -3; z <= 3; z += 0.5) this.group.add(box(1.45, 0.12, 0.2, mat("#3a3a3a"), x, 1.32, z));
      this.group.add(box(1.42, 0.5, 6.2, grime, x, 0.35, 0));
    }
    this.group.add(box(3, 0.8, 4, mat("#333"), 0, 1.3, 0));
    this.house.position.y = 1.7;
    this.house.add(box(5, 2.2, 5.4, body, 0, 1.1, -0.6));
    this.house.add(box(2, 2.1, 2.1, body, -1.4, 3.15, 1.2), box(2.02, 1.2, 1.8, windowGlow, -1.4, 3.35, 1.2), box(1.8, 1.3, 0.06, windowGlow, -1.4, 3.3, 2.27));
    this.house.add(box(4.6, 1.7, 1.3, mat("#2f2f2f"), 0, 1.3, -3.5)); // counterweight
    this.house.add(box(0.1, 1, 2.4, steel, 2.55, 2.4, -1.2)); // handrail
    this.boom.position.set(0.9, 2.2, 1.8);
    this.boom.add(box(0.95, 1.05, 7.2, body, 0, 0, 3.5));
    const ram = cylinder(0.18, 0.18, 4.5, steel, 8);
    ram.rotation.x = Math.PI / 2 - 0.25;
    ram.position.set(0, -0.8, 2.2);
    this.boom.add(ram);
    this.stick.position.set(0, 0, 7);
    this.stick.add(box(0.75, 0.8, 5, body, 0, 0, 2.5));
    const bucket = pivot(0, 0, 5, box(2.1, 1.3, 1.5, mat("#4b4b4b"), 0, -0.4, 0.4));
    for (let i = -2; i <= 2; i++) bucket.add(box(0.18, 0.15, 0.45, steel, i * 0.45, -1.05, 0.9)); // teeth
    this.bucketLoad = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat("#7a4026"));
    this.bucketLoad.position.set(0, 0.25, 0.4);
    this.bucketLoad.visible = false;
    bucket.add(this.bucketLoad);
    this.stick.add(bucket);
    this.boom.add(this.stick);
    this.house.add(this.boom);
    this.group.add(this.house);
    this.pose(0.4, 1);
  }

  /** lift 0 is digging at the ground, 1 is raised to dump over a truck. */
  pose(lift: number, curl: number): void {
    this.boom.rotation.x = -0.15 - lift * 0.55;
    this.stick.rotation.x = 0.9 + curl * 0.6 - lift * 0.5;
  }
}

/** The slogan painted on the back of the trotro. */
function slogan(text: string): THREE.MeshStandardMaterial {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e9e3d3";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#b8241f";
  ctx.font = "italic 700 64px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.2 });
}

/** A Sprinter-style minibus, painted the way trotros are. Faces +z. */
export class Trotro {
  readonly group = new THREE.Group();
  constructor() {
    const g = this.group;
    const white = paint("#e9e3d3");
    g.add(box(3.5, 2.7, 8.2, white, 0, 2.35, -0.3));
    g.add(box(3.3, 1.5, 1.4, white, 0, 1.85, 4.4)); // bonnet
    const screen = box(3.2, 1.3, 0.08, windowGlow, 0, 3.1, 3.72);
    screen.rotation.x = -0.35;
    g.add(screen);
    g.add(box(3.52, 0.45, 8.22, paint("#1f5f9e"), 0, 1.35, -0.3), box(3.54, 0.2, 8.24, paint("#b8241f"), 0, 1.75, -0.3));
    g.add(box(3.54, 1.0, 6.4, windowGlow, 0, 3.0, -0.8));
    g.add(box(3.4, 0.25, 0.3, steel, 0, 1.15, 5.1), box(3.4, 0.25, 0.3, steel, 0, 1.15, -4.5)); // bumpers
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), slogan("God Dey"));
    back.rotation.y = Math.PI;
    back.position.set(0, 2.25, -4.42);
    g.add(back);
    for (const x of [-1.2, 1.2]) g.add(box(0.5, 0.3, 0.08, lampGlow, x, 1.95, 5.12));
    g.add(box(3.2, 0.25, 4.8, mat("#333"), 0, 3.8, -0.5)); // roof rack
    g.add(box(2.4, 0.8, 1.3, mat("#7d4f27"), -0.3, 4.3, 0.3), box(1.2, 0.6, 1.1, mat("#2c5d8a"), 0.8, 4.2, -1.6)); // luggage
    for (const [x, z] of [[-1.65, 3.3], [1.65, 3.3], [-1.65, -2.9], [1.65, -2.9]] as const) {
      const w = wheel(0.72, 0.5);
      w.position.set(x, 0.72, z);
      g.add(w);
    }
  }
}

/** A Ghanaian taxi: a small saloon with the painted corner panels. Faces +z. */
export function taxi(): THREE.Group {
  const g = new THREE.Group();
  const yellow = paint("#d9a514");
  const red = paint("#b8241f");
  g.add(box(2.3, 0.9, 5, red, 0, 0.95, 0));
  g.add(box(2.32, 0.5, 2.0, yellow, 0, 1.0, 1.6), box(2.32, 0.5, 2.0, yellow, 0, 1.0, -1.6));
  g.add(box(2.0, 0.8, 2.4, red, 0, 1.75, -0.2), box(2.04, 0.6, 2.2, windowGlow, 0, 1.78, -0.2));
  for (const x of [-0.75, 0.75]) g.add(box(0.4, 0.2, 0.06, lampGlow, x, 1.0, 2.52));
  g.add(box(0.6, 0.25, 0.3, mat("#f2f2f2"), 0, 2.27, -0.2));
  for (const [x, z] of [[-1.1, 1.6], [1.1, 1.6], [-1.1, -1.6], [1.1, -1.6]] as const) {
    const w = wheel(0.45, 0.35);
    w.position.set(x, 0.45, z);
    g.add(w);
  }
  return g;
}

export interface BuildingSpec {
  w: number;
  d: number;
  h: number;
  wall: string;
  roof: string;
  /** Gable roofs run along the longer side; flat roofs get a parapet. */
  roofType?: "gable" | "flat" | "shed";
  windows?: boolean;
}

/** A pitched zinc roof with proper UVs so the corrugations run down the slope. */
function gableRoof(w: number, d: number, h: number, colour: string): THREE.Mesh {
  const hw = w / 2 + 0.7;
  const hd = d / 2 + 0.7;
  const rh = Math.min(w, d) * 0.28;
  const slope = Math.hypot(hw, rh);
  const tile = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[], ua: number[], ub: number[], uc: number[], ue: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
    uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ue);
  };
  // Left and right slopes; u along the ridge, v down the slope.
  quad([-hw, h, hd], [0, h + rh, hd], [0, h + rh, -hd], [-hw, h, -hd], [0, 0], [0, slope / tile], [(2 * hd) / tile, slope / tile], [(2 * hd) / tile, 0]);
  quad([hw, h, -hd], [0, h + rh, -hd], [0, h + rh, hd], [hw, h, hd], [0, 0], [0, slope / tile], [(2 * hd) / tile, slope / tile], [(2 * hd) / tile, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const m = roofMat(colour).clone();
  m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

let buildingCount = 0;

/** A building centred on its footprint, door facing +z: plastered walls, plinth, frames, bars. */
export function building(spec: BuildingSpec): THREE.Group {
  const g = new THREE.Group();
  const { w, d, h } = spec;
  const n = buildingCount++;
  g.add(slab(w, h, d, wallMat(spec.wall), 0, h / 2, 0, 9, true));
  g.add(slab(w + 0.3, 0.55, d + 0.3, concreteMat("#8f8a80"), 0, 0.27, 0, 4)); // plinth
  const type = spec.roofType ?? "gable";
  if (type === "gable") {
    g.add(gableRoof(w, d, h, spec.roof));
    g.add(slab(w + 1.4, 0.35, 0.18, mat("#5a4a3a"), 0, h - 0.1, d / 2 + 0.7), slab(w + 1.4, 0.35, 0.18, mat("#5a4a3a"), 0, h - 0.1, -d / 2 - 0.7)); // fascia
    // Gable ends.
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, Math.min(w, d) * 0.28 - 0.05)]);
    for (const z of [d / 2, -d / 2]) {
      const end = new THREE.Mesh(new THREE.ShapeGeometry(tri), wallMat(spec.wall));
      end.position.set(0, h, z);
      if (z < 0) end.rotation.y = Math.PI;
      g.add(end);
    }
  } else if (type === "shed") {
    const roof = slab(w + 1.2, 0.25, d + 1.6, roofMat(spec.roof), 0, h + 0.4, 0, 4);
    roof.rotation.x = 0.08;
    g.add(roof);
  } else {
    g.add(slab(w + 0.4, 0.9, d + 0.4, concreteMat(spec.roof), 0, h + 0.45, 0, 6));
    if (n % 2 === 0) {
      // A black polytank on the roof, like half the town.
      const tank = cylinder(0.9, 0.9, 1.8, mat("#141414"), 14);
      tank.position.set(w / 2 - 1.6, h + 1.8, -d / 2 + 1.6);
      g.add(tank, box(2.2, 0.6, 2.2, concreteMat(), w / 2 - 1.6, h + 0.9, -d / 2 + 1.6));
    }
  }
  const doorW = Math.min(2.2, w * 0.25);
  const doorH = Math.min(3.2, h * 0.7);
  g.add(box(doorW + 0.3, doorH + 0.2, 0.2, mat("#3b3028"), 0, doorH / 2, d / 2 + 0.05));
  g.add(box(doorW, doorH, 0.22, paint(n % 3 ? "#5b3b22" : "#2f4a5a"), 0, doorH / 2, d / 2 + 0.08));
  g.add(box(doorW + 1.2, 0.25, 1.4, concreteMat(), 0, 0.12, d / 2 + 0.75)); // step
  if (spec.windows !== false) {
    const rows = Math.max(1, Math.floor(h / 5));
    const bars = mat("#222");
    for (let r = 0; r < rows; r++) {
      const y = 2.5 + r * 4.5;
      for (let x = -w / 2 + 2.5; x <= w / 2 - 2.5; x += 4.5) {
        if (Math.abs(x) < doorW) continue;
        for (const side of [1, -1]) {
          const z = side * (d / 2 + 0.06);
          g.add(box(1.9, 1.7, 0.1, mat("#d9d4c8"), x, y, z)); // frame
          g.add(box(1.6, 1.4, 0.14, windowGlow, x, y, z));
          for (let b = -0.6; b <= 0.61; b += 0.3) g.add(box(0.05, 1.4, 0.18, bars, x + b, y, z)); // burglar bars
        }
      }
    }
    if (n % 3 === 1) g.add(box(1.2, 0.7, 0.6, mat("#d8d8d0"), w / 2 - 1.5, h - 1.2, -d / 2 - 0.35)); // AC unit
  }
  return g;
}

/** Text that floats above a place and always faces the camera. */
export function label(text: string, colour = "#ffffff", background = "rgba(14,14,12,0.62)"): THREE.Sprite {
  const scale = 4;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `700 ${16 * scale}px Fredoka, "Trebuchet MS", sans-serif`;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 28 * scale;
  canvas.width = width;
  canvas.height = 30 * scale;
  ctx.font = font;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, canvas.height, 10 * scale);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, canvas.height / 2 + scale);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const h = 2.2;
  sprite.scale.set((h * width) / canvas.height, h, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/** A small okada motorbike. Faces +z; `fork` steers, wheels roll. The rider sits at `seat`. */
export class Motorbike {
  readonly group = new THREE.Group();
  readonly fork = new THREE.Group();
  readonly seat = new THREE.Vector3(0, 0.62, -0.25);
  private readonly wheels: THREE.Group[] = [];

  constructor(colour = "#b8241f") {
    const g = this.group;
    const body = paint(colour);
    const black = mat("#1b1b1b");
    const back = wheel(0.36, 0.16);
    back.position.set(0, 0.36, -0.75);
    const front = wheel(0.36, 0.14);
    front.position.set(0, -0.74, 0.3);
    this.wheels.push(back, front);
    // Frame, tank, seat, side covers and exhaust.
    const frame = box(0.12, 0.12, 1.3, steel, 0, 0.62, 0);
    frame.rotation.x = 0.25;
    const tank = box(0.36, 0.26, 0.5, body, 0, 0.92, 0.25);
    const seat = box(0.3, 0.12, 0.7, black, 0, 0.88, -0.32);
    const cover = box(0.34, 0.26, 0.4, body, 0, 0.66, -0.35);
    const engine = box(0.3, 0.28, 0.34, mat("#4a4a4a"), 0, 0.42, 0.02);
    const pipe = cylinder(0.05, 0.06, 0.9, steel, 8);
    pipe.rotation.x = Math.PI / 2 - 0.12;
    pipe.position.set(0.2, 0.36, -0.42);
    const rack = box(0.34, 0.04, 0.38, steel, 0, 0.92, -0.85);
    const fender = box(0.18, 0.05, 0.5, body, 0, 0.78, -0.8);
    g.add(back, frame, tank, seat, cover, engine, pipe, rack, fender);
    // Fork, front wheel, bars and lamp turn together.
    const legs = box(0.06, 0.75, 0.06, steel, -0.1, -0.25, 0.12);
    const legs2 = box(0.06, 0.75, 0.06, steel, 0.1, -0.25, 0.12);
    legs.rotation.x = legs2.rotation.x = 0.35;
    const bars = box(0.75, 0.05, 0.05, steel, 0, 0.24, -0.04);
    const grips = [box(0.14, 0.07, 0.07, black, -0.4, 0.24, -0.04), box(0.14, 0.07, 0.07, black, 0.4, 0.24, -0.04)];
    const lamp = box(0.18, 0.16, 0.08, lampGlow, 0, 0.06, 0.18);
    const frontFender = box(0.16, 0.04, 0.4, body, 0, -0.18, 0.34);
    this.fork.add(legs, legs2, bars, ...grips, lamp, front, frontFender);
    this.fork.position.set(0, 0.98, 0.62);
    this.fork.rotation.x = -0.3;
    g.add(this.fork, contactShadow(0.9, 2.2, 0.55));
  }

  roll(distance: number): void {
    for (const w of this.wheels) w.rotation.x += distance / 0.36;
  }

  steer(angle: number): void {
    this.fork.rotation.y = angle;
  }
}
