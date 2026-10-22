import Phaser from "phaser";
import { LiveMine, type LiveShift } from "../sim/live";
import type { Load } from "../sim/haul";
import type { Role } from "../sim/mine";
import type { DrillHole } from "../sim/drilling";
import { isOre } from "../sim/digPlan";
import { Walker, Vehicle } from "./actors";
import { Hud } from "./hud";
import { makeTextures, ROLE_COLOURS } from "./textures";
import { CELL, LEASE, PLACES, WORLD, columnCentre, dist, fromLease, haulRoute, toLease, type Point } from "./world";
import * as f from "../ui/format";

/** Game minutes that pass per real second at normal speed. A 12 hour shift takes 12 minutes. */
const GAME_MINUTES_PER_SECOND = 1;
const TRUCK_EMPTY_SPEED = 170;
const TRUCK_LOADED_SPEED = 120;
const DRILL_MINUTES_PER_100M = 20;
const HOLE_DEPTHS = [100, 150, 200];
const ORE_TINT = 0xd9a032;
const NEAR = 56;

const ROLE_NAMES: Record<Role, string> = {
  geologist: "Geologist",
  planner: "Mine Planner",
  operator: "Equipment Operator",
  plant: "Plant Operator",
};

const ROLE_HOME: Record<Role, Point> = {
  geologist: { x: LEASE.x + LEASE.size + 34, y: LEASE.y + 70 },
  planner: { x: PLACES.office.x, y: PLACES.office.y + 46 },
  operator: { x: PLACES.truckPark.x - 40, y: PLACES.truckPark.y - 40 },
  plant: { x: PLACES.controlRoom.x, y: PLACES.controlRoom.y + 40 },
};

interface LoadClient {
  pos(): Point;
  loaded(load: Load | null): void;
}

/** One excavator at the pit face, loading trucks in the order they arrive. */
class Excavator {
  readonly body: Phaser.GameObjects.Image;
  readonly boom: Phaser.GameObjects.Image;
  private queue: LoadClient[] = [];
  private serving: { client: LoadClient; left: number } | null = null;
  private swing = 0;
  private target: Point;

  constructor(
    scene: Phaser.Scene,
    private readonly live: LiveMine,
  ) {
    this.target = this.home();
    this.body = scene.add.image(this.target.x, this.target.y, "excavator").setDepth(26);
    this.boom = scene.add.image(this.target.x, this.target.y, "boom").setOrigin(0.1, 0.5).setDepth(27);
  }

  get pos(): Point {
    return { x: this.body.x, y: this.body.y };
  }
  get busy(): boolean {
    return this.serving !== null || this.queue.length > 0;
  }

  /** Where trucks pull up: just east of the machine, toward the ramp. */
  get loadingSpot(): Point {
    return { x: this.body.x + 30, y: this.body.y + 4 };
  }

  home(): Point {
    const face = this.live.face;
    return face ? columnCentre(face.i, face.j) : { x: PLACES.rampTop.x - 30, y: PLACES.rampTop.y };
  }

  request(client: LoadClient): void {
    if (!this.queue.includes(client) && this.serving?.client !== client) this.queue.push(client);
  }

  cancel(client: LoadClient): void {
    this.queue = this.queue.filter((c) => c !== client);
  }

  update(dt: number, gameSeconds: number): void {
    // Track toward the face as blocks are dug out.
    this.target = this.home();
    const d = dist(this.pos, this.target);
    if (d > 1) {
      const step = Math.min(d, 30 * dt);
      const a = Math.atan2(this.target.y - this.body.y, this.target.x - this.body.x);
      this.body.x += Math.cos(a) * step;
      this.body.y += Math.sin(a) * step;
    }
    this.boom.setPosition(this.body.x, this.body.y);

    if (!this.serving && this.queue.length > 0) {
      const client = this.queue.shift()!;
      const op = this.live.mine.haulOperation;
      this.serving = { client, left: op ? op.loadSeconds : 1 };
    }
    if (this.serving) {
      this.serving.left -= gameSeconds;
      // Dig behind, swing over the truck, dump, repeat.
      this.swing += dt * 5;
      const truck = this.serving.client.pos();
      const toTruck = Math.atan2(truck.y - this.body.y, truck.x - this.body.x);
      const dig = toTruck + Math.PI * 0.85;
      const t = (Math.sin(this.swing) + 1) / 2;
      this.boom.rotation = Phaser.Math.Angle.RotateTo(this.boom.rotation, dig + (toTruck - dig) * t, 8 * dt);
      if (this.serving.left <= 0) {
        const { client } = this.serving;
        this.serving = null;
        client.loaded(this.live.loadTruck());
      }
    } else {
      this.boom.rotation += Math.sin(Date.now() / 900) * 0.002;
    }
  }
}

type TruckState = "parked" | "toFace" | "waiting" | "hauling" | "tipping" | "returning";

/** A haul truck on its own: queue at the shovel, haul to the right bay, tip, come back. */
class HaulTruckAI implements LoadClient {
  readonly v: Vehicle;
  state: TruckState = "parked";
  retire = false;
  private load: Load | null = null;
  private timer = 0;
  private retryIn = 0;

  constructor(
    private readonly scene: GameScene,
    readonly id: number,
    at: Point,
  ) {
    this.v = new Vehicle(scene, "truck", at, TRUCK_EMPTY_SPEED);
  }

  pos(): Point {
    return this.v.pos;
  }

  get working(): boolean {
    return this.state !== "parked";
  }

  start(): void {
    this.state = "toFace";
    this.v.driveTo([PLACES.junction, PLACES.rampExit, PLACES.rampTop, this.scene.excavator.loadingSpot], () => this.arrive());
  }

  private arrive(): void {
    this.state = "waiting";
    this.scene.excavator.request(this);
  }

  loaded(load: Load | null): void {
    if (!load) {
      // No plan, or the pit is finished: wait at the rim and try again.
      this.state = "returning";
      this.v.driveTo([PLACES.rampTop, PLACES.rampExit], () => {
        this.state = "parked";
        this.retryIn = 8;
      });
      return;
    }
    this.load = load;
    this.v.setLoad(load.destination);
    this.state = "hauling";
    this.v.speed = TRUCK_LOADED_SPEED;
    const site = load.destination === "ore" ? "crusher" : "dump";
    this.v.driveTo(haulRoute(site), () => {
      this.state = "tipping";
      this.timer = 1.2;
      this.scene.dust(this.v.pos, 6);
    });
  }

  update(dt: number, gameDt: number): void {
    this.v.update(gameDt);
    if (this.state === "parked") {
      if (this.retire) return;
      this.retryIn -= gameDt;
      if (this.retryIn <= 0 && this.scene.live.mine.plan) this.start();
      return;
    }
    if (this.state === "waiting") {
      // Follow the excavator as it walks to the next block.
      const spot = this.scene.excavator.loadingSpot;
      if (dist(this.v.pos, spot) > 40) this.v.driveTo([spot]);
    }
    if (this.state === "tipping") {
      this.timer -= gameDt;
      if (this.timer <= 0 && this.load) {
        const site = this.load.destination === "ore" ? "crusher" : "dump";
        this.scene.delivered(this.load, site, false);
        this.load = null;
        this.v.setLoad(null);
        this.v.speed = TRUCK_EMPTY_SPEED;
        this.state = "returning";
        const back = [...haulRoute(site)].reverse().slice(1);
        if (this.retire) {
          this.v.driveTo([PLACES.junction, PLACES.truckPark], () => (this.state = "parked"));
        } else {
          this.v.driveTo([...back, this.scene.excavator.loadingSpot], () => this.arrive());
        }
      }
    }
    void dt;
  }
}

/** The truck the player drives as Equipment Operator. */
class PlayerTruck implements LoadClient {
  readonly v: Vehicle;
  load: Load | null = null;
  waiting = false;
  private speed = 0;

  constructor(scene: Phaser.Scene, at: Point) {
    this.v = new Vehicle(scene, "truck", at);
    this.v.body.setDepth(28);
    const ring = scene.add.circle(0, 0, 30, 0xffffff, 0).setStrokeStyle(2, 0xffffff, 0.8);
    this.v.body.addAt(ring, 0);
  }

  pos(): Point {
    return this.v.pos;
  }

  loaded(load: Load | null): void {
    this.waiting = false;
    this.load = load;
    this.v.setLoad(load ? load.destination : null);
  }

  drive(dt: number, c: { up: boolean; down: boolean; left: boolean; right: boolean }): void {
    if (this.waiting) {
      this.speed = 0;
      return;
    }
    const max = this.load ? 120 : 160;
    if (c.up) this.speed = Math.min(max, this.speed + 140 * dt);
    else if (c.down) this.speed = Math.max(-50, this.speed - 200 * dt);
    else this.speed *= Math.pow(0.15, dt);
    const turn = 2.4 * dt * Math.sign(this.speed) * Math.min(1, Math.abs(this.speed) / 40);
    if (c.left) this.v.body.rotation -= turn;
    if (c.right) this.v.body.rotation += turn;
    const b = this.v.body;
    b.x = Phaser.Math.Clamp(b.x + Math.cos(b.rotation) * this.speed * dt, 20, WORLD.w - 20);
    b.y = Phaser.Math.Clamp(b.y + Math.sin(b.rotation) * this.speed * dt, 20, WORLD.h - 20);
  }
}

interface DrillOrder {
  x: number;
  y: number;
  depth: number;
  cost: number;
  marker: Phaser.GameObjects.Arc;
}

/** The drill rig and its crew: drives to each ordered site and drills it. */
class DrillCrew {
  readonly rig: Vehicle;
  readonly driller: Walker;
  orders: DrillOrder[] = [];
  current: DrillOrder | null = null;
  private state: "idle" | "driving" | "drilling" | "returning" = "idle";
  private left = 0;
  private puffTimer = 0;

  constructor(private readonly scene: GameScene) {
    const park = { x: PLACES.coreShed.x + 80, y: PLACES.coreShed.y + 10 };
    this.rig = new Vehicle(scene, "rig", park, 150);
    this.driller = new Walker(scene, "driller", park);
    this.driller.sprite.setVisible(false);
  }

  get pendingCost(): number {
    return this.orders.reduce((s, o) => s + o.cost, 0) + (this.current?.cost ?? 0);
  }

  get busy(): boolean {
    return this.current !== null;
  }

  site(): Point | null {
    return this.current ? fromLease(this.current.x, this.current.y) : null;
  }

  order(o: DrillOrder): void {
    this.orders.push(o);
  }

  update(dt: number, gameDt: number, gameMinutes: number): void {
    this.rig.update(gameDt);
    if (this.state === "idle" && this.orders.length > 0) {
      this.current = this.orders.shift()!;
      this.state = "driving";
      const site = fromLease(this.current.x, this.current.y);
      this.rig.driveTo([PLACES.junction, PLACES.rampExit, { x: site.x + 26, y: site.y }], () => {
        this.state = "drilling";
        this.left = (this.current!.depth / 100) * DRILL_MINUTES_PER_100M;
        this.driller.sprite.setPosition(site.x + 12, site.y + 20).setVisible(true);
      });
    }
    if (this.state === "drilling" && this.current) {
      this.left -= gameMinutes;
      this.driller.wait(0);
      this.driller.animate(dt * 0.3);
      this.rig.body.x += Math.sin(Date.now() / 30) * 0.15;
      this.puffTimer -= dt;
      if (this.puffTimer <= 0) {
        this.puffTimer = 0.25;
        this.scene.dust(fromLease(this.current.x, this.current.y), 1);
      }
      if (this.left <= 0) {
        const done = this.current;
        this.current = null;
        this.driller.sprite.setVisible(false);
        this.scene.holeFinished(done);
        if (this.orders.length > 0) this.state = "idle";
        else {
          this.state = "returning";
          this.rig.driveTo([PLACES.rampExit, PLACES.junction, { x: PLACES.coreShed.x + 80, y: PLACES.coreShed.y + 10 }], () => (this.state = "idle"));
        }
      }
    }
  }
}

export class GameScene extends Phaser.Scene {
  // A large open pit fleet: 180 t trucks and a face shovel with a 60 t bucket.
  readonly live = new LiveMine(2047, {
    trucks: 5,
    truckCostPerHour: 260,
    excavator: { name: "Face shovel", bucketTonnes: 60, passSeconds: 30 },
    truck: { name: "180 t haul truck", payloadTonnes: 180, loadedSpeedKmh: 22, emptySpeedKmh: 38, dumpSeconds: 60, spotSeconds: 45, fuelLitresPerHour: 170 },
  });
  readonly hud = new Hud();
  excavator!: Excavator;
  role: Role = "geologist";
  private speed = 1;
  private player!: Walker;
  private playerTruck: PlayerTruck | null = null;
  private trucks: HaulTruckAI[] = [];
  private crew!: DrillCrew;
  private npcs: Partial<Record<Role, Walker>> = {};
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private actQueued = false;
  private holeDepth = 200;
  /** Static scenery is drawn once into this, then baked into a single texture. */
  private ground!: Phaser.GameObjects.Graphics;
  /** Scratch pen for layers that change now and then; drawn into render textures, not kept on screen. */
  private scratch!: Phaser.GameObjects.Graphics;
  private pitLayer!: Phaser.GameObjects.RenderTexture;
  private overlay!: Phaser.GameObjects.RenderTexture;
  private piles!: Phaser.GameObjects.Graphics;
  private conveyor!: Phaser.GameObjects.Graphics;
  private night!: Phaser.GameObjects.Rectangle;
  private drum!: Phaser.GameObjects.Image;
  private agitators: Phaser.GameObjects.Image[] = [];
  private bars: Phaser.GameObjects.Image[] = [];
  private collars: Phaser.GameObjects.Image[] = [];
  private pitKey = "";
  private overlayKey = "";
  private showGeology = true;
  private wasteTipped = 0;
  private beltOffset = 0;
  private statTimer = 0;
  private npcTimer = 0;
  private particles!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super("mine");
  }

  create(): void {
    (window as unknown as { __kestrel: GameScene }).__kestrel = this;
    makeTextures(this);
    this.cameras.main.setBounds(0, 0, WORLD.w, WORLD.h).setBackgroundColor(0x6f8f4e);
    this.ground = this.make.graphics({}, false);
    this.scratch = this.make.graphics({}, false);
    this.drawGround();
    this.drawPlant();
    this.ground.generateTexture("world", WORLD.w, WORLD.h);
    this.ground.destroy();
    this.add.image(0, 0, "world").setOrigin(0).setDepth(1);
    this.pitLayer = this.add.renderTexture(LEASE.x, LEASE.y, LEASE.size, LEASE.size).setOrigin(0).setDepth(5);
    this.overlay = this.add.renderTexture(LEASE.x, LEASE.y, LEASE.size, LEASE.size).setOrigin(0).setDepth(6);
    this.piles = this.add.graphics().setDepth(8);
    this.conveyor = this.add.graphics().setDepth(9);
    this.particles = this.add.particles(0, 0, "puff", {
      lifespan: 900,
      speed: { min: 8, max: 30 },
      scale: { start: 0.9, end: 2.2 },
      alpha: { start: 0.5, end: 0 },
      emitting: false,
    }).setDepth(40);

    // A previous owner's holes, so there is something to plan from at the start.
    for (const [x, y] of [[95, 300], [205, 215], [310, 120], [140, 90], [330, 320], [220, 345]]) {
      const hole = this.live.mine.exploration.drill(x, y, 200);
      this.addCollar(hole);
    }
    this.live.mine.updateEstimates();

    this.excavator = new Excavator(this, this.live);
    this.crew = new DrillCrew(this);
    for (let n = 0; n < this.live.mine.trucks; n++) this.addTruck();

    this.npcs.geologist = new Walker(this, "geologist", ROLE_HOME.geologist);
    this.npcs.planner = new Walker(this, "planner", ROLE_HOME.planner);
    this.npcs.plant = new Walker(this, "plant", ROLE_HOME.plant);
    this.npcs.operator = new Walker(this, "operator", { x: PLACES.dispatch.x, y: PLACES.dispatch.y + 30 });

    this.player = new Walker(this, "geologist", ROLE_HOME.geologist, 95);
    this.player.sprite.setDepth(35);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.cameras.main.setZoom(this.scale.width < 700 ? 1.1 : 1.6);

    this.night = this.add.rectangle(0, 0, 10, 10, 0x0a1430, 0).setOrigin(0).setScrollFactor(0).setDepth(100);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
    // Queue the action on keydown so a quick tap between frames is never missed.
    kb.on("keydown-E", () => (this.actQueued = true));
    kb.on("keydown-SPACE", () => (this.actQueued = true));
    this.hud.onAct = () => (this.actQueued = true);
    kb.on("keydown-Q", () => this.cycleDepth());
    kb.on("keydown-G", () => (this.showGeology = !this.showGeology));
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.6, 2.6));
    });

    this.hud.onRole = (r) => this.setRole(r);
    this.hud.onSpeed = (s) => (this.speed = s);
    this.setRole("geologist");
    this.hud.toast("Welcome to Kestrel Ridge. Six old drill holes are on the map. Drill more, then plan the pit.", "gold");
  }

  // ---------- World drawing ----------

  private label(x: number, y: number, text: string, size = 11): void {
    this.add
      .text(x, y, text, { fontFamily: "Saira Condensed, Arial Narrow, sans-serif", fontSize: `${size}px`, color: "#1b1f1d", backgroundColor: "#f3efe2cc", padding: { x: 4, y: 1 } })
      .setOrigin(0.5)
      .setDepth(50);
  }

  private building(at: Point, w: number, h: number, colour: number, name: string): void {
    const g = this.ground;
    g.fillStyle(0x000000, 0.18);
    g.fillRect(at.x - w / 2 + 4, at.y - h / 2 + 4, w, h);
    g.fillStyle(colour);
    g.fillRect(at.x - w / 2, at.y - h / 2, w, h);
    g.lineStyle(2, 0x000000, 0.25);
    g.strokeRect(at.x - w / 2, at.y - h / 2, w, h);
    g.lineStyle(1, 0xffffff, 0.25);
    for (let x = at.x - w / 2 + 6; x < at.x + w / 2; x += 8) g.lineBetween(x, at.y - h / 2 + 2, x, at.y + h / 2 - 2);
    this.label(at.x, at.y - h / 2 - 10, name);
  }

  private drawGround(): void {
    const g = this.ground;
    // Scrub and bare patches.
    const rnd = new Phaser.Math.RandomDataGenerator(["kestrel"]);
    for (let n = 0; n < 420; n++) {
      g.fillStyle(rnd.pick([0x5f7f42, 0x7a9655, 0x8a8456, 0x67864a]), 0.7);
      g.fillCircle(rnd.between(0, WORLD.w), rnd.between(0, WORLD.h), rnd.between(6, 22));
    }
    // Lease pad.
    g.fillStyle(0x9c8a68, 1);
    g.fillRect(LEASE.x - 10, LEASE.y - 10, LEASE.size + 20, LEASE.size + 20);
    g.lineStyle(2, 0xffffff, 0.7);
    for (let x = LEASE.x; x <= LEASE.x + LEASE.size; x += 24) {
      g.lineBetween(x, LEASE.y - 10, x + 10, LEASE.y - 10);
      g.lineBetween(x, LEASE.y + LEASE.size + 10, x + 10, LEASE.y + LEASE.size + 10);
    }
    for (let y = LEASE.y; y <= LEASE.y + LEASE.size; y += 24) {
      g.lineBetween(LEASE.x - 10, y, LEASE.x - 10, y + 10);
      g.lineBetween(LEASE.x + LEASE.size + 10, y, LEASE.x + LEASE.size + 10, y + 10);
    }
    this.label(LEASE.x + LEASE.size / 2, LEASE.y - 26, "Lease ML-2047 · 400 × 400 m", 12);

    // Haul roads.
    const road = this.ground;
    const lane = (pts: Point[], width: number) => {
      road.lineStyle(width, 0x7a6f62, 1);
      for (let n = 1; n < pts.length; n++) road.lineBetween(pts[n - 1].x, pts[n - 1].y, pts[n].x, pts[n].y);
      for (const p of pts) road.fillStyle(0x7a6f62).fillCircle(p.x, p.y, width / 2);
    };
    lane([PLACES.rampTop, PLACES.rampExit, PLACES.junction, PLACES.crusherBay], 30);
    lane([PLACES.junction, PLACES.dumpBay], 30);
    lane([PLACES.junction, { x: 1100, y: 560 }, PLACES.office, PLACES.coreShed], 16);
    lane([{ x: 1100, y: 560 }, PLACES.dispatch, PLACES.workshop, PLACES.truckPark], 22);
    lane([PLACES.controlRoom, { x: 1100, y: 560 }], 12);

    this.building(PLACES.office, 110, 54, 0xd8d2c0, "Mine office · Planner");
    this.building(PLACES.coreShed, 110, 54, 0x8fb0c9, "Core shed · Geologist");
    this.building(PLACES.workshop, 130, 60, 0xb9b1a3, "Workshop");
    this.building(PLACES.dispatch, 54, 40, 0xe8a05a, "Dispatch");
    this.building(PLACES.controlRoom, 80, 40, 0x9cc49a, "Plant control room");
    this.building(PLACES.goldRoom, 70, 50, 0xe9cf7a, "Gold room");

    // Truck park bays.
    const park = this.ground;
    park.lineStyle(2, 0xffffff, 0.6);
    for (let n = 0; n < 6; n++) park.strokeRect(PLACES.truckPark.x - 70 + n * 26, PLACES.truckPark.y - 22, 24, 50);
    this.label(PLACES.truckPark.x - 2, PLACES.truckPark.y + 40, "Truck park");

    // Crusher and the tipping bays.
    const c = this.ground;
    c.fillStyle(0x4d555c).fillRect(PLACES.crusher.x - 34, PLACES.crusher.y - 30, 68, 60);
    c.fillStyle(0x2c3236).fillRect(PLACES.crusher.x - 20, PLACES.crusher.y - 18, 40, 36);
    this.label(PLACES.crusher.x, PLACES.crusher.y - 44, "Crusher · tip ore here");
    this.label(PLACES.dump.x, PLACES.dump.y + 96, "Waste dump · tip waste here");
  }

  private drawPlant(): void {
    const g = this.ground;
    // Mill house.
    g.fillStyle(0xbfc6cc).fillRect(PLACES.mill.x - 50, PLACES.mill.y - 46, 100, 92);
    this.drum = this.add.image(PLACES.mill.x, PLACES.mill.y, "drum").setDepth(11);
    this.label(PLACES.mill.x, PLACES.mill.y - 58, "Ball mill");
    // Leach tanks.
    for (let n = 0; n < 4; n++) {
      const x = PLACES.tanks.x - 60 + (n % 2) * 70;
      const y = PLACES.tanks.y - 35 + Math.floor(n / 2) * 70;
      g.fillStyle(0x5d6a72).fillCircle(x, y, 30);
      g.fillStyle(0x7d6a4a).fillCircle(x, y, 25);
      this.agitators.push(this.add.image(x, y, "agitator").setDepth(11));
    }
    this.label(PLACES.tanks.x - 25, PLACES.tanks.y - 80, "Leach tanks");
    // Pipe to the gold room.
    g.lineStyle(4, 0x56606a).lineBetween(PLACES.tanks.x + 20, PLACES.tanks.y, PLACES.goldRoom.x - 35, PLACES.goldRoom.y);
  }

  /** Redraws the open pit from the blocks dug so far: deeper benches are darker. */
  private drawPit(): void {
    const m = this.live.mine;
    const key = `${m.plan?.sequence.length ?? 0}-${m.blocksDug}`;
    if (key === this.pitKey) return;
    this.pitKey = key;
    const depth = new Array(40 * 40).fill(0);
    for (const idx of m.dugBlocks) {
      const k = Math.floor(idx / 1600);
      const col = idx % 1600;
      depth[col] = Math.max(depth[col], k + 1);
    }
    const g = this.scratch;
    g.clear();
    for (let j = 0; j < 40; j++)
      for (let i = 0; i < 40; i++) {
        const d = depth[j * 40 + i];
        if (d === 0) continue;
        const c = columnCentre(i, j);
        const shade = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(0x6e5640),
          Phaser.Display.Color.ValueToColor(0x261d17),
          20,
          d,
        );
        g.fillStyle(Phaser.Display.Color.GetColor(shade.r, shade.g, shade.b));
        g.fillRect(c.x - CELL / 2, c.y - CELL / 2, CELL, CELL);
        // Bench crest where the neighbour is shallower.
        g.lineStyle(1, 0xe3d2ad, 0.7);
        if (i > 0 && depth[j * 40 + i - 1] < d) g.lineBetween(c.x - CELL / 2, c.y - CELL / 2, c.x - CELL / 2, c.y + CELL / 2);
        if (j < 39 && depth[(j + 1) * 40 + i] < d) g.lineBetween(c.x - CELL / 2, c.y - CELL / 2, c.x + CELL / 2, c.y - CELL / 2);
      }
    this.pitLayer.clear().draw(g, -LEASE.x, -LEASE.y);
  }

  /** Geologist's grade map and the planner's pit outline over the lease. */
  private drawOverlay(): void {
    const m = this.live.mine;
    const showGrades = this.showGeology && (this.role === "geologist" || this.role === "planner");
    const key = `${showGrades}-${this.role}-${m.exploration.holes.length}-${m.plan?.sequence.length ?? 0}-${m.planSettings.cutoffGrade}-${this.pitKey}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const g = this.scratch;
    g.clear();
    if (showGrades) {
      const dug = new Set<number>();
      for (const idx of m.dugBlocks) dug.add(idx % 1600);
      for (let j = 0; j < 40; j++)
        for (let i = 0; i < 40; i++) {
          // Leave the open pit visible under the grade map.
          if (dug.has(j * 40 + i)) continue;
          let best = 0;
          let conf = 0;
          for (let k = 0; k < 20; k++) {
            const e = m.estimates.get(i, j, k);
            if (e.samples > 0 && e.grade > best) {
              best = e.grade;
              conf = e.confidence;
            }
          }
          if (conf <= 0) continue;
          const c = columnCentre(i, j);
          const t = Math.min(1, best / 3);
          const col = Phaser.Display.Color.Interpolate.ColorWithColor(
            Phaser.Display.Color.ValueToColor(0x6d6156),
            Phaser.Display.Color.ValueToColor(0xffc533),
            100,
            t * 100,
          );
          g.fillStyle(Phaser.Display.Color.GetColor(col.r, col.g, col.b), 0.25 + 0.45 * conf);
          g.fillRect(c.x - CELL / 2, c.y - CELL / 2, CELL, CELL);
        }
    }
    if (this.role === "planner" && m.plan) {
      g.lineStyle(1.5, 0xfff2a8, 0.9);
      const oreCols = new Set<number>();
      for (const b of m.plan.sequence) if (b.destination === "ore") oreCols.add(b.j * 40 + b.i);
      for (const col of oreCols) {
        const c = columnCentre(col % 40, Math.floor(col / 40));
        g.strokeRect(c.x - CELL / 2 + 1, c.y - CELL / 2 + 1, CELL - 2, CELL - 2);
      }
    }
    this.overlay.clear().draw(g, -LEASE.x, -LEASE.y);
  }

  private drawPiles(): void {
    const g = this.piles;
    g.clear();
    // Waste dump grows with every load tipped.
    const r = 40 + Math.sqrt(this.wasteTipped) * 0.12;
    g.fillStyle(0x857868).fillEllipse(PLACES.dump.x, PLACES.dump.y, r * 2.2, r * 1.6);
    g.fillStyle(0x9b8e7c).fillEllipse(PLACES.dump.x - 6, PLACES.dump.y - 6, r * 1.6, r * 1.1);
    // Run-of-mine stockpile beside the crusher.
    const feed = this.live.mine.plant.feed.tonnes;
    if (feed > 0) {
      const s = 8 + Math.sqrt(feed) * 0.35;
      g.fillStyle(0xb98a3a).fillEllipse(PLACES.crusher.x + 70, PLACES.crusher.y + 40, s * 2, s * 1.4);
    }
  }

  private addCollar(hole: DrillHole): void {
    const p = fromLease(hole.x, hole.y);
    const best = Math.max(...hole.assays.map((a) => a.grade));
    const img = this.add.image(p.x, p.y, best >= 1 ? "collar-gold" : "collar").setDepth(20);
    this.collars.push(img);
  }

  dust(at: Point, n: number): void {
    this.particles.emitParticleAt(at.x, at.y, n);
  }

  // ---------- Game events ----------

  private addTruck(): void {
    const n = this.trucks.length;
    const t = new HaulTruckAI(this, n + 1, { x: PLACES.truckPark.x - 57 + (n % 6) * 26, y: PLACES.truckPark.y });
    t.v.body.rotation = -Math.PI / 2;
    this.trucks.push(t);
  }

  /** Brings the AI fleet in line with the dispatch setting, leaving room for the player's truck. */
  private syncFleet(): void {
    const want = this.live.mine.trucks - (this.playerTruck ? 1 : 0);
    let active = this.trucks.filter((t) => !t.retire);
    while (active.length < want) {
      const spare = this.trucks.find((t) => t.retire);
      if (spare) spare.retire = false;
      else this.addTruck();
      active = this.trucks.filter((t) => !t.retire);
    }
    for (const t of active.slice(want).reverse()) t.retire = true;
  }

  delivered(load: Load, site: "crusher" | "dump", byPlayer: boolean): void {
    this.live.deliver(load, site);
    if (site === "dump") this.wasteTipped += load.tonnes;
    if (!byPlayer) return;
    if (load.destination === "ore" && site === "dump") this.hud.toast(`You tipped ${f.tonnes(load.tonnes)} of ore on the waste dump. That gold is lost.`, "bad");
    else if (load.destination === "waste" && site === "crusher") this.hud.toast(`You fed ${f.tonnes(load.tonnes)} of waste to the crusher. It dilutes the mill feed.`, "bad");
    else this.hud.toast(`Delivered ${f.tonnes(load.tonnes)} of ${load.destination} to the ${site}. Head back to the shovel.`, "good");
  }

  holeFinished(o: DrillOrder): void {
    let hole: DrillHole;
    try {
      hole = this.live.drill(o.x, o.y, o.depth);
    } catch {
      o.marker.destroy();
      this.hud.toast("The hole was cancelled: not enough exploration budget.", "bad");
      return;
    }
    o.marker.destroy();
    this.addCollar(hole);
    this.hud.toast(intercept(hole), Math.max(...hole.assays.map((a) => a.grade)) >= 1 ? "gold" : "info");
    if (this.live.mine.plan) this.hud.toast("New assays are in. The Mine Planner can replan the pit to use them.", "info");
  }

  private shiftClosed(s: LiveShift): void {
    const profit = s.revenue - s.costs;
    this.hud.toast(
      `Shift ${s.number} closed: ${f.tonnes(s.oreDelivered)} ore to the crusher, ${f.oz(s.goldOunces)} poured, ${profit >= 0 ? "profit" : "loss"} ${f.money(Math.abs(profit))}.`,
      profit >= 0 ? "good" : "bad",
    );
  }

  // ---------- Roles and interaction ----------

  setRole(role: Role): void {
    this.hud.closeModal();
    if (this.playerTruck) this.leaveTruck();
    this.role = role;
    this.player.sprite.setPosition(ROLE_HOME[role].x, ROLE_HOME[role].y);
    this.player.sprite.setTexture(`person-${role}-0`);
    this.player.role = role;
    for (const [r, npc] of Object.entries(this.npcs)) npc.sprite.setVisible(r !== role);
    this.hud.setRole(role);
    this.overlayKey = "";
    const intro: Record<Role, string> = {
      geologist: "Geologist: walk onto the lease and press E to order a drill hole. Q changes the depth. G toggles the grade map.",
      planner: "Mine Planner: go into the mine office and press E to set the cutoff grade and plan the pit.",
      operator: "Equipment Operator: press E at the truck park to drive a haul truck, or at Dispatch to size the fleet.",
      plant: "Plant Operator: press E in the control room to set the mill feed rate and grind size.",
    };
    this.hud.toast(intro[role], "info");
  }

  private cycleDepth(): void {
    const n = HOLE_DEPTHS.indexOf(this.holeDepth);
    this.holeDepth = HOLE_DEPTHS[(n + 1) % HOLE_DEPTHS.length];
  }

  private leaveTruck(): void {
    const t = this.playerTruck!;
    if (t.waiting) this.excavator.cancel(t);
    this.player.sprite.setPosition(t.v.body.x, t.v.body.y + 30).setVisible(true);
    t.v.body.destroy();
    this.playerTruck = null;
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.syncFleet();
  }

  /** What the player can do where they stand, as [prompt, action]. */
  private interaction(): [string, () => void] | null {
    const m = this.live.mine;
    const truck = this.playerTruck;
    if (truck) {
      const at = truck.v.pos;
      if (truck.waiting) return ["The excavator is loading you. Hold still.", () => {}];
      if (!truck.load && dist(at, this.excavator.pos) < 70) {
        if (!m.plan) return ["No pit plan yet. The Mine Planner has to plan the pit first.", () => {}];
        return ["<kbd>E</kbd> Get loaded by the excavator", () => {
          truck.waiting = true;
          this.excavator.request(truck);
        }];
      }
      if (truck.load && dist(at, PLACES.crusherBay) < NEAR)
        return ["<kbd>E</kbd> Tip into the crusher", () => this.playerTip("crusher")];
      if (truck.load && dist(at, PLACES.dumpBay) < NEAR + 20)
        return ["<kbd>E</kbd> Tip on the waste dump", () => this.playerTip("dump")];
      if (dist(at, PLACES.truckPark) < 80) return ["<kbd>E</kbd> Park and get out", () => this.leaveTruck()];
      if (truck.load) {
        const where = truck.load.destination === "ore" ? "ORE: take it to the crusher" : "WASTE: take it to the waste dump";
        return [`Loaded with ${f.tonnes(truck.load.tonnes)} of ${where}.`, () => {}];
      }
      return ["Drive to the excavator in the pit to get loaded.", () => {}];
    }

    const at = this.player.pos;
    if (this.role === "geologist") {
      const lease = toLease(at);
      if (lease) {
        const cost = m.exploration.costOf(this.holeDepth);
        const afford = m.exploration.budget - this.crew.pendingCost >= cost;
        if (!afford) return [`Not enough budget for a ${this.holeDepth} m hole. Press <kbd>Q</kbd> for a shorter one.`, () => {}];
        return [`<kbd>E</kbd> Order a ${this.holeDepth} m hole here · ${f.money(cost)} · <kbd>Q</kbd> depth`, () => this.orderHole(lease.x, lease.y)];
      }
      return ["Walk onto the lease (the brown pad to the west) to choose a drill site.", () => {}];
    }
    if (dist(at, PLACES.office) < NEAR + 10) {
      if (this.role !== "planner") return ["The mine office belongs to the Mine Planner.", () => {}];
      return ["<kbd>E</kbd> Open the mine plan", () => this.openPlanner()];
    }
    if (dist(at, PLACES.controlRoom) < NEAR) {
      if (this.role !== "plant") return ["The control room belongs to the Plant Operator.", () => {}];
      return ["<kbd>E</kbd> Open plant controls", () => this.openPlant()];
    }
    if (dist(at, PLACES.dispatch) < NEAR) {
      if (this.role !== "operator") return ["Dispatch belongs to the Equipment Operator.", () => {}];
      return ["<kbd>E</kbd> Open fleet dispatch", () => this.openDispatch()];
    }
    if (dist(at, PLACES.truckPark) < 90 && this.role === "operator")
      return ["<kbd>E</kbd> Climb into a haul truck", () => this.enterTruck()];
    return null;
  }

  private orderHole(x: number, y: number): void {
    const p = fromLease(x, y);
    const marker = this.add.circle(p.x, p.y, 6, 0xffffff, 0).setStrokeStyle(2, 0xffffff).setDepth(21);
    this.tweens.add({ targets: marker, scale: 1.6, alpha: 0.4, yoyo: true, repeat: -1, duration: 600 });
    const cost = this.live.mine.exploration.costOf(this.holeDepth);
    this.crew.order({ x, y, depth: this.holeDepth, cost, marker });
    const queued = this.crew.orders.length + (this.crew.busy ? 1 : 0);
    this.hud.toast(`Hole ordered at ${Math.round(x)} m E, ${Math.round(y)} m N. ${queued > 1 ? `${queued - 1} ahead in the queue.` : "The rig is on its way."}`, "info");
  }

  private enterTruck(): void {
    const start = { x: PLACES.truckPark.x + 110, y: PLACES.truckPark.y };
    this.playerTruck = new PlayerTruck(this, start);
    this.playerTruck.v.body.rotation = -Math.PI / 2;
    this.player.sprite.setVisible(false);
    this.cameras.main.startFollow(this.playerTruck.v.body, true, 0.12, 0.12);
    this.syncFleet();
    this.hud.toast("You're in the driver's seat. Arrow keys or WASD to drive. Follow the road west to the shovel in the pit to get loaded.", "info");
  }

  private playerTip(site: "crusher" | "dump"): void {
    const t = this.playerTruck!;
    if (!t.load) return;
    this.dust(t.v.pos, 8);
    this.delivered(t.load, site, true);
    t.loaded(null);
  }

  private openPlanner(): void {
    const m = this.live.mine;
    this.hud.openModal(
      "Mine plan",
      `<p>Blocks estimated above the cutoff grade go to the crusher. Everything above them has to come out first, at a safe 45° wall angle.</p>
      <label class="field">Cutoff grade <output id="m-cutoff-out"></output><input id="m-cutoff" type="range" min="0.3" max="3" step="0.05" value="${m.planSettings.cutoffGrade}"></label>
      <label class="field">Minimum confidence <output id="m-conf-out"></output><input id="m-conf" type="range" min="0" max="0.8" step="0.05" value="${m.planSettings.minConfidence}"></label>
      <button class="action primary" id="m-plan">${m.plan ? "Replan pit" : "Plan pit"}</button>
      <dl class="readout" id="m-readout"></dl>`,
      (root) => {
        const cutoff = root.querySelector<HTMLInputElement>("#m-cutoff")!;
        const conf = root.querySelector<HTMLInputElement>("#m-conf")!;
        const apply = () => {
          m.planSettings = { ...m.planSettings, cutoffGrade: Number(cutoff.value), minConfidence: Number(conf.value) };
        };
        cutoff.addEventListener("input", apply);
        conf.addEventListener("input", apply);
        root.querySelector("#m-plan")!.addEventListener("click", () => {
          m.planPit();
          this.pitKey = "";
          this.overlayKey = "";
          this.hud.toast(`Pit planned: ${f.tonnes(m.plan!.oreTonnes)} of ore at ${f.grade(m.plan!.averageOreGrade)}. The trucks are rolling.`, "good");
          (root.querySelector("#m-plan") as HTMLButtonElement).textContent = "Replan pit";
        });
        return () => {
          root.querySelector("#m-cutoff-out")!.textContent = f.grade(m.planSettings.cutoffGrade);
          root.querySelector("#m-conf-out")!.textContent = `${Math.round(m.planSettings.minConfidence * 100)}%`;
          const plan = m.plan;
          let candidates = 0;
          if (!plan)
            for (let k = 0; k < 20; k++) for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) if (isOre(m.estimates.get(i, j, k), m.planSettings)) candidates++;
          root.querySelector("#m-readout")!.innerHTML = plan
            ? row("Ore", f.tonnes(plan.oreTonnes)) +
              row("Planned ore grade", f.grade(plan.averageOreGrade)) +
              row("Waste", f.tonnes(plan.wasteTonnes)) +
              row("Strip ratio", Number.isFinite(plan.stripRatio) ? `${plan.stripRatio.toFixed(1)} : 1` : "No ore") +
              row("Contained gold", f.oz(plan.containedOunces)) +
              row("Blocks dug", `${f.num(m.blocksDug)} of ${f.num(plan.sequence.length)}`)
            : row("Pit", "Not planned yet") + row("Blocks above cutoff", f.num(candidates));
        };
      },
    );
  }

  private openPlant(): void {
    const m = this.live.mine;
    this.hud.openModal(
      "Plant controls",
      `<p>Finer grinding recovers more gold, but the mill handles fewer tonnes and power costs rise.</p>
      <label class="field">Feed rate <output id="p-feed-out"></output><input id="p-feed" type="range" min="50" max="800" step="10" value="${m.plantSettings.feedRateTph}"></label>
      <label class="field">Grind size P80 <output id="p-grind-out"></output><input id="p-grind" type="range" min="53" max="250" step="1" value="${m.plantSettings.grindP80}"></label>
      <dl class="readout" id="p-readout"></dl>`,
      (root) => {
        const feed = root.querySelector<HTMLInputElement>("#p-feed")!;
        const grind = root.querySelector<HTMLInputElement>("#p-grind")!;
        const apply = () => (m.plantSettings = { feedRateTph: Number(feed.value), grindP80: Number(grind.value) });
        feed.addEventListener("input", apply);
        grind.addEventListener("input", apply);
        return () => {
          const { feedRateTph, grindP80 } = m.plantSettings;
          const cap = m.plant.capacityTph(grindP80);
          root.querySelector("#p-feed-out")!.textContent = `${feedRateTph} t/h`;
          root.querySelector("#p-grind-out")!.textContent = `${grindP80} µm`;
          root.querySelector("#p-readout")!.innerHTML =
            row("Mill capacity at this grind", `${f.num(cap)} t/h`) +
            row("Actual throughput", `${f.num(Math.min(feedRateTph, cap))} t/h`) +
            row("Expected recovery", f.pct(m.plant.recovery(grindP80))) +
            row("Processing cost", `${f.money(m.plant.costPerTonne(grindP80))} per t`) +
            row("Ore on the stockpile", `${f.tonnes(m.plant.feed.tonnes)} at ${f.grade(m.plant.feed.grade)}`);
        };
      },
    );
  }

  private openDispatch(): void {
    const m = this.live.mine;
    this.hud.openModal(
      "Fleet dispatch",
      `<p>One excavator loads every truck. More trucks move more rock until they queue at the shovel. Each truck costs fuel and wages while it works.</p>
      <div class="field">Haul trucks on shift
        <div class="stepper"><button id="d-down" aria-label="One fewer truck">−</button><output id="d-out"></output><button id="d-up" aria-label="One more truck">+</button></div>
      </div>
      <dl class="readout" id="d-readout"></dl>`,
      (root) => {
        const change = (by: number) => {
          m.trucks = Phaser.Math.Clamp(m.trucks + by, 1, 12);
          this.syncFleet();
        };
        root.querySelector("#d-down")!.addEventListener("click", () => change(-1));
        root.querySelector("#d-up")!.addEventListener("click", () => change(1));
        return () => {
          root.querySelector("#d-out")!.textContent = String(m.trucks);
          const waiting = this.trucks.filter((t) => t.state === "waiting").length;
          const face = this.live.face;
          root.querySelector("#d-readout")!.innerHTML =
            row("Trucks working", String(this.trucks.filter((t) => t.working).length + (this.playerTruck ? 1 : 0))) +
            row("Queued at the shovel", String(waiting)) +
            row("Excavator digging", face ? `${(face.k + 0.5) * 10} m deep, ${face.destination}` : "Waiting for a plan") +
            row("Running cost", `${f.money(m.trucks * (m.settings.truck.fuelLitresPerHour * m.settings.dieselPerLitre + m.settings.truckCostPerHour))} per hour`);
        };
      },
    );
  }

  // ---------- NPC routines ----------

  private runNpcs(dt: number): void {
    this.npcTimer -= dt;
    const geo = this.npcs.geologist!;
    const site = this.crew.site();
    if (geo.idle) {
      if (site && dist(geo.pos, site) > 30) geo.walkTo({ x: site.x - 14, y: site.y + 16 });
      else if (site) geo.wait(2);
      else if (Math.random() < 0.5) {
        const p = fromLease(Phaser.Math.Between(20, 380), Phaser.Math.Between(20, 380));
        geo.walkTo(PLACES.junction, PLACES.rampExit, p);
        geo.wait(0);
      } else {
        geo.walkTo(PLACES.rampExit, PLACES.junction, ROLE_HOME.geologist);
      }
      if (!site) geo.wait(Phaser.Math.Between(2, 5));
    }
    const planner = this.npcs.planner!;
    if (planner.idle) {
      const lookout = { x: PLACES.rampExit.x + 10, y: PLACES.rampExit.y - 40 };
      planner.walkTo(...(dist(planner.pos, lookout) < 50 ? [PLACES.junction, ROLE_HOME.planner] : [PLACES.junction, lookout]));
      planner.wait(Phaser.Math.Between(4, 8));
    }
    const plant = this.npcs.plant!;
    if (plant.idle) {
      const stops = [
        { x: PLACES.mill.x, y: PLACES.mill.y + 60 },
        { x: PLACES.tanks.x - 25, y: PLACES.tanks.y + 75 },
        { x: PLACES.goldRoom.x, y: PLACES.goldRoom.y + 40 },
        ROLE_HOME.plant,
      ];
      plant.walkTo(Phaser.Utils.Array.GetRandom(stops));
      plant.wait(Phaser.Math.Between(2, 5));
    }
    const op = this.npcs.operator!;
    if (op.idle) {
      op.walkTo(Phaser.Utils.Array.GetRandom([{ x: PLACES.dispatch.x, y: PLACES.dispatch.y + 30 }, { x: PLACES.workshop.x, y: PLACES.workshop.y + 44 }]));
      op.wait(Phaser.Math.Between(3, 7));
    }
  }

  // ---------- Frame loop ----------

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    const gameDt = dt * this.speed;
    const gameMinutes = gameDt * GAME_MINUTES_PER_SECOND;
    const paused = this.hud.modalOpen;

    const k = this.keys;
    const t = this.hud.touch;
    const c = {
      up: k.W.isDown || k.UP.isDown || t.up,
      down: k.S.isDown || k.DOWN.isDown || t.down,
      left: k.A.isDown || k.LEFT.isDown || t.left,
      right: k.D.isDown || k.RIGHT.isDown || t.right,
    };
    const pressed = this.actQueued;
    this.actQueued = false;

    if (!paused) {
      if (this.playerTruck) this.playerTruck.drive(dt, c);
      else {
        const vx = (c.right ? 1 : 0) - (c.left ? 1 : 0);
        const vy = (c.down ? 1 : 0) - (c.up ? 1 : 0);
        if (vx || vy) {
          const len = Math.hypot(vx, vy);
          const s = this.player.sprite;
          s.x = Phaser.Math.Clamp(s.x + (vx / len) * 130 * dt, 10, WORLD.w - 10);
          s.y = Phaser.Math.Clamp(s.y + (vy / len) * 130 * dt, 10, WORLD.h - 10);
          s.rotation = Math.atan2(vy, vx) + Math.PI / 2;
          this.player.animate(dt);
        }
      }
      const action = this.interaction();
      this.hud.prompt(action ? action[0] : null);
      if (pressed && action) action[1]();
    } else this.hud.prompt(null);

    // The world keeps working while panels are open.
    for (const truck of this.trucks) truck.update(dt, gameDt);
    this.excavator.update(dt, gameMinutes * 60);
    this.crew.update(dt, gameDt, gameMinutes);
    for (const npc of Object.values(this.npcs)) npc.update(dt);
    this.runNpcs(dt);

    const working = this.trucks.filter((x) => x.working).length + (this.playerTruck ? 1 : 0);
    for (const s of this.live.advance(gameMinutes / 60, working)) this.shiftClosed(s);

    // Plant animation runs while there is ore to mill.
    const running = this.live.mine.plant.feed.tonnes > 0 || this.live.shift.milled > 0;
    const milling = this.live.mine.plant.feed.tonnes > 0;
    this.drum.rotation += (milling ? 1.4 : 0.05) * gameDt;
    for (const a of this.agitators) a.rotation += (running ? 2 : 0.2) * gameDt;
    this.beltOffset = (this.beltOffset + (milling ? 40 : 0) * gameDt) % 16;
    this.drawBelt();

    const barCount = Math.min(30, Math.floor(this.live.totalOunces / 40));
    while (this.bars.length < barCount) {
      const n = this.bars.length;
      this.bars.push(this.add.image(PLACES.goldRoom.x - 24 + (n % 6) * 9, PLACES.goldRoom.y + 36 - Math.floor(n / 6) * 6, "bar").setDepth(12));
    }

    this.drawPit();
    this.drawOverlay();
    this.drawPiles();
    this.updateNight();

    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.25;
      this.updateStats();
    }
  }

  private drawBelt(): void {
    const g = this.conveyor;
    g.clear();
    const a = { x: PLACES.crusher.x + 34, y: PLACES.crusher.y };
    const b = { x: PLACES.mill.x - 50, y: PLACES.mill.y };
    g.lineStyle(8, 0x3a3f44).lineBetween(a.x, a.y, b.x, b.y);
    if (this.live.mine.plant.feed.tonnes <= 0) return;
    const len = dist(a, b);
    g.fillStyle(ORE_TINT);
    for (let s = this.beltOffset; s < len; s += 16) {
      const t = s / len;
      g.fillRect(a.x + (b.x - a.x) * t - 2, a.y + (b.y - a.y) * t - 2, 5, 4);
    }
  }

  private updateNight(): void {
    const cam = this.cameras.main;
    this.night.setSize(cam.width, cam.height);
    const hour = this.live.clock % 24;
    // Dusk from 18:00, full dark 20:00 to 04:00, dawn by 06:00.
    const dark = hour >= 20 || hour < 4 ? 1 : hour >= 18 ? (hour - 18) / 2 : hour < 6 ? (6 - hour) / 2 : 0;
    this.night.setFillStyle(0x0a1430, dark * 0.45);
  }

  private updateStats(): void {
    const l = this.live;
    const hour = l.clock % 24;
    const hh = String(Math.floor(hour)).padStart(2, "0");
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, "0");
    const recon = l.reconciliation;
    this.hud.setStats({
      time: `Day ${l.day} · ${hh}:${mm}`,
      shift: hour >= 6 && hour < 18 ? "Day shift" : "Night shift",
      cash: f.money(l.mine.cash),
      gold: f.oz(l.totalOunces),
      recon: recon === null ? "–" : `${Math.round(recon * 100)}%`,
      budget: f.money(l.mine.exploration.budget - this.crew.pendingCost),
      pit: !l.mine.plan ? "Not planned" : !l.face ? "Finished" : l.face.destination === "ore" ? `Mining ore · ${(l.face.k + 0.5) * 10} m` : `Stripping waste · ${(l.face.k + 0.5) * 10} m`,
      depth: `${this.holeDepth} m`,
      role: ROLE_NAMES[this.role],
    });
    void ROLE_COLOURS;
  }
}

function row(k: string, v: string): string {
  return `<dt>${k}</dt><dd>${v}</dd>`;
}

/** Best run of assays above 0.5 g/t, the way drill results are reported. */
function intercept(hole: DrillHole): string {
  let best = { metres: 0, grams: 0, from: 0 };
  let run = { metres: 0, grams: 0, from: 0 };
  for (const a of hole.assays) {
    const len = a.to - a.from;
    if (a.grade >= 0.5) {
      if (run.metres === 0) run.from = a.from;
      run = { metres: run.metres + len, grams: run.grams + a.grade * len, from: run.from };
      if (run.grams > best.grams) best = { ...run };
    } else run = { metres: 0, grams: 0, from: 0 };
  }
  if (best.metres === 0) return `Hole ${hole.id} assays are back: no significant gold.`;
  return `Hole ${hole.id} assays are back: ${best.metres} m at ${f.grade(best.grams / best.metres)} from ${best.from} m.`;
}
