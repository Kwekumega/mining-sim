/** Reads the page's colour tokens so canvas drawings follow the light and dark themes. */
export interface Palette {
  sheet: string;
  ink: string;
  muted: string;
  rule: string;
  ore: string;
  waste: string;
  unknown: string;
  dug: string;
  hole: string;
  gold: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return {
    sheet: v("sheet"),
    ink: v("ink"),
    muted: v("muted"),
    rule: v("rule"),
    ore: v("ore"),
    waste: v("waste"),
    unknown: v("unknown"),
    dug: v("dug"),
    hole: v("hole"),
    gold: v("gold"),
  };
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = Math.min(1, Math.max(0, t));
  return `rgb(${Math.round(ar + (br - ar) * f)}, ${Math.round(ag + (bg - ag) * f)}, ${Math.round(ab + (bb - ab) * f)})`;
}

/** Grade ramp from waste brown at 0 g/t to ore gold at 3 g/t, faded toward "unknown" where confidence is low. */
export function gradeColour(p: Palette, grade: number, confidence: number): string {
  if (confidence <= 0) return p.unknown;
  const ramp = mixHex(p.waste, p.ore, grade / 3);
  return mix(p.unknown, ramp, Math.max(0.3, confidence));
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = Math.min(1, Math.max(0, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * f).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}
