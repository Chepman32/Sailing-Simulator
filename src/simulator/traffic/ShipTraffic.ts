import { segmentNearLand } from "../world/WorldLayout";

/** Ships keep at least this far apart so they never bunch up in one area. */
export const SHIP_MIN_SPACING = 1500;
/** …and are seeded no farther than this from their nearest neighbour. */
export const SHIP_MAX_SPACING = 3000;
/** No two horn blasts (from any ships) closer together than this. */
export const HORN_MIN_INTERVAL = 30;
/** Routes keep this clearance from every shoreline. */
export const SHIP_LAND_CLEARANCE = 170;
/** Ships farther than this from the yacht are recycled onto a new route. */
export const SHIP_RECYCLE_DISTANCE = 3600;

export type PlanarPoint = { x: number; z: number };

export type ShipSpawn = { x: number; z: number; heading: number };

export function planarDistance(a: PlanarPoint, b: PlanarPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * A new ship position is acceptable when it is at least SHIP_MIN_SPACING from
 * every other ship and, if any exist, within SHIP_MAX_SPACING of the nearest.
 */
export function isValidShipSpacing(candidate: PlanarPoint, others: readonly PlanarPoint[]): boolean {
  if (others.length === 0) return true;
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of others) {
    const distance = planarDistance(candidate, other);
    if (distance < SHIP_MIN_SPACING) return false;
    nearest = Math.min(nearest, distance);
  }
  return nearest <= SHIP_MAX_SPACING;
}

/**
 * Choose a spawn 1.2–2.6 km from the yacht on a course that passes it at a
 * safe 280–650 m, keeps clear of land for the whole crossing, and respects the
 * spacing rule against the other ships. Returns null if no attempt fits.
 */
export function chooseShipSpawn(
  yacht: PlanarPoint,
  others: readonly PlanarPoint[],
  random: () => number,
  attempts = 60,
): ShipSpawn | null {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const bearing = random() * Math.PI * 2;
    const distance = 1200 + random() * 1400;
    const x = yacht.x + Math.sin(bearing) * distance;
    const z = yacht.z + Math.cos(bearing) * distance;
    // Aim past the yacht with a lateral passing distance on either side.
    const passing = (280 + random() * 370) * (random() < 0.5 ? -1 : 1);
    const toYacht = Math.atan2(yacht.x - x, yacht.z - z);
    const heading = toYacht + Math.atan2(passing, distance);
    const endX = x + Math.sin(heading) * distance * 2;
    const endZ = z + Math.cos(heading) * distance * 2;
    if (segmentNearLand(x, z, endX, endZ, SHIP_LAND_CLEARANCE)) continue;
    const candidate = { x, z };
    if (!isValidShipSpacing(candidate, others)) continue;
    return { x, z, heading };
  }
  return null;
}

/** Closest point of approach of the yacht to a ship's straight course ahead. */
export function closestApproach(ship: PlanarPoint, heading: number, yacht: PlanarPoint): { distance: number; along: number } {
  const dx = yacht.x - ship.x;
  const dz = yacht.z - ship.z;
  const along = dx * Math.sin(heading) + dz * Math.cos(heading);
  const lateral = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
  return { distance: along > 0 ? lateral : Math.hypot(dx, dz), along };
}

/** Global horn arbiter: at most one blast per HORN_MIN_INTERVAL seconds. */
export class HornScheduler {
  private lastHorn = Number.NEGATIVE_INFINITY;

  canSound(time: number): boolean {
    return time - this.lastHorn >= HORN_MIN_INTERVAL;
  }

  /** Returns true and records the blast if the interval has elapsed. */
  trySound(time: number): boolean {
    if (!this.canSound(time)) return false;
    this.lastHorn = time;
    return true;
  }

  get last(): number {
    return this.lastHorn;
  }
}
