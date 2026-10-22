import type { BlockModel } from "./blockModel";
import type { Destination, DigPlan } from "./digPlan";

export interface Excavator {
  name: string;
  /** Tonnes per bucket pass. */
  bucketTonnes: number;
  /** Seconds per dig, swing, dump and return. */
  passSeconds: number;
}

export interface HaulTruck {
  name: string;
  payloadTonnes: number;
  loadedSpeedKmh: number;
  emptySpeedKmh: number;
  dumpSeconds: number;
  /** Time to reverse up to the excavator before loading. */
  spotSeconds: number;
  fuelLitresPerHour: number;
}

export interface HaulRoutes {
  /** Surface distance from the pit rim to the crusher, metres. */
  crusherDistance: number;
  /** Surface distance from the pit rim to the waste dump, metres. */
  dumpDistance: number;
  /** Ramp gradient; at 10 percent each metre of depth adds 10 m of road. */
  rampGrade: number;
}

export const defaultExcavator: Excavator = { name: "Hydraulic excavator", bucketTonnes: 25, passSeconds: 30 };
export const defaultTruck: HaulTruck = {
  name: "100 t haul truck",
  payloadTonnes: 100,
  loadedSpeedKmh: 20,
  emptySpeedKmh: 35,
  dumpSeconds: 60,
  spotSeconds: 45,
  fuelLitresPerHour: 90,
};
export const defaultRoutes: HaulRoutes = { crusherDistance: 1200, dumpDistance: 800, rampGrade: 0.1 };

/** One truckload delivered. Its true grade is what the plant will reveal. */
export interface Load {
  readonly i: number;
  readonly j: number;
  readonly k: number;
  readonly destination: Destination;
  readonly tonnes: number;
  readonly trueGrade: number;
  readonly plannedGrade: number;
}

export interface HaulShift {
  readonly loads: readonly Load[];
  readonly hours: number;
  readonly fuelLitres: number;
  readonly blocksCompleted: number;
}

export const tonnesTo = (shift: HaulShift, d: Destination) =>
  shift.loads.filter((l) => l.destination === d).reduce((sum, l) => sum + l.tonnes, 0);

/**
 * The Equipment Operator's work: one excavator loading a fleet of trucks, digging the
 * plan in order. Tracks partly dug blocks between shifts.
 */
export class HaulOperation {
  private next = 0;
  private remainingInBlock: number;
  private fleet: number;

  constructor(
    private readonly model: BlockModel,
    private readonly plan: DigPlan,
    readonly excavator: Excavator = defaultExcavator,
    readonly truck: HaulTruck = defaultTruck,
    trucks = 4,
    readonly routes: HaulRoutes = defaultRoutes,
  ) {
    this.fleet = 1;
    this.trucks = trucks;
    this.remainingInBlock = model.blockTonnes;
  }

  /** Trucks in the fleet; can change between shifts. */
  get trucks(): number {
    return this.fleet;
  }
  set trucks(value: number) {
    if (!(value >= 1)) throw new RangeError("Fleet needs at least one truck.");
    this.fleet = Math.floor(value);
  }

  get isFinished(): boolean {
    return this.next >= this.plan.sequence.length;
  }
  get blocksDug(): number {
    return this.next;
  }

  get loadSeconds(): number {
    return Math.ceil(this.truck.payloadTonnes / this.excavator.bucketTonnes) * this.excavator.passSeconds + this.truck.spotSeconds;
  }

  /** Seconds for one truck to load, haul, dump and return from a block at this depth. */
  cycleSeconds(destination: Destination, depth: number): number {
    const metres = (destination === "ore" ? this.routes.crusherDistance : this.routes.dumpDistance) + depth / this.routes.rampGrade;
    const haul = metres / (this.truck.loadedSpeedKmh / 3.6);
    const back = metres / (this.truck.emptySpeedKmh / 3.6);
    return this.loadSeconds + haul + this.truck.dumpSeconds + back;
  }

  /**
   * Runs one shift. With N trucks a load leaves every max(load time, cycle / N) seconds,
   * so the excavator limits output once enough trucks queue.
   */
  runShift(hours: number): HaulShift {
    if (!(hours > 0)) throw new RangeError("Shift length must be positive.");
    const loads: Load[] = [];
    let secondsLeft = hours * 3600;
    let completed = 0;

    while (!this.isFinished && secondsLeft > 0) {
      const block = this.plan.sequence[this.next];
      const depth = (block.k + 0.5) * this.model.blockSize;
      const interval = Math.max(this.loadSeconds, this.cycleSeconds(block.destination, depth) / this.fleet);
      if (interval > secondsLeft) break;

      const tonnes = Math.min(this.truck.payloadTonnes, this.remainingInBlock);
      const trueGrade = this.model.get(block.i, block.j, block.k).trueGrade;
      loads.push({ i: block.i, j: block.j, k: block.k, destination: block.destination, tonnes, trueGrade, plannedGrade: block.dilutedGrade });
      secondsLeft -= interval;
      this.remainingInBlock -= tonnes;

      if (this.remainingInBlock <= 1e-9) {
        this.next++;
        completed++;
        this.remainingInBlock = this.model.blockTonnes;
      }
    }

    const worked = hours - secondsLeft / 3600;
    return { loads, hours: worked, fuelLitres: worked * this.fleet * this.truck.fuelLitresPerHour, blocksCompleted: completed };
  }
}
