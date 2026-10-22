import { BlockModel } from "./blockModel";
import { generateDeposit } from "./deposit";
import { DrillingProgram } from "./drilling";
import { EstimateGrid, estimateAt } from "./estimator";

const grades = (m: BlockModel) => m.all().map((b) => b.trueGrade);
const assay = (x: number, y: number, z: number, grade: number) => ({ x, y, from: z - 2.5, to: z + 2.5, grade });

describe("deposit", () => {
  it("builds the same deposit from the same seed", () => {
    expect(grades(generateDeposit(7))).toEqual(grades(generateDeposit(7)));
    expect(grades(generateDeposit(1))).not.toEqual(grades(generateDeposit(2)));
  });

  it("keeps the overburden barren", () => {
    const model = generateDeposit(3, { overburdenDepth: 20 });
    const cover = model.all().filter((b) => b.k < 2);
    expect(cover.every((b) => b.rock === "overburden" && b.trueGrade === 0)).toBe(true);
  });

  it("is mostly waste with some ore", () => {
    const model = generateDeposit(11);
    const share = model.all().filter((b) => b.rock === "ore").length / model.count;
    expect(share).toBeGreaterThan(0.01);
    expect(share).toBeLessThan(0.5);
  });

  it("weighs blocks by size and density", () => {
    expect(generateDeposit(1, { blockSize: 10, density: 2.7 }).blockTonnes).toBeCloseTo(2700);
  });
});

describe("drilling", () => {
  const model = generateDeposit(5);

  it("charges metres plus assays", () => {
    const program = new DrillingProgram(model, 100_000, { perMetre: 100, perAssay: 50, assayInterval: 5 });
    program.drill(105, 105, 50);
    expect(program.budget).toBeCloseTo(100_000 - 5_000 - 500);
  });

  it("returns one assay per interval", () => {
    const hole = new DrillingProgram(model, 1e9).drill(105, 105, 100);
    expect(hole.assays).toHaveLength(20);
    expect(hole.assays.at(-1)!.to).toBe(100);
  });

  it("matches the true grade when the lab is perfect", () => {
    const hole = new DrillingProgram(model, 1e9, { assayError: 0 }).drill(205, 195, 150);
    for (const a of hole.assays) expect(a.grade).toBeCloseTo(model.at(a.x, a.y, (a.from + a.to) / 2).trueGrade, 9);
  });

  it("refuses to overspend or drill off the lease", () => {
    const program = new DrillingProgram(model, 1_000);
    expect(() => program.drill(105, 105, 100)).toThrow();
    expect(program.holes).toHaveLength(0);
    expect(() => new DrillingProgram(model, 1e9).drill(-10, 50, 50)).toThrow(RangeError);
  });

  it("caps holes at the model depth", () => {
    expect(new DrillingProgram(model, 1e12).drill(105, 105, 9999).depth).toBe(model.depth);
  });
});

describe("estimation", () => {
  it("gives nothing without samples in range", () => {
    expect(estimateAt(0, 0, 0, [assay(500, 500, 50, 3)]).samples).toBe(0);
  });

  it("equals the sample at the sample", () => {
    const e = estimateAt(10, 10, 50, [assay(10, 10, 50, 3.2), assay(40, 10, 50, 0.1)]);
    expect(e.grade).toBeCloseTo(3.2);
    expect(e.confidence).toBe(1);
  });

  it("weighs closer samples more", () => {
    // Weights 1/10^2 and 1/20^2 give 4 x 0.8 = 3.2.
    expect(estimateAt(10, 0, 50, [assay(0, 0, 50, 4), assay(30, 0, 50, 0)]).grade).toBeCloseTo(3.2);
  });

  it("trusts estimates less away from holes", () => {
    const samples = [assay(0, 0, 50, 2)];
    expect(estimateAt(5, 0, 50, samples).confidence).toBeGreaterThan(estimateAt(40, 0, 50, samples).confidence);
  });

  it("grid matches the point estimate", () => {
    const model = generateDeposit(9);
    const program = new DrillingProgram(model, 1e12);
    program.drill(105, 105, 200);
    program.drill(155, 125, 200);
    const grid = new EstimateGrid(model, program.holes);
    const [x, y, z] = model.centre(12, 11, 6);
    expect(grid.get(12, 11, 6).grade).toBeCloseTo(estimateAt(x, y, z, program.assays).grade, 9);
  });

  it("improves with denser drilling", () => {
    const model = generateDeposit(21);
    const error = (spacing: number) => {
      const program = new DrillingProgram(model, Infinity, {}, 1);
      for (let x = spacing / 2; x < model.width; x += spacing)
        for (let y = spacing / 2; y < model.length; y += spacing) program.drill(x, y, model.depth);
      const grid = new EstimateGrid(model, program.holes);
      return model.all().reduce((sum, b) => sum + Math.abs(grid.get(b.i, b.j, b.k).grade - b.trueGrade), 0) / model.count;
    };
    expect(error(40)).toBeLessThan(error(100));
  });
});
