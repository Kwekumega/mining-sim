/** World layout in pixels. North is up. The lease holds the 40 x 40 block model at 12 px per 10 m block. */
export const WORLD = { w: 1800, h: 1150 };
export const CELL = 12;
export const LEASE = { x: 120, y: 260, size: 40 * CELL };

export type Point = { x: number; y: number };

export const PLACES = {
  rampTop: { x: LEASE.x + LEASE.size - 18, y: LEASE.y + LEASE.size / 2 },
  rampExit: { x: LEASE.x + LEASE.size + 40, y: LEASE.y + LEASE.size / 2 },
  junction: { x: 800, y: 500 },
  crusher: { x: 940, y: 330 },
  crusherBay: { x: 900, y: 380 },
  dump: { x: 960, y: 760 },
  dumpBay: { x: 900, y: 700 },
  mill: { x: 1170, y: 300 },
  tanks: { x: 1340, y: 300 },
  goldRoom: { x: 1520, y: 300 },
  controlRoom: { x: 1170, y: 440 },
  office: { x: 1260, y: 660 },
  coreShed: { x: 1440, y: 660 },
  workshop: { x: 1260, y: 860 },
  truckPark: { x: 1400, y: 880 },
  dispatch: { x: 1130, y: 860 },
} satisfies Record<string, Point>;

/** Centre of a block column in world pixels. j counts north, so it runs up the screen. */
export function columnCentre(i: number, j: number): Point {
  return { x: LEASE.x + (i + 0.5) * CELL, y: LEASE.y + (39 - j + 0.5) * CELL };
}

/** World pixels to lease metres (x east, y north), or null outside the lease. */
export function toLease(p: Point): { x: number; y: number } | null {
  const x = ((p.x - LEASE.x) / CELL) * 10;
  const y = ((LEASE.y + LEASE.size - p.y) / CELL) * 10;
  if (x < 0 || y < 0 || x >= 400 || y >= 400) return null;
  return { x, y };
}

export function fromLease(x: number, y: number): Point {
  return { x: LEASE.x + (x / 10) * CELL, y: LEASE.y + LEASE.size - (y / 10) * CELL };
}

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Road from the pit rim to a tipping bay, in driving order. */
export function haulRoute(to: "crusher" | "dump"): Point[] {
  return [PLACES.rampTop, PLACES.rampExit, PLACES.junction, to === "crusher" ? PLACES.crusherBay : PLACES.dumpBay];
}
