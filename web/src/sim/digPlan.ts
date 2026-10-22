import type { BlockModel } from "./blockModel";
import type { EstimateGrid, BlockEstimate } from "./estimator";

export type Destination = "ore" | "waste";

/** One block in the dig sequence, with where it should be hauled and the grade the plan expects. */
export interface PlannedBlock {
  readonly i: number;
  readonly j: number;
  readonly k: number;
  readonly destination: Destination;
  readonly estimatedGrade: number;
  readonly dilutedGrade: number;
}

export interface PlanSettings {
  /** Blocks estimated at or above this grade, in grams per tonne, go to the plant. */
  cutoffGrade: number;
  /** Waste mixed into an ore block for each waste neighbour on the same level. */
  dilutionPerWasteNeighbour: number;
  /** Blocks with lower confidence are not trusted as ore and are sent to waste. */
  minConfidence: number;
}

export const defaultPlan: PlanSettings = { cutoffGrade: 0.8, dilutionPerWasteNeighbour: 0.03, minConfidence: 0.2 };

export const GRAMS_PER_OUNCE = 31.1035;

export const isOre = (e: BlockEstimate, s: PlanSettings) =>
  e.samples > 0 && e.confidence >= s.minConfidence && e.grade >= s.cutoffGrade;

type Key = readonly [number, number, number];

/**
 * The Mine Planner's output: which blocks to dig, in what order, and where each goes.
 * Pit walls follow a 45 degree slope: a block can be dug only after the 3 by 3 blocks above it.
 */
export class DigPlan {
  readonly oreTonnes: number;
  readonly wasteTonnes: number;
  /** Gold sent to the plant, before plant recovery, in troy ounces. */
  readonly containedOunces: number;

  private constructor(
    model: BlockModel,
    readonly sequence: readonly PlannedBlock[],
  ) {
    const ore = sequence.filter((b) => b.destination === "ore");
    this.oreTonnes = ore.length * model.blockTonnes;
    this.wasteTonnes = (sequence.length - ore.length) * model.blockTonnes;
    this.containedOunces = ore.reduce((sum, b) => sum + (b.dilutedGrade * model.blockTonnes) / GRAMS_PER_OUNCE, 0);
  }

  /** Tonnes of waste moved per tonne of ore; infinite when the plan has no ore. */
  get stripRatio(): number {
    return this.oreTonnes > 0 ? this.wasteTonnes / this.oreTonnes : Infinity;
  }
  get averageOreGrade(): number {
    return this.oreTonnes > 0 ? (this.containedOunces * GRAMS_PER_OUNCE) / this.oreTonnes : 0;
  }

  /**
   * Plans a pit that reaches every target block. Each target pulls in the cone of blocks above it;
   * targets are reached shallowest and richest first, and each new cone is dug level by level.
   * A target's cone contains the cone of every block inside it, so the walls stay safe.
   */
  static create(
    model: BlockModel,
    estimates: EstimateGrid,
    targets: readonly Key[],
    settings: Partial<PlanSettings> = {},
    alreadyDug: ReadonlySet<number> = new Set(),
  ): DigPlan {
    const s = { ...defaultPlan, ...settings };
    const inPit = new Set<number>(alreadyDug);
    const sequence: PlannedBlock[] = [];

    const ordered = [...targets].sort((a, b) => a[2] - b[2] || estimates.get(...b).grade - estimates.get(...a).grade);
    for (const [ti, tj, tk] of ordered) {
      const added: Key[] = [];
      for (let k = 0; k <= tk; k++) {
        const reach = tk - k;
        for (let j = Math.max(0, tj - reach); j <= Math.min(model.ny - 1, tj + reach); j++)
          for (let i = Math.max(0, ti - reach); i <= Math.min(model.nx - 1, ti + reach); i++) {
            const idx = model.index(i, j, k);
            if (inPit.has(idx)) continue;
            inPit.add(idx);
            added.push([i, j, k]);
          }
      }
      added.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
      for (const key of added) sequence.push(planBlock(model, estimates, key, s));
    }
    return new DigPlan(model, sequence);
  }

  /** Plans a pit reaching every block whose estimate clears the cutoff. Blocks already dug are left out. */
  static forAllOre(model: BlockModel, estimates: EstimateGrid, settings: Partial<PlanSettings> = {}, alreadyDug: ReadonlySet<number> = new Set()): DigPlan {
    const s = { ...defaultPlan, ...settings };
    const targets: Key[] = [];
    for (let k = 0; k < model.nz; k++)
      for (let j = 0; j < model.ny; j++)
        for (let i = 0; i < model.nx; i++)
          if (!alreadyDug.has(model.index(i, j, k)) && isOre(estimates.get(i, j, k), s)) targets.push([i, j, k]);
    return DigPlan.create(model, estimates, targets, s, alreadyDug);
  }
}

function planBlock(model: BlockModel, estimates: EstimateGrid, [i, j, k]: Key, s: PlanSettings): PlannedBlock {
  const e = estimates.get(i, j, k);
  if (!isOre(e, s)) return { i, j, k, destination: "waste", estimatedGrade: e.grade, dilutedGrade: e.grade };

  let wasteNeighbours = 0;
  let wasteGrade = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= model.nx || nj >= model.ny) continue;
    const n = estimates.get(ni, nj, k);
    if (isOre(n, s)) continue;
    wasteNeighbours++;
    wasteGrade += n.grade;
  }
  const dilution = wasteNeighbours * s.dilutionPerWasteNeighbour;
  const averageWaste = wasteNeighbours > 0 ? wasteGrade / wasteNeighbours : 0;
  const diluted = e.grade * (1 - dilution) + averageWaste * dilution;
  return { i, j, k, destination: "ore", estimatedGrade: e.grade, dilutedGrade: diluted };
}
