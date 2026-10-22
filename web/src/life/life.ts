import { Random } from "../sim/random";

export type Need = "hunger" | "energy" | "fun" | "social" | "hygiene";
export const NEEDS: Need[] = ["hunger", "energy", "fun", "social", "hygiene"];
export type Needs = Record<Need, number>;

export type PlaceId =
  | "home" | "chopBar" | "spot" | "pitch" | "training" | "trotroTown" | "trotroMine"
  | "mineGate" | "stockyard" | "coreShed" | "truckPark" | "shovel" | "crusher" | "controlRoom" | "office";

export type JobId = "labourer" | "coreTech" | "driver" | "excavator" | "plant" | "geologist";
export type CertId = "haulLicence" | "excavatorTicket" | "plantCourse" | "geoDiploma";
/** How the work is done in the world. */
export type TaskKind = "carry" | "core" | "haul" | "load" | "panel" | "map";

export interface Job {
  id: JobId;
  title: string;
  place: PlaceId;
  /** Cedis per finished task. */
  pay: number;
  task: TaskKind;
  blurb: string;
  needsCert?: CertId;
  needsShifts?: { job: JobId; count: number };
}

export const SHIFT = { start: 6, end: 18 };
/** Tasks needed in one clock-in for it to count as a worked shift. */
export const TASKS_PER_SHIFT = 4;

export const JOBS: Record<JobId, Job> = {
  labourer: { id: "labourer", title: "General Labourer", place: "stockyard", pay: 15, task: "carry", blurb: "Move sample sacks from the stockyard to the core shed." },
  coreTech: { id: "coreTech", title: "Core Shed Technician", place: "coreShed", pay: 25, task: "core", blurb: "Collect core trays at the drill rig and rack them in the core shed.", needsShifts: { job: "labourer", count: 2 } },
  driver: { id: "driver", title: "Haul Truck Driver", place: "truckPark", pay: 45, task: "haul", blurb: "Drive a 100 t truck: load at the shovel, tip at the crusher.", needsCert: "haulLicence" },
  plant: { id: "plant", title: "Plant Operator", place: "controlRoom", pay: 40, task: "panel", blurb: "Keep the mill in the green: balance feed and water for each batch.", needsCert: "plantCourse", needsShifts: { job: "labourer", count: 2 } },
  excavator: { id: "excavator", title: "Excavator Operator", place: "shovel", pay: 35, task: "load", blurb: "Load each haul truck that pulls up at the face.", needsCert: "excavatorTicket", needsShifts: { job: "driver", count: 2 } },
  geologist: { id: "geologist", title: "Field Geologist", place: "coreShed", pay: 70, task: "map", blurb: "Map the flagged drill sites and outcrops on the lease.", needsCert: "geoDiploma", needsShifts: { job: "coreTech", count: 2 } },
};

export interface Cert {
  id: CertId;
  title: string;
  cost: number;
  hours: number;
}

export const CERTS: Record<CertId, Cert> = {
  haulLicence: { id: "haulLicence", title: "Haul truck licence", cost: 350, hours: 6 },
  plantCourse: { id: "plantCourse", title: "Process plant course", cost: 500, hours: 8 },
  excavatorTicket: { id: "excavatorTicket", title: "Excavator ticket", cost: 600, hours: 8 },
  geoDiploma: { id: "geoDiploma", title: "Geology field diploma", cost: 900, hours: 12 },
};

export interface Offer {
  id: string;
  label: string;
  cost: number;
  minutes: number;
  effects: Partial<Needs>;
}

/** What each place sells or lets you do. Effects add to needs, clamped to 0 to 100. */
export const OFFERS: Partial<Record<PlaceId, Offer[]>> = {
  chopBar: [
    { id: "kenkey", label: "Kenkey and fried fish", cost: 15, minutes: 20, effects: { hunger: 30, social: 5 } },
    { id: "waakye", label: "Waakye with egg", cost: 20, minutes: 25, effects: { hunger: 40, social: 10 } },
    { id: "banku", label: "Banku and tilapia", cost: 45, minutes: 40, effects: { hunger: 65, social: 15, fun: 5 } },
  ],
  spot: [
    { id: "malt", label: "Cold malt with friends", cost: 10, minutes: 30, effects: { fun: 12, social: 15 } },
    { id: "night", label: "Night out, highlife and dancing", cost: 60, minutes: 180, effects: { fun: 45, social: 40, energy: -10 } },
  ],
  pitch: [{ id: "football", label: "Play a football match", cost: 0, minutes: 60, effects: { fun: 30, social: 20, energy: -20, hygiene: -25 } }],
  home: [
    { id: "bath", label: "Bucket bath", cost: 0, minutes: 15, effects: { hygiene: 100 } },
    { id: "cook", label: "Cook rice and stew", cost: 8, minutes: 40, effects: { hunger: 30 } },
  ],
};

/** Need change per game hour for each activity. */
const DECAY: Record<string, Partial<Needs>> = {
  idle: { hunger: -4, energy: -2.5, fun: -2.5, social: -2, hygiene: -2 },
  walk: { hunger: -4.5, energy: -3, fun: -2.5, social: -2, hygiene: -2.5 },
  run: { hunger: -6, energy: -7, fun: -2, social: -2, hygiene: -5 },
  work: { hunger: -5.5, energy: -6, fun: -3.5, social: -1, hygiene: -4 },
};

export interface Choice {
  label: string;
  apply: (life: Life) => string;
}

export interface LifeEvent {
  title: string;
  text: string;
  choices: Choice[];
}

export type Background = "family" | "hustler";

export const RENT = { amount: 250, everyDays: 7, graceDays: 3 };

/**
 * One person's life in the mining town: needs, money, rent, the clock, a job and its shifts,
 * training, and the odd surprise. Pure state, so it is easy to test; the 3D world calls into it.
 */
export class Life {
  readonly rng: Random;
  money: number;
  /** Game minutes since day 1 00:00. */
  minutes = 7 * 60;
  needs: Needs = { hunger: 70, energy: 85, fun: 60, social: 55, hygiene: 80 };
  job: JobId | null = null;
  onShift = false;
  shiftPay = 0;
  shiftTasks = 0;
  readonly shiftsWorked: Record<JobId, number> = { labourer: 0, coreTech: 0, driver: 0, plant: 0, excavator: 0, geologist: 0 };
  readonly certs = new Set<CertId>();
  rentDueDay = 1 + RENT.everyDays;
  evicted = false;
  /** Pay multiplier for today, set by events such as overtime. */
  payBoost = 1;
  fare = 5;
  totalEarned = 0;
  private lastDay = 1;

  constructor(
    seed: number,
    readonly background: Background = new Random(seed).next() < 0.5 ? "family" : "hustler",
  ) {
    this.rng = new Random(seed + 7);
    this.money = background === "family" ? 1500 : 300;
  }

  get day(): number {
    return Math.floor(this.minutes / 1440) + 1;
  }
  get hour(): number {
    return (this.minutes % 1440) / 60;
  }
  get clock(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor(this.minutes % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  get weekday(): string {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(this.day - 1) % 7];
  }
  get inShiftHours(): boolean {
    return this.hour >= SHIFT.start && this.hour < SHIFT.end;
  }
  get rentLate(): number {
    return Math.max(0, this.day - this.rentDueDay);
  }

  /** Work suffers when any need is nearly empty. */
  get performance(): number {
    return NEEDS.some((n) => this.needs[n] < 15) ? 0.6 : 1;
  }

  adjust(effects: Partial<Needs>): void {
    for (const n of NEEDS) if (effects[n] !== undefined) this.needs[n] = clamp(this.needs[n] + effects[n]!);
  }

  /**
   * Moves the clock on. Returns a morning event when a new day starts, if one happens.
   */
  tick(minutes: number, activity: "idle" | "walk" | "run" | "work"): LifeEvent | null {
    const rates = DECAY[this.onShift ? "work" : activity];
    const hours = minutes / 60;
    for (const n of NEEDS) this.needs[n] = clamp(this.needs[n] + (rates[n] ?? 0) * hours);
    // An empty stomach drains energy faster.
    if (this.needs.hunger <= 0) this.needs.energy = clamp(this.needs.energy - 4 * hours);
    this.minutes += minutes;
    if (this.onShift && !this.inShiftHours) this.clockOut();
    return this.newDay();
  }

  private newDay(): LifeEvent | null {
    if (this.day === this.lastDay) return null;
    this.lastDay = this.day;
    this.payBoost = 1;
    if (this.rentLate > RENT.graceDays && !this.evicted) {
      this.evicted = true;
      return {
        title: "Locked out",
        text: `The landlord changed the padlock. You owe GH₵ ${RENT.amount}. Pay the rent from your phone to get your room back.`,
        choices: [{ label: "OK", apply: () => "" }],
      };
    }
    return this.rng.next() < 0.45 ? this.randomEvent() : null;
  }

  spend(cost: number): boolean {
    if (cost > this.money) return false;
    this.money -= cost;
    return true;
  }

  /** Buys something at a place. Returns an error message, or null when it worked. */
  use(offer: Offer): string | null {
    if (offer.effects.energy !== undefined && offer.effects.energy < 0 && this.needs.energy + offer.effects.energy < 0) return "You're too tired for that.";
    if (!this.spend(offer.cost)) return `You need GH₵ ${offer.cost}.`;
    this.adjust(offer.effects);
    this.passTime(offer.minutes);
    return null;
  }

  /** Lets time pass without the usual decay eating the thing you just did. */
  passTime(minutes: number): void {
    this.minutes += minutes;
    if (this.onShift && !this.inShiftHours) this.clockOut();
  }

  /** Sleep at home until morning or for 8 hours, whichever is shorter. Returns hours slept. */
  sleep(): number {
    if (this.evicted) return 0;
    const toSix = ((30 - this.hour) % 24) || 24;
    const hours = Math.min(8, toSix);
    this.needs.energy = clamp(this.needs.energy + hours * 12);
    this.adjust({ hunger: -hours * 2, hygiene: -hours * 1.5, fun: -hours * 0.5 });
    if (this.onShift) this.clockOut();
    this.minutes += hours * 60;
    return hours;
  }

  /** Why a job is closed to you, or null when you can take it. */
  blocker(id: JobId): string | null {
    const job = JOBS[id];
    if (job.needsCert && !this.certs.has(job.needsCert)) return `Needs the ${CERTS[job.needsCert].title}.`;
    if (job.needsShifts && this.shiftsWorked[job.needsShifts.job] < job.needsShifts.count)
      return `Needs ${job.needsShifts.count} shifts as ${JOBS[job.needsShifts.job].title} (you have ${this.shiftsWorked[job.needsShifts.job]}).`;
    return null;
  }

  takeJob(id: JobId): string | null {
    const why = this.blocker(id);
    if (why) return why;
    if (this.onShift) this.clockOut();
    this.job = id;
    return null;
  }

  /** Clock in at the job's workplace during shift hours. Returns an error, or null. */
  clockIn(): string | null {
    if (!this.job) return "You don't have a job yet. Check Jobs on your phone.";
    if (!this.inShiftHours) return `Shifts run ${SHIFT.start}:00 to ${SHIFT.end}:00.`;
    if (this.needs.energy < 10) return "You're too exhausted to work. Get some sleep.";
    this.onShift = true;
    this.shiftPay = 0;
    this.shiftTasks = 0;
    return null;
  }

  /** One finished task pays straight into the shift's wages. Returns cedis earned. */
  completeTask(quality = 1): number {
    if (!this.onShift || !this.job) return 0;
    const pay = Math.round(JOBS[this.job].pay * quality * this.performance * this.payBoost);
    this.shiftPay += pay;
    this.shiftTasks++;
    return pay;
  }

  /** Ends the shift and pays wages. Returns what was paid and whether it counted as a shift. */
  clockOut(): { paid: number; counted: boolean } {
    if (!this.onShift || !this.job) return { paid: 0, counted: false };
    const paid = this.shiftPay;
    const counted = this.shiftTasks >= TASKS_PER_SHIFT;
    this.money += paid;
    this.totalEarned += paid;
    if (counted) this.shiftsWorked[this.job]++;
    this.onShift = false;
    this.shiftPay = 0;
    this.shiftTasks = 0;
    return { paid, counted };
  }

  /** Takes a course at the training centre. Returns an error, or null. */
  train(id: CertId): string | null {
    const cert = CERTS[id];
    if (this.certs.has(id)) return "You already have this.";
    if (!this.spend(cert.cost)) return `The course costs GH₵ ${cert.cost}.`;
    this.certs.add(id);
    this.adjust({ energy: -cert.hours * 2, hunger: -cert.hours * 3, fun: -cert.hours, social: cert.hours });
    this.passTime(cert.hours * 60);
    return null;
  }

  payRent(): string | null {
    if (!this.spend(RENT.amount)) return `Rent is GH₵ ${RENT.amount}.`;
    this.rentDueDay += RENT.everyDays;
    this.evicted = false;
    return null;
  }

  takeTrotro(): boolean {
    if (!this.spend(this.fare)) return false;
    this.passTime(12);
    return true;
  }

  randomEvent(): LifeEvent {
    const events: LifeEvent[] = [
      {
        title: "Message from your cousin",
        text: "Kofi needs GH₵ 50 to finish paying his school fees.",
        choices: [
          { label: "Send GH₵ 50", apply: (l) => (l.spend(50) ? (l.adjust({ social: 15 }), "Kofi says God bless you.") : (l.adjust({ social: -5 }), "You don't have it.")) },
          { label: "Not this time", apply: (l) => (l.adjust({ social: -10 }), "He says he understands.") },
        ],
      },
      {
        title: "Rain in the pit",
        text: "Heavy rain flooded the lower benches overnight. The mine is paying 1.5× for every task today.",
        choices: [{ label: "Let's work", apply: (l) => ((l.payBoost = 1.5), "Overtime rates are on today.") }],
      },
      {
        title: "Fuel prices are up",
        text: "Trotro drivers have raised the fare between town and the mine.",
        choices: [{ label: "Hmm", apply: (l) => ((l.fare = Math.min(12, l.fare + 2)), `The fare is now GH₵ ${l.fare}.`) }],
      },
      {
        title: "Funeral on Saturday",
        text: "Your friend's grandmother passed. The whole town is going in black and red.",
        choices: [
          { label: "Go and pay respects (GH₵ 30)", apply: (l) => (l.spend(30) ? (l.adjust({ social: 30, fun: 10, energy: -10 }), l.passTime(180), "You stayed for the drumming.") : "You can't afford the donation.") },
          { label: "Send apologies", apply: (l) => (l.adjust({ social: -5 }), "Maybe next time.") },
        ],
      },
      {
        title: "Lucky day",
        text: "You found GH₵ 20 folded in the pocket of your old work trousers.",
        choices: [{ label: "Nice", apply: (l) => ((l.money += 20), "Small money, but money.") }],
      },
      {
        title: "Malaria",
        text: "You woke up shivering. Your energy is low.",
        choices: [
          { label: "Buy medicine (GH₵ 60)", apply: (l) => (l.spend(60) ? (l.adjust({ energy: 10 }), "The tablets help. Drink water.") : (l.adjust({ energy: -30 }), "You can't afford it. You feel worse.")) },
          { label: "Push through", apply: (l) => (l.adjust({ energy: -30, fun: -10 }), "You feel terrible.") },
        ],
      },
    ];
    return events[Math.floor(this.rng.next() * events.length)];
  }
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
