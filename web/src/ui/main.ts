import "./style.css";
import { gradeColour, readPalette, type Palette } from "./colours";
import * as f from "./format";
import { Mine, type Role, type ShiftReport } from "../sim/mine";
import type { DrillHole } from "../sim/drilling";
import { isOre, type PlannedBlock } from "../sim/digPlan";

const SEED = 2047;
const WEEK = 14;

// A previous owner's scattered holes, so the first map already shows something.
const HISTORIC_HOLES: [number, number][] = [[95, 300], [205, 215], [310, 120], [140, 90], [330, 320], [220, 345]];

const mine = new Mine(SEED);
for (const [x, y] of HISTORIC_HOLES) mine.exploration.drill(x, y, mine.model.depth);
mine.updateEstimates();

let level = 5;
let sectionRow = Math.floor(215 / mine.model.blockSize);
let planStale = false;
let palette: Palette = readPalette();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const planCanvas = $<HTMLCanvasElement>("plan");
const sectionCanvas = $<HTMLCanvasElement>("section");

// ---------- Drawing ----------

/** Dug blocks and the plan, indexed by block, for quick lookup while drawing. */
function planLookup() {
  const dug = new Set<number>();
  const planned = new Map<number, PlannedBlock>();
  if (mine.plan) {
    mine.plan.sequence.forEach((b, n) => {
      const idx = mine.model.index(b.i, b.j, b.k);
      planned.set(idx, b);
      if (n < mine.blocksDug) dug.add(idx);
    });
  }
  return { dug, planned };
}

function showPlan(): boolean {
  return mine.activeRole !== "geologist" && mine.plan !== null;
}

function blockColour(i: number, j: number, k: number, lookup: ReturnType<typeof planLookup>): string {
  const idx = mine.model.index(i, j, k);
  if (lookup.dug.has(idx)) return palette.dug;
  if (showPlan()) {
    const b = lookup.planned.get(idx);
    if (!b) return palette.unknown;
    return b.destination === "ore" ? palette.ore : palette.waste;
  }
  const e = mine.estimates.get(i, j, k);
  return gradeColour(palette, e.grade, e.confidence);
}

function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function drawPlan(lookup: ReturnType<typeof planLookup>) {
  const ctx = fit(planCanvas);
  const { nx, ny, blockSize } = mine.model;
  const w = planCanvas.clientWidth;
  const cell = w / nx;
  ctx.fillStyle = palette.sheet;
  ctx.fillRect(0, 0, w, w);

  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      ctx.fillStyle = blockColour(i, j, level, lookup);
      ctx.fillRect(i * cell, (ny - 1 - j) * cell, cell - 0.6, cell - 0.6);
    }

  // Section line.
  const sy = (ny - 1 - sectionRow + 0.5) * cell;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(0, sy);
  ctx.lineTo(w, sy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Drill collars.
  for (const hole of mine.exploration.holes) {
    const hx = (hole.x / blockSize) * cell;
    const hy = (ny - hole.y / blockSize) * cell;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(3, cell * 0.32), 0, Math.PI * 2);
    ctx.fillStyle = palette.sheet;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.hole;
    ctx.stroke();
  }

  // North arrow and scale.
  ctx.fillStyle = palette.ink;
  ctx.font = "600 12px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText("N ↑", w - 8, 16);
  ctx.textAlign = "left";
  const bar = 100 / blockSize * cell;
  ctx.fillRect(8, w - 12, bar, 3);
  ctx.fillText("100 m", 8, w - 18);
}

function drawSection(lookup: ReturnType<typeof planLookup>) {
  const ctx = fit(sectionCanvas);
  const { nx, nz, blockSize } = mine.model;
  const w = sectionCanvas.clientWidth;
  const h = sectionCanvas.clientHeight;
  const left = 44;
  const cellW = (w - left - 4) / nx;
  const cellH = (h - 8) / nz;
  ctx.fillStyle = palette.sheet;
  ctx.fillRect(0, 0, w, h);

  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      ctx.fillStyle = blockColour(i, sectionRow, k, lookup);
      ctx.fillRect(left + i * cellW, k * cellH, cellW - 0.6, cellH - 0.6);
    }

  // Current level.
  ctx.strokeStyle = palette.ink;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.25;
  ctx.strokeRect(left, level * cellH, nx * cellW, cellH);
  ctx.setLineDash([]);

  // Holes within half a block of the section, with assays coloured by grade.
  const rowY = (sectionRow + 0.5) * blockSize;
  for (const hole of mine.exploration.holes) {
    if (Math.abs(hole.y - rowY) > blockSize) continue;
    const hx = left + (hole.x / blockSize) * cellW;
    for (const a of hole.assays) {
      ctx.fillStyle = gradeColour(palette, a.grade, 1);
      ctx.fillRect(hx - 3, (a.from / blockSize) * cellH, 6, ((a.to - a.from) / blockSize) * cellH);
    }
    ctx.strokeStyle = palette.hole;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(hx - 3, 0, 6, (hole.depth / blockSize) * cellH);
  }

  // Depth axis.
  ctx.fillStyle = palette.muted;
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  for (let d = 0; d <= mine.model.depth; d += 50) {
    const y = Math.min(h - 2, Math.max(10, (d / blockSize) * cellH + 4));
    ctx.fillText(`${d} m`, left - 6, y);
  }
}

function drawLegend() {
  const items = showPlan()
    ? [["Ore, to the plant", palette.ore], ["Waste, to the dump", palette.waste], ["Already dug", palette.dug], ["Outside the pit", palette.unknown]]
    : [["No data", palette.unknown], ["Drill hole", palette.hole]];
  const ramp = showPlan()
    ? ""
    : `<span><i class="ramp" style="background:linear-gradient(90deg, ${palette.waste}, ${palette.ore})"></i>0 to 3+ g/t, faded where confidence is low</span>`;
  $("legend").innerHTML =
    ramp + items.map(([label, colour]) => `<span><i style="background:${colour}"></i>${label}</span>`).join("");
}

function draw() {
  const lookup = planLookup();
  drawPlan(lookup);
  drawSection(lookup);
  drawLegend();
  $("level-out").textContent = `${level} · ${level * mine.model.blockSize}–${(level + 1) * mine.model.blockSize} m`;
  $("section-label").textContent = `Looking north · ${sectionRow * mine.model.blockSize}–${(sectionRow + 1) * mine.model.blockSize} m N`;
  $("plan-hint").textContent =
    mine.activeRole === "geologist"
      ? "Click to drill a hole and move the cross-section there."
      : "Click to move the cross-section. Switch to Geologist to drill.";
}

// ---------- Readouts ----------

function readout(id: string, rows: [string, string][]) {
  $(id).innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

/** Best run of assays above 0.5 g/t, written the way drill results are reported. */
function intercept(hole: DrillHole): string {
  let best = { metres: 0, grams: 0, from: 0 };
  let run = { metres: 0, grams: 0, from: 0 };
  for (const a of hole.assays) {
    const len = a.to - a.from;
    if (a.grade >= 0.5) {
      if (run.metres === 0) run.from = a.from;
      run = { metres: run.metres + len, grams: run.grams + a.grade * len, from: run.from };
      if (run.grams > best.grams) best = { ...run };
    } else run = { metres: 0, grams: 0, from: 0 };
  }
  if (best.metres === 0) return `Hole ${hole.id}: no significant intercepts. Nothing above 0.5 g/t.`;
  return `Hole ${hole.id}: ${best.metres} m at ${f.grade(best.grams / best.metres)} from ${best.from} m.`;
}

function updateGeologist() {
  const depth = Number($<HTMLSelectElement>("hole-depth").value);
  const metres = mine.exploration.holes.reduce((s, h) => s + h.depth, 0);
  readout("geo-readout", [
    ["Budget left", f.money(mine.exploration.budget)],
    [`Next ${depth} m hole`, f.money(mine.exploration.costOf(depth))],
    ["Holes drilled", f.num(mine.exploration.holes.length)],
    ["Metres drilled", `${f.num(metres)} m`],
  ]);
}

function updatePlanner() {
  $("cutoff-out").textContent = f.grade(mine.planSettings.cutoffGrade);
  $("confidence-out").textContent = `${Math.round(mine.planSettings.minConfidence * 100)}%`;
  const plan = mine.plan;
  if (!plan) {
    let candidates = 0;
    for (let k = 0; k < mine.model.nz; k++)
      for (let j = 0; j < mine.model.ny; j++)
        for (let i = 0; i < mine.model.nx; i++) if (isOre(mine.estimates.get(i, j, k), mine.planSettings)) candidates++;
    readout("plan-readout", [
      ["Pit", "Not planned yet"],
      ["Blocks above cutoff", f.num(candidates)],
    ]);
  } else {
    readout("plan-readout", [
      ["Ore", f.tonnes(plan.oreTonnes)],
      ["Planned ore grade", f.grade(plan.averageOreGrade)],
      ["Waste", f.tonnes(plan.wasteTonnes)],
      ["Strip ratio", Number.isFinite(plan.stripRatio) ? `${plan.stripRatio.toFixed(1)} : 1` : "No ore"],
      ["Contained gold", f.oz(plan.containedOunces)],
      ["Blocks dug", `${f.num(mine.blocksDug)} of ${f.num(plan.sequence.length)}`],
    ]);
  }
  $("plan-stale").hidden = !(plan && planStale);
}

function updateOperator() {
  $("trucks-out").textContent = String(mine.trucks);
  const op = mine.haulOperation;
  const next = mine.plan && mine.plan.sequence[mine.blocksDug];
  if (!op || !next) {
    readout("fleet-readout", [
      ["Trucks", `${mine.trucks} × 100 t`],
      ["Digging", mine.plan ? "Pit finished" : "Waiting for a pit plan"],
    ]);
    return;
  }
  const depth = (next.k + 0.5) * mine.model.blockSize;
  const cycle = op.cycleSeconds(next.destination, depth);
  const interval = Math.max(op.loadSeconds, cycle / mine.trucks);
  const perShift = (12 * 3600) / interval;
  const limit = op.loadSeconds >= cycle / mine.trucks ? "Excavator" : "Trucks";
  readout("fleet-readout", [
    ["Current bench", `${Math.round(depth)} m deep`],
    ["Hauling to", next.destination === "ore" ? "Crusher" : "Waste dump"],
    ["Truck cycle", f.minutes(cycle)],
    ["Excavator load time", f.minutes(op.loadSeconds)],
    ["Bottleneck", limit],
    ["Rock per shift", `≈ ${f.tonnes(perShift * 100)}`],
    ["Fuel per shift", `${f.num(12 * mine.trucks * op.truck.fuelLitresPerHour)} L`],
  ]);
}

function updatePlant() {
  const { feedRateTph, grindP80 } = mine.plantSettings;
  $("feed-out").textContent = `${feedRateTph} t/h`;
  $("grind-out").textContent = `${grindP80} µm`;
  const cap = mine.plant.capacityTph(grindP80);
  readout("plant-readout", [
    ["Mill capacity at this grind", `${f.num(cap)} t/h`],
    ["Actual throughput", `${f.num(Math.min(feedRateTph, cap))} t/h${feedRateTph > cap ? " (mill-limited)" : ""}`],
    ["Expected recovery", f.pct(mine.plant.recovery(grindP80))],
    ["Processing cost", `${f.money(mine.plant.costPerTonne(grindP80))} per t`],
    ["Ore on stockpile", `${f.tonnes(mine.plant.feed.tonnes)} at ${f.grade(mine.plant.feed.grade)}`],
  ]);
}

function updateTicker() {
  const reports = mine.reports;
  $("cash").textContent = f.money(mine.cash);
  $("shift").textContent = String(reports.length);
  $("gold").textContent = f.oz(reports.reduce((s, r) => s + r.ounces, 0));
  const planned = reports.reduce((s, r) => s + r.oreHauled * r.plannedOreGrade, 0);
  const actual = reports.reduce((s, r) => s + r.oreHauled * r.trueOreGrade, 0);
  $("recon").textContent = planned > 0 ? `${Math.round((actual / planned) * 100)}%` : "–";
}

function logRow(r: ShiftReport): string {
  const short = r.oreHauled > 0 && r.trueOreGrade < r.plannedOreGrade * 0.85;
  const g = (v: number) => (r.oreHauled > 0 ? f.grade(v) : "–");
  return `<tr>
    <td>${r.shift}</td>
    <td>${f.tonnes(r.oreHauled)}</td>
    <td>${f.tonnes(r.wasteHauled)}</td>
    <td>${g(r.plannedOreGrade)}</td>
    <td class="${short ? "short" : ""}">${g(r.trueOreGrade)}</td>
    <td>${f.tonnes(r.plant.tonnesMilled)}</td>
    <td>${r.plant.tonnesMilled > 0 ? f.pct(r.plant.recovery) : "–"}</td>
    <td>${f.oz(r.ounces)}</td>
    <td class="${r.profit >= 0 ? "pos" : "neg"}">${f.money(r.profit)}</td>
  </tr>`;
}

function updateLog() {
  if (mine.reports.length === 0) return;
  $("log-body").innerHTML = mine.reports.slice().reverse().slice(0, 200).map(logRow).join("");
}

function refresh() {
  updateGeologist();
  updatePlanner();
  updateOperator();
  updatePlant();
  updateTicker();
  updateLog();
  draw();
}

// ---------- Controls ----------

const roles: Role[] = ["geologist", "planner", "operator", "plant"];

function selectRole(role: Role) {
  mine.activeRole = role;
  for (const r of roles) {
    $(`tab-${r}`).setAttribute("aria-selected", String(r === role));
    $(`panel-${r}`).hidden = r !== role;
  }
  refresh();
}

for (const r of roles) $(`tab-${r}`).addEventListener("click", () => selectRole(r));

planCanvas.addEventListener("click", (event) => {
  const rect = planCanvas.getBoundingClientRect();
  const { nx, ny, blockSize } = mine.model;
  const cell = rect.width / nx;
  const x = ((event.clientX - rect.left) / cell) * blockSize;
  const y = (ny - (event.clientY - rect.top) / cell) * blockSize;
  if (!mine.model.contains(x, y, 0)) return;
  sectionRow = Math.min(ny - 1, Math.max(0, Math.floor(y / blockSize)));

  if (mine.activeRole === "geologist") {
    const depth = Number($<HTMLSelectElement>("hole-depth").value);
    const note = $("geo-last");
    if (!mine.exploration.canAfford(depth)) {
      note.textContent = `Not enough budget for a ${depth} m hole. Try a shorter hole.`;
    } else {
      const hole = mine.exploration.drill(x, y, depth);
      mine.updateEstimates();
      if (mine.plan) planStale = true;
      note.textContent = `${intercept(hole)} Collar at ${Math.round(x)} m E, ${Math.round(y)} m N.`;
    }
  }
  refresh();
});

$<HTMLInputElement>("level").addEventListener("input", (e) => {
  level = Number((e.target as HTMLInputElement).value);
  draw();
});

$<HTMLSelectElement>("hole-depth").addEventListener("change", updateGeologist);

const cutoff = $<HTMLInputElement>("cutoff");
cutoff.value = String(mine.planSettings.cutoffGrade);
cutoff.addEventListener("input", () => {
  mine.planSettings = { ...mine.planSettings, cutoffGrade: Number(cutoff.value) };
  updatePlanner();
});

const confidence = $<HTMLInputElement>("confidence");
confidence.value = String(mine.planSettings.minConfidence);
confidence.addEventListener("input", () => {
  mine.planSettings = { ...mine.planSettings, minConfidence: Number(confidence.value) };
  updatePlanner();
});

$("plan-pit").addEventListener("click", () => {
  mine.planPit();
  planStale = false;
  refresh();
});

$("trucks-down").addEventListener("click", () => {
  if (mine.trucks > 1) mine.trucks -= 1;
  refresh();
});
$("trucks-up").addEventListener("click", () => {
  if (mine.trucks < 20) mine.trucks += 1;
  refresh();
});

const feed = $<HTMLInputElement>("feed");
const grind = $<HTMLInputElement>("grind");
feed.value = String(mine.plantSettings.feedRateTph);
grind.value = String(mine.plantSettings.grindP80);
const applyPlant = () => {
  mine.plantSettings = { feedRateTph: Number(feed.value), grindP80: Number(grind.value) };
  updatePlant();
};
feed.addEventListener("input", applyPlant);
grind.addEventListener("input", applyPlant);

function runShifts(n: number) {
  for (let s = 0; s < n; s++) mine.runShift();
  refresh();
}
$("run-shift").addEventListener("click", () => runShifts(1));
$("run-week").addEventListener("click", () => runShifts(WEEK));

// ---------- Theme and size ----------

const repaint = () => {
  palette = readPalette();
  draw();
};
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
new ResizeObserver(() => draw()).observe(planCanvas);
new ResizeObserver(() => draw()).observe(sectionCanvas);

$<HTMLInputElement>("level").value = String(level);
selectRole("geologist");
