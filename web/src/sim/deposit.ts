import { BlockModel, type RockType } from "./blockModel";
import { Random } from "./random";

export interface DepositSettings {
  nx: number;
  ny: number;
  nz: number;
  blockSize: number;
  density: number;
  /** Depth of barren cover in metres. */
  overburdenDepth: number;
  oreShoots: number;
  /** Mean grade at the core of an ore shoot, grams per tonne. */
  peakGrade: number;
  /** Background grade of unmineralised host rock, grams per tonne. */
  backgroundGrade: number;
  /** Grade below which a block is classed as host rather than ore. */
  oreThreshold: number;
}

export const defaultDeposit: DepositSettings = {
  nx: 40,
  ny: 40,
  nz: 20,
  blockSize: 10,
  density: 2.7,
  overburdenDepth: 10,
  oreShoots: 3,
  peakGrade: 4,
  backgroundGrade: 0.05,
  oreThreshold: 0.5,
};

/**
 * Builds a synthetic gold deposit: a few ellipsoidal ore shoots with grade
 * falling off from their cores, plus lognormal noise. Same seed, same deposit.
 */
export function generateDeposit(seed: number, overrides: Partial<DepositSettings> = {}): BlockModel {
  const s = { ...defaultDeposit, ...overrides };
  const rng = new Random(seed);
  const width = s.nx * s.blockSize;
  const length = s.ny * s.blockSize;
  const depth = s.nz * s.blockSize;

  const shoots = Array.from({ length: s.oreShoots }, () => ({
    x: rng.between(0.2, 0.8) * width,
    y: rng.between(0.2, 0.8) * length,
    z: rng.between(0.3, 0.7) * depth,
    rx: rng.between(0.08, 0.2) * width,
    ry: rng.between(0.08, 0.2) * length,
    rz: rng.between(0.15, 0.35) * depth,
  }));

  const sigma = 0.4;
  return new BlockModel(s.nx, s.ny, s.nz, s.blockSize, s.density, (i, j, k) => {
    const x = (i + 0.5) * s.blockSize;
    const y = (j + 0.5) * s.blockSize;
    const z = (k + 0.5) * s.blockSize;
    if (z < s.overburdenDepth) return { i, j, k, rock: "overburden", trueGrade: 0 };

    let strength = 0;
    for (const shoot of shoots) {
      const dx = (x - shoot.x) / shoot.rx;
      const dy = (y - shoot.y) / shoot.ry;
      const dz = (z - shoot.z) / shoot.rz;
      strength = Math.max(strength, Math.exp(-(dx * dx + dy * dy + dz * dz)));
    }
    const mean = s.backgroundGrade + (s.peakGrade - s.backgroundGrade) * strength;
    // Multiplicative lognormal noise with mean 1.
    const grade = mean * Math.exp(sigma * rng.normal() - (sigma * sigma) / 2);
    const rock: RockType = grade >= s.oreThreshold ? "ore" : "host";
    return { i, j, k, rock, trueGrade: grade };
  });
}
