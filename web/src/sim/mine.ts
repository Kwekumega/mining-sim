import type { BlockModel } from "./blockModel";
import { generateDeposit, type DepositSettings } from "./deposit";
import { DigPlan, defaultPlan, type PlanSettings } from "./digPlan";
import { DrillingProgram } from "./drilling";
import { EstimateGrid } from "./estimator";
import { HaulOperation, defaultExcavator, defaultRoutes, defaultTruck, tonnesTo, type Excavator, type HaulTruck } from "./haul";
import { Plant, ounces, type PlantShift, type PlantSettings } from "./plant";

export type Role = "geologist" | "planner" | "operator" | "plant";

export interface MineSettings {
  deposit: Partial<DepositSettings>;
  startingCash: number;
  explorationBudget: number;
  goldPricePerOunce: number;
  dieselPerLitre: number;
  /** Crew, maintenance and ownership cost per truck hour, excluding fuel. */
  truckCostPerHour: number;
  trucks: number;
  excavator: Excavator;
  truck: HaulTruck;
  plan: PlanSettings;
  plantSettings: PlantSettings;
}

export const defaultMine: MineSettings = {
  deposit: {},
  startingCash: 20_000_000,
  explorationBudget: 3_000_000,
  goldPricePerOunce: 2_400,
  dieselPerLitre: 1.3,
  truckCostPerHour: 180,
  trucks: 4,
  excavator: defaultExcavator,
  truck: defaultTruck,
  plan: defaultPlan,
  plantSettings: { feedRateTph: 400, grindP80: 106 },
};

/** What happened in one shift, for the shift log. */
export interface ShiftReport {
  readonly shift: number;
  readonly oreHauled: number;
  readonly wasteHauled: number;
  readonly plannedOreGrade: number;
  readonly trueOreGrade: number;
  readonly plant: PlantShift;
  readonly ounces: number;
  readonly revenue: number;
  readonly haulCost: number;
  readonly profit: number;
  readonly cashAfter: number;
}

/**
 * One mine and everything every role shares. The player works one role at a time;
 * the others run on their current settings.
 */
export class Mine {
  readonly settings: MineSettings;
  readonly model: BlockModel;
  readonly exploration: DrillingProgram;
  readonly plant: Plant;
  readonly reports: ShiftReport[] = [];
  cash: number;
  activeRole: Role = "geologist";
  planSettings: PlanSettings;
  plantSettings: PlantSettings;
  estimates: EstimateGrid;
  plan: DigPlan | null = null;
  private haul: HaulOperation | null = null;
  private fleet: number;

  constructor(seed: number, settings: Partial<MineSettings> = {}) {
    this.settings = { ...defaultMine, ...settings };
    this.model = generateDeposit(seed, this.settings.deposit);
    this.cash = this.settings.startingCash - this.settings.explorationBudget;
    this.exploration = new DrillingProgram(this.model, this.settings.explorationBudget, {}, seed);
    this.plant = new Plant();
    this.planSettings = { ...this.settings.plan };
    this.plantSettings = { ...this.settings.plantSettings };
    this.fleet = this.settings.trucks;
    this.estimates = new EstimateGrid(this.model, []);
  }

  get shiftsWorked(): number {
    return this.reports.length;
  }

  /** Equipment Operator: trucks on the haul fleet. Takes effect from the next shift. */
  get trucks(): number {
    return this.fleet;
  }
  set trucks(value: number) {
    if (!(value >= 1)) throw new RangeError("Fleet needs at least one truck.");
    this.fleet = Math.floor(value);
    if (this.haul) this.haul.trucks = this.fleet;
  }

  /** Blocks of the current plan already dug, in plan order. */
  get blocksDug(): number {
    return this.haul?.blocksDug ?? 0;
  }

  private dugEarlier = new Set<number>();

  /** Every block dug so far, under this plan and any earlier ones, by block index. */
  get dugBlocks(): Set<number> {
    const dug = new Set(this.dugEarlier);
    if (this.plan) for (let n = 0; n < this.blocksDug; n++) {
      const b = this.plan.sequence[n];
      dug.add(this.model.index(b.i, b.j, b.k));
    }
    return dug;
  }

  get haulOperation(): HaulOperation | null {
    return this.haul;
  }

  /** Geologist: rebuild the grade estimate from every hole so far. */
  updateEstimates(): void {
    this.estimates = new EstimateGrid(this.model, this.exploration.holes);
  }

  /** Mine Planner: plan a pit around every block above cutoff. Replaces any earlier plan; dug blocks stay dug. */
  planPit(): DigPlan {
    this.dugEarlier = this.dugBlocks;
    this.plan = DigPlan.forAllOre(this.model, this.estimates, this.planSettings, this.dugEarlier);
    this.haul = new HaulOperation(this.model, this.plan, this.settings.excavator, this.settings.truck, this.fleet, defaultRoutes);
    return this.plan;
  }

  /** Runs one shift for every role: haul to plan, feed the plant, sell the gold. */
  runShift(hours = 12): ShiftReport {
    if (!this.haul) this.planPit();
    const haul = this.haul!.runShift(hours);
    const ore = haul.loads.filter((l) => l.destination === "ore");
    for (const load of ore) this.plant.feed.add(load.tonnes, load.trueGrade);

    const plant = this.plant.runShift(hours, this.plantSettings);
    const oz = ounces(plant);
    const revenue = oz * this.settings.goldPricePerOunce;
    const haulCost = haul.fuelLitres * this.settings.dieselPerLitre + haul.hours * this.fleet * this.settings.truckCostPerHour;
    const profit = revenue - haulCost - plant.cost;
    this.cash += profit;

    const oreTonnes = tonnesTo(haul, "ore");
    const weighted = (pick: (l: (typeof ore)[number]) => number) =>
      oreTonnes > 0 ? ore.reduce((sum, l) => sum + l.tonnes * pick(l), 0) / oreTonnes : 0;
    const report: ShiftReport = {
      shift: this.reports.length + 1,
      oreHauled: oreTonnes,
      wasteHauled: tonnesTo(haul, "waste"),
      plannedOreGrade: weighted((l) => l.plannedGrade),
      trueOreGrade: weighted((l) => l.trueGrade),
      plant,
      ounces: oz,
      revenue,
      haulCost,
      profit,
      cashAfter: this.cash,
    };
    this.reports.push(report);
    return report;
  }
}
