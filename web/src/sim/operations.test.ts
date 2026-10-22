import { BlockModel } from "./blockModel";
import { DigPlan } from "./digPlan";
import type { EstimateGrid } from "./estimator";
import { HaulOperation } from "./haul";
import { Mine } from "./mine";
import { Plant, Stockpile } from "./plant";

/** A fake estimate grid: every block 0.1 g/t at full confidence unless overridden. */
function grid(model: BlockModel, overrides: [number, number, number, number][] = []): EstimateGrid {
  const map = new Map(overrides.map(([i, j, k, g]) => [model.index(i, j, k), g]));
  return { model, get: (i: number, j: number, k: number) => ({ grade: map.get(model.index(i, j, k)) ?? 0.1, confidence: 1, samples: 5 }) } as unknown as EstimateGrid;
}

describe("dig plan", () => {
  const model = new BlockModel(5, 5, 3, 10, 2.5, (i, j, k) => ({ i, j, k, rock: "host", trueGrade: 0 }));

  it("pulls in the slope cone above a target", () => {
    expect(DigPlan.create(model, grid(model), [[2, 2, 2]]).sequence).toHaveLength(1 + 9 + 25);
  });

  it("digs every block after the blocks above it", () => {
    const plan = DigPlan.create(model, grid(model, [[4, 4, 2, 2], [0, 0, 1, 3]]), [[4, 4, 2], [0, 0, 1]]);
    const dug = new Set<number>();
    for (const b of plan.sequence) {
      if (b.k > 0)
        for (let i = Math.max(0, b.i - 1); i <= Math.min(4, b.i + 1); i++)
          for (let j = Math.max(0, b.j - 1); j <= Math.min(4, b.j + 1); j++) expect(dug.has(model.index(i, j, b.k - 1))).toBe(true);
      dug.add(model.index(b.i, b.j, b.k));
    }
  });

  it("reaches shallow ore first", () => {
    const plan = DigPlan.create(model, grid(model, [[4, 4, 2, 2], [0, 0, 1, 3]]), [[4, 4, 2], [0, 0, 1]], { cutoffGrade: 1 });
    const first = plan.sequence.find((b) => b.destination === "ore")!;
    expect([first.i, first.j, first.k]).toEqual([0, 0, 1]);
  });

  it("dilutes an isolated ore block", () => {
    const plan = DigPlan.create(model, grid(model, [[2, 2, 1, 2]]), [[2, 2, 1]], { cutoffGrade: 1, dilutionPerWasteNeighbour: 0.05 });
    // Four waste neighbours at 0.1 g/t: 2.0 x 0.8 + 0.1 x 0.2 = 1.62.
    expect(plan.sequence.find((b) => b.destination === "ore")!.dilutedGrade).toBeCloseTo(1.62);
  });

  it("totals tonnes and strip ratio", () => {
    const plan = DigPlan.create(model, grid(model, [[2, 2, 1, 2]]), [[2, 2, 1]], { cutoffGrade: 1, dilutionPerWasteNeighbour: 0 });
    expect(plan.oreTonnes).toBe(2_500);
    expect(plan.wasteTonnes).toBe(22_500);
    expect(plan.stripRatio).toBe(9);
  });
});

describe("hauling", () => {
  const model = new BlockModel(3, 3, 2, 10, 2.5, (i, j, k) => ({ i, j, k, rock: "host", trueGrade: k === 1 ? 3 : 0.1 }));
  const plan = () => DigPlan.create(model, grid(model, [[1, 1, 1, 3]]), [[1, 1, 1]], { dilutionPerWasteNeighbour: 0 });

  it("counts bucket passes and spotting in load time", () => {
    expect(new HaulOperation(model, plan()).loadSeconds).toBe(165);
  });

  it("moves whole blocks in truckloads with true grades", () => {
    const op = new HaulOperation(model, plan(), undefined, undefined, 3);
    const shift = op.runShift(12);
    expect(op.isFinished).toBe(true);
    expect(shift.loads).toHaveLength(250);
    expect(shift.loads.filter((l) => l.destination === "ore").every((l) => l.trueGrade === 3)).toBe(true);
  });

  it("moves more with more trucks until the excavator limits", () => {
    const tonnes = (n: number) => new HaulOperation(model, plan(), undefined, undefined, n).runShift(1).loads.reduce((s, l) => s + l.tonnes, 0);
    expect(tonnes(3)).toBeGreaterThan(tonnes(1));
    expect(tonnes(50)).toBeLessThanOrEqual(22 * 100);
  });
});

describe("plant", () => {
  it("blends a stockpile", () => {
    const pile = new Stockpile();
    pile.add(100, 2);
    pile.add(300, 1);
    expect(pile.grade).toBeCloseTo(1.25);
  });

  it("trades recovery against throughput and cost", () => {
    const plant = new Plant();
    expect(plant.recovery(75)).toBeGreaterThan(plant.recovery(150));
    expect(plant.capacityTph(75)).toBeLessThan(plant.capacityTph(150));
    expect(plant.costPerTonne(75)).toBeGreaterThan(plant.costPerTonne(150));
  });

  it("is limited by capacity", () => {
    const plant = new Plant();
    plant.feed.add(100_000, 2);
    expect(plant.runShift(10, { feedRateTph: 10_000, grindP80: 106 }).tonnesMilled).toBeCloseTo(4_000);
  });

  it("recovers gold above the tail floor", () => {
    const plant = new Plant({ maxRecovery: 0.9, optimalP80: 75, tailFloorGrade: 0.05 });
    plant.feed.add(1_000, 2.05);
    expect(plant.runShift(10, { feedRateTph: 100, grindP80: 75 }).goldGrams).toBeCloseTo(1_800);
  });
});

describe("mine", () => {
  const drilled = (spacing: number) => {
    const mine = new Mine(42, { explorationBudget: 1e12, startingCash: 2e12 });
    for (let x = spacing / 2; x < mine.model.width; x += spacing)
      for (let y = spacing / 2; y < mine.model.length; y += spacing) mine.exploration.drill(x, y, mine.model.depth);
    mine.updateEstimates();
    return mine;
  };

  it("takes the exploration budget out of cash", () => {
    const mine = new Mine(1, { startingCash: 10_000_000, explorationBudget: 2_000_000 });
    expect(mine.cash).toBe(8_000_000);
  });

  it("produces gold and keeps the books", () => {
    const mine = drilled(50);
    mine.planPit();
    const before = mine.cash;
    for (let n = 0; n < 60; n++) mine.runShift();
    expect(mine.reports.reduce((s, r) => s + r.ounces, 0)).toBeGreaterThan(0);
    expect(mine.cash).toBeCloseTo(before + mine.reports.reduce((s, r) => s + r.profit, 0), 2);
    expect(mine.blocksDug).toBeGreaterThan(0);
  });

  it("plans automatically if the planner has not", () => {
    const mine = drilled(50);
    mine.runShift();
    expect(mine.plan).not.toBeNull();
  });

  it("applies fleet changes to the next shift", () => {
    const slow = drilled(50);
    slow.trucks = 1;
    const fast = drilled(50);
    fast.trucks = 4;
    const moved = (m: Mine) => {
      const r = m.runShift();
      return r.oreHauled + r.wasteHauled;
    };
    expect(moved(fast)).toBeGreaterThan(moved(slow));
    expect(() => (slow.trucks = 0)).toThrow(RangeError);
  });
});
