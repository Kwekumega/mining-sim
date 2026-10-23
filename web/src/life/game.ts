import * as THREE from "three";
import { Random } from "../sim/random";
import { BIKE_PRICE, CERTS, CertId, friendLevel, GOALS, HomeId, HOMES, JOBS, JobId, levelFor, Life, LifeEvent, MAX_LEVEL, Need, NEEDS, Offer, OFFERS, PlaceId, SHIFT, TASKS_PER_SHIFT, xpForLevel } from "./life";
import { cedis, Choice, h, Hud, NEED_INFO } from "./hud";
import { box, HaulTruck, lampGlow, Look, Motorbike, Person, SKINS, windowGlow } from "./models";
import { FilmLook, QUALITY_NAMES } from "./look";
import { wind } from "./plants";
import { Dust, Rain, WeatherClock } from "./weather";
import { Football, LoadClient, PASSES_PER_TRUCK, placeVehicle, Shovel, TrotroBus, TruckAI, turnToward, Walker } from "./npcs";
import { GROUND, heightAt } from "./terrain";
import { buildWorld, groundWet, inLease, SpotId, TOWN_NAME, World } from "./world";

const SAVE_KEY = "minelife-sikakrom-v1";
const GRAPHICS_KEY = "minelife-graphics";
const BIKE_SPEED = 21;
const WALK = 6.5;
const RUN = 11;
/** Game minutes that pass per real second. */
const MINUTES_PER_SECOND = 1;

type Mode = "walk" | "truck" | "excavator" | "bike";
type Rock = "quartz" | "laterite" | "granite" | "schist";

const ROCKS: Record<Rock, { name: string; colour: string; note: string }> = {
  quartz: { name: "Quartz vein", colour: "#ece9df", note: "white and glassy, the host for gold here" },
  laterite: { name: "Laterite", colour: "#a4472a", note: "red-brown weathered crust" },
  granite: { name: "Granite", colour: "#c9a297", note: "pink-grey and speckled" },
  schist: { name: "Greenstone schist", colour: "#4f604a", note: "dark green and layered" },
};

interface Interaction {
  at: THREE.Vector3;
  radius: number;
  text: string;
  /** Lower goes first when two are in reach. */
  priority?: number;
  run: () => void;
}

interface Outcrop {
  x: number;
  z: number;
  rock: THREE.Mesh;
  flag: THREE.Group;
  type: Rock;
  flagged: boolean;
}

const PLACE_SPOT: Partial<Record<PlaceId, SpotId>> = {
  stockyard: "stockyard", coreShed: "coreShed", truckPark: "truckPark", controlRoom: "controlRoom", shovel: "shovel", office: "office",
};

const HOME_SPOT: Record<HomeId, SpotId> = { room: "home", chamber: "chamber", selfCon: "selfCon" };

const TOWN_NAMES = ["Esi", "Kojo", "Abena", "Yaw", "Akosua", "Kwesi", "Adwoa", "Fiifi", "Efua", "Nana", "Ama", "Kofi", "Afia", "Ekow", "Serwaa", "Kwabena", "Dede", "Mensah", "Aba", "Yaa", "Paa Kwesi"];

/** Small talk, by how well you know them. */
const CHAT_LINES: Record<"new" | "known" | "close", string[]> = {
  new: [
    "\u201cYou're new in town? Welcome. The chop bar does the best waakye.\u201d",
    "\u201cThey're hiring at the mine. Start at the stockyard and work up.\u201d",
    "\u201cThe trotro to the gate is cheaper than walking in this sun.\u201d",
    "\u201cDon't let the landlord catch you late on rent. He changes the padlock.\u201d",
  ],
  known: [
    "\u201cHow was the shift? My cousin says the pit flooded again.\u201d",
    "\u201cIf you get your haul licence, driving pays better than carrying sacks.\u201d",
    "\u201cCome and watch the match on Saturday. Hearts against Kotoko!\u201d",
    "\u201cThe geologists find the gold, the drivers move it, and we all eat.\u201d",
  ],
  close: [
    "\u201cMy brother, my sister! Sit down, let me tell you the gist.\u201d",
    "\u201cYou're doing well. One day you'll be supervisor and forget us.\u201d",
    "\u201cIf you ever need help, you call me. That's what friends are for.\u201d",
  ],
};

interface Hazard {
  areas: SpotId[];
  text: string;
  right: string;
  wrong: [string, string];
}

/** Things a shift supervisor has to catch on the site walk. */
const HAZARDS: Hazard[] = [
  { areas: ["drillRig"], text: "A driller is working next to the rig without hearing protection.", right: "Stop the job until he has earplugs", wrong: ["Let him finish the run", "Note it for next week"] },
  { areas: ["truckPark"], text: "A truck is parked on the slope with no wheel chocks.", right: "Get it chocked and moved to the bay", wrong: ["Nothing, the handbrake is on", "Tell the driver to park closer"] },
  { areas: ["truckPark", "crusher"], text: "A worker is walking behind a reversing haul truck.", right: "Radio the driver to stop and clear the person", wrong: ["Sound your horn and carry on", "Leave it, the driver has mirrors"] },
  { areas: ["stockyard"], text: "Sample sacks are stacked four high and leaning.", right: "Restack them two high on pallets", wrong: ["Tape the stack together", "Put a warning sign up"] },
  { areas: ["controlRoom"], text: "The mill guard is off for cleaning and the mill is still running.", right: "Isolate and lock out the mill, then refit the guard", wrong: ["Clean quickly while it runs", "Turn the mill down to half speed"] },
  { areas: ["controlRoom"], text: "An operator is at the leach tanks with no gloves or respirator.", right: "Send him for PPE before he goes back", wrong: ["Tell him to hold his breath", "Let him finish, it's quick"] },
  { areas: ["shovel"], text: "Loose rock is hanging on the bench face above the excavator.", right: "Pull the machine back and have the face scaled", wrong: ["Dig faster before it falls", "Park a truck under it as a shield"] },
  { areas: ["crusher"], text: "A diesel hose at the crusher is leaking onto the pad.", right: "Shut off the supply and spread absorbent", wrong: ["Hose it into the drain", "Cover it with sand later"] },
  { areas: ["coreShed"], text: "The core shed fire extinguisher's tag is a year out of date.", right: "Get it swapped for a serviced one today", wrong: ["It still looks fine", "Move it out of sight"] },
  { areas: ["coreShed", "stockyard"], text: "A forklift is lifting a pallet with someone standing on the forks.", right: "Stop the lift and get him off", wrong: ["Tell him to hold on tight", "Let it go, it's a short lift"] },
];
const INSPECT_AREAS: SpotId[] = ["stockyard", "coreShed", "truckPark", "drillRig", "controlRoom", "crusher", "shovel"];

interface Profile {
  name: string;
  look: Look;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly look: FilmLook;
  private bakedAt = -99;
  private bakedRain = 0;
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);
  private readonly world: World;
  private readonly hud: Hud;
  private life!: Life;
  private profile!: Profile;
  private player!: Person;
  private readonly pos = new THREE.Vector3();
  private yaw = 0;
  private speed = 0;
  private mode: Mode = "walk";
  private carrying: "sack" | "tray" | null = null;
  private readonly carryMeshes: Record<"sack" | "tray", THREE.Mesh>;
  private readonly cam = { yaw: 0.6, pitch: 0.42, dist: 16, dragAt: 0 };
  private readonly keys = new Set<string>();
  private readonly clock = new THREE.Clock();
  private started = false;
  private paused = true;
  private lastInteractions: Interaction | null = null;
  private trayReadyAt = 0;
  private readonly lowNeeds = new Set<Need>();
  private readonly shovel: Shovel;
  private readonly trucks: TruckAI[] = [];
  private readonly myTruck: HaulTruck;
  private readonly truckState = { x: 0, z: 0, yaw: 0, speed: 0, tipping: -1, readyToLoad: false, passes: 0 };
  private readonly myClient: LoadClient;
  private readonly walkers: Walker[] = [];
  private readonly football: Football;
  private readonly trotro: TrotroBus;
  private readonly outcrops: Outcrop[] = [];
  private readonly beacon: THREE.Group;
  private readonly sitters: Person[] = [];
  private frames = 0;
  private fpsCheck = { t: 0, frames: 0, done: false };
  private saveTimer = 0;
  private hudTimer = 0;
  private mapTimer = 0;
  private readonly rng: Random;
  private shadows = true;
  private readonly labels: THREE.Sprite[] = [];
  private readonly rain: Rain;
  private readonly dust: Dust;
  private weather: WeatherClock;
  private readonly bike: Motorbike;
  private readonly bikeState = { x: 0, z: 0, yaw: 0, speed: 0, steer: 0 };
  private dustTimer = 0;
  private goalTimer = 0;
  private inspectAt: SpotId | null = null;
  private time = 0;

  constructor(private readonly container: HTMLElement) {
    const seed = 20261022;
    this.rng = new Random(seed);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.world = buildWorld(seed);
    this.look = new FilmLook(this.renderer, this.world.scene, this.camera);
    this.hud = new Hud(document.body);

    this.carryMeshes = {
      sack: box(1.1, 0.8, 0.7, "#f1ece0"),
      tray: box(1.8, 0.3, 0.8, "#5c6b75"),
    };

    this.shovel = new Shovel(this.world.shovel);
    this.shovel.onPass = (c, full) => {
      if (c === this.myClient) this.hud.toast(full ? "Loaded with ore. Drive up the ramp to the crusher." : `Bucket ${c.passes} of ${PASSES_PER_TRUCK} in your tray.`, full ? "good" : "info");
      if (this.shovel.playerControlled && full) {
        const pay = this.task(1);
        this.hud.toast(`Truck loaded. +${cedis(pay)} (${this.life.shiftTasks}/${TASKS_PER_SHIFT} tasks)`, "gold");
      }
    };

    this.myTruck = new HaulTruck("#f7c52b");
    this.world.scene.add(this.myTruck.group);
    const sp = this.world.spots.truckSpawn;
    Object.assign(this.truckState, { x: sp.x, z: sp.z, yaw: Math.PI });
    placeVehicle(this.myTruck.group, sp.x, sp.z, Math.PI, 9);
    const ts = this.truckState;
    this.myClient = {
      get readyToLoad() {
        return ts.readyToLoad;
      },
      get passes() {
        return ts.passes;
      },
      set passes(n: number) {
        ts.passes = n;
      },
      truck: this.myTruck,
      onLoaded: () => {
        ts.readyToLoad = false;
      },
    };
    this.shovel.clients.push(this.myClient);

    const others = () => [
      ...this.trucks.map((t) => ({ x: t.x, z: t.z, self: t as unknown })),
      { x: this.truckState.x, z: this.truckState.z, self: this.myTruck },
    ];
    this.trucks.push(new TruckAI(this.world, new THREE.Vector3(170, 0, -96), 1, others), new TruckAI(this.world, new THREE.Vector3(146, 0, -40), 0, others));
    for (let i = 0; i < 9; i++) this.walkers.push(new Walker(this.world.scene, this.world.mineWalk, this.rng, true));
    for (let i = 0; i < 12; i++) this.walkers.push(new Walker(this.world.scene, this.world.townWalk, this.rng, false));
    this.world.benchSeats.forEach((s, i) => {
      if (i % 3 === 2) return;
      const p = new Person(randomTownLook(this.rng));
      p.sitting = true;
      p.group.position.copy(s.pos);
      p.group.rotation.y = s.yaw;
      p.animate(0, 0);
      this.world.scene.add(p.group);
      this.sitters.push(p);
    });
    this.football = new Football(this.world.scene, this.world, this.rng);
    this.trotro = new TrotroBus(this.world.scene, this.world.trotroRoad);

    for (const site of this.world.outcropSites) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 0), new THREE.MeshLambertMaterial({ color: "#888", flatShading: true }));
      rock.scale.set(1.4, 0.7, 1.1);
      rock.position.set(site.x, heightAt(site.x, site.z) + 0.6, site.z);
      rock.rotation.y = site.x;
      rock.castShadow = true;
      const flag = new THREE.Group();
      flag.add(box(0.15, 5, 0.15, "#eeeeee", 0, 2.5, 0), box(1.6, 1, 0.08, "#ff3d7f", 0.8, 4.4, 0));
      flag.position.set(site.x + 2.5, heightAt(site.x, site.z), site.z + 1);
      flag.visible = false;
      this.world.scene.add(rock, flag);
      const o: Outcrop = { ...site, rock, flag, type: "laterite", flagged: false };
      this.setRock(o, this.randomRock());
      this.outcrops.push(o);
    }

    this.beacon = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 60, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 30;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 4), new THREE.MeshBasicMaterial({ color: "#ffd23f" }));
    arrow.rotation.x = Math.PI;
    arrow.name = "arrow";
    this.beacon.add(beam, arrow);
    this.world.scene.add(this.beacon);

    this.world.scene.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) this.labels.push(o as THREE.Sprite);
    });

    // Townspeople have names you can learn by chatting.
    const names = [...TOWN_NAMES];
    this.walkers.forEach((w, i) => (w.name = names[i % names.length] + (i >= names.length ? " Jnr" : "")));

    this.rain = new Rain(this.world.scene);
    this.dust = new Dust(this.world.scene);
    this.weather = new WeatherClock(new Random(seed + 3));

    // Bikes for sale out front of Okada Motors, and your own once you buy one.
    for (const [dx, colour] of [[-3, "#1f6fb2"], [0, "#b8241f"], [3, "#2a2a2a"]] as const) {
      const b = new Motorbike(colour);
      const p = this.world.spots.bikeShop;
      b.group.position.set(p.x + dx, 0, p.z + 1.5);
      b.group.rotation.y = 0.4;
      this.world.scene.add(b.group);
    }
    this.bike = new Motorbike("#d6342c");
    this.bike.group.visible = false;
    this.world.scene.add(this.bike.group);

    this.bindInput();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.hud.onAct = () => this.act();
    this.hud.onExit = () => this.exitVehicle();
    this.hud.onPhone = () => this.openPhone();
    this.hud.onMap = () => this.openMap();
    document.addEventListener("visibilitychange", () => document.hidden && this.save());
    window.addEventListener("pagehide", () => this.save());

    // Show the town behind the title screen.
    this.pos.copy(this.world.spots.home).add(new THREE.Vector3(0, 0, -4));
    this.setGraphics(this.defaultQuality());
    this.renderer.setAnimationLoop(() => this.frame());
    this.titleScreen();
    (window as unknown as { __minelife: Game }).__minelife = this;
  }

  // ---------------------------------------------------------------- start and save

  private titleScreen(): void {
    const saved = this.loadSave();
    const look: Look = { skin: SKINS[1], shirt: "#1f6fb2", trousers: "#2c3e50" };
    const nameInput = h<HTMLInputElement>("input.name", { value: saved?.profile.name ?? "Kwame", maxlength: 16, "aria-label": "Your name" });
    const swatches = (label: string, colours: string[], key: "skin" | "shirt") => {
      const row = h("div.swatches", { role: "radiogroup", "aria-label": label });
      for (const c of colours) {
        const b = h("button.swatch", { style: `background:${c}`, "aria-label": `${label} ${c}`, role: "radio", "aria-checked": String(look[key] === c) });
        b.addEventListener("click", () => {
          look[key] = c;
          for (const x of row.children) x.setAttribute("aria-checked", String(x === b));
        });
        row.append(b);
      }
      return h("div.field", null, h("span", null, label), row);
    };
    const start = h("button.choice.primary", null, h("span", null, saved ? "Start a new life" : "Start your life"), h("small", null, "You arrive with what you've got. The town decides how much that is."));
    start.addEventListener("click", () => {
      this.profile = { name: nameInput.value.trim() || "Kwame", look: { ...look } };
      this.life = new Life((Date.now() % 100000) + 1);
      this.begin(false);
    });
    const card = h(
      "div.card.title",
      { role: "dialog", "aria-label": "MineLife" },
      h("div.logo", null, "Mine", h("b", null, "Life")),
      h("p.tag", null, `Start broke in ${TOWN_NAME}, a gold-mining town. Get hired at the mine, learn the trade, pay your rent, and keep yourself fed, rested and happy.`),
      saved
        ? h("button.choice.primary", {
            onclick: () => {
              this.profile = saved.profile;
              this.life = saved.life;
              this.begin(true, saved.pos);
            },
          }, h("span", null, `Continue as ${saved.profile.name}`), h("small", null, `Day ${saved.life.day}, ${cedis(saved.life.money)}`))
        : null,
      h("div.field", null, h("span", null, "Name"), nameInput),
      swatches("Skin", SKINS, "skin"),
      swatches("Shirt", ["#1f6fb2", "#d6342c", "#2e8b57", "#f2b705", "#8e44ad", "#f4f1e8"], "shirt"),
      start,
    );
    this.hud.show(card, false);
  }

  private begin(resumed: boolean, at?: [number, number]): void {
    this.hud.close(false);
    if (this.player) this.world.scene.remove(this.player.group);
    this.player = new Person({ ...this.profile.look, hat: undefined });
    this.world.scene.add(this.player.group);
    const home = this.world.spots.home;
    this.pos.set(at ? at[0] : home.x, 0, at ? at[1] : home.z + 1);
    this.yaw = Math.PI;
    this.cam.yaw = Math.PI - 0.5;
    this.mode = "walk";
    this.bike.group.visible = this.life.ownsBike;
    if (this.life.ownsBike && !this.bikeState.x) this.parkBike(this.world.spots.bikePark.x, this.world.spots.bikePark.z, Math.PI);
    else this.parkBike(this.bikeState.x, this.bikeState.z, this.bikeState.yaw);
    this.started = true;
    this.paused = false;
    this.clock.getDelta();
    this.refreshHud();
    if (!resumed) {
      const rich = this.life.background === "family";
      this.hud.dialog(
        `Akwaaba, ${this.profile.name}`,
        h(
          "div",
          null,
          h("p", null, rich
            ? `Your family helped you move to ${TOWN_NAME} with ${cedis(this.life.money)} in your MoMo wallet.`
            : `You came to ${TOWN_NAME} with ${cedis(this.life.money)} and a bag. Everyone starts somewhere.`),
          h("p", null, `Rent on your room in the compound house is ${cedis(this.life.rent)} a week, due on day ${this.life.rentDueDay}. The mine hires from 06:00 to 18:00.`),
          h("p", null, "Open your phone and take a job as a General Labourer to start earning. Get better at each job to earn more, and work your way up to driver, geologist or shift supervisor. Chat with people in town to make friends."),
        ),
        [{ label: "Open my phone", primary: true, onPick: () => this.openPhone("jobs") }, { label: "Look around first" }],
      );
    } else this.hud.toast(`Welcome back, ${this.profile.name}.`, "good");
  }

  private save(): void {
    if (!this.started) return;
    const l = this.life;
    const data = {
      profile: this.profile,
      pos: [this.pos.x, this.pos.z],
      seed: 0,
      life: {
        background: l.background, money: l.money, minutes: l.minutes, needs: l.needs, job: l.job, shiftsWorked: l.shiftsWorked,
        certs: [...l.certs], rentDueDay: l.rentDueDay, evicted: l.evicted, fare: l.fare, totalEarned: l.totalEarned,
        xp: l.xp, home: l.home, ownsBike: l.ownsBike, friends: l.friends, lastChat: l.lastChat, goalsDone: [...l.goalsDone],
      },
      bike: [this.bikeState.x, this.bikeState.z, this.bikeState.yaw],
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable; the game still runs.
    }
  }

  private loadSave(): { profile: Profile; life: Life; pos: [number, number] } | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const life = new Life(1, d.life.background);
      Object.assign(life, { money: d.life.money, minutes: d.life.minutes, needs: d.life.needs, job: d.life.job, rentDueDay: d.life.rentDueDay, evicted: d.life.evicted, fare: d.life.fare, totalEarned: d.life.totalEarned });
      Object.assign(life.shiftsWorked, d.life.shiftsWorked);
      for (const c of d.life.certs) life.certs.add(c);
      Object.assign(life.xp, d.life.xp ?? {});
      Object.assign(life.friends, d.life.friends ?? {});
      Object.assign(life.lastChat, d.life.lastChat ?? {});
      for (const g of d.life.goalsDone ?? []) life.goalsDone.add(g);
      if (d.life.home in HOMES) life.home = d.life.home;
      life.ownsBike = !!d.life.ownsBike;
      if (d.bike) Object.assign(this.bikeState, { x: d.bike[0], z: d.bike[1], yaw: d.bike[2] });
      (life as unknown as { lastDay: number }).lastDay = life.day;
      return { profile: d.profile, life, pos: d.pos };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const canvas = this.renderer.domElement;
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (this.hud.open) {
        if (k === "escape") this.hud.close();
        const n = Number(e.key);
        if (n >= 1 && n <= 9) {
          const buttons = document.querySelectorAll<HTMLButtonElement>(".layer .choices button:not([disabled])");
          buttons[n - 1]?.click();
        }
        return;
      }
      this.keys.add(k);
      if (e.repeat) return;
      if (k === "e" || k === " " || k === "enter") this.act();
      else if (k === "f") this.exitVehicle();
      else if (k === "p" || k === "tab") {
        e.preventDefault();
        this.openPhone();
      } else if (k === "m") this.openMap();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.cam.yaw -= (e.clientX - drag.x) * 0.006;
      this.cam.pitch = Math.max(0.08, Math.min(1.35, this.cam.pitch + (e.clientY - drag.y) * 0.004));
      this.cam.dragAt = performance.now();
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(7, Math.min(60, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  private axis(): { x: number; y: number; run: boolean } {
    const k = this.keys;
    let x = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    let y = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    if (this.hud.touch.active) {
      x = this.hud.touch.x;
      y = -this.hud.touch.y;
    }
    return { x, y, run: k.has("shift") || this.hud.running };
  }

  private resize(): void {
    const w = this.container.clientWidth || innerWidth;
    const hgt = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, hgt);
    this.look.setSize(w, hgt);
    this.camera.aspect = w / hgt;
    if (w < hgt) this.cam.dist = Math.max(this.cam.dist, 24);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- loop

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const live = this.started && !this.hud.open && !this.paused;
    this.time += dt;
    wind.time.value = this.time;
    if (live) this.update(dt);
    this.animateWorld(live ? dt : 0);
    this.updateCamera(dt);
    this.updateLighting();
    this.dust.update(live ? dt : 0, this.world.hemi.color.clone().multiplyScalar(0.5).add(this.world.sun.color.clone().multiplyScalar(Math.min(1, this.world.sun.intensity / 3))));
    this.rain.update(this.time, this.camera, this.look.rain, Math.min(1, this.world.sun.intensity / 2.5));
    this.look.render(this.time);
    this.frames++;
    this.checkFps(dt);
  }

  /** Steps quality down while the frame rate stays low: first bloom and MSAA, then post and shadows. */
  private checkFps(dt: number): void {
    const f = this.fpsCheck;
    if (f.done || !this.started) return;
    f.t += dt;
    f.frames++;
    if (f.t < 4) return;
    const fps = f.frames / f.t;
    f.t = 0;
    f.frames = 0;
    if (fps >= 40 || this.look.quality === 0) {
      f.done = true;
      return;
    }
    this.setGraphics(this.look.quality - 1);
  }

  /** Picks a starting quality from the GPU's name, or the player's saved choice. */
  private defaultQuality(): number {
    try {
      const saved = localStorage.getItem(GRAPHICS_KEY);
      if (saved !== null) {
        this.fpsCheck.done = true;
        return Math.max(0, Math.min(3, Number(saved)));
      }
    } catch {
      // No storage: fall through to detection.
    }
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return 0;
    if (/nvidia|geforce|gtx|rtx|quadro|radeon|rx ?\d|arc/i.test(gpu) && !/radeon\(tm\) graphics|vega \d+ graphics/i.test(gpu)) return 2;
    return 1;
  }

  /** The renderer's name, shown on the Me tab. */
  private gpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).replace(/^ANGLE \((.*)\)$/, "$1") : "unknown";
  }

  setGraphics(q: number): void {
    this.look.setQuality(q);
    this.world.plants.grass.visible = q > 0;
    const size = q >= 3 ? 4096 : 2048;
    const sh = this.world.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      (sh as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    const shadows = q > 0;
    if (shadows !== this.shadows) {
      this.shadows = shadows;
      this.renderer.shadowMap.enabled = shadows;
      this.world.sun.castShadow = shadows;
      this.world.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    }
    this.renderer.setPixelRatio(q === 2 ? Math.min(devicePixelRatio, 1.5) : 1);
    this.resize();
  }

  private update(dt: number): void {
    const life = this.life;
    let activity: "idle" | "walk" | "run" | "work" = "idle";
    if (this.mode === "walk") activity = this.updateWalking(dt);
    else if (this.mode === "truck") this.updateDriving(dt);
    else if (this.mode === "bike") this.updateBike(dt);
    else this.updateExcavator();

    const event = life.tick(dt * MINUTES_PER_SECOND, activity);
    if (event) this.showEvent(event);
    this.checkNeeds();
    this.look.rain = this.weather.step(life.minutes, dt * MINUTES_PER_SECOND);
    groundWet.value += ((this.look.rain > 0.05 ? 1 : 0) - groundWet.value) * Math.min(1, dt / (this.look.rain > 0.05 ? 25 : 120));
    this.goalTimer -= dt;
    if (this.goalTimer <= 0) {
      this.goalTimer = 1;
      for (const g of life.checkGoals()) this.hud.toast(`🏆 Goal reached: ${g.title}${g.reward ? `. +${cedis(g.reward)}` : ""}`, "gold");
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.15;
      this.refreshHud();
    }
    this.saveTimer += dt;
    if (this.saveTimer > 20) {
      this.saveTimer = 0;
      this.save();
    }
  }

  private updateWalking(dt: number): "idle" | "walk" | "run" {
    const { x, y, run } = this.axis();
    const len = Math.min(1, Math.hypot(x, y));
    let activity: "idle" | "walk" | "run" = "idle";
    if (len > 0.05) {
      const cy = this.cam.yaw;
      const fx = -Math.sin(cy);
      const fz = -Math.cos(cy);
      const dx = fx * y + Math.cos(cy) * x;
      const dz = fz * y - Math.sin(cy) * x;
      const dl = Math.hypot(dx, dz) || 1;
      const tired = this.life.needs.energy < 8;
      const sp = (run && !tired && !this.carrying ? RUN : WALK) * len * (tired ? 0.6 : 1);
      this.speed = sp;
      this.pos.x += (dx / dl) * sp * dt;
      this.pos.z += (dz / dl) * sp * dt;
      this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), dt * 12);
      activity = sp > WALK + 0.5 ? "run" : "walk";
    } else this.speed = 0;
    this.collide(this.pos, 0.8);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.player.group.position.copy(this.pos);
    this.player.group.rotation.y = this.yaw;
    this.player.carrying = !!this.carrying;
    this.player.animate(dt, this.speed);
    this.updatePrompt();
    return activity;
  }

  private collide(p: THREE.Vector3, r: number): boolean {
    let hit = false;
    for (const b of this.world.colliders) {
      if (p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r) {
        hit = true;
        const pushes = [b.minX - r - p.x, b.maxX + r - p.x, b.minZ - r - p.z, b.maxZ + r - p.z];
        const i = pushes.reduce((best, v, j) => (Math.abs(v) < Math.abs(pushes[best]) ? j : best), 0);
        if (i < 2) p.x += pushes[i];
        else p.z += pushes[i];
      }
    }
    p.x = Math.max(GROUND.minX + 5, Math.min(GROUND.maxX - 5, p.x));
    p.z = Math.max(GROUND.minZ + 5, Math.min(GROUND.maxZ - 5, p.z));
    return hit;
  }

  private updateDriving(dt: number): void {
    const t = this.truckState;
    const { x, y } = this.axis();
    if (t.tipping >= 0) {
      t.tipping += dt;
      const up = Math.min(1, t.tipping / 1.8);
      const down = Math.max(0, Math.min(1, (t.tipping - 2.8) / 1.8));
      this.myTruck.bed.rotation.x = -0.95 * (up - down);
      if (t.tipping > 2 && this.myTruck.loaded) {
        this.myTruck.setLoad(null);
        const pay = this.task(1);
        this.hud.toast(`Tipped 100 t of ore into the crusher. +${cedis(pay)} (${this.life.shiftTasks}/${TASKS_PER_SHIFT} tasks)`, "gold");
      }
      if (t.tipping > 4.8) {
        t.tipping = -1;
        this.myTruck.bed.rotation.x = 0;
      }
    } else if (!t.readyToLoad) {
      const max = this.myTruck.loaded ? 10 : 14;
      const target = y > 0 ? y * max : y < 0 ? y * 5 : 0;
      const rate = y === 0 || Math.sign(target) !== Math.sign(t.speed) ? 6 : 3;
      t.speed += Math.max(-rate * dt, Math.min(rate * dt, target - t.speed));
      t.yaw -= x * dt * Math.min(1, Math.abs(t.speed) / 4) * 0.8 * Math.sign(t.speed || 1);
    }
    const nx = t.x + Math.sin(t.yaw) * t.speed * dt;
    const nz = t.z + Math.cos(t.yaw) * t.speed * dt;
    const probe = new THREE.Vector3(nx, 0, nz);
    let blocked = this.collide(probe.clone(), 4);
    for (const ai of this.trucks) if (Math.hypot(ai.x - nx, ai.z - nz) < 9) blocked = true;
    if (blocked) {
      if (Math.abs(t.speed) > 3) this.hud.toast("Bump. Watch the other vehicles.", "bad");
      t.speed = 0;
    } else {
      t.x = Math.max(GROUND.minX + 8, Math.min(GROUND.maxX - 8, nx));
      t.z = Math.max(GROUND.minZ + 8, Math.min(GROUND.maxZ - 8, nz));
    }
    this.myTruck.roll(t.speed * dt);
    placeVehicle(this.myTruck.group, t.x, t.z, t.yaw, 9);
    // Stop at the shovel to be loaded.
    const load = this.world.haul.load;
    const atShovel = Math.hypot(t.x - load.x, t.z - load.z) < 7 && Math.abs(t.speed) < 0.4;
    if (atShovel && !this.myTruck.loaded && !t.readyToLoad && this.life.onShift) {
      t.readyToLoad = true;
      t.passes = 0;
      t.speed = 0;
      this.hud.toast("Parked under the boom. Hold still while the excavator loads you.");
    }
    this.pos.set(t.x, heightAt(t.x, t.z), t.z);
    this.player.group.position.set(t.x, -50, t.z);
    this.updatePrompt();
  }

  private parkBike(x: number, z: number, yaw: number): void {
    Object.assign(this.bikeState, { x, z, yaw, speed: 0, steer: 0 });
    const g = this.bike.group;
    g.position.set(x, heightAt(x, z), z);
    g.rotation.set(0, yaw, 0.12);
    this.bike.steer(0.35);
  }

  private updateBike(dt: number): void {
    const b = this.bikeState;
    const { x, y } = this.axis();
    const target = y > 0 ? y * BIKE_SPEED : y < 0 ? (b.speed > 1 ? 0 : y * 3) : 0;
    const rate = y < 0 && b.speed > 1 ? 16 : y === 0 ? 4 : 7;
    b.speed += Math.max(-rate * dt, Math.min(rate * dt, target - b.speed));
    b.steer += (x - b.steer) * Math.min(1, dt * 6);
    b.yaw -= b.steer * dt * 2.2 * Math.min(1, Math.abs(b.speed) / 3) * Math.sign(b.speed || 1);
    const probe = new THREE.Vector3(b.x + Math.sin(b.yaw) * b.speed * dt, 0, b.z + Math.cos(b.yaw) * b.speed * dt);
    let hit = this.collide(probe, 1);
    for (const ai of this.trucks) if (Math.hypot(ai.x - probe.x, ai.z - probe.z) < 6) hit = true;
    if (Math.hypot(this.truckState.x - probe.x, this.truckState.z - probe.z) < 6) hit = true;
    if (hit && Math.abs(b.speed) > 6) {
      this.hud.toast("Ouch! Mind where you ride.", "bad");
      this.life.adjust({ energy: -3 });
    }
    if (hit) b.speed *= 0.3;
    b.x = probe.x;
    b.z = probe.z;
    this.bike.roll(b.speed * dt);
    this.bike.steer(-b.steer * 0.5);
    const g = this.bike.group;
    g.position.set(b.x, heightAt(b.x, b.z), b.z);
    g.rotation.set(0, b.yaw, b.steer * 0.35 * Math.min(1, Math.abs(b.speed) / 10));
    // The rider sits on the seat and leans with the bike.
    this.pos.set(b.x, g.position.y, b.z);
    const p = this.player.group;
    p.position.copy(this.bike.seat).applyEuler(g.rotation).add(g.position);
    p.position.y += -0.28;
    p.rotation.copy(g.rotation);
    this.yaw = b.yaw;
    this.updatePrompt();
  }

  private mountBike(): void {
    this.mode = "bike";
    this.carrying = null;
    this.player.hands.clear();
    this.player.sitting = true;
    this.player.animate(0, 0);
    this.cam.yaw = this.bikeState.yaw + Math.PI;
    this.hud.toast("W to ride, S to brake, A/D to steer. F to get off.", "info");
  }

  private updateExcavator(): void {
    const s = this.world.shovel.group.position;
    this.pos.set(s.x, s.y, s.z);
    this.updatePrompt();
  }

  private animateWorld(dt: number): void {
    const near = (o: THREE.Object3D) => o.position.distanceToSquared(this.pos) < 130 * 130;
    if (dt > 0) {
      this.shovel.update(dt);
      for (const t of this.trucks) t.update(dt, this.shovel);
      for (const w of this.walkers) w.update(dt, near(w.person.group));
      this.football.update(dt, near(this.football.ball));
      this.trotro.update(dt);
      this.world.rigRod.rotation.y += dt * 6;
      this.world.rigRod.position.y = 7.5 + Math.sin(performance.now() / 2000) * 1.2;
      this.world.millDrum.rotation.x += dt * 0.8;
      this.world.trayStack.visible = this.life && this.life.minutes >= this.trayReadyAt;
      this.kickDust(dt);
    }
    // Beacon at the current goal.
    const target = this.started ? this.goal().target : null;
    this.beacon.visible = !!target && target.distanceTo(this.pos) > 7;
    if (target) {
      this.beacon.position.set(target.x, heightAt(target.x, target.z), target.z);
      const arrow = this.beacon.getObjectByName("arrow")!;
      arrow.position.y = 7 + Math.sin(performance.now() / 300) * 0.6;
      arrow.rotation.y += 0.03;
    }
  }

  /** Trucks and bikes throw up red dust on dry laterite. */
  private kickDust(dt: number): void {
    this.dustTimer -= dt;
    if (this.dustTimer > 0 || groundWet.value > 0.4) return;
    this.dustTimer = 0.07;
    const emit = (x: number, z: number, yaw: number, speed: number, back: number, size: number) => {
      if (Math.abs(speed) < 3 || !inLease(x, z) || Math.hypot(x - this.camera.position.x, z - this.camera.position.z) > 160) return;
      for (const side of [-1, 1]) {
        const ex = x - Math.sin(yaw) * back + Math.cos(yaw) * side * size * 0.3;
        const ez = z - Math.cos(yaw) * back - Math.sin(yaw) * side * size * 0.3;
        this.dust.emit(ex, heightAt(ex, ez), ez, size * Math.min(1.4, Math.abs(speed) / 9), this.rng);
      }
    };
    for (const t of this.trucks) emit(t.x, t.z, t.yaw, t.speed, 3.5, 4);
    emit(this.truckState.x, this.truckState.z, this.truckState.yaw, this.truckState.speed, 3.5, 4);
    if (this.mode === "bike") emit(this.bikeState.x, this.bikeState.z, this.bikeState.yaw, this.bikeState.speed, 1, 1.4);
  }

  private updateCamera(dt: number): void {
    let target: THREE.Vector3;
    let dist = this.cam.dist;
    if (this.mode === "truck") {
      target = new THREE.Vector3(this.truckState.x, heightAt(this.truckState.x, this.truckState.z) + 5, this.truckState.z);
      dist = Math.max(dist, 24);
      if (performance.now() - this.cam.dragAt > 1500 && Math.abs(this.truckState.speed) > 1)
        this.cam.yaw = turnToward(this.cam.yaw, this.truckState.yaw + Math.PI, dt * 1.2);
    } else if (this.mode === "bike") {
      const b = this.bikeState;
      target = new THREE.Vector3(b.x, heightAt(b.x, b.z) + 2.2, b.z);
      dist = Math.max(dist, 13);
      if (performance.now() - this.cam.dragAt > 1500 && Math.abs(b.speed) > 1) this.cam.yaw = turnToward(this.cam.yaw, b.yaw + Math.PI, dt * 2);
    } else if (this.mode === "excavator") {
      const s = this.world.shovel.group.position;
      target = new THREE.Vector3(s.x + 6, s.y + 5, s.z);
      dist = Math.max(dist, 30);
    } else target = new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z);
    if (!this.started) {
      this.cam.yaw += dt * 0.05;
      dist = 70;
      target = new THREE.Vector3(-110, 0, 80);
    }
    const p = this.cam.pitch;
    const cp = new THREE.Vector3(
      target.x + Math.sin(this.cam.yaw) * Math.cos(p) * dist,
      target.y + Math.sin(p) * dist,
      target.z + Math.cos(this.cam.yaw) * Math.cos(p) * dist,
    );
    // Pull the camera in front of any building between it and the player.
    if (this.started && this.mode === "walk") {
      for (let k = 1; k > 0.15; k -= 0.05) {
        const x = target.x + (cp.x - target.x) * k;
        const z = target.z + (cp.z - target.z) * k;
        const y = target.y + (cp.y - target.y) * k;
        if (y > 11 || !this.world.colliders.some((b) => x > b.minX - 0.5 && x < b.maxX + 0.5 && z > b.minZ - 0.5 && z < b.maxZ + 0.5)) {
          cp.set(x, y, z);
          break;
        }
      }
    }
    cp.y = Math.max(cp.y, heightAt(cp.x, cp.z) + 1.5);
    this.camera.position.lerp(cp, this.started ? Math.min(1, dt * 10) : 1);
    this.camera.lookAt(target);
    for (const l of this.labels) l.visible = l.position.distanceToSquared(this.camera.position) > 30 * 30;
  }

  private updateLighting(): void {
    const hour = this.started ? this.life.hour : 16.8;
    const elevation = Math.sin(((hour - 6) / 12) * Math.PI);
    const day = Math.sqrt(Math.max(0, elevation));
    const dusk = Math.max(0, 1 - Math.abs(hour - 18.1) / 1.3) + Math.max(0, 1 - Math.abs(hour - 6) / 1.1);
    const w = this.world;
    const angle = ((hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(angle) * 0.85, elevation, 0.4).normalize();
    this.look.setTime(day, Math.min(1, dusk), sunDir);
    // By day the sun lights the scene; at night a pale moon from high up.
    const night = day < 0.12;
    const lightDir = night ? new THREE.Vector3(-0.3, 0.8, -0.5).normalize() : new THREE.Vector3(sunDir.x, Math.max(0.12, sunDir.y), sunDir.z).normalize();
    const overcast = this.look.rain;
    w.sun.intensity = (night ? 0.7 : 0.5 + day * 2.9) * (1 - overcast * 0.7);
    w.sun.color.set(night ? "#9fb4d9" : "#fff1d6").lerp(new THREE.Color("#ff9a50"), night ? 0 : Math.min(1, dusk * 0.9));
    w.hemi.intensity = (night ? 0.35 : 0.12 + day * 0.35) * (1 + overcast * 0.6);
    w.sun.shadow.radius = 3 + overcast * 6;
    w.sun.position.copy(this.pos).addScaledVector(lightDir, 140);
    w.sun.target.position.copy(this.pos);
    const dark = day > 0.3 ? 0 : 1 - day / 0.3;
    windowGlow.emissiveIntensity = dark * 1.4;
    lampGlow.emissiveIntensity = dark * 6;
    if (Math.abs(hour - this.bakedAt) > 0.5 || Math.abs(overcast - this.bakedRain) > 0.15) {
      this.bakedAt = hour;
      this.bakedRain = overcast;
      this.look.bakeEnvironment();
    }
  }

  // ---------------------------------------------------------------- goals and HUD

  private homeSpot(): THREE.Vector3 {
    return this.world.spots[HOME_SPOT[this.life.home]];
  }

  private placeName(id: SpotId): string {
    return this.world.names[id] ?? id;
  }

  /** What the player should do next, and where. */
  private goal(): { text: string; target: THREE.Vector3 | null } {
    const l = this.life;
    const s = this.world.spots;
    if (l.evicted) return { text: `You're locked out. Pay ${cedis(this.life.rent)} rent with MoMo on your phone.`, target: null };
    if (!l.job) return { text: "Open your phone (P) and take a job. Anyone can start as a General Labourer.", target: null };
    const job = JOBS[l.job];
    const workplace = s[PLACE_SPOT[job.place]!];
    if (!l.onShift) {
      if (!l.inShiftHours) return { text: `Shifts run ${SHIFT.start}:00 to ${SHIFT.end}:00. Rest, eat or have fun until then.`, target: l.needs.energy < 50 ? this.homeSpot() : null };
      return { text: `Go to ${this.placeName(PLACE_SPOT[job.place]!)} and clock in as ${job.title}.`, target: workplace };
    }
    switch (job.task) {
      case "carry":
        return this.carrying ? { text: "Carry the sack to the core shed.", target: s.coreShed } : { text: "Pick up a sample sack at the stockyard.", target: s.sackPile };
      case "core":
        if (this.carrying) return { text: "Take the core tray to the core shed and log it.", target: s.coreShed };
        return { text: "Collect a core tray from the drill rig on the pit rim.", target: s.drillRig };
      case "haul":
        if (this.mode !== "truck") return { text: "Get in your haul truck at the truck park.", target: new THREE.Vector3(this.truckState.x, 0, this.truckState.z) };
        if (this.truckState.readyToLoad) return { text: "Hold still. The excavator is loading you.", target: null };
        if (this.myTruck.loaded) return { text: "Drive up the ramp to the crusher and tip (E).", target: s.tipPoint };
        return { text: "Drive down the ramp and stop by the excavator. W/S drive, A/D steer.", target: s.loadPoint };
      case "load":
        if (this.mode !== "excavator") return { text: "Climb into the excavator on the pit floor.", target: s.shovel };
        return { text: this.shovel.bucketFull ? "E: swing and dump into the truck." : "E: dig a bucket of ore from the face.", target: null };
      case "panel":
        return { text: "Run mill batches at the control panel.", target: s.controlRoom };
      case "inspect": {
        const at = this.inspectAt ?? this.nextInspection();
        return { text: `Inspect ${this.placeName(at)} and deal with any hazard you find.`, target: s[at] };
      }
      case "map": {
        const flags = this.outcrops.filter((o) => o.flagged);
        if (!flags.length) this.flagOutcrops();
        const near = this.outcrops.filter((o) => o.flagged).sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z))[0];
        return { text: "Map the flagged outcrops. Pink flags on the lease.", target: near ? new THREE.Vector3(near.x, 0, near.z) : null };
      }
    }
  }

  private refreshHud(): void {
    const l = this.life;
    let job = l.job ? `${JOBS[l.job].title} · Lv ${l.level(l.job)}` : "Unemployed";
    if (l.onShift) job += ` · on shift · ${l.shiftTasks}/${TASKS_PER_SHIFT} tasks · ${cedis(l.shiftPay)}`;
    this.hud.setStats(l.money, `Day ${l.day} · ${l.weekday} ${l.clock}`, job, l.needs, l.onShift);
    this.hud.setGoal(this.goal().text);
    this.hud.vehicleBar.hidden = this.mode === "walk";

    this.mapTimer -= 0.15;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.3;
      this.drawMap(this.hud.minimap, this.pos.x, this.pos.z, 0.55);
    }
  }

  private checkNeeds(): void {
    const tips: Record<Need, string> = {
      hunger: "You're hungry. Eat at Auntie Ama's or cook at home.",
      energy: "You're exhausted. Get some sleep in your room.",
      fun: "You're bored. Play football or go to the spot.",
      social: "You're lonely. Meet people at the spot or the chop bar.",
      hygiene: "You need a bath. There's a bucket at home.",
    };
    for (const n of NEEDS) {
      const low = this.life.needs[n] < 25;
      if (low && !this.lowNeeds.has(n)) {
        this.lowNeeds.add(n);
        this.hud.toast(`${NEED_INFO[n].icon} ${tips[n]}`, "bad");
      } else if (!low && this.life.needs[n] > 30) this.lowNeeds.delete(n);
    }
    if (this.life.needs.energy <= 0 && (this.mode === "walk" || this.mode === "bike")) {
      if (this.mode === "bike") this.exitVehicle(true);
      this.collapse();
    }
  }

  private collapse(): void {
    const l = this.life;
    const fee = Math.min(l.money, 40);
    this.paused = true;
    this.carrying = null;
    this.hud
      .fade(() => {
        if (l.onShift) l.clockOut();
        l.money -= fee;
        l.passTime(8 * 60);
        l.adjust({ energy: 45, hunger: -10, fun: -10 });
        this.pos.copy(this.homeSpot());
      }, "You collapsed from exhaustion…")
      .then(() => {
        this.paused = false;
        this.hud.dialog("You collapsed", `A neighbour carried you home and paid the nurse ${cedis(fee)} from your wallet. You lost the night. Sleep before you run empty.`, [{ label: "OK" }]);
      });
  }

  private showEvent(e: LifeEvent): void {
    if (e.title === "Rain in the pit") this.weather.forcedUntil = this.life.minutes + 180;
    this.hud.dialog(
      e.title,
      e.text,
      e.choices.map((c) => ({
        label: c.label,
        onPick: () => {
          const msg = c.apply(this.life);
          if (msg) this.hud.toast(msg);
        },
      })),
      { dismissable: false },
    );
    const l = this.life;
    const left = l.rentDueDay - l.day;
    if (left >= 0 && left <= 1 && !l.evicted) this.hud.toast(`Rent of ${cedis(this.life.rent)} is due on day ${l.rentDueDay}. Pay with MoMo on your phone.`, "bad");
  }

  // ---------------------------------------------------------------- interactions

  private interactions(): Interaction[] {
    const l = this.life;
    const s = this.world.spots;
    const list: Interaction[] = [];
    const add = (at: THREE.Vector3, text: string, run: () => void, radius = 4.5, priority = 1) => list.push({ at, text, run, radius, priority });

    if (this.mode === "truck") {
      const t = this.truckState;
      const tip = s.tipPoint;
      if (this.myTruck.loaded && t.tipping < 0 && Math.hypot(t.x - tip.x, t.z - tip.z) < 10) {
        add(this.pos, Math.abs(t.speed) < 0.5 ? "Tip your load into the crusher" : "Stop to tip your load", () => {
          if (Math.abs(t.speed) < 0.5) t.tipping = 0;
        }, 99, 0);
      }
      return list;
    }
    if (this.mode === "bike") return list;
    if (this.mode === "excavator") {
      add(this.pos, this.shovel.bucketFull ? "Swing and dump into the truck" : "Dig a bucket from the face", () => {
        const why = this.shovel.command();
        if (why) this.hud.toast(why);
      }, 99, 0);
      return list;
    }

    for (const id of Object.keys(HOMES) as HomeId[]) {
      const mine = l.home === id;
      add(s[HOME_SPOT[id]], mine ? (l.evicted ? "Your home is padlocked" : `Go into your ${HOMES[id].title.toLowerCase()}`) : `Ask the landlord about the ${HOMES[id].title.toLowerCase()} (${cedis(HOMES[id].rent)}/week)`, () => (mine ? this.homeMenu() : this.landlord(id)));
    }
    add(s.bikeShop, l.ownsBike ? "Okada Motors" : `Okada Motors: buy a motorbike (${cedis(BIKE_PRICE)})`, () => this.bikeShop());
    if (l.ownsBike) add(new THREE.Vector3(this.bikeState.x, 0, this.bikeState.z), "Ride your motorbike", () => this.mountBike(), 2.5, 1.5);
    // Anyone nearby to chat with.
    for (const w of this.walkers) {
      const p = w.person.group.position;
      if (Math.abs(p.x - this.pos.x) > 4 || Math.abs(p.z - this.pos.z) > 4) continue;
      const pts = l.friends[w.name] ?? 0;
      add(p.clone(), `Chat with ${w.name} (${friendLevel(pts)})`, () => this.chat(w), 2.8, 3);
    }
    add(s.chopBar, "Eat at Auntie Ama's Chop Bar", () => this.shop("chopBar", "Auntie Ama's Chop Bar", "Hot food, cold water, and the latest gossip."));
    add(s.spot, "Hang out at Gold Coast Spot", () => this.shop("spot", "Gold Coast Spot", "Highlife on the speaker and miners after their shift."));
    add(s.pitch, "Join the football match", () => this.shop("pitch", "Football pitch", "The boys need one more player."), 7);
    add(s.training, "Mining Training Centre", () => this.trainingMenu());
    add(s.kiosk, "MoMo kiosk", () => this.openPhone("momo"));
    add(s.trotroTown, `Ride the trotro to the mine gate (${cedis(l.fare)})`, () => this.rideTrotro(s.trotroMine), 5);
    add(s.trotroMine, `Ride the trotro to town (${cedis(l.fare)})`, () => this.rideTrotro(s.trotroTown), 5);
    add(s.office, "Mine office", () => this.officeMenu());

    if (l.job) {
      const job = JOBS[l.job];
      const spotId = PLACE_SPOT[job.place]!;
      add(s[spotId], l.onShift ? `Clock out (${l.shiftTasks}/${TASKS_PER_SHIFT} tasks, ${cedis(l.shiftPay)})` : `Clock in as ${job.title}`, () => (l.onShift ? this.confirmClockOut() : this.clockIn()), 4.5, 0.9);
      if (l.onShift) {
        if (job.task === "carry") {
          if (!this.carrying) add(s.sackPile, "Pick up a sample sack", () => this.pickUp("sack"), 4.5, 0);
          else add(s.coreShed, "Drop the sample sack at the core shed", () => this.deliverSack(), 4.5, 0);
        } else if (job.task === "core") {
          if (!this.carrying) {
            const ready = l.minutes >= this.trayReadyAt;
            add(s.drillRig, ready ? "Collect a core tray" : "The driller is still pulling the next run", () => ready && this.pickUp("tray"), 5, 0);
          } else add(s.coreShed, "Log the core tray", () => this.logCore(), 4.5, 0);
        } else if (job.task === "haul") {
          const t = this.truckState;
          add(new THREE.Vector3(t.x, 0, t.z), "Get in your haul truck", () => this.enterTruck(), 8, 0);
        } else if (job.task === "load") {
          add(s.shovel, "Climb into the excavator", () => this.enterExcavator(), 5, 0);
        } else if (job.task === "panel") {
          add(s.controlRoom, "Run a mill batch", () => this.millGame(), 4.5, 0);
        } else if (job.task === "map") {
          for (const o of this.outcrops) if (o.flagged) add(new THREE.Vector3(o.x, 0, o.z), "Map this outcrop", () => this.mapOutcrop(o), 5, 0);
        } else if (job.task === "inspect") {
          const at = this.inspectAt ?? this.nextInspection();
          add(s[at], `Inspect ${this.placeName(at)}`, () => this.inspect(at), 6, 0);
        }
      }
    }
    if (l.evicted) add(s.trotroTown.clone().add(new THREE.Vector3(0, 0, 3)), "Sleep on the station bench", () => this.sleepRough(), 4, 0);
    return list;
  }

  private nearest(): Interaction | null {
    let best: Interaction | null = null;
    let bestScore = Infinity;
    for (const i of this.interactions()) {
      const d = Math.hypot(i.at.x - this.pos.x, i.at.z - this.pos.z);
      if (d > i.radius) continue;
      const score = (i.priority ?? 1) * 100 + d;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return best;
  }

  private updatePrompt(): void {
    this.lastInteractions = this.nearest();
    this.hud.setPrompt(this.lastInteractions?.text ?? null);
  }

  private act(): void {
    if (!this.started || this.hud.open || this.paused) return;
    const i = this.nearest();
    if (i) i.run();
  }

  // ---------------------------------------------------------------- places

  private homeMenu(): void {
    const l = this.life;
    if (l.evicted) {
      this.hud.dialog("Padlocked", `The landlord locked your room. Rent of ${cedis(this.life.rent)} is overdue.`, [
        { label: `Pay ${cedis(this.life.rent)} with MoMo`, primary: true, disabled: l.money < this.life.rent, onPick: () => this.payRent() },
        { label: "Leave" },
      ]);
      return;
    }
    const due = l.rentDueDay - l.day;
    const home = HOMES[l.home];
    const offers: Offer[] = [...OFFERS.home!];
    if (l.home !== "room") offers.push({ id: "tv", label: "Watch the evening news and a movie", cost: 0, minutes: 90, effects: { fun: 25, energy: -3 } });
    if (l.home === "selfCon") offers.push({ id: "guests", label: "Invite friends round for jollof", cost: 40, minutes: 120, effects: { social: 40, fun: 20, hunger: 35 } });
    this.hud.dialog(
      `Your ${home.title.toLowerCase()}`,
      `${home.blurb} Rent ${cedis(l.rent)} a week, ${due >= 0 ? `due in ${due} day${due === 1 ? "" : "s"}` : `${-due} day${due === -1 ? "" : "s"} late`}.`,
      [
        { label: "Sleep", sub: `${l.hour >= 20 || l.hour < 5 ? "Until morning" : "Up to 8 hours"} · +${home.rest} energy an hour`, primary: l.needs.energy < 40, onPick: () => this.sleep() },
        { label: "Nap for 2 hours", sub: "+20 energy", onPick: () => this.nap() },
        ...offers.map((o) => this.offerChoice(o)),
        { label: `Pay rent (${cedis(this.life.rent)})`, sub: `Next due day ${l.rentDueDay}`, disabled: l.money < this.life.rent, onPick: () => this.payRent() },
      ],
    );
  }

  private landlord(id: HomeId): void {
    const l = this.life;
    const home = HOMES[id];
    const better = home.rent > l.rent;
    this.hud.dialog(
      home.title,
      h("div", null, h("p", null, home.blurb), h("p", null, `Rent ${cedis(home.rent)} a week, first week paid up front. Sleep gives +${home.rest} energy an hour (you get +${HOMES[l.home].rest} now).`), l.evicted ? h("p.why", null, "The landlord wants your old rent cleared first.") : null),
      [
        {
          label: `Move in · ${cedis(home.rent)}`,
          sub: better ? "Your rent goes up, but you rest better" : "Cheaper rent, plainer room",
          primary: true,
          disabled: l.evicted || l.money < home.rent,
          onPick: () => {
            const err = l.moveHome(id);
            this.hud.toast(err ?? `You moved into the ${home.title.toLowerCase()}. Rent is due on day ${l.rentDueDay}.`, err ? "bad" : "gold");
          },
        },
        { label: "Not now" },
      ],
    );
  }

  private bikeShop(): void {
    const l = this.life;
    if (l.ownsBike) {
      this.hud.dialog("Okada Motors", "\u201cHow's the bike treating you? Ride safe, and wear a helmet.\u201d", [
        { label: "Bring my bike here", sub: "The mechanic fetches it for GH₵ 20", disabled: l.money < 20, onPick: () => {
          l.spend(20);
          const p = this.world.spots.bikePark;
          this.parkBike(p.x, p.z, Math.PI);
          this.hud.toast("Your bike is parked out front.", "good");
        } },
        { label: "Leave" },
      ]);
      return;
    }
    this.hud.dialog(
      "Okada Motors",
      h("div", null, h("p", null, "A 125 cc motorbike: tough enough for the mine roads, cheap on fuel. Get around town and out to the mine three times faster than walking, no trotro fare."), h("p", null, `Price ${cedis(BIKE_PRICE)}, paid by MoMo.`)),
      [
        {
          label: `Buy the bike · ${cedis(BIKE_PRICE)}`,
          primary: true,
          disabled: l.money < BIKE_PRICE,
          onPick: () => {
            const err = l.buyBike();
            if (err) return this.hud.toast(err, "bad");
            const p = this.world.spots.bikePark;
            this.parkBike(p.x, p.z, Math.PI);
            this.bike.group.visible = true;
            this.hud.toast("It's yours! Walk up to the bike and press E to ride.", "gold");
          },
        },
        { label: "Just looking" },
      ],
    );
  }

  private chat(w: import("./npcs").Walker): void {
    const l = this.life;
    w.hold(this.pos.x, this.pos.z, 12);
    this.yaw = Math.atan2(w.person.group.position.x - this.pos.x, w.person.group.position.z - this.pos.z);
    const before = l.friends[w.name] ?? 0;
    const gain = l.chat(w.name);
    const after = l.friends[w.name] ?? 0;
    const pool = CHAT_LINES[after >= 60 ? "close" : after >= 10 ? "known" : "new"];
    const line = pool[Math.floor(this.rng.next() * pool.length)];
    let extra = "";
    if (gain && after >= 60 && this.rng.next() < 0.3) {
      l.adjust({ hunger: 15 });
      extra = ` ${w.name} shares some roasted plantain and groundnuts with you.`;
    }
    const levelNow = friendLevel(after);
    const levelUp = levelNow !== friendLevel(before);
    this.hud.dialog(
      w.name,
      h("div", null, h("p", null, line + extra), h("p.hint", null, gain ? `Friendship +${gain} · ${levelNow}${levelUp ? " (new!)" : ""}` : `You've already caught up with ${w.name} today. Come back tomorrow.`)),
      [{ label: "Bye for now", primary: true }],
    );
  }

  /** Any finished task, with level-up news. */
  private task(quality = 1): number {
    const l = this.life;
    const pay = l.completeTask(quality);
    if (l.levelledUp && l.job) {
      const lv = l.levelledUp;
      setTimeout(() => this.hud.toast(`⭐ ${JOBS[l.job!].title} skill level ${lv}! Pay for this job is now +${lv * 5}%.`, "gold"), 600);
    }
    return pay;
  }

  private nextInspection(): SpotId {
    const choices = INSPECT_AREAS.filter((a) => a !== this.inspectAt);
    this.inspectAt = choices[Math.floor(this.rng.next() * choices.length)];
    return this.inspectAt;
  }

  /** The supervisor's site walk: spot the hazard and take the right action. */
  private inspect(at: SpotId): void {
    const pool = HAZARDS.filter((x) => x.areas.includes(at));
    const hz = pool[Math.floor(this.rng.next() * pool.length)];
    const options = [hz.right, ...hz.wrong].sort(() => this.rng.next() - 0.5);
    this.hud.dialog(
      `Inspection: ${this.placeName(at)}`,
      h("div", null, h("p", null, hz.text), h("p.hint", null, "What do you do?")),
      options.map((o) => ({
        label: o,
        onPick: () => {
          this.life.tick(20, "work");
          const right = o === hz.right;
          const pay = this.task(right ? 1 : 0.4);
          this.hud.toast(right ? `Hazard controlled. +${cedis(pay)} (${this.life.shiftTasks}/${TASKS_PER_SHIFT})` : `The safety manager steps in: "${hz.right}." +${cedis(pay)}`, right ? "gold" : "bad");
          this.nextInspection();
        },
      })),
      { dismissable: false },
    );
  }

  private offerChoice(o: Offer): Choice {
    const effects = Object.entries(o.effects)
      .map(([n, v]) => `${NEED_INFO[n as Need].icon} ${v! > 0 ? "+" : ""}${v}`)
      .join("  ");
    return {
      label: `${o.label}${o.cost ? ` · ${cedis(o.cost)}` : " · free"}`,
      sub: `${effects} · ${o.minutes} min`,
      disabled: o.cost > this.life.money,
      onPick: () => {
        const err = this.life.use(o);
        this.hud.toast(err ?? `${o.label}: done.`, err ? "bad" : "good");
      },
    };
  }

  private shop(id: PlaceId, title: string, blurb: string): void {
    this.hud.dialog(title, blurb, [...OFFERS[id]!.map((o) => this.offerChoice(o)), { label: "Leave" }]);
  }

  private sleep(): void {
    const l = this.life;
    this.carrying = null;
    this.hud.fade(() => {
      const hours = l.sleep();
      this.hud.toast(`You slept ${Math.round(hours)} hours.`, "good");
      const e = l.tick(0, "idle");
      if (e) setTimeout(() => this.showEvent(e), 700);
    }, "Sleeping…");
  }

  private nap(): void {
    this.hud.fade(() => {
      this.life.passTime(120);
      this.life.adjust({ energy: 20, hunger: -6 });
      const e = this.life.tick(0, "idle");
      if (e) setTimeout(() => this.showEvent(e), 700);
    }, "Napping…");
  }

  private sleepRough(): void {
    this.hud.fade(() => {
      this.life.passTime(6 * 60);
      this.life.adjust({ energy: 40, hygiene: -20, social: -10, fun: -10 });
      const e = this.life.tick(0, "idle");
      if (e) setTimeout(() => this.showEvent(e), 700);
    }, "A rough night on the bench…");
  }

  private payRent(): void {
    const err = this.life.payRent();
    this.hud.toast(err ?? `Rent paid. Next due on day ${this.life.rentDueDay}.`, err ? "bad" : "good");
    this.hud.refreshSheet();
  }

  private rideTrotro(to: THREE.Vector3): void {
    if (!this.life.takeTrotro()) {
      this.hud.toast(`You need ${cedis(this.life.fare)} for the fare. You'll have to walk.`, "bad");
      return;
    }
    this.carrying = null;
    this.hud.fade(() => {
      this.pos.copy(to);
      this.cam.yaw = Math.atan2(to.x - this.world.spots.trotroTown.x, 1) > 0 ? 2.4 : 0.8;
    }, "Riding the trotro…");
  }

  private trainingMenu(): void {
    const l = this.life;
    const unlocks: Record<CertId, string> = {
      safetyCert: "Shift Supervisor (also needs 2 driver shifts)",
      haulLicence: "Haul Truck Driver",
      plantCourse: "Plant Operator (also needs 2 labourer shifts)",
      excavatorTicket: "Excavator Operator (also needs 2 driver shifts)",
      geoDiploma: "Field Geologist (also needs 2 core shed shifts)",
    };
    this.hud.dialog(
      "Mining Training Centre",
      "Courses run back to back. You'll be tired and hungry after, but you leave certified.",
      [
        ...(Object.keys(CERTS) as CertId[]).map((id) => {
          const c = CERTS[id];
          const have = l.certs.has(id);
          return {
            label: have ? `${c.title} ✓` : `${c.title} · ${cedis(c.cost)}`,
            sub: have ? `Unlocks ${unlocks[id]}` : `${c.hours} hours · unlocks ${unlocks[id]}`,
            disabled: have || l.money < c.cost,
            onPick: () => {
              this.hud.fade(() => {
                const err = l.train(id);
                this.hud.toast(err ?? `You passed the ${c.title}!`, err ? "bad" : "gold");
              }, `Studying for the ${c.title}…`);
            },
          } satisfies Choice;
        }),
        { label: "Leave" },
      ],
    );
  }

  private officeMenu(): void {
    const l = this.life;
    const rows = (Object.keys(JOBS) as JobId[]).map((id) => h("li", null, `${JOBS[id].title}: ${l.shiftsWorked[id]} shift${l.shiftsWorked[id] === 1 ? "" : "s"}`));
    this.hud.dialog(
      "Mine office",
      h("div", null, h("p", null, `HR keeps your record here. A shift counts when you finish ${TASKS_PER_SHIFT} tasks before clocking out. Promotions need counted shifts and a certificate from the training centre.`), h("ul.record", null, ...rows), h("p", null, `Lifetime wages: ${cedis(l.totalEarned)}`)),
      [{ label: "See open jobs", primary: true, onPick: () => this.openPhone("jobs") }, { label: "Leave" }],
    );
  }

  // ---------------------------------------------------------------- work

  private clockIn(): void {
    const err = this.life.clockIn();
    if (err) {
      this.hud.toast(err, "bad");
      return;
    }
    const job = JOBS[this.life.job!];
    this.hud.toast(`Clocked in as ${job.title}. ${job.blurb}`, "good");
    if (job.task === "map") this.flagOutcrops();
    if (job.task === "inspect") this.nextInspection();
  }

  private confirmClockOut(): void {
    const l = this.life;
    const short = l.shiftTasks < TASKS_PER_SHIFT;
    this.hud.dialog("Clock out?", `You've done ${l.shiftTasks} of ${TASKS_PER_SHIFT} tasks and earned ${cedis(l.shiftPay)} this shift.${short ? " A shift only counts toward promotion after " + TASKS_PER_SHIFT + " tasks." : ""}`, [
      { label: "Clock out and get paid", primary: !short, onPick: () => this.clockOut() },
      { label: "Keep working", primary: short },
    ]);
  }

  private clockOut(): void {
    if (this.mode !== "walk") this.exitVehicle();
    this.carrying = null;
    const { paid, counted } = this.life.clockOut();
    this.hud.toast(`Clocked out. ${cedis(paid)} paid to MoMo.${counted ? " Shift counted toward promotion." : ` Finish ${TASKS_PER_SHIFT} tasks for a shift to count.`}`, counted ? "gold" : "info");
    this.hud.refreshSheet();
  }

  private pickUp(what: "sack" | "tray"): void {
    this.carrying = what;
    const m = this.carryMeshes[what];
    this.player.hands.clear();
    this.player.hands.add(m);
    if (what === "tray") this.trayReadyAt = this.life.minutes + 15;
    this.hud.toast(what === "sack" ? "Sample sack on your shoulder. Walk it to the core shed." : "Core tray in hand. Take it to the core shed.");
  }

  private drop(): void {
    this.carrying = null;
    this.player.hands.clear();
  }

  private deliverSack(): void {
    this.drop();
    this.life.tick(10, "work");
    const pay = this.task(1);
    this.hud.toast(`Sack logged in. +${cedis(pay)} (${this.life.shiftTasks}/${TASKS_PER_SHIFT} tasks)`, "gold");
  }

  /** Pick the interval to send for assay: the one with quartz veins and pyrite. */
  private logCore(): void {
    const kinds = [
      { id: "vein", css: "repeating-linear-gradient(115deg,#7b8478 0 14px,#eeeae0 14px 22px,#7b8478 22px 40px), radial-gradient(#e2c24a 1px, transparent 2px)" },
      { id: "oxide", css: "linear-gradient(90deg,#9c4a2a,#b8643a 40%,#8f3f25)" },
      { id: "fresh", css: "linear-gradient(90deg,#3e4a3c,#4d5b49 50%,#3b4639)" },
    ];
    const order = [...kinds].sort(() => this.rng.next() - 0.5);
    const depth = 20 + Math.floor(this.rng.next() * 80);
    const body = h(
      "div",
      null,
      h("p", null, "Gold at Sikakrom sits in quartz veins with brassy pyrite. Pick the interval to send to the lab for assay."),
      h("div.cores", null, ...order.map((k, i) => h("div.core", null, h("i", { style: `background:${k.css}` }), h("small", null, `${String.fromCharCode(65 + i)} · ${depth + i * 2}–${depth + i * 2 + 2} m`)))),
    );
    this.hud.dialog("Log the core", body, order.map((k, i) => ({
      label: `Interval ${String.fromCharCode(65 + i)}`,
      onPick: () => {
        this.drop();
        this.life.tick(15, "work");
        const right = k.id === "vein";
        const pay = this.task(right ? 1 : 0.6);
        this.hud.toast(right ? `Good call: quartz-pyrite vein sent for assay. +${cedis(pay)}` : `The geologist corrects you: the veined interval was the one. +${cedis(pay)}`, right ? "gold" : "info");
      },
    })), { dismissable: false });
  }

  private enterTruck(): void {
    this.mode = "truck";
    this.carrying = null;
    this.cam.yaw = this.truckState.yaw + Math.PI;
    this.cam.pitch = 0.35;
    this.hud.toast("W/S to drive, A/D to steer. Down the ramp to the excavator, then the crusher.", "info");
  }

  private enterExcavator(): void {
    this.mode = "excavator";
    this.shovel.playerControlled = true;
    this.player.group.visible = false;
    this.cam.yaw = Math.PI * 0.75;
    this.cam.pitch = 0.5;
    this.hud.toast("E digs from the face; E again swings and dumps. Three buckets fill a truck.", "info");
  }

  private exitVehicle(force = false): void {
    if (this.mode === "walk") return;
    if (this.mode === "bike") {
      const b = this.bikeState;
      if (Math.abs(b.speed) > 2 && !force) {
        this.hud.toast("Slow down first (S).", "bad");
        return;
      }
      this.parkBike(b.x, b.z, b.yaw);
      this.player.sitting = false;
      this.player.group.rotation.set(0, b.yaw, 0);
      this.pos.set(b.x + Math.cos(b.yaw) * 1.4, 0, b.z - Math.sin(b.yaw) * 1.4);
      this.mode = "walk";
      return;
    }
    if (this.mode === "truck") {
      const t = this.truckState;
      if (Math.abs(t.speed) > 0.5 || t.tipping >= 0) {
        this.hud.toast("Stop the truck first.", "bad");
        return;
      }
      t.readyToLoad = false;
      const side = new THREE.Vector3(Math.cos(t.yaw) * -4.5, 0, -Math.sin(t.yaw) * -4.5);
      this.pos.set(t.x + side.x, 0, t.z + side.z);
    } else {
      this.shovel.playerControlled = false;
      const s = this.world.spots.shovel;
      this.pos.set(s.x, 0, s.z);
    }
    this.mode = "walk";
    this.player.group.visible = true;
  }

  /** Keep the mill density in the green band for a batch. */
  private millGame(): void {
    const duration = 18;
    let value = 50;
    let vel = 0;
    let t = 0;
    let inside = 0;
    let band = 60;
    let push = 0;
    const needle = h("i.needle");
    const zone = h("i.zone");
    const gauge = h("div.gauge", null, zone, needle);
    const timer = h("div.timer");
    const read = h("div.readout");
    const btn = (label: string, d: number) => {
      const b = h("button.choice", null, h("span", null, label));
      const on = () => (push = d);
      const off = () => (push = 0);
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointerleave", off);
      return b;
    };
    const controls = h("div.millControls", null, btn("◀ More water", -1), btn("More feed ▶", 1));
    const body = h("div.mill", null, h("p", null, "Hold the slurry density in the green band. Harder ore makes it drift. Use the buttons or A/D."), gauge, read, timer, controls);
    const keys = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") push = e.type === "keydown" ? -1 : 0;
      if (k === "d" || k === "arrowright") push = e.type === "keydown" ? 1 : 0;
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("keyup", keys);
    let last = performance.now();
    let raf = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", keys);
      window.removeEventListener("keyup", keys);
    };
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      // Ore hardness wanders, the band slides, and the operator nudges feed and water.
      vel += (Math.sin(t * 0.9) * 9 + Math.sin(t * 2.3 + 1) * 6 + push * 26 - vel * 1.4) * dt;
      value = Math.max(0, Math.min(100, value + vel * dt));
      band = 58 + Math.sin(t * 0.35) * 10;
      const ok = value > band - 7 && value < band + 7;
      if (ok) inside += dt;
      needle.style.left = `${value}%`;
      zone.style.left = `${band - 7}%`;
      zone.style.width = "14%";
      gauge.classList.toggle("ok", ok);
      read.textContent = `Density ${(1.2 + value / 200).toFixed(2)} t/m³ · ${ok ? "in spec" : value < band ? "too thin" : "too thick"}`;
      timer.textContent = `Batch ${Math.min(duration, t).toFixed(0)} / ${duration} s · in spec ${Math.round((inside / Math.max(t, 0.01)) * 100)}%`;
      if (t >= duration) {
        stop();
        const share = inside / duration;
        this.hud.close(false);
        this.life.tick(30, "work");
        const pay = this.task(0.5 + share * 0.5);
        this.hud.dialog("Batch done", `The mill held spec ${Math.round(share * 100)}% of the batch. +${cedis(pay)} (${this.life.shiftTasks}/${TASKS_PER_SHIFT} tasks).`, [
          { label: "Run another batch", primary: true, onPick: () => this.life.onShift && this.millGame() },
          { label: "Step away" },
        ]);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    this.hud.dialog("Mill control panel", body, [], { dismissable: false, className: "millCard" });
    raf = requestAnimationFrame(step);
  }

  private randomRock(): Rock {
    const all: Rock[] = ["quartz", "laterite", "granite", "schist"];
    return all[Math.floor(this.rng.next() * all.length)];
  }

  private setRock(o: Outcrop, type: Rock): void {
    o.type = type;
    (o.rock.material as THREE.MeshLambertMaterial).color.set(ROCKS[type].colour);
  }

  private flagOutcrops(): void {
    const free = [...this.outcrops].sort(() => this.rng.next() - 0.5).slice(0, 3);
    for (const o of free) {
      this.setRock(o, this.randomRock());
      o.flagged = true;
      o.flag.visible = true;
    }
  }

  private mapOutcrop(o: Outcrop): void {
    const swatch = h("div.rockSwatch", { style: `background:${ROCKS[o.type].colour}` });
    const guide = h("ul.record", null, ...(Object.keys(ROCKS) as Rock[]).map((r) => h("li", null, h("b", null, ROCKS[r].name), `: ${ROCKS[r].note}`)));
    this.hud.dialog("Map the outcrop", h("div", null, h("p", null, "Break a fresh face with your hammer and look closely. What rock is it?"), swatch, guide), (Object.keys(ROCKS) as Rock[]).map((r) => ({
      label: ROCKS[r].name,
      onPick: () => {
        o.flagged = false;
        o.flag.visible = false;
        this.life.tick(20, "work");
        const right = r === o.type;
        const pay = this.task(right ? 1 : 0.5);
        this.hud.toast(right ? `Mapped as ${ROCKS[r].name}. +${cedis(pay)}` : `Your supervisor logs it as ${ROCKS[o.type].name}. +${cedis(pay)}`, right ? "gold" : "info");
        if (!this.outcrops.some((x) => x.flagged)) this.flagOutcrops();
      },
    })));
  }

  // ---------------------------------------------------------------- phone and map

  private openPhone(tab = "jobs"): void {
    if (!this.started || this.hud.open) return;
    const l = this.life;
    const jobs = () => {
      const list = h("div.list");
      for (const id of Object.keys(JOBS) as JobId[]) {
        const j = JOBS[id];
        const why = l.blocker(id);
        const current = l.job === id;
        const take = h("button.small", { disabled: !!why || current }, current ? "Your job" : "Take job");
        take.addEventListener("click", () => {
          const err = l.takeJob(id);
          this.hud.toast(err ?? `You're now a ${j.title}. Clock in at ${this.placeName(PLACE_SPOT[j.place]!)} during shift hours.`, err ? "bad" : "good");
          this.hud.refreshSheet();
        });
        const xp = l.xp[id];
        const lv = levelFor(xp);
        const toNext = lv >= MAX_LEVEL ? 1 : (xp - xpForLevel(lv)) / (xpForLevel(lv + 1) - xpForLevel(lv));
        const payNow = Math.round(j.pay * (1 + 0.05 * lv));
        list.append(h(`div.item${current ? ".current" : ""}`, null, h("div", null, h("b", null, j.title, h("span.level", null, `Lv ${lv}`)), h("small", null, `${cedis(payNow)} per task · ${j.blurb}`), why ? h("small.why", null, why) : null, xp > 0 ? h("div.xpbar", { title: `${xp} XP` }, h("i", { style: `width:${Math.round(toNext * 100)}%` })) : null), take));
      }
      const foot = l.onShift ? h("button.choice", { onclick: () => this.clockOut() }, h("span", null, `Clock out now (${cedis(l.shiftPay)})`)) : null;
      return h("div", null, h("p.hint", null, `Shifts ${SHIFT.start}:00–${SHIFT.end}:00. ${TASKS_PER_SHIFT} tasks make a counted shift. Every skill level adds 5% to that job's pay.`), list, foot);
    };
    const training = () =>
      h(
        "div.list",
        null,
        h("p.hint", null, "Enrol in person at the Mining Training Centre in town."),
        ...(Object.keys(CERTS) as CertId[]).map((id) => h("div.item", null, h("div", null, h("b", null, `${CERTS[id].title}${l.certs.has(id) ? " ✓" : ""}`), h("small", null, `${cedis(CERTS[id].cost)} · ${CERTS[id].hours} hours`)))),
      );
    const momo = () => {
      const due = l.rentDueDay - l.day;
      const pay = h("button.choice.primary", { disabled: l.money < l.rent, onclick: () => this.payRent() }, h("span", null, `Pay rent ${cedis(this.life.rent)}`), h("small", null, l.evicted ? "You're locked out until you pay" : due >= 0 ? `Due day ${l.rentDueDay} (in ${due} day${due === 1 ? "" : "s"})` : `${-due} days late`));
      return h("div", null, h("div.balance", null, h("small", null, "MoMo wallet"), h("b", null, cedis(l.money))), pay, h("p.hint", null, `Lifetime wages ${cedis(l.totalEarned)}. Trotro fare ${cedis(l.fare)}.`));
    };
    const goals = () =>
      h("div.list", null, h("p.hint", null, `${l.goalsDone.size} of ${GOALS.length} reached.`), ...GOALS.map((g) => {
        const done = l.goalsDone.has(g.id);
        return h(`div.item.milestone${done ? ".done" : ""}`, null, h("div", null, h("b", null, g.title), h("small", null, `${g.hint}${g.reward ? ` · reward ${cedis(g.reward)}` : ""}`)));
      }));
    const friends = () => {
      const names = Object.keys(l.friends).sort((a, b) => l.friends[b] - l.friends[a]);
      if (!names.length) return h("div", null, h("p.hint", null, "Walk up to people in town or at the mine and press E to chat. Talk to the same person on different days to become friends. Good friends cheer you up more and sometimes share food."));
      return h("div.list", null, h("p.hint", null, "One chat a day per person grows the friendship."), ...names.map((n) => h("div.item", null, h("div", null, h("b", null, n), h("small", null, `${friendLevel(l.friends[n])}${l.lastChat[n] === l.day ? " · talked today" : ""}`), h("div.xpbar", null, h("i", { style: `width:${l.friends[n]}%` }))))));
    };
    const me = () =>
      h(
        "div",
        null,
        h("p", null, h("b", null, this.profile.name), ` · ${l.background === "family" ? "came with family savings" : "came with nothing but hustle"}`),
        h("div.needList", null, ...NEEDS.map((n) => h("div", null, `${NEED_INFO[n].icon} ${NEED_INFO[n].label}`, h("b", null, `${Math.round(l.needs[n])}`)))),
        h("p.hint", null, `Home: ${HOMES[l.home].title} (${cedis(l.rent)}/week)${l.ownsBike ? " · owns a motorbike" : ""}`),
        h("p.hint", null, `Certificates: ${[...l.certs].map((c) => CERTS[c].title).join(", ") || "none yet"}`),
        h("div.field", null, h("span", null, "Graphics"), h("div.tabs", null, ...QUALITY_NAMES.map((label, q) => {
          const b = h("button", { "aria-selected": String(this.look.quality === q) }, label);
          b.addEventListener("click", () => {
            this.fpsCheck.done = true;
            this.setGraphics(q);
            try {
              localStorage.setItem(GRAPHICS_KEY, String(q));
            } catch {
              // Not saved; it still applies now.
            }
            this.hud.refreshSheet();
          });
          return b;
        }))),
        h("p.hint", null, `GPU: ${this.gpuName()}. Low for weak laptops, High for 2 GB graphics cards, Ultra adds ambient occlusion and sharper shadows.`),
        h("button.choice", { onclick: () => (this.save(), this.hud.toast("Game saved on this device.", "good")) }, h("span", null, "Save game")),
      );
    this.hud.sheet("Phone", [
      { id: "jobs", label: "Jobs", render: jobs },
      { id: "training", label: "Training", render: training },
      { id: "momo", label: "MoMo", render: momo },
      { id: "goals", label: "Goals", render: goals },
      { id: "friends", label: "Friends", render: friends },
      { id: "me", label: "Me", render: me },
    ], tab);
  }

  private openMap(): void {
    if (!this.started || this.hud.open) return;
    const c = h<HTMLCanvasElement>("canvas.bigmap", { width: 1080, height: 960, "aria-label": `Map of ${TOWN_NAME}` });
    this.drawMap(c, (GROUND.minX + GROUND.maxX) / 2, (GROUND.minZ + GROUND.maxZ) / 2, 0.5, true);
    this.hud.show(h("div.card.mapCard", { role: "dialog", "aria-label": "Map" }, h("div.sheetHead", null, h("h2", null, `${TOWN_NAME} and the mine`), h("button.closeX", { "aria-label": "Close", onclick: () => this.hud.close() }, "✕")), c), true);
  }

  /** Draws the map around (cx, cz). scale is canvas pixels per world unit / 4. */
  private drawMap(canvas: HTMLCanvasElement, cx: number, cz: number, zoom: number, labels = false): void {
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    const s = labels ? Math.min(W / (GROUND.maxX - GROUND.minX), H / (GROUND.maxZ - GROUND.minZ)) : zoom * 4;
    const X = (x: number) => W / 2 + (x - cx) * s;
    const Z = (z: number) => H / 2 + (z - cz) * s;
    ctx.fillStyle = "#7da34a";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#b3643a";
    ctx.beginPath();
    ctx.moveTo(X(-2), Z(GROUND.minZ));
    ctx.lineTo(X(-2), Z(40));
    ctx.lineTo(X(GROUND.maxX), Z(40 + GROUND.maxX * 0.1));
    ctx.lineTo(X(GROUND.maxX), Z(GROUND.minZ));
    ctx.fill();
    ctx.fillStyle = "#c79a68";
    ctx.fillRect(X(-215), Z(62), 195 * s, 54 * s);
    const w = this.world;
    ctx.fillStyle = "#6c5a4a";
    ctx.beginPath();
    ctx.arc(X(40), Z(-110), 62 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a3e33";
    ctx.beginPath();
    ctx.arc(X(40), Z(-110), 22 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e9dcc7";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 7 * s);
    for (const road of w.roads) {
      ctx.beginPath();
      road.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(X(52), Z(-110));
    ctx.lineTo(X(132), Z(-110));
    ctx.stroke();
    for (const f of w.footprints) {
      ctx.fillStyle = f.colour;
      ctx.fillRect(X(f.minX), Z(f.minZ), (f.maxX - f.minX) * s, (f.maxZ - f.minZ) * s);
    }
    if (labels) {
      ctx.font = "600 22px Fredoka, sans-serif";
      ctx.textAlign = "center";
      const named: [SpotId, string][] = [
        [HOME_SPOT[this.life.home], "Your home"], ["bikeShop", "Okada Motors"], ["chopBar", "Chop bar"], ["spot", "Spot"], ["training", "Training"], ["pitch", "Pitch"],
        ["trotroTown", "Trotro"], ["trotroMine", "Trotro"], ["office", "Office"], ["stockyard", "Stockyard"], ["coreShed", "Core shed"],
        ["drillRig", "Drill rig"], ["truckPark", "Truck park"], ["controlRoom", "Control room"], ["crusher", "Crusher"], ["shovel", "Excavator"],
      ];
      for (const [id, text] of named) {
        const p = w.spots[id];
        ctx.fillStyle = "rgba(20,24,22,0.75)";
        const tw = ctx.measureText(text).width + 14;
        ctx.fillRect(X(p.x) - tw / 2, Z(p.z) - 30, tw, 26);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, X(p.x), Z(p.z) - 10);
      }
      ctx.fillStyle = "#ffe9b0";
      ctx.font = "700 30px Fredoka, sans-serif";
      ctx.fillText(TOWN_NAME.toUpperCase(), X(-120), Z(150));
      ctx.fillText("MAIN PIT", X(40), Z(-110));
    }
    for (const o of this.outcrops) {
      if (!o.flagged) continue;
      ctx.fillStyle = "#ff3d7f";
      ctx.beginPath();
      ctx.arc(X(o.x), Z(o.z), labels ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const g = this.goal().target;
    if (g) {
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(X(g.x), Z(g.z), labels ? 14 : 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The player, as an arrow pointing the way they face.
    const yaw = this.mode === "truck" ? this.truckState.yaw : this.mode === "bike" ? this.bikeState.yaw : this.yaw;
    ctx.save();
    ctx.translate(X(this.pos.x), Z(this.pos.z));
    ctx.rotate(-yaw + Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1b1b1b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const k = labels ? 1.6 : 1.2;
    ctx.moveTo(0, -12 * k);
    ctx.lineTo(8 * k, 9 * k);
    ctx.lineTo(0, 4 * k);
    ctx.lineTo(-8 * k, 9 * k);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}

function randomTownLook(rng: Random): Look {
  const shirts = ["#d6342c", "#1f6fb2", "#f2b705", "#2e8b57", "#8e44ad", "#e67e22"];
  return { skin: SKINS[Math.floor(rng.next() * SKINS.length)], shirt: shirts[Math.floor(rng.next() * shirts.length)], trousers: "#2c3e50" };
}
