/**
 * The ground of Sikakrom: flat town and mine pads, an open pit cut in benches, and a ramp
 * trench running east out of the pit. One unit is roughly 0.75 m.
 */

export const PIT = { x: 40, z: -110, radius: 62, benchWidth: 10, benchHeight: 6, benches: 5 };
export const PIT_DEPTH = PIT.benches * PIT.benchHeight;
/** The ramp leaves the pit floor heading east and reaches the surface here. */
export const RAMP = { halfWidth: 6, bottomDx: 12, topDx: PIT.radius + 30 };

/** Ground height at a point, used for the mesh and for keeping people and trucks on it. */
export function heightAt(x: number, z: number): number {
  const dx = x - PIT.x;
  const dz = z - PIT.z;
  const r = Math.hypot(dx, dz);
  let h = 0;
  if (r < PIT.radius) {
    const inward = PIT.radius - r;
    const k = Math.floor(inward / PIT.benchWidth);
    const u = inward - k * PIT.benchWidth;
    h = k >= PIT.benches ? -PIT_DEPTH : -(k * PIT.benchHeight + PIT.benchHeight * Math.min(1, u / 3));
  }
  if (dx > RAMP.bottomDx - 4 && dx < RAMP.topDx) {
    const t = Math.min(1, Math.max(0, (dx - RAMP.bottomDx) / (RAMP.topDx - RAMP.bottomDx)));
    const ramp = -PIT_DEPTH * (1 - t);
    const side = Math.abs(dz);
    if (side < RAMP.halfWidth) h = ramp;
    else if (side < RAMP.halfWidth + 9) {
      const w = (side - RAMP.halfWidth) / 9;
      h = ramp * (1 - w) + h * w;
    }
  }
  return h;
}

/** True where the ground is the ramp road, for colouring. */
export function onRamp(x: number, z: number): boolean {
  const dx = x - PIT.x;
  return dx > RAMP.bottomDx - 2 && dx < RAMP.topDx && Math.abs(z - PIT.z) < RAMP.halfWidth;
}

/** The pit and its ramp trench are drawn as a detailed disc of this radius; everywhere else is flat. */
export const PIT_DISC = { radius: 100, segments: 288 };

export const GROUND = { minX: -260, maxX: 280, minZ: -260, maxZ: 220 };
