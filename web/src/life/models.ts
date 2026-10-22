import * as THREE from "three";

/** Low-poly models built from boxes and cylinders, so the whole game stays one small file. */

const materials = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: string | number, emissive?: string): THREE.MeshLambertMaterial {
  const key = `${color}|${emissive ?? ""}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    if (emissive) m.emissive = new THREE.Color(emissive);
    materials.set(key, m);
  }
  return m;
}

/** Windows glow after dark; the game turns this up at night. */
export const windowGlow = new THREE.MeshLambertMaterial({ color: "#2b3540", emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 0 });

export function box(w: number, h: number, d: number, color: string | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "string" ? mat(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cylinder(rTop: number, rBottom: number, h: number, color: string, segments = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
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

/** A person with swinging arms and legs. Faces +z. */
export class Person {
  readonly group = new THREE.Group();
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly body: THREE.Group;
  /** Whatever the person is holding sits here, in front of the chest. */
  readonly hands = new THREE.Group();
  carrying = false;
  sitting = false;
  private phase = Math.random() * 6;

  constructor(look: Look) {
    const leg = () => pivot(0, 0, 0, box(0.36, 0.95, 0.38, look.trousers, 0, -0.47, 0), box(0.4, 0.2, 0.55, "#2a2420", 0, -0.92, 0.08));
    this.legL = leg();
    this.legR = leg();
    this.legL.position.set(-0.22, 0.98, 0);
    this.legR.position.set(0.22, 0.98, 0);
    const arm = () => pivot(0, 0, 0, box(0.24, 0.8, 0.26, look.shirt, 0, -0.38, 0), box(0.22, 0.2, 0.22, look.skin, 0, -0.85, 0));
    this.armL = arm();
    this.armR = arm();
    this.armL.position.set(-0.56, 1.82, 0);
    this.armR.position.set(0.56, 1.82, 0);
    const torso = box(0.86, 0.95, 0.48, look.shirt, 0, 1.42, 0);
    const head = box(0.5, 0.52, 0.5, look.skin, 0, 2.18, 0);
    this.body = pivot(0, 0, 0, torso, head, this.armL, this.armR, this.hands);
    if (look.vest) {
      this.body.add(box(0.9, 0.09, 0.5, "#e8f04a", 0, 1.25, 0), box(0.9, 0.09, 0.5, "#e8f04a", 0, 1.6, 0));
    }
    if (look.hat) {
      const hat = new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(look.hat));
      hat.position.set(0, 2.42, 0);
      hat.castShadow = true;
      this.body.add(hat, box(0.78, 0.05, 0.78, look.hat, 0, 2.43, 0.05));
    } else {
      this.body.add(box(0.54, 0.14, 0.54, "#1b1310", 0, 2.48, 0));
    }
    this.hands.position.set(0, 1.45, 0.62);
    this.group.add(this.legL, this.legR, this.body);
  }

  /** Call every frame with the ground speed in units per second. */
  animate(dt: number, speed: number): void {
    if (this.sitting) {
      this.legL.rotation.x = this.legR.rotation.x = -1.4;
      this.body.position.y = -0.55;
      this.armL.rotation.x = this.armR.rotation.x = -0.4;
      return;
    }
    this.body.position.y = 0;
    this.phase += dt * (speed > 0.1 ? 1.4 + speed * 0.55 : 2);
    const amount = Math.min(1, speed / 6);
    const s = Math.sin(this.phase) * 0.8 * amount;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    if (this.carrying) {
      this.armL.rotation.x = this.armR.rotation.x = -1.25;
    } else {
      this.armL.rotation.x = -s * 0.9;
      this.armR.rotation.x = s * 0.9;
    }
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.08 * amount + (speed < 0.1 ? Math.sin(this.phase) * 0.015 : 0);
  }

  setPose(raiseArms: number): void {
    this.armL.rotation.x = this.armR.rotation.x = -raiseArms;
  }
}

function wheel(r: number, w: number): THREE.Mesh {
  const m = cylinder(r, r, w, "#1f1f1f", 10);
  m.rotation.z = Math.PI / 2;
  return m;
}

/** A rigid-frame haul truck. Faces +z. The tray tips by rotating `bed`. */
export class HaulTruck {
  readonly group = new THREE.Group();
  readonly bed: THREE.Group;
  private readonly load: THREE.Mesh;
  private readonly wheels: THREE.Mesh[] = [];

  constructor(colour = "#f2b705") {
    const g = this.group;
    g.add(box(4.4, 1, 9.5, "#3a3a3a", 0, 1.9, 0));
    g.add(box(4.8, 1.2, 1.2, colour, 0, 2.8, 4.6)); // front deck
    g.add(box(1.8, 1.7, 1.8, colour, -1.3, 4.1, 3.9)); // cab
    g.add(box(1.7, 0.7, 0.1, windowGlow, -1.3, 4.4, 4.82));
    g.add(box(3.6, 1.4, 0.6, "#2b2b2b", 0, 2.6, 5.1)); // grille
    for (const [x, z] of [[-2.1, 3.4], [2.1, 3.4], [-2.1, -2.6], [2.1, -2.6], [-1.3, -2.6], [1.3, -2.6]] as const) {
      const w = wheel(1.35, x * x > 3 ? 1.1 : 0.9);
      w.position.set(x, 1.35, z);
      this.wheels.push(w);
      g.add(w);
    }
    // The tray hinges at the back; children sit forward of the hinge. Tip with a negative rotation.x.
    const tray = new THREE.Group();
    tray.add(box(5, 0.4, 7.6, colour, 0, 0, 3.8));
    tray.add(box(0.35, 2.2, 7.6, colour, -2.4, 1.1, 3.8), box(0.35, 2.2, 7.6, colour, 2.4, 1.1, 3.8));
    tray.add(box(5, 2.6, 0.35, colour, 0, 1.3, 7.5)); // headboard
    tray.add(box(5, 0.35, 1.6, colour, 0, 2.5, 8.2)); // canopy over the cab
    this.load = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.4, 5), mat("#8a4b2a"));
    this.load.scale.set(1, 1, 1.5);
    this.load.position.set(0, 1.4, 3.8);
    this.load.visible = false;
    tray.add(this.load);
    this.bed = pivot(0, 2.6, -4.4, tray);
    g.add(this.bed);
  }

  setLoad(kind: "ore" | "waste" | null): void {
    this.load.visible = kind !== null;
    if (kind) this.load.material = mat(kind === "ore" ? "#8a4b2a" : "#a39a8c");
  }

  get loaded(): boolean {
    return this.load.visible;
  }

  roll(distance: number): void {
    for (const w of this.wheels) w.rotation.x += distance / 1.35;
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
    this.group.add(box(1.4, 1.4, 7, "#2a2a2a", -2, 0.7, 0), box(1.4, 1.4, 7, "#2a2a2a", 2, 0.7, 0), box(3, 0.8, 4, "#3b3b3b", 0, 1.3, 0));
    this.house.position.y = 1.7;
    this.house.add(box(5, 2.2, 5.4, "#f2b705", 0, 1.1, -0.6), box(2, 2, 2, "#f2b705", -1.4, 3, 1.2), box(1.9, 1.2, 0.1, windowGlow, -1.4, 3.2, 2.22));
    this.house.add(box(4.6, 1.6, 1.2, "#3b3b3b", 0, 1.3, -3.4)); // counterweight
    this.boom.position.set(0.9, 2.2, 1.8);
    this.boom.add(box(0.9, 0.9, 7, "#f2b705", 0, 0, 3.5));
    this.stick.position.set(0, 0, 7);
    this.stick.add(box(0.7, 0.7, 5, "#f2b705", 0, 0, 2.5));
    const bucket = pivot(0, 0, 5, box(2, 1.4, 1.4, "#555", 0, -0.4, 0.4));
    this.bucketLoad = new THREE.Mesh(new THREE.ConeGeometry(1, 0.8, 5), mat("#8a4b2a"));
    this.bucketLoad.position.set(0, 0.5, 0.4);
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

/** A Sprinter-style minibus, painted the way trotros are. Faces +z. */
export class Trotro {
  readonly group = new THREE.Group();
  constructor() {
    const g = this.group;
    g.add(box(3.6, 3, 8.6, "#f4f1e8", 0, 2.4, 0));
    g.add(box(3.62, 0.5, 8.62, "#1f6fb2", 0, 1.4, 0));
    g.add(box(3.64, 0.25, 8.64, "#d6342c", 0, 2.1, 0));
    g.add(box(3.66, 1, 7, windowGlow, 0, 3.1, -0.4));
    g.add(box(3.2, 1.1, 0.1, windowGlow, 0, 3.1, 4.31));
    g.add(box(3.4, 0.4, 2, "#f4f1e8", 0, 4.1, 0.5)); // luggage on the roof
    g.add(box(2.6, 0.9, 1.4, "#8d5a2b", 0, 4.6, 0.5));
    for (const [x, z] of [[-1.7, 2.8], [1.7, 2.8], [-1.7, -2.8], [1.7, -2.8]] as const) {
      const w = wheel(0.75, 0.6);
      w.position.set(x, 0.75, z);
      g.add(w);
    }
  }
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

/** A simple building centred on its footprint, door facing +z. */
export function building(spec: BuildingSpec): THREE.Group {
  const g = new THREE.Group();
  const { w, d, h } = spec;
  g.add(box(w, h, d, spec.wall, 0, h / 2, 0));
  const type = spec.roofType ?? "gable";
  if (type === "gable") {
    // A ridge roof running front to back.
    const ridge = new THREE.Mesh(new THREE.BufferGeometry(), mat(spec.roof));
    const hw = w / 2 + 0.5;
    const hd = d / 2 + 0.5;
    const rh = Math.min(w, d) * 0.32;
    const p = [
      -hw, h, -hd, hw, h, -hd, 0, h + rh, -hd, -hw, h, hd, hw, h, hd, 0, h + rh, hd,
    ];
    const idx = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
    ridge.geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    ridge.geometry.setIndex(idx);
    ridge.geometry.computeVertexNormals();
    ridge.castShadow = true;
    ridge.material = new THREE.MeshLambertMaterial({ color: spec.roof, flatShading: true, side: THREE.DoubleSide });
    g.add(ridge);
  } else if (type === "shed") {
    const roof = box(w + 1, 0.4, d + 1.4, spec.roof, 0, h + 0.4, 0);
    roof.rotation.x = 0.08;
    g.add(roof);
  } else {
    g.add(box(w + 0.4, 0.6, d + 0.4, spec.roof, 0, h + 0.3, 0));
  }
  g.add(box(Math.min(2.4, w * 0.25), Math.min(3.4, h * 0.7), 0.15, "#4a3424", 0, Math.min(3.4, h * 0.7) / 2, d / 2 + 0.05));
  if (spec.windows !== false) {
    const rows = Math.max(1, Math.floor(h / 5));
    for (let r = 0; r < rows; r++) {
      const y = 2.6 + r * 4.5;
      for (let x = -w / 2 + 2.5; x <= w / 2 - 2.5; x += 4.5) {
        if (Math.abs(x) < 2) continue;
        g.add(box(1.6, 1.4, 0.12, windowGlow, x, y, d / 2 + 0.06));
        g.add(box(1.6, 1.4, 0.12, windowGlow, x, y, -d / 2 - 0.06));
      }
    }
  }
  return g;
}

/** Text that floats above a place and always faces the camera. */
export function label(text: string, colour = "#ffffff", background = "rgba(20,24,22,0.78)"): THREE.Sprite {
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
  const h = 2.6;
  sprite.scale.set((h * width) / canvas.height, h, 1);
  sprite.renderOrder = 5;
  return sprite;
}
