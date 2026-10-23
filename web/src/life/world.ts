import * as THREE from "three";
import { Random } from "../sim/random";
import { GROUND, heightAt, onRamp, PIT, PIT_DEPTH, PIT_DISC, RAMP } from "./terrain";
import { box, building, BuildingSpec, concreteMat, cylinder, Excavator, HaulTruck, label, mat, Person, SKINS, slab, windowGlow } from "./models";
import { dirt } from "./textures";
import { decorate } from "./decor";

/**
 * Sikakrom: a small gold-mining town in the south-west, the mine lease to the north-east.
 * x runs east, z runs south.
 */

export type SpotId =
  | "home" | "chopBar" | "spot" | "pitch" | "training" | "kiosk" | "trotroTown" | "trotroMine"
  | "office" | "stockyard" | "sackPile" | "coreShed" | "drillRig" | "truckPark" | "truckSpawn"
  | "shovel" | "loadPoint" | "tipPoint" | "controlRoom" | "crusher";

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Footprint extends Box2 {
  colour: string;
}

export interface World {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  colliders: Box2[];
  footprints: Footprint[];
  roads: [number, number][][];
  spots: Record<SpotId, THREE.Vector3>;
  names: Partial<Record<SpotId, string>>;
  shovel: Excavator;
  rigRod: THREE.Object3D;
  trayStack: THREE.Object3D;
  millDrum: THREE.Object3D;
  outcropSites: { x: number; z: number }[];
  /** Waypoints for the haul loop: ramp head, ramp top, load point, tip approach, tip point. */
  haul: Record<"park" | "head" | "rampTop" | "load" | "tipTurn" | "tip", THREE.Vector3>;
  /** The trotro road from town to the mine. */
  trotroRoad: THREE.Vector3[];
  townWalk: THREE.Vector3[];
  mineWalk: THREE.Vector3[];
  benchSeats: { pos: THREE.Vector3; yaw: number }[];
  pitchBox: Box2;
  people: Person[];
}

const v = (x: number, z: number, y = heightAt(x, z)) => new THREE.Vector3(x, y, z);

export const TOWN_NAME = "Sikakrom";

export function buildWorld(seed: number): World {
  const rng = new Random(seed);
  const scene = new THREE.Scene();

  const hemi = new THREE.HemisphereLight("#c9d6e0", "#7a5a40", 0.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff3dc", 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -80;
  sc.right = 80;
  sc.top = 80;
  sc.bottom = -80;
  sc.near = 1;
  sc.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.3;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const colliders: Box2[] = [];
  const footprints: Footprint[] = [];
  const roads: [number, number][][] = [
    // Town main street
    [[-215, 90], [-20, 90]],
    // Town to the mine gate
    [[-20, 90], [5, 62], [24, 40], [36, 24]],
    // Mine site road: gate, office, stockyard, core shed, truck park
    [[36, 24], [50, 8], [90, 8], [128, 0]],
    [[50, 8], [44, -14], [10, -50], [-12, -64]],
    // Haul road: park, ramp head, crusher
    [[128, 0], [146, -40], [154, -96], [156, -110], [RAMP.topDx + PIT.x, -110]],
    [[156, -110], [176, -100], [186, -84]],
    [[128, 0], [172, -24], [190, -32]],
  ];

  scene.add(ground(rng, roads));
  scene.add(pitTile());
  hills(scene, rng);

  const spots = {} as Record<SpotId, THREE.Vector3>;
  const names: Partial<Record<SpotId, string>> = {};

  /** Places a building and returns the point just outside its door. */
  function put(spec: BuildingSpec, x: number, z: number, facing: "s" | "n" | "e" | "w" = "s", sign?: string, signColour?: string): THREE.Vector3 {
    const g = building(spec);
    const rot = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[facing];
    g.rotation.y = rot;
    g.position.set(x, 0, z);
    scene.add(g);
    const sideways = facing === "e" || facing === "w";
    const hw = (sideways ? spec.d : spec.w) / 2;
    const hd = (sideways ? spec.w : spec.d) / 2;
    const fp = { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd };
    colliders.push(fp);
    footprints.push({ ...fp, colour: spec.roof });
    const out = spec.d / 2 + 2.2;
    const door = new THREE.Vector3(x + Math.sin(rot) * out, 0, z + Math.cos(rot) * out);
    if (sign) {
      const s = label(sign, signColour ?? "#ffffff");
      s.position.set(x, spec.h + 4.5, z);
      scene.add(s);
    }
    return door;
  }

  // ---------- Town ----------
  spots.home = put({ w: 18, d: 10, h: 5, wall: "#e9d8b4", roof: "#8d4b2e" }, -150, 104, "n", "Your room (compound house)", "#ffd36b");
  names.home = "your room";
  put({ w: 14, d: 10, h: 5, wall: "#d8c7a0", roof: "#7c4a30" }, -178, 104, "n");
  put({ w: 12, d: 10, h: 4.5, wall: "#c9d6c2", roof: "#94573a" }, -200, 104, "n");
  put({ w: 12, d: 9, h: 4.5, wall: "#e6c9a8", roof: "#8f5236" }, -88, 104, "n");
  spots.chopBar = put({ w: 14, d: 9, h: 4.5, wall: "#2e8b57", roof: "#b5b5b0", roofType: "shed" }, -118, 104, "n", "Auntie Ama's Chop Bar", "#ffd36b");
  names.chopBar = "Auntie Ama's Chop Bar";
  spots.kiosk = put({ w: 5, d: 4, h: 3.5, wall: "#ffcc00", roof: "#d6342c", roofType: "flat", windows: false }, -60, 102, "n", "MoMo", "#ffcc00");
  names.kiosk = "the MoMo kiosk";
  spots.spot = put({ w: 12, d: 9, h: 4.5, wall: "#c0392b", roof: "#6b6b6b", roofType: "flat" }, -110, 76, "s", "Gold Coast Spot", "#ffd36b");
  names.spot = "Gold Coast Spot";
  put({ w: 14, d: 20, h: 9, wall: "#f7f4ec", roof: "#2f6fa8" }, -150, 70, "s", "Church", "#bcd9ff");
  spots.training = put({ w: 22, d: 12, h: 8, wall: "#f3efe3", roof: "#2f5f8f", roofType: "flat" }, -70, 74, "s", "Mining Training Centre", "#ffd36b");
  names.training = "the Mining Training Centre";
  put({ w: 10, d: 8, h: 4, wall: "#b9cfe0", roof: "#80583c" }, -190, 76, "s");
  put({ w: 10, d: 8, h: 4, wall: "#e8b9a0", roof: "#80583c" }, -40, 76, "s");

  // Benches and tables in front of the chop bar and the spot.
  const benchSeats: { pos: THREE.Vector3; yaw: number }[] = [];
  for (const [tx, tz] of [[-106, 101.5], [-99, 101.5], [-106, 107.5], [-99, 107.5]] as const) {
    scene.add(box(3, 0.2, 2, "#7a5230", tx, 1.6, tz), box(0.3, 1.6, 0.3, "#5a3a20", tx, 0.8, tz));
    scene.add(box(3, 0.2, 0.7, "#7a5230", tx, 0.95, tz - 1.6), box(3, 0.2, 0.7, "#7a5230", tx, 0.95, tz + 1.6));
    benchSeats.push({ pos: v(tx - 0.7, tz - 1.6, 0.4), yaw: 0 }, { pos: v(tx + 0.7, tz + 1.6, 0.4), yaw: Math.PI });
  }
  // String lights at the spot.
  scene.add(box(13, 0.06, 0.06, "#222", -110, 4.9, 81.4));
  for (let i = 0; i < 6; i++) scene.add(box(0.35, 0.35, 0.35, windowGlow, -116 + i * 2.4, 4.6, 81.4));

  // Football pitch: goals on the ground drawn in the ground texture.
  const pitchBox = { minX: -132, maxX: -88, minZ: 26, maxZ: 54 };
  for (const gx of [pitchBox.minX, pitchBox.maxX]) {
    scene.add(box(0.3, 2.6, 0.3, "#ffffff", gx, 1.3, 36), box(0.3, 2.6, 0.3, "#ffffff", gx, 1.3, 44), box(0.3, 0.3, 8.3, "#ffffff", gx, 2.6, 40));
  }
  spots.pitch = v(-110, 56);
  names.pitch = "the football pitch";
  const pitchSign = label("Football pitch", "#bff5c9");
  pitchSign.position.set(-110, 7, 40);
  scene.add(pitchSign);

  // Trotro stops.
  function shelter(x: number, z: number, text: string) {
    scene.add(box(8, 0.3, 3.4, "#d6342c", x, 3.6, z), box(0.3, 3.6, 0.3, "#888", x - 3.6, 1.8, z), box(0.3, 3.6, 0.3, "#888", x + 3.6, 1.8, z));
    scene.add(box(6, 0.2, 1, "#7a5230", x, 0.9, z + 1));
    const s = label(text, "#ffffff", "rgba(214,52,44,0.92)");
    s.position.set(x, 6.6, z);
    scene.add(s);
  }
  shelter(-30, 98, "Trotro: Town station");
  spots.trotroTown = v(-30, 95);
  names.trotroTown = "the town trotro station";
  shelter(14, 46, "Trotro: Mine gate");
  spots.trotroMine = v(16, 43);
  names.trotroMine = "the mine gate trotro stop";

  // ---------- Mine ----------
  // Gate, boom barrier and sign.
  scene.add(box(4, 3.4, 4, "#e9e4d8", 28, 1.7, 34), box(0.5, 0.5, 9, "#d6342c", 33, 1.4, 27.5));
  colliders.push({ minX: 26, maxX: 30, minZ: 32, maxZ: 36 });
  const gateSign = label(`${TOWN_NAME} Goldfields`, "#1b1b1b", "rgba(242,183,5,0.95)");
  gateSign.position.set(30, 7.5, 34);
  scene.add(gateSign);

  spots.office = put({ w: 16, d: 10, h: 6, wall: "#f3efe3", roof: "#1f6f4a", roofType: "flat" }, 64, 22, "n", "Mine office", "#c9f2d8");
  names.office = "the mine office";

  // Stockyard: a concrete pad with sample sacks and a clock-in board.
  scene.add(flat(24, 16, "#948e84", 44, -18));
  const sacks = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const s = box(1.2, 0.9, 0.8, "#f1ece0", (i % 6) * 1.4 - 3.5, 0.45 + Math.floor(i / 12) * 0.9, (Math.floor(i / 6) % 2) * 1.0);
    s.rotation.y = rng.between(-0.2, 0.2);
    sacks.add(s);
  }
  sacks.position.set(40, 0, -22);
  scene.add(sacks);
  colliders.push({ minX: 35.5, maxX: 44.5, minZ: -22.5, maxZ: -20.5 });
  spots.sackPile = v(40, -18);
  names.sackPile = "the sample sacks";
  board(scene, 52, -10, "Stockyard");
  spots.stockyard = v(52, -7);
  names.stockyard = "the stockyard";

  spots.coreShed = put({ w: 20, d: 12, h: 6, wall: "#d9d4c4", roof: "#9aa3a8", roofType: "shed" }, 92, -4, "s", "Core shed", "#ffd36b");
  names.coreShed = "the core shed";

  // Drill rig on the west rim, with a stack of core trays.
  const rig = new THREE.Group();
  rig.add(box(4, 1.6, 8, "#d6342c", 0, 0.8, 0), box(3, 2, 2.4, "#d6342c", 0, 2.4, 2.8));
  const mast = new THREE.Group();
  mast.add(box(1.2, 16, 1.2, "#f4f1e8", 0, 8, 0), box(1.6, 0.6, 1.6, "#d6342c", 0, 16, 0));
  const rod = cylinder(0.25, 0.25, 15, "#777", 6);
  rod.position.set(0, 7.5, 0.9);
  mast.add(rod);
  mast.position.set(0, 1.6, -2);
  rig.add(mast);
  rig.position.set(-16, 0, -74);
  scene.add(rig);
  colliders.push({ minX: -18, maxX: -14, minZ: -78, maxZ: -70 });
  const trayStack = new THREE.Group();
  for (let i = 0; i < 3; i++) trayStack.add(box(2.4, 0.35, 1.2, i % 2 ? "#5c6b75" : "#a8b0a6", 0, 0.2 + i * 0.4, 0));
  trayStack.position.set(-10, 0, -70);
  scene.add(trayStack);
  spots.drillRig = v(-9, -67);
  names.drillRig = "the drill rig";
  const rigSign = label("Exploration drill rig", "#ffd0c9");
  rigSign.position.set(-16, 20, -74);
  scene.add(rigSign);

  // Truck park.
  scene.add(flat(30, 22, "#7f7a72", 128, -14));
  board(scene, 118, -8, "Truck park");
  spots.truckPark = v(118, -5);
  names.truckPark = "the truck park";
  spots.truckSpawn = v(128, -8);
  for (const x of [124, 140]) {
    const t = new HaulTruck(x === 124 ? "#e5a800" : "#f2b705");
    t.group.position.set(x, 0, -22);
    scene.add(t.group);
    colliders.push({ minX: x - 2.6, maxX: x + 2.6, minZ: -27, maxZ: -17 });
  }

  // The shovel works at the west side of the pit floor; trucks load east of it.
  const shovel = new Excavator();
  shovel.group.position.copy(v(PIT.x - 4, PIT.z));
  shovel.group.rotation.y = Math.PI / 2;
  scene.add(shovel.group);
  spots.shovel = v(PIT.x - 4, PIT.z + 7);
  names.shovel = "the excavator in the pit";
  const pitSign = label("Main pit", "#ffe2b8");
  pitSign.position.set(PIT.x, 8, PIT.z - 40);
  scene.add(pitSign);

  // Process plant: crusher, conveyor, mill, leach tanks, control room, tailings.
  const crusher = new THREE.Group();
  crusher.add(box(12, 6, 10, "#bdb6a8", 0, 3, 0));
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 3, 4, 4, 1, true), new THREE.MeshStandardMaterial({ color: "#6f6a62", roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
  hopper.rotation.y = Math.PI / 4;
  hopper.position.y = 8;
  crusher.add(hopper);
  crusher.position.set(186, 0, -70);
  scene.add(crusher);
  colliders.push({ minX: 180, maxX: 192, minZ: -75, maxZ: -65 });
  const crusherSign = label("ROM pad and crusher", "#ffd36b");
  crusherSign.position.set(186, 14, -70);
  scene.add(crusherSign);
  spots.crusher = v(186, -84);
  names.crusher = "the crusher";
  const conveyor = box(2, 0.8, 34, "#3a3a3a", 196, 9, -54);
  conveyor.rotation.set(0.25, -0.35, 0);
  scene.add(conveyor);
  const drum = cylinder(4.5, 4.5, 12, "#7d8b91", 12);
  drum.rotation.z = Math.PI / 2;
  const mill = new THREE.Group();
  mill.add(drum, box(2, 6, 6, "#bdb6a8", -7, 3, 0), box(2, 6, 6, "#bdb6a8", 7, 3, 0));
  drum.position.y = 6;
  mill.position.set(208, 0, -38);
  scene.add(mill);
  colliders.push({ minX: 200, maxX: 216, minZ: -43, maxZ: -33 });
  const millSign = label("Ball mill", "#ffffff");
  millSign.position.set(208, 15, -38);
  scene.add(millSign);
  for (let i = 0; i < 4; i++) {
    const tank = cylinder(4, 4, 7, "#9aa7ad", 12);
    tank.position.set(226 + (i % 2) * 10, 3.5, -54 + Math.floor(i / 2) * 10);
    scene.add(tank);
    colliders.push({ minX: tank.position.x - 4, maxX: tank.position.x + 4, minZ: tank.position.z - 4, maxZ: tank.position.z + 4 });
  }
  const pond = new THREE.Mesh(new THREE.PlaneGeometry(50, 34), mat("#5f8f9a"));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(236, 0.08, 10);
  scene.add(pond);
  spots.controlRoom = put({ w: 12, d: 9, h: 6, wall: "#f3efe3", roof: "#2f5f8f", roofType: "flat" }, 190, -26, "s", "Plant control room", "#bcd9ff");
  names.controlRoom = "the plant control room";

  const head = v(156, -110);
  const haul = {
    park: v(136, -6),
    head,
    rampTop: v(PIT.x + RAMP.topDx, PIT.z),
    load: v(PIT.x + 9, PIT.z),
    tipTurn: v(176, -100),
    tip: v(186, -86),
  };
  spots.loadPoint = haul.load.clone();
  spots.tipPoint = haul.tip.clone();

  // Outcrops a geologist can map; the game chooses which are flagged.
  const outcropSites = [
    { x: -45, z: -140 }, { x: -64, z: -44 }, { x: 8, z: -192 }, { x: 98, z: -192 },
    { x: 172, z: -160 }, { x: 214, z: -118 }, { x: -76, z: -104 }, { x: 150, z: 40 },
  ];

  decorate(scene, rng, colliders, roads);

  // Trees, kept off roads, buildings, pads and the pit.
  trees(scene, rng, (x, z) => {
    if (Math.hypot(x - PIT.x, z - PIT.z) < PIT.radius + 14) return false;
    if (x > PIT.x && x < PIT.x + RAMP.topDx + 10 && Math.abs(z - PIT.z) < 14) return false;
    for (const b of colliders) if (x > b.minX - 4 && x < b.maxX + 4 && z > b.minZ - 4 && z < b.maxZ + 4) return false;
    for (const road of roads) for (let i = 1; i < road.length; i++) if (distToSegment(x, z, road[i - 1], road[i]) < 7) return false;
    if (x > pitchBox.minX - 4 && x < pitchBox.maxX + 4 && z > pitchBox.minZ - 4 && z < pitchBox.maxZ + 4) return false;
    if (x > 20 && x < 140 && z > -40 && z < 30) return false;
    if (x > 110 && x < 260 && z > -100 && z < 30) return false;
    return true;
  });

  const trotroRoad = [v(-30, 92), v(-20, 90), v(5, 62), v(18, 46), v(20, 41)];
  const townWalk = [v(-200, 93), v(-170, 93), v(-150, 94), v(-130, 93), v(-110, 92), v(-90, 93), v(-70, 92), v(-50, 93), v(-30, 93), v(-150, 84), v(-70, 85)];
  const mineWalk = [spots.office, spots.stockyard, spots.coreShed, spots.truckPark, v(70, 8), v(110, 6), v(20, -40), v(-6, -60), spots.controlRoom, v(160, -20)];

  const people: Person[] = [];
  return {
    scene, sun, hemi, colliders, footprints, roads, spots, names, shovel,
    rigRod: rod, trayStack, millDrum: drum, outcropSites, haul, trotroRoad, townWalk, mineWalk, benchSeats, pitchBox, people,
  };
}

function flat(w: number, d: number, colour: string, x: number, z: number): THREE.Mesh {
  const m = slab(w, 0.2, d, concreteMat(colour), x, 0.02, z, 6);
  m.castShadow = false;
  return m;
}

function board(scene: THREE.Scene, x: number, z: number, text: string) {
  scene.add(box(0.3, 2.6, 0.3, "#555", x - 1.2, 1.3, z), box(0.3, 2.6, 0.3, "#555", x + 1.2, 1.3, z), box(3, 1.6, 0.2, "#1f6f4a", x, 2.6, z));
  const s = label(text, "#c9f2d8");
  s.position.set(x, 5.4, z);
  scene.add(s);
}

export function distToSegment(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}

/** True on the mine lease, where the ground is bare red laterite. */
export function inLease(x: number, z: number): boolean {
  return x > 0 && z < 40 + x * 0.1;
}

const W = GROUND.maxX - GROUND.minX;
const H = GROUND.maxZ - GROUND.minZ;

/** The flat ground, painted on one canvas: grass, laterite, roads and the pitch lines. */
function ground(rng: Random, roads: [number, number][][]): THREE.Mesh {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const sx = size / W;
  const sz = size / H;
  const px = (x: number) => (x - GROUND.minX) * sx;
  const pz = (z: number) => (z - GROUND.minZ) * sz;
  ctx.fillStyle = "#66733f";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i++) {
    const k = rng.next();
    ctx.fillStyle = k < 0.4 ? "rgba(78,98,48,0.35)" : k < 0.75 ? "rgba(146,134,84,0.32)" : "rgba(120,92,60,0.28)";
    ctx.beginPath();
    ctx.arc(rng.next() * size, rng.next() * size, rng.between(6, 40), 0, Math.PI * 2);
    ctx.fill();
  }
  // Laterite over the lease, with a ragged edge.
  ctx.fillStyle = "#a0603c";
  ctx.beginPath();
  ctx.moveTo(px(0), pz(GROUND.minZ));
  for (let z = GROUND.minZ; z <= 60; z += 6) ctx.lineTo(px(-4 + Math.sin(z * 0.2) * 4), pz(z));
  for (let x = 0; x <= GROUND.maxX; x += 6) ctx.lineTo(px(x), pz(40 + x * 0.1 + Math.sin(x * 0.3) * 3));
  ctx.lineTo(px(GROUND.maxX), pz(GROUND.minZ));
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px(PIT.x), pz(PIT.z), (PIT_DISC.radius + 6) * sx, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 1600; i++) {
    const x = rng.between(-60, GROUND.maxX);
    const z = rng.between(GROUND.minZ, 40);
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(120,62,34,0.18)" : "rgba(190,128,86,0.16)";
    ctx.beginPath();
    ctx.arc(px(x), pz(z), rng.between(2, 16) * sx * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Town yard: packed earth along the street.
  ctx.fillStyle = "#9c7a58";
  ctx.fillRect(px(-215), pz(62), px(-20) - px(-215), pz(116) - pz(62));
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(80,60,40,0.25)" : "rgba(170,140,100,0.25)";
    ctx.beginPath();
    ctx.arc(px(rng.between(-215, -20)), pz(rng.between(62, 116)), rng.between(2, 14) * sx, 0, Math.PI * 2);
    ctx.fill();
  }
  // Roads.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const road of roads) {
    const town = road[0][0] < -10;
    for (const [width, colour] of [[16, town ? "#6e5a48" : "#7c5c44"], [11, town ? "#3c3c3a" : "#8a6a50"]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width * sx;
      ctx.beginPath();
      road.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), pz(z)) : ctx.moveTo(px(x), pz(z))));
      ctx.stroke();
    }
    // Wear: tyre tracks and patches.
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1];
      const [bx, bz] = road[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t < len; t += 1.5) {
        const k = t / len;
        const x = ax + (bx - ax) * k + rng.between(-4, 4);
        const z = az + (bz - az) * k + rng.between(-4, 4);
        ctx.fillStyle = town ? (rng.next() < 0.5 ? "rgba(20,20,20,0.25)" : "rgba(120,110,100,0.18)") : "rgba(60,40,28,0.2)";
        ctx.beginPath();
        ctx.ellipse(px(x), pz(z), rng.between(0.5, 2.5) * sx, rng.between(0.3, 1.5) * sx, rng.next() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (town) {
      ctx.strokeStyle = "rgba(230,220,190,0.55)";
      ctx.lineWidth = 0.6 * sx;
      ctx.setLineDash([6 * sx, 6 * sx]);
      ctx.beginPath();
      road.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), pz(z)) : ctx.moveTo(px(x), pz(z))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Pitch.
  ctx.fillStyle = "#6f7a3e";
  ctx.fillRect(px(-132), pz(26), px(-88) - px(-132), pz(54) - pz(26));
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = "rgba(140,105,70,0.35)";
    ctx.beginPath();
    ctx.arc(px(rng.between(-130, -90)), pz(rng.between(28, 52)), rng.between(1, 6) * sx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 0.5 * sx;
  ctx.strokeRect(px(-131), pz(27), px(-89) - px(-131), pz(53) - pz(27));
  ctx.beginPath();
  ctx.moveTo(px(-110), pz(27));
  ctx.lineTo(px(-110), pz(53));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px(-110), pz(40), 5 * sx, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  groundTexture = tex;

  const shape = new THREE.Shape();
  shape.moveTo(GROUND.minX, -GROUND.maxZ);
  shape.lineTo(GROUND.maxX, -GROUND.maxZ);
  shape.lineTo(GROUND.maxX, -GROUND.minZ);
  shape.lineTo(GROUND.minX, -GROUND.minZ);
  // A hole matching the outer ring of the pit disc, wound the opposite way.
  const hole = new THREE.Path();
  for (let i = 0; i <= PIT_DISC.segments; i++) {
    const a = (i / PIT_DISC.segments) * Math.PI * 2;
    const x = PIT.x + Math.cos(a) * PIT_DISC.radius;
    const z = PIT.z + Math.sin(a) * PIT_DISC.radius;
    if (i === 0) hole.moveTo(x, -z);
    else hole.lineTo(x, -z);
  }
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  setGroundUv(geo);
  const mesh = new THREE.Mesh(geo, groundMaterial({ map: tex }));
  mesh.receiveShadow = true;
  return mesh;
}

/** Ground material: the painted map, plus a fine pebbly detail texture tiled on top up close. */
function groundMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const detail = dirt();
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, ...params });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D detailMap;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), texture2D(detailMap, vMapUv * 160.0).rgb * 1.3, 0.8) * mix(vec3(1.0), texture2D(detailMap, vMapUv * 23.0).rgb * 1.3, 0.35);",
      );
  };
  return m;
}

let groundTexture: THREE.CanvasTexture;

function setGroundUv(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - GROUND.minX) / W;
    uv[i * 2 + 1] = 1 - (pos.getZ(i) - GROUND.minZ) / H;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * The pit and ramp: a disc of rings placed on every bench crest and toe, so the benches come out
 * as clean terraces. Tinted by depth over the ground texture.
 */
function pitTile(): THREE.Mesh {
  const radii = [0, 5, 9];
  for (let k = PIT.benches - 1; k >= 0; k--) {
    const crest = PIT.radius - k * PIT.benchWidth;
    radii.push(crest - 3 - (PIT.benchWidth - 3) / 2, crest - 3, crest);
  }
  for (let r = PIT.radius + 2.5; r < PIT_DISC.radius; r += 2.5) radii.push(r);
  radii.push(PIT_DISC.radius);
  const segs = PIT_DISC.segments;
  const positions: number[] = [];
  const colours: number[] = [];
  const c = new THREE.Color();
  const base = new THREE.Color("#a0603c");
  for (const r of radii) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = PIT.x + Math.cos(a) * r;
      const z = PIT.z + Math.sin(a) * r;
      const h = r === PIT_DISC.radius ? 0 : heightAt(x, z);
      positions.push(x, h, z);
      const depth = -h / PIT_DEPTH;
      if (onRamp(x, z)) c.copy(base).multiplyScalar(0.85);
      else if (h < -0.01) {
        // Weathered orange near the top, grey fresh rock deeper, dark ore on the floor.
        c.set("#c0703f").lerp(new THREE.Color("#8d8170"), Math.min(1, depth * 1.2));
        if (h <= -PIT_DEPTH + 0.01) c.set("#6c5a4a");
      } else c.copy(base);
      // The texture is laterite here; divide it out so the tint shows true.
      colours.push(c.r / base.r, c.g / base.g, c.b / base.b);
    }
  }
  const index: number[] = [];
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let i = 0; i < segs; i++) {
      const a = ring * segs + i;
      const b = ring * segs + ((i + 1) % segs);
      const c2 = a + segs;
      const d = b + segs;
      index.push(a, b, c2, b, d, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  setGroundUv(geo);
  const mesh = new THREE.Mesh(geo, groundMaterial({ map: groundTexture, vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function hills(scene: THREE.Scene, rng: Random) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng.between(-0.08, 0.08);
    const r = rng.between(330, 380);
    const m = new THREE.Mesh(geo, mat(i % 3 ? "#4c5a34" : "#57653a"));
    const s = rng.between(40, 80);
    m.scale.set(s * 1.6, s * rng.between(0.5, 0.9), s * 1.3);
    m.position.set(Math.cos(a) * r, -s * 0.15, Math.sin(a) * r);
    scene.add(m);
  }
}

function trees(scene: THREE.Scene, rng: Random, ok: (x: number, z: number) => boolean) {
  const spots: [number, number, number][] = [];
  for (let tries = 0; tries < 5000 && spots.length < 380; tries++) {
    const x = rng.between(GROUND.minX + 6, GROUND.maxX - 6);
    const z = rng.between(GROUND.minZ + 6, GROUND.maxZ - 6);
    if (ok(x, z)) spots.push([x, z, rng.between(0.8, 1.5)]);
  }
  const bark = new THREE.MeshStandardMaterial({ color: "#4a3a2c", roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.55, 5, 7), bark, spots.length);
  // Three clumps per tree give a broken, natural canopy.
  const clumpGeo = new THREE.IcosahedronGeometry(2.4, 1);
  const pos = clumpGeo.attributes.position;
  const jr = new Random(9);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + jr.next() * 0.3), pos.getY(i) * (0.75 + jr.next() * 0.2), pos.getZ(i) * (0.85 + jr.next() * 0.3));
  clumpGeo.computeVertexNormals();
  const crowns = new THREE.InstancedMesh(clumpGeo, leaf, spots.length * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(rng.between(-1, 1), 0, rng.between(-1, 1)).normalize(), rng.between(0, 0.12));
    m.compose(new THREE.Vector3(x, 2.5 * s, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
    const hue = 0.2 + rng.next() * 0.06;
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + rng.next();
      q.setFromAxisAngle(up, rng.next() * 6);
      const off = new THREE.Vector3(Math.cos(a) * 1.4 * s, (5.2 + k * 0.7 + rng.next()) * s, Math.sin(a) * 1.4 * s);
      const sc = s * (0.9 + rng.next() * 0.45);
      m.compose(new THREE.Vector3(x + off.x, off.y, z + off.z), q, new THREE.Vector3(sc * 1.2, sc, sc * 1.2));
      crowns.setMatrixAt(i * 3 + k, m);
      crowns.setColorAt(i * 3 + k, new THREE.Color().setHSL(hue, 0.32 + rng.next() * 0.12, 0.11 + rng.next() * 0.06));
    }
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  scene.add(trunks, crowns);
}

export function randomLook(rng: Random, worker: boolean): import("./models").Look {
  const shirts = worker ? ["#f28c28", "#2f7fc1", "#e8f04a", "#f28c28"] : ["#d6342c", "#1f6fb2", "#f2b705", "#2e8b57", "#8e44ad", "#f4f1e8", "#e67e22"];
  return {
    skin: SKINS[Math.floor(rng.next() * SKINS.length)],
    shirt: shirts[Math.floor(rng.next() * shirts.length)],
    trousers: worker ? "#2c3e50" : ["#2c3e50", "#5d4037", "#1b2631", "#7f8c8d"][Math.floor(rng.next() * 4)],
    hat: worker ? (rng.next() < 0.3 ? "#ffffff" : "#f2b705") : undefined,
    vest: worker,
  };
}
