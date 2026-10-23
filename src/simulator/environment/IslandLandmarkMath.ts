import { islandEdgeNoise, type IslandDefinition } from "./IslandMath";

/**
 * Which landmarks an island carries and where, decided from its id alone so
 * every visit (and the chart) finds the same ones: about one island in five
 * has a lighthouse on a headland, about one in five a plank pier with a
 * thatched stilt hut at its root, and every island boulders along its beach
 * (volcanoes the most). The islands around the start are set by hand so all
 * three kinds are in sight from the first moment. Pure.
 */

export type PolarSpot = { radial: number; angle: number };

export type IslandLandmarkPlan = {
  lighthouse: PolarSpot | null;
  /** The pier runs straight out to sea from the waterline at `angle`. */
  pier: { angle: number; length: number } | null;
  hut: PolarSpot | null;
  rocks: (PolarSpot & { size: number; yaw: number; tilt: number })[];
};

/** Islands this close to the start are the hand-set ones. */
const START_RANGE = 320;
/** The waterline as a fraction of the beach radius. */
const WATERLINE = 0.97;
export const PIER_HALF_WIDTH = 1.3;

function hash(value: number, salt: number): number {
  let x = Math.imul((value ^ (salt * 0x9e3779b9)) >>> 0, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function islandLandmarks(island: IslandDefinition): IslandLandmarkPlan {
  const random = (salt: number) => hash(island.id, salt);
  const start = Math.hypot(island.centerX, island.centerZ) < START_RANGE;
  const roll = random(1);
  const big = island.beachRadius >= 28 && !island.volcano;
  const hasLighthouse = start ? island.seed === 0 : big && roll < 0.2;
  const hasPier = start ? island.seed === 1 : big && roll >= 0.2 && roll < 0.42;
  const lighthouseAngle = random(2) * Math.PI * 2;
  const pierAngle = random(3) * Math.PI * 2;
  const plan: IslandLandmarkPlan = {
    lighthouse: hasLighthouse ? { radial: 0.62, angle: lighthouseAngle } : null,
    pier: hasPier ? { angle: pierAngle, length: 16 + random(4) * 8 } : null,
    // The hut stands on the beach just inland of the pier's root.
    hut: hasPier ? { radial: 0.8, angle: pierAngle + (random(5) < 0.5 ? -1 : 1) * (5 / island.beachRadius) } : null,
    rocks: [],
  };
  const rocks = island.volcano ? 14 : 4 + Math.floor(random(6) * 9);
  for (let index = 0; index < rocks; index += 1) {
    const angle = random(10 + index) * Math.PI * 2;
    // Keep the pier's approach clear.
    if (plan.pier && Math.abs(Math.atan2(Math.sin(angle - plan.pier.angle), Math.cos(angle - plan.pier.angle))) < 0.35) continue;
    if (plan.lighthouse && Math.abs(Math.atan2(Math.sin(angle - plan.lighthouse.angle), Math.cos(angle - plan.lighthouse.angle))) < 0.12) continue;
    plan.rocks.push({
      angle,
      radial: 0.8 + random(40 + index) * 0.2,
      size: (island.volcano ? 1.2 : 0.9) + random(70 + index) * (island.volcano ? 2.2 : 1.8),
      yaw: random(100 + index) * Math.PI * 2,
      tilt: (random(130 + index) - 0.5) * 0.5,
    });
  }
  return plan;
}

/** World position of a polar spot on an island (radial 1 = the beach line). */
export function islandSpot(island: IslandDefinition, radial: number, angle: number): { x: number; z: number } {
  const radius = island.beachRadius * radial * islandEdgeNoise(angle, island);
  return { x: island.centerX + Math.cos(angle) * radius, z: island.centerZ + Math.sin(angle) * radius * island.scaleZ };
}

/** The pier's centre line in world metres, from its root on the waterline out to its seaward end. */
export function pierLine(island: IslandDefinition, pier: { angle: number; length: number }): { x0: number; z0: number; x1: number; z1: number } {
  // Its root a couple of metres up the beach.
  const root = islandSpot(island, WATERLINE - 2.5 / island.beachRadius, pier.angle);
  // Out along the coast's outward direction (the ellipse's radial direction).
  const dx = Math.cos(pier.angle);
  const dz = Math.sin(pier.angle) * island.scaleZ;
  const length = Math.hypot(dx, dz);
  return { x0: root.x, z0: root.z, x1: root.x + (dx / length) * pier.length, z1: root.z + (dz / length) * pier.length };
}

/**
 * Distance from (x, z) to a pier's planking (negative inside it), and the
 * outward normal there: the guard keeps the hulls off it as off any obstacle.
 */
export function pierClearance(line: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, normal: { x: number; z: number }): number {
  const sx = line.x1 - line.x0;
  const sz = line.z1 - line.z0;
  const t = Math.max(0, Math.min(1, ((x - line.x0) * sx + (z - line.z0) * sz) / Math.max(1e-6, sx * sx + sz * sz)));
  const dx = x - (line.x0 + sx * t);
  const dz = z - (line.z0 + sz * t);
  const distance = Math.hypot(dx, dz);
  if (distance > 1e-6) {
    normal.x = dx / distance;
    normal.z = dz / distance;
  } else {
    normal.x = -sz;
    normal.z = sx;
    const length = Math.hypot(normal.x, normal.z) || 1;
    normal.x /= length;
    normal.z /= length;
  }
  return distance - PIER_HALF_WIDTH;
}
