import type { BlockModel } from "./blockModel";
import { Random } from "./random";

/** Assayed grade over one depth interval of a vertical hole. */
export interface Assay {
  readonly x: number;
  readonly y: number;
  readonly from: number;
  readonly to: number;
  readonly grade: number;
}

export const midDepth = (a: Assay) => (a.from + a.to) / 2;

/** A vertical drill hole collared at (x, y) on the surface. */
export interface DrillHole {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly assays: readonly Assay[];
}

export interface DrillingCosts {
  /** Cost per metre drilled. */
  perMetre: number;
  /** Cost per assay sample sent to the lab. */
  perAssay: number;
  /** Length of each assay interval in metres. */
  assayInterval: number;
  /** Relative standard deviation of lab assay error. */
  assayError: number;
}

export const defaultDrillingCosts: DrillingCosts = { perMetre: 150, perAssay: 40, assayInterval: 5, assayError: 0.1 };

/**
 * The Geologist's drilling campaign: spends a budget on vertical holes and
 * returns assays sampled from the hidden true grades.
 */
export class DrillingProgram {
  readonly costs: DrillingCosts;
  private readonly rng: Random;
  private readonly drilled: DrillHole[] = [];
  private remaining: number;

  constructor(
    private readonly model: BlockModel,
    budget: number,
    costs: Partial<DrillingCosts> = {},
    seed = 0,
  ) {
    if (budget < 0) throw new RangeError("Budget cannot be negative.");
    this.remaining = budget;
    this.costs = { ...defaultDrillingCosts, ...costs };
    this.rng = new Random(seed + 1);
  }

  get budget(): number {
    return this.remaining;
  }
  get holes(): readonly DrillHole[] {
    return this.drilled;
  }
  get assays(): Assay[] {
    return this.drilled.flatMap((h) => h.assays);
  }

  costOf(depth: number): number {
    const d = Math.min(depth, this.model.depth);
    return d * this.costs.perMetre + Math.ceil(d / this.costs.assayInterval) * this.costs.perAssay;
  }

  canAfford(depth: number): boolean {
    return this.costOf(depth) <= this.remaining;
  }

  drill(x: number, y: number, depth: number): DrillHole {
    if (depth <= 0) throw new RangeError("Depth must be positive.");
    if (!this.model.contains(x, y, 0)) throw new RangeError("Collar lies outside the lease.");
    depth = Math.min(depth, this.model.depth);

    const cost = this.costOf(depth);
    if (cost > this.remaining) throw new Error(`Hole costs ${Math.round(cost)} but only ${Math.round(this.remaining)} is left.`);
    this.remaining -= cost;

    const assays: Assay[] = [];
    for (let from = 0; from < depth; from += this.costs.assayInterval) {
      const to = Math.min(from + this.costs.assayInterval, depth);
      const truth = this.model.at(x, y, (from + to) / 2).trueGrade;
      const grade = Math.max(0, truth * (1 + this.costs.assayError * this.rng.normal()));
      assays.push({ x, y, from, to, grade });
    }
    const hole: DrillHole = { id: this.drilled.length + 1, x, y, depth, assays };
    this.drilled.push(hole);
    return hole;
  }
}
