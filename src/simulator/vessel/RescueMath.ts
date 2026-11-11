/**
 * Help for a yacht that is stuck (aground, wedged against a ship or a reef):
 * the nearest open water, and which way to point her there. Pure.
 */

export type ClearanceSampler = (x: number, z: number, normal: { x: number; z: number }) => number;

/** Open water the yacht is towed into: this far from any shore, hull or reef, metres. */
export const RESCUE_CLEARANCE = 35;
const RING_STEP = 12;
const MAX_RADIUS = 600;
const BEARINGS = 32;

/**
 * The nearest point to (x, z) with at least `need` metres of open water
 * around it, searched ring by ring, and a heading pointing away from the
 * nearest obstacle there (forward is (sin h, cos h)). Null if nothing is
 * found within 600 m.
 */
export function findOpenWater(
  x: number,
  z: number,
  clearance: ClearanceSampler,
  need = RESCUE_CLEARANCE,
): { x: number; z: number; heading: number } | null {
  const normal = { x: 0, z: 1 };
  for (let radius = RING_STEP; radius <= MAX_RADIUS; radius += RING_STEP) {
    let best: { x: number; z: number; heading: number; room: number } | null = null;
    const bearings = Math.max(12, Math.min(BEARINGS * 2, Math.round((radius * Math.PI * 2) / 20)));
    for (let step = 0; step < bearings; step += 1) {
      const angle = (step / bearings) * Math.PI * 2;
      const px = x + Math.sin(angle) * radius;
      const pz = z + Math.cos(angle) * radius;
      const room = clearance(px, pz, normal);
      if (room < need || (best && room <= best.room)) continue;
      best = { x: px, z: pz, heading: Math.atan2(normal.x, normal.z), room };
    }
    if (best) return { x: best.x, z: best.z, heading: best.heading };
  }
  return null;
}
