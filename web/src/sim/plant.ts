import { GRAMS_PER_OUNCE } from "./digPlan";

export interface PlantDesign {
  /** Throughput in tonnes per hour at the design grind size. */
  designCapacityTph: number;
  /** Design grind size: 80 percent of particles pass this size, in microns. */
  designP80: number;
  /** Best achievable recovery, at or below the optimal grind. */
  maxRecovery: number;
  optimalP80: number;
  /** Recovery lost per micron coarser than optimal. */
  recoveryLossPerMicron: number;
  /** Gold that stays in the tailings whatever the settings, grams per tonne. */
  tailFloorGrade: number;
  /** Processing cost per tonne at the design grind. */
  costPerTonne: number;
}

export const defaultPlantDesign: PlantDesign = {
  designCapacityTph: 400,
  designP80: 106,
  maxRecovery: 0.93,
  optimalP80: 75,
  recoveryLossPerMicron: 0.0012,
  tailFloorGrade: 0.05,
  costPerTonne: 18,
};

/** The Plant Operator's controls. */
export interface PlantSettings {
  feedRateTph: number;
  grindP80: number;
}

export interface PlantShift {
  readonly tonnesMilled: number;
  readonly headGrade: number;
  readonly recovery: number;
  readonly goldGrams: number;
  readonly cost: number;
}

export const ounces = (shift: PlantShift) => shift.goldGrams / GRAMS_PER_OUNCE;

/** A blended pile: tonnes and their average grade, reclaimed as a mix. */
export class Stockpile {
  tonnes = 0;
  grade = 0;

  add(tonnes: number, grade: number): void {
    if (tonnes < 0) throw new RangeError("Tonnes cannot be negative.");
    if (tonnes === 0) return;
    this.grade = (this.tonnes * this.grade + tonnes * grade) / (this.tonnes + tonnes);
    this.tonnes += tonnes;
  }

  take(tonnes: number): { tonnes: number; grade: number } {
    const taken = Math.min(Math.max(0, tonnes), this.tonnes);
    const grade = this.grade;
    this.tonnes -= taken;
    if (this.tonnes <= 1e-9) {
      this.tonnes = 0;
      this.grade = 0;
    }
    return { tonnes: taken, grade: taken > 0 ? grade : 0 };
  }
}

/**
 * Crush, grind and leach circuit fed from a run-of-mine stockpile. Finer grinding raises
 * recovery but lowers throughput and costs more power.
 */
export class Plant {
  readonly design: PlantDesign;
  readonly feed = new Stockpile();

  constructor(design: Partial<PlantDesign> = {}) {
    this.design = { ...defaultPlantDesign, ...design };
  }

  /** Mill throughput limit at a grind size; grinding finer takes longer per tonne. */
  capacityTph(p80: number): number {
    return this.design.designCapacityTph * Math.sqrt(p80 / this.design.designP80);
  }

  recovery(p80: number): number {
    const r = this.design.maxRecovery - this.design.recoveryLossPerMicron * Math.max(0, p80 - this.design.optimalP80);
    return Math.min(1, Math.max(0, r));
  }

  costPerTonne(p80: number): number {
    return this.design.costPerTonne * Math.sqrt(this.design.designP80 / p80);
  }

  runShift(hours: number, settings: PlantSettings): PlantShift {
    if (!(hours > 0)) throw new RangeError("Shift length must be positive.");
    if (!(settings.grindP80 > 0)) throw new RangeError("Grind size must be positive.");
    if (settings.feedRateTph < 0) throw new RangeError("Feed rate cannot be negative.");

    const rate = Math.min(settings.feedRateTph, this.capacityTph(settings.grindP80));
    const { tonnes, grade } = this.feed.take(rate * hours);
    const recovery = this.recovery(settings.grindP80);
    const goldGrams = tonnes * Math.max(0, grade - this.design.tailFloorGrade) * recovery;
    return { tonnesMilled: tonnes, headGrade: grade, recovery, goldGrams, cost: tonnes * this.costPerTonne(settings.grindP80) };
  }
}
