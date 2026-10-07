import { clamp } from "../math";

/**
 * Pure island geometry shared by collision, bathymetry, terrain meshing and
 * the ocean shader. Keeping it free of rendering imports lets the same
 * definitions be unit-tested and compiled into GLSL constants.
 */
export type IslandDefinition = {
  centerX: number;
  centerZ: number;
  beachRadius: number;
  /** The island is an ellipse: its Z extent is `beachRadius × scaleZ`. */
  scaleZ: number;
};

export const ISLAND_DEFINITIONS: readonly IslandDefinition[] = [
  { centerX: -115, centerZ: -65, beachRadius: 54, scaleZ: 0.72 },
  { centerX: 138, centerZ: -28, beachRadius: 46, scaleZ: 0.82 },
  { centerX: 25, centerZ: 175, beachRadius: 36, scaleZ: 0.68 },
] as const;

/** Mean open-water depth in metres. */
export const OPEN_WATER_DEPTH = 17.5;
/** Width of the sloping shelf around each beach in metres. */
export const SHELF_WIDTH = 34;
export const SHORE_DEPTH = 0.38;
export const SHELF_SLOPE = 0.46;
/** Terrain radius (as a fraction of the beach radius) where sand meets still water. */
export const WATERLINE_RADIAL = 0.975;

/** Irregular coastline: radial scale of the terrain at a polar angle. */
export function islandEdgeNoise(angle: number, index: number): number {
  return (
    1 +
    Math.sin(angle * 3 + index * 1.7) * 0.038 +
    Math.sin(angle * 7 - index * 0.9) * 0.023 +
    Math.cos(angle * 11 + index * 0.6) * 0.012
  );
}

/** Signed distance from the nominal beach ellipse; negative on land. */
export function distanceFromBeach(island: IslandDefinition, x: number, z: number): number {
  const dx = x - island.centerX;
  const dz = (z - island.centerZ) / island.scaleZ;
  return Math.hypot(dx, dz) - island.beachRadius;
}

/** Water depth in metres used by physics, the depth sounder and grounding. */
export function waterDepthAt(x: number, z: number): number {
  let depth = OPEN_WATER_DEPTH + Math.sin(x * 0.006) * 1.7 + Math.cos(z * 0.005) * 1.2;
  for (const island of ISLAND_DEFINITIONS) {
    const distance = distanceFromBeach(island, x, z);
    if (distance < SHELF_WIDTH) depth = Math.min(depth, SHORE_DEPTH + Math.max(0, distance) * SHELF_SLOPE);
  }
  return clamp(depth, 0.35, 24);
}

/**
 * Distance in metres from the visible, irregular waterline of the nearest
 * island (negative on the beach). The ocean shader evaluates the same
 * expression so shore foam and shallow-water colour hug the rendered coast.
 */
export function distanceFromWaterline(x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  ISLAND_DEFINITIONS.forEach((island, index) => {
    const dx = x - island.centerX;
    const dz = (z - island.centerZ) / island.scaleZ;
    const angle = Math.atan2(dz, dx);
    const shore = island.beachRadius * islandEdgeNoise(angle, index) * WATERLINE_RADIAL;
    nearest = Math.min(nearest, Math.hypot(dx, dz) - shore);
  });
  return nearest;
}

function latticeHash(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

/** Smooth, deterministic value noise in [0, 1] for terrain colour and dunes. */
export function terrainNoise(x: number, z: number): number {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const localX = x - cellX;
  const localZ = z - cellZ;
  const smoothX = localX * localX * (3 - 2 * localX);
  const smoothZ = localZ * localZ * (3 - 2 * localZ);
  const a = latticeHash(cellX, cellZ);
  const b = latticeHash(cellX + 1, cellZ);
  const c = latticeHash(cellX, cellZ + 1);
  const d = latticeHash(cellX + 1, cellZ + 1);
  return a + (b - a) * smoothX + (c - a) * smoothZ + (a - b - c + d) * smoothX * smoothZ;
}
