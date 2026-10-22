const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const tonnes = (t: number) => `${whole.format(t)} t`;
export const grade = (g: number) => `${g.toFixed(2)} g/t`;
export const oz = (o: number) => `${whole.format(o)} oz`;
export const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
export const num = (n: number) => whole.format(n);

export function money(v: number): string {
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${whole.format(a)}`;
}

export function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}
