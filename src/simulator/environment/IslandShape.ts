import { clamp, smoothstep } from "../math";

export type IslandStyle = "volcanic" | "hills" | "cay";

export type IslandDefinition = {
  name: string;
  style: IslandStyle;
  centerX: number;
  centerZ: number;
  beachRadius: number;
  scaleZ: number;
  seed: number;
};

export type LandmarkKind = "island" | "peak" | "lighthouse" | "pier" | "hut";

export type Landmark = {
  id: string;
  kind: LandmarkKind;
  name: string;
  island: number;
  /** Radial position in beach radii and polar angle around the island center. */
  radial: number;
  angle: number;
};

/** Visible terrain extends this far (in beach radii) before fading into the seabed. */
export const MAX_VISIBLE_TERRAIN_RADIUS_SCALE = 1.06;
/** Radial fraction where the dry beach begins. */
export const BEACH_START = 0.84;

export const ISLANDS: readonly IslandDefinition[] = [
  { name: "Mount Ember", style: "volcanic", centerX: -115, centerZ: -65, beachRadius: 54, scaleZ: 0.72, seed: 0 },
  { name: "Beacon Isle", style: "hills", centerX: 138, centerZ: -28, beachRadius: 46, scaleZ: 0.82, seed: 1 },
  { name: "Driftwood Cay", style: "cay", centerX: 25, centerZ: 175, beachRadius: 36, scaleZ: 0.68, seed: 2 },
];

export const LANDMARKS: readonly Landmark[] = [
  { id: "mount-ember", kind: "island", name: "Mount Ember", island: 0, radial: 0, angle: 0 },
  { id: "ember-crater", kind: "peak", name: "Ember crater", island: 0, radial: 0.02, angle: 0 },
  { id: "beacon-isle", kind: "island", name: "Beacon Isle", island: 1, radial: 0, angle: 0 },
  { id: "beacon-lighthouse", kind: "lighthouse", name: "Lighthouse", island: 1, radial: 0.7, angle: 0.55 },
  { id: "driftwood-cay", kind: "island", name: "Driftwood Cay", island: 2, radial: 0, angle: 0 },
  { id: "driftwood-pier", kind: "pier", name: "Pier", island: 2, radial: 0.98, angle: -1.25 },
  { id: "driftwood-hut", kind: "hut", name: "Beach hut", island: 2, radial: 0.62, angle: -1.05 },
];

/** Irregular coastline multiplier on the beach radius for a polar angle. */
export function coastlineScale(island: IslandDefinition, angle: number): number {
  const seed = island.seed;
  return (
    1 +
    Math.sin(angle * 3 + seed * 1.7) * 0.038 +
    Math.sin(angle * 7 - seed * 0.9) * 0.023 +
    Math.cos(angle * 11 + seed * 0.6) * 0.012
  );
}

/** Island-local horizontal position (meters) of a polar terrain sample. */
export function islandLocalPoint(island: IslandDefinition, radial: number, angle: number): { x: number; z: number } {
  const radius = island.beachRadius * radial * coastlineScale(island, angle);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius * island.scaleZ };
}

export function islandWorldPoint(island: IslandDefinition, radial: number, angle: number): { x: number; z: number } {
  const local = islandLocalPoint(island, radial, angle);
  return { x: island.centerX + local.x, z: island.centerZ + local.z };
}

function ridgeNoise(angle: number, radial: number, seed: number): number {
  return (
    Math.sin(angle * 5 + seed * 2.1) * Math.cos(radial * 7 + seed) * 0.5 +
    Math.sin(angle * 9 - seed * 1.3) * Math.sin(radial * 11 + 0.4) * 0.3 +
    Math.cos(angle * 13 + seed) * Math.cos(radial * 17) * 0.2
  );
}

function bump(radial: number, angle: number, bumpRadial: number, bumpAngle: number, width: number): number {
  // Gaussian bump in polar space on a unit disc.
  const ax = Math.cos(angle) * radial - Math.cos(bumpAngle) * bumpRadial;
  const az = Math.sin(angle) * radial - Math.sin(bumpAngle) * bumpRadial;
  return Math.exp(-(ax * ax + az * az) / (2 * width * width));
}

/** Interior land height before the beach blend, by island style. */
function interiorHeight(island: IslandDefinition, radial: number, angle: number): number {
  const noise = ridgeNoise(angle, radial, island.seed);
  switch (island.style) {
    case "volcanic": {
      // A dormant cone with eroded ridges and a shallow summit crater.
      const cone = 21 * Math.exp(-(radial * radial) / (2 * 0.3 * 0.3));
      const ridges = noise * 1.6 * smoothstep(0.08, 0.5, radial) * (1 - smoothstep(0.5, 0.85, radial));
      const crater = 3.6 * Math.exp(-(radial * radial) / (2 * 0.05 * 0.05));
      return 1.3 + cone + ridges - crater;
    }
    case "hills": {
      // Rolling green hills plus a raised rocky headland for the lighthouse.
      const hillA = 8.5 * bump(radial, angle, 0.3, 2.6, 0.26);
      const hillB = 5.5 * bump(radial, angle, 0.38, 4.4, 0.2);
      const headland = 6.2 * bump(radial, angle, 0.7, 0.55, 0.15);
      return 1.25 + hillA + hillB + headland + noise * 0.55;
    }
    case "cay":
    default:
      // A low sandy cay with dunes.
      return 1.05 + 1.5 * (1 - radial * radial) + noise * 0.28;
  }
}

/** Terrain height (meters above mean sea level) at a polar island sample. */
export function islandHeight(island: IslandDefinition, radial: number, angle: number): number {
  const r = Math.max(0, radial);
  const beach =
    r < 1
      ? 0.34 - 0.42 * smoothstep(BEACH_START, 1, r) + Math.sin(angle * 9) * 0.03
      : -0.08 - 0.34 * smoothstep(1, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, r);
  const land = interiorHeight(island, r, angle);
  const toBeach = smoothstep(BEACH_START - 0.24, BEACH_START, r);
  return land * (1 - toBeach) + beach * toBeach;
}

/** True where vegetation can grow: dry, above the beach, and not too steep. */
export function isPlantable(island: IslandDefinition, radial: number, angle: number): boolean {
  if (radial > BEACH_START + 0.06 || radial < 0.12) return false;
  const height = islandHeight(island, radial, angle);
  const step = 0.02;
  const slope = Math.abs(islandHeight(island, radial + step, angle) - height) / (step * island.beachRadius);
  const maxHeight = island.style === "volcanic" ? 12 : 30;
  return height > 0.6 && height < maxHeight && slope < 0.55;
}

export function terrainSlope(island: IslandDefinition, radial: number, angle: number): number {
  const step = 0.015;
  const height = islandHeight(island, radial, angle);
  const radialSlope = (islandHeight(island, radial + step, angle) - height) / (step * island.beachRadius);
  const angularDistance = Math.max(0.5, radial * island.beachRadius * step * 3);
  const angularSlope = (islandHeight(island, radial, angle + step * 3) - height) / angularDistance;
  return clamp(Math.hypot(radialSlope, angularSlope), 0, 10);
}
