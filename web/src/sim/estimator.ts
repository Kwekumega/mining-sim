import type { BlockModel } from "./blockModel";
import { midDepth, type Assay, type DrillHole } from "./drilling";

/** Estimated grade for one block, with how much the estimate can be trusted. */
export interface BlockEstimate {
  readonly grade: number;
  /** 0 when no sample is in range, 1 at a sample. */
  readonly confidence: number;
  readonly samples: number;
}

export interface EstimatorSettings {
  /** Samples beyond this distance in metres are ignored. */
  searchRadius: number;
  maxSamples: number;
  /** Inverse distance power; 2 is the industry default. */
  power: number;
  /** Vertical distances are multiplied by this, so samples along a hole count less than ones beside it. */
  verticalAnisotropy: number;
}

export const defaultEstimator: EstimatorSettings = { searchRadius: 60, maxSamples: 12, power: 2, verticalAnisotropy: 2 };

const none: BlockEstimate = { grade: 0, confidence: 0, samples: 0 };

/**
 * Inverse distance weighting from drill assays. Confidence falls with distance
 * to the nearest sample and rises with sample count.
 */
export function estimateAt(x: number, y: number, z: number, assays: readonly Assay[], settings: EstimatorSettings = defaultEstimator): BlockEstimate {
  const near: { assay: Assay; d: number }[] = [];
  for (const assay of assays) {
    const d = distance(x, y, z, assay, settings);
    if (d <= settings.searchRadius) near.push({ assay, d });
  }
  return weigh(near, settings);
}

/** Estimates every block. Holes are vertical, so each column only looks at holes within the search radius. */
export class EstimateGrid {
  private readonly values: BlockEstimate[];

  constructor(
    readonly model: BlockModel,
    holes: readonly DrillHole[],
    readonly settings: EstimatorSettings = defaultEstimator,
  ) {
    this.values = new Array(model.count).fill(none);
    const r = settings.searchRadius;
    for (let j = 0; j < model.ny; j++)
      for (let i = 0; i < model.nx; i++) {
        const [cx, cy] = model.centre(i, j, 0);
        const nearby = holes.filter((h) => (h.x - cx) ** 2 + (h.y - cy) ** 2 <= r * r);
        if (nearby.length === 0) continue;
        for (let k = 0; k < model.nz; k++) {
          const cz = model.centre(i, j, k)[2];
          const near: { assay: Assay; d: number }[] = [];
          for (const hole of nearby)
            for (const assay of hole.assays) {
              const d = distance(cx, cy, cz, assay, settings);
              if (d <= r) near.push({ assay, d });
            }
          this.values[model.index(i, j, k)] = weigh(near, settings);
        }
      }
  }

  get(i: number, j: number, k: number): BlockEstimate {
    return this.values[this.model.index(i, j, k)];
  }
}

function distance(x: number, y: number, z: number, a: Assay, s: EstimatorSettings): number {
  const dx = x - a.x;
  const dy = y - a.y;
  const dz = (z - midDepth(a)) * s.verticalAnisotropy;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function weigh(near: { assay: Assay; d: number }[], s: EstimatorSettings): BlockEstimate {
  if (near.length === 0) return none;
  near.sort((a, b) => a.d - b.d);
  const used = near.slice(0, s.maxSamples);
  // A sample at the point itself is the estimate.
  if (used[0].d < 1e-6) return { grade: used[0].assay.grade, confidence: 1, samples: used.length };

  let weighted = 0;
  let total = 0;
  for (const { assay, d } of used) {
    const w = 1 / d ** s.power;
    weighted += w * assay.grade;
    total += w;
  }
  const proximity = 1 - used[0].d / s.searchRadius;
  const coverage = Math.min(1, used.length / s.maxSamples);
  const confidence = Math.min(1, Math.max(0, proximity * (0.5 + 0.5 * coverage)));
  return { grade: weighted / total, confidence, samples: used.length };
}
