import * as THREE from "three";
import { Random } from "../sim/random";
import { heightAt } from "./terrain";
import { Excavator, HaulTruck, Person, Trotro } from "./models";
import { randomLook, World } from "./world";

/** Points the truck in its heading and tilts it to the slope under it. */
export function placeVehicle(g: THREE.Object3D, x: number, z: number, yaw: number, length: number): void {
  const fx = Math.sin(yaw) * length * 0.5;
  const fz = Math.cos(yaw) * length * 0.5;
  const front = heightAt(x + fx, z + fz);
  const back = heightAt(x - fx, z - fz);
  g.position.set(x, (front + back) / 2, z);
  g.rotation.order = "YXZ";
  g.rotation.y = yaw;
  g.rotation.x = -Math.atan2(front - back, length);
}

export function turnToward(current: number, target: number, maxStep: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Anything the shovel can load: a truck parked at the load point. */
export interface LoadClient {
  readyToLoad: boolean;
  passes: number;
  truck: HaulTruck;
  onLoaded(): void;
}

export const PASSES_PER_TRUCK = 3;

/**
 * The excavator at the face. Without the player at the controls another operator runs it;
 * with the player in the cab it only moves when they press E.
 */
export class Shovel {
  clients: LoadClient[] = [];
  playerControlled = false;
  phase: "face" | "digging" | "toTruck" | "dumping" | "toFace" = "face";
  private t = 0;
  bucketFull = false;
  /** Called when a pass lands in a truck and when a truck is full. */
  onPass: (client: LoadClient, full: boolean) => void = () => {};

  constructor(readonly model: Excavator) {
    model.house.rotation.y = Math.PI;
  }

  get client(): LoadClient | undefined {
    return this.clients.find((c) => c.readyToLoad && c.passes < PASSES_PER_TRUCK);
  }

  /** Player input: dig at the face, or swing a full bucket to the truck. Returns a hint when it can't. */
  command(): string | null {
    if (this.phase !== "face") return null;
    if (!this.bucketFull) {
      this.phase = "digging";
      this.t = 0;
      return null;
    }
    if (!this.client) return "No truck under the boom yet. Wait for one to back in.";
    this.phase = "toTruck";
    this.t = 0;
    return null;
  }

  update(dt: number): void {
    const m = this.model;
    this.t += dt;
    const client = this.client;
    switch (this.phase) {
      case "face":
        m.house.rotation.y = turnToward(m.house.rotation.y, Math.PI, dt * 1.5);
        m.pose(0.35, this.bucketFull ? 1 : 0.6);
        if (!this.playerControlled && client) this.phase = this.bucketFull ? "toTruck" : "digging";
        this.t = 0;
        break;
      case "digging": {
        const k = Math.min(1, this.t / 1.6);
        m.pose(0.35 - Math.sin(k * Math.PI) * 0.45, k);
        if (k >= 1) {
          this.bucketFull = true;
          m.bucketLoad.visible = true;
          this.phase = "face";
          if (!this.playerControlled && client) this.phase = "toTruck";
        }
        break;
      }
      case "toTruck": {
        const k = Math.min(1, this.t / 1.8);
        m.house.rotation.y = Math.PI * (1 - k * k * (3 - 2 * k));
        m.pose(0.35 + k * 0.65, 1);
        if (k >= 1) {
          this.phase = "dumping";
          this.t = 0;
        }
        break;
      }
      case "dumping": {
        const k = Math.min(1, this.t / 0.8);
        m.pose(1, 1 - k * 1.2);
        if (k >= 1) {
          this.bucketFull = false;
          m.bucketLoad.visible = false;
          const c = this.client;
          if (c) {
            c.passes++;
            if (c.passes === 1) c.truck.setLoad("ore");
            const full = c.passes >= PASSES_PER_TRUCK;
            this.onPass(c, full);
            if (full) c.onLoaded();
          }
          this.phase = "toFace";
          this.t = 0;
        }
        break;
      }
      case "toFace": {
        const k = Math.min(1, this.t / 1.8);
        m.house.rotation.y = Math.PI * (k * k * (3 - 2 * k));
        m.pose(1 - k * 0.65, 0.4);
        if (k >= 1) this.phase = "face";
        break;
      }
    }
  }
}

interface Leg {
  to: THREE.Vector3;
  action?: "load" | "tip";
  /** Heading to turn to before the action. */
  face?: number;
}

/** A computer-driven haul truck running the pit-to-crusher loop. */
export class TruckAI implements LoadClient {
  readonly truck: HaulTruck;
  x: number;
  z: number;
  yaw: number;
  speed = 0;
  readyToLoad = false;
  passes = 0;
  private legs: Leg[];
  private leg = 0;
  private wait = 0;
  private state: "drive" | "turn" | "loading" | "tipping" = "drive";
  private tipT = 0;

  constructor(world: World, start: THREE.Vector3, delay: number, private readonly others: () => { x: number; z: number; self: unknown }[]) {
    const hl = world.haul;
    this.truck = new HaulTruck();
    world.scene.add(this.truck.group);
    this.x = start.x;
    this.z = start.z;
    this.yaw = Math.PI;
    this.wait = delay;
    this.legs = [
      { to: hl.head },
      { to: hl.rampTop },
      { to: hl.load, action: "load", face: Math.PI / 2 },
      { to: hl.rampTop },
      { to: hl.head },
      { to: hl.tipTurn },
      { to: hl.tip, action: "tip", face: 0 },
      { to: hl.tipTurn },
    ];
    placeVehicle(this.truck.group, this.x, this.z, this.yaw, 9);
  }

  onLoaded(): void {
    this.readyToLoad = false;
    this.state = "drive";
    this.leg = (this.leg + 1) % this.legs.length;
  }

  update(dt: number, shovel: Shovel): void {
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const leg = this.legs[this.leg];
    if (this.state === "loading") return;
    if (this.state === "tipping") {
      this.tipT += dt;
      const up = Math.min(1, this.tipT / 2);
      const down = Math.max(0, Math.min(1, (this.tipT - 3) / 2));
      this.truck.bed.rotation.x = -0.95 * (up - down);
      if (this.tipT > 2.2) this.truck.setLoad(null);
      if (this.tipT >= 5) {
        this.state = "drive";
        this.leg = (this.leg + 1) % this.legs.length;
      }
      return;
    }
    if (this.state === "turn") {
      this.yaw = turnToward(this.yaw, leg.face!, dt * 1.1);
      placeVehicle(this.truck.group, this.x, this.z, this.yaw, 9);
      if (angleDiff(this.yaw, leg.face!) < 0.02) {
        if (leg.action === "load") {
          this.state = "loading";
          this.readyToLoad = true;
          this.passes = 0;
          if (!shovel.clients.includes(this)) shovel.clients.push(this);
        } else {
          this.state = "tipping";
          this.tipT = 0;
        }
      }
      return;
    }
    // Drive: keep to the right of the road except on the final approach to an action point.
    let tx = leg.to.x;
    let tz = leg.to.z;
    if (!leg.action) {
      const prev = this.legs[(this.leg + this.legs.length - 1) % this.legs.length].to;
      const dx = tx - prev.x;
      const dz = tz - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      tx += (-dz / len) * 2.6;
      tz += (dx / len) * 2.6;
    }
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    this.yaw = turnToward(this.yaw, want, dt * 0.9);
    const maxSpeed = this.truck.loaded ? 8 : 11;
    let target = Math.min(maxSpeed, dist * 0.8 + 2) * Math.max(0.3, 1 - angleDiff(this.yaw, want));
    // Hold back from anything ahead.
    for (const o of this.others()) {
      if (o.self === this) continue;
      const ox = o.x - this.x;
      const oz = o.z - this.z;
      const ahead = ox * Math.sin(this.yaw) + oz * Math.cos(this.yaw);
      const side = Math.abs(ox * Math.cos(this.yaw) - oz * Math.sin(this.yaw));
      if (ahead > 0 && ahead < 15 && side < 4.5) target = Math.min(target, Math.max(0, (ahead - 10) * 0.6));
    }
    this.speed += (target - this.speed) * Math.min(1, dt * 1.5);
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
    this.truck.roll(this.speed * dt);
    placeVehicle(this.truck.group, this.x, this.z, this.yaw, 9);
    if (dist < (leg.action ? 1.2 : 4)) {
      if (leg.action) {
        this.speed = 0;
        this.state = "turn";
      } else this.leg = (this.leg + 1) % this.legs.length;
    }
  }
}

/** Someone walking between points, stopping now and then. */
export class Walker {
  readonly person: Person;
  private target: THREE.Vector3;
  private wait: number;
  private readonly speed: number;

  constructor(scene: THREE.Scene, private readonly points: THREE.Vector3[], private readonly rng: Random, worker: boolean) {
    this.person = new Person(randomLook(rng, worker));
    const start = points[Math.floor(rng.next() * points.length)];
    this.person.group.position.set(start.x + rng.between(-3, 3), 0, start.z + rng.between(-3, 3));
    this.target = this.pick();
    this.wait = rng.between(0, 4);
    this.speed = rng.between(2.6, 3.6);
    scene.add(this.person.group);
  }

  private pick(): THREE.Vector3 {
    const p = this.points[Math.floor(this.rng.next() * this.points.length)];
    return new THREE.Vector3(p.x + this.rng.between(-3, 3), 0, p.z + this.rng.between(-3, 3));
  }

  update(dt: number, near: boolean): void {
    const g = this.person.group;
    if (this.wait > 0) {
      this.wait -= dt;
      if (near) this.person.animate(dt, 0);
      return;
    }
    const dx = this.target.x - g.position.x;
    const dz = this.target.z - g.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) {
      this.wait = this.rng.between(2, 9);
      this.target = this.pick();
      return;
    }
    const step = Math.min(d, this.speed * dt);
    g.position.x += (dx / d) * step;
    g.position.z += (dz / d) * step;
    g.position.y = heightAt(g.position.x, g.position.z);
    g.rotation.y = turnToward(g.rotation.y, Math.atan2(dx, dz), dt * 6);
    if (near) this.person.animate(dt, this.speed);
  }
}

/** Kids playing football on the town pitch. */
export class Football {
  readonly ball: THREE.Mesh;
  private readonly kids: Person[] = [];
  private ballVel = new THREE.Vector2();
  constructor(scene: THREE.Scene, private readonly world: World, private readonly rng: Random) {
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true }));
    const b = world.pitchBox;
    this.ball.position.set((b.minX + b.maxX) / 2, 0.45, (b.minZ + b.maxZ) / 2);
    this.ball.castShadow = true;
    scene.add(this.ball);
    for (let i = 0; i < 8; i++) {
      const look = randomLook(rng, false);
      look.shirt = i % 2 ? "#d6342c" : "#f2b705";
      const p = new Person(look);
      p.group.scale.setScalar(0.8);
      p.group.position.set(rng.between(b.minX, b.maxX), 0, rng.between(b.minZ, b.maxZ));
      scene.add(p.group);
      this.kids.push(p);
    }
  }

  update(dt: number, near: boolean): void {
    const b = this.world.pitchBox;
    const ball = this.ball.position;
    ball.x += this.ballVel.x * dt;
    ball.z += this.ballVel.y * dt;
    this.ballVel.multiplyScalar(Math.max(0, 1 - dt * 0.9));
    this.ball.rotation.x += this.ballVel.y * dt;
    this.ball.rotation.z -= this.ballVel.x * dt;
    if (ball.x < b.minX || ball.x > b.maxX) this.ballVel.x *= -1;
    if (ball.z < b.minZ || ball.z > b.maxZ) this.ballVel.y *= -1;
    ball.x = Math.max(b.minX, Math.min(b.maxX, ball.x));
    ball.z = Math.max(b.minZ, Math.min(b.maxZ, ball.z));
    this.kids.forEach((k, i) => {
      const g = k.group.position;
      // Two chase the ball, the rest drift towards their half.
      const chaser = i < 2 || g.distanceTo(ball) < 6;
      const tx = chaser ? ball.x : (i % 2 ? b.minX + 10 : b.maxX - 10) + Math.sin(performance.now() / 1500 + i) * 6;
      const tz = chaser ? ball.z : (b.minZ + b.maxZ) / 2 + Math.cos(performance.now() / 1700 + i * 2) * 9;
      const dx = tx - g.x;
      const dz = tz - g.z;
      const d = Math.hypot(dx, dz);
      const speed = d > 1 ? (chaser ? 5 : 2.5) : 0;
      if (d > 0.01) {
        g.x += (dx / d) * Math.min(d, speed * dt);
        g.z += (dz / d) * Math.min(d, speed * dt);
        k.group.rotation.y = turnToward(k.group.rotation.y, Math.atan2(dx, dz), dt * 6);
      }
      if (near) k.animate(dt, speed);
      if (Math.hypot(ball.x - g.x, ball.z - g.z) < 1.2 && this.ballVel.length() < 4) {
        const a = this.rng.between(0, Math.PI * 2);
        const goal = i % 2 ? b.maxX : b.minX;
        const gx = goal - ball.x;
        const gz = (b.minZ + b.maxZ) / 2 - ball.z;
        const gl = Math.hypot(gx, gz) || 1;
        this.ballVel.set((gx / gl) * 9 + Math.cos(a) * 4, (gz / gl) * 9 + Math.sin(a) * 4);
      }
    });
  }
}

/** The minibus shuttling between the town station and the mine gate. */
export class TrotroBus {
  readonly bus = new Trotro();
  private s = 0;
  private dir = 1;
  private wait = 6;
  private yaw = 0;
  private readonly lengths: number[] = [];
  private readonly total: number;

  constructor(scene: THREE.Scene, private readonly road: THREE.Vector3[]) {
    scene.add(this.bus.group);
    let t = 0;
    this.lengths.push(0);
    for (let i = 1; i < road.length; i++) {
      t += road[i].distanceTo(road[i - 1]);
      this.lengths.push(t);
    }
    this.total = t;
    this.place(0.016);
  }

  private pointAt(s: number): THREE.Vector3 {
    for (let i = 1; i < this.road.length; i++) {
      if (s <= this.lengths[i]) {
        const k = (s - this.lengths[i - 1]) / (this.lengths[i] - this.lengths[i - 1]);
        return this.road[i - 1].clone().lerp(this.road[i], k);
      }
    }
    return this.road[this.road.length - 1].clone();
  }

  private place(dt: number) {
    const p = this.pointAt(this.s);
    const ahead = this.pointAt(Math.max(0, Math.min(this.total, this.s + this.dir * 3)));
    // Drive on the right.
    const dx = ahead.x - p.x;
    const dz = ahead.z - p.z;
    if (Math.hypot(dx, dz) > 0.1) this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), dt * 2.5);
    const len = Math.hypot(dx, dz) || 1;
    placeVehicle(this.bus.group, p.x - (dz / len) * 2.4, p.z + (dx / len) * 2.4, this.yaw, 8);
  }

  update(dt: number): void {
    if (this.wait > 0) {
      this.wait -= dt;
      this.place(dt);
      return;
    }
    this.s += this.dir * 10 * dt;
    if (this.s >= this.total || this.s <= 0) {
      this.s = Math.max(0, Math.min(this.total, this.s));
      this.dir *= -1;
      this.wait = 15;
    }
    this.place(dt);
  }
}
