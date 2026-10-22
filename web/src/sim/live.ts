import type { Load } from "./haul";
import { Mine, type MineSettings } from "./mine";
import { ounces } from "./plant";

export type DumpSite = "crusher" | "dump";

/** Totals for one 12 hour shift of the live game. */
export interface LiveShift {
  readonly number: number;
  oreDelivered: number;
  wasteDelivered: number;
  /** Ore dumped on the waste dump by mistake. */
  oreLost: number;
  /** Waste tipped into the crusher by mistake. */
  wasteToCrusher: number;
  plannedGradeTonnes: number;
  trueGradeTonnes: number;
  milled: number;
  goldOunces: number;
  revenue: number;
  costs: number;
}

const newShift = (number: number): LiveShift => ({
  number,
  oreDelivered: 0,
  wasteDelivered: 0,
  oreLost: 0,
  wasteToCrusher: 0,
  plannedGradeTonnes: 0,
  trueGradeTonnes: 0,
  milled: 0,
  goldOunces: 0,
  revenue: 0,
  costs: 0,
});

export const SHIFT_HOURS = 12;

/**
 * Runs the mine in real time for the animated game: trucks take loads one at a time,
 * deliver them where the driver chooses, and the plant and the books tick with the clock.
 */
export class LiveMine {
  readonly mine: Mine;
  /** Hours since the start of day 1 at midnight. The game starts at 06:00. */
  clock = 6;
  shift: LiveShift = newShift(1);
  readonly shifts: LiveShift[] = [];
  totalOunces = 0;
  private plannedTotal = 0;
  private trueTotal = 0;

  constructor(seed: number, settings: Partial<MineSettings> = {}) {
    this.mine = new Mine(seed, settings);
  }

  get day(): number {
    return Math.floor(this.clock / 24) + 1;
  }

  /** Actual ore grade delivered as a share of what the plan promised, or null before any ore. */
  get reconciliation(): number | null {
    return this.plannedTotal > 0 ? this.trueTotal / this.plannedTotal : null;
  }

  /** The block the excavator is digging now. */
  get face() {
    return this.mine.haulOperation?.currentBlock ?? null;
  }

  drill(x: number, y: number, depth: number) {
    const hole = this.mine.exploration.drill(x, y, depth);
    this.mine.updateEstimates();
    return hole;
  }

  /** Excavator loads one truck. Null when there is no plan or the pit is finished. */
  loadTruck(): Load | null {
    return this.mine.haulOperation?.nextLoad() ?? null;
  }

  /** A truck tips its load. Ore at the crusher feeds the plant; anything else is a loss or dilution. */
  deliver(load: Load, site: DumpSite): void {
    const s = this.shift;
    if (site === "crusher") {
      this.mine.plant.feed.add(load.tonnes, load.trueGrade);
      if (load.destination === "ore") {
        s.oreDelivered += load.tonnes;
        s.plannedGradeTonnes += load.plannedGrade * load.tonnes;
        s.trueGradeTonnes += load.trueGrade * load.tonnes;
        this.plannedTotal += load.plannedGrade * load.tonnes;
        this.trueTotal += load.trueGrade * load.tonnes;
      } else s.wasteToCrusher += load.tonnes;
    } else {
      s.wasteDelivered += load.tonnes;
      if (load.destination === "ore") s.oreLost += load.tonnes;
    }
  }

  /**
   * Moves the clock on. The plant mills, gold is sold, and trucks burn fuel and wages.
   * Returns the shifts that ended during this step.
   */
  advance(hours: number, trucksWorking: number): LiveShift[] {
    const ended: LiveShift[] = [];
    let left = hours;
    while (left > 1e-9) {
      const toBoundary = SHIFT_HOURS - (((this.clock - 6) % SHIFT_HOURS) + SHIFT_HOURS) % SHIFT_HOURS;
      const step = Math.min(left, toBoundary);
      this.tick(step, trucksWorking);
      this.clock += step;
      left -= step;
      if (step === toBoundary) {
        this.shifts.push(this.shift);
        ended.push(this.shift);
        this.shift = newShift(this.shift.number + 1);
      }
    }
    return ended;
  }

  private tick(hours: number, trucks: number): void {
    if (hours <= 0) return;
    const m = this.mine;
    const plant = m.plant.runShift(hours, m.plantSettings);
    const oz = ounces(plant);
    const revenue = oz * m.settings.goldPricePerOunce;
    const truckCost = hours * trucks * (m.settings.truck.fuelLitresPerHour * m.settings.dieselPerLitre + m.settings.truckCostPerHour);
    const costs = plant.cost + truckCost;
    m.cash += revenue - costs;
    this.totalOunces += oz;
    const s = this.shift;
    s.milled += plant.tonnesMilled;
    s.goldOunces += oz;
    s.revenue += revenue;
    s.costs += costs;
  }
}
