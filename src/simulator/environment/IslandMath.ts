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
  /** Height of the summit above mean sea level, metres. */
  height: number;
  /** Two-lobed bulge of the coastline (0 = none), as a fraction of the radius. */
  lobe: number;
};

/** Mean open-water depth in metres. */
export const OPEN_WATER_DEPTH = 17.5;
/** Width of the sloping shelf around each beach in metres. */
export const SHELF_WIDTH = 34;
export const SHORE_DEPTH = 0.38;
export const SHELF_SLOPE = 0.46;
/** Terrain radius (as a fraction of the beach radius) where sand meets still water. */
export const WATERLINE_RADIAL = 0.975;

/** A small, fast, deterministic generator (mulberry32) for the archipelago. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three islands closest to the start; the rest of the archipelago is generated around them. */
const HOME_ISLANDS: readonly IslandDefinition[] = [
  { centerX: -115, centerZ: -65, beachRadius: 54, scaleZ: 0.72, height: 1.78, lobe: 0 },
  { centerX: 138, centerZ: -28, beachRadius: 46, scaleZ: 0.82, height: 1.96, lobe: 0 },
  { centerX: 25, centerZ: 175, beachRadius: 36, scaleZ: 0.68, height: 2.14, lobe: 0 },
];

/** How far out the archipelago reaches from the start, metres. */
export const ARCHIPELAGO_RADIUS = 2600;
/** Generated islands, beyond the three home islands. */
export const ARCHIPELAGO_EXTRA_ISLANDS = 32;
/** Open water kept between two islands' shelves, metres. */
const ISLAND_CHANNEL = 70;

/**
 * Scatters islands of every size over the sea around the start: mostly cays
 * and small islets, some wooded islands, a few large high ones. Placement is
 * deterministic, so physics, the ocean shader and the terrain all see the
 * same archipelago on every load. Islands never crowd the start or each
 * other: a channel of deep water always separates two shelves.
 */
function generateArchipelago(): IslandDefinition[] {
  const random = seededRandom(0x5a11ab1e);
  const islands: IslandDefinition[] = HOME_ISLANDS.map((island) => ({ ...island }));
  let attempts = 0;
  while (islands.length < HOME_ISLANDS.length + ARCHIPELAGO_EXTRA_ISLANDS && attempts < 6000) {
    attempts += 1;
    const size = random();
    // Mostly small; one in eight is a large, high island.
    const beachRadius = size < 0.55 ? 16 + random() * 22 : size < 0.875 ? 38 + random() * 30 : 72 + random() * 46;
    const scaleZ = 0.55 + random() * 0.95;
    const angle = random() * Math.PI * 2;
    const distance = 280 + Math.pow(random(), 0.85) * (ARCHIPELAGO_RADIUS - 280);
    const centerX = Math.cos(angle) * distance;
    const centerZ = Math.sin(angle) * distance;
    const reach = beachRadius * Math.max(1, scaleZ);
    const clear = islands.every((other) => {
      const otherReach = other.beachRadius * Math.max(1, other.scaleZ);
      return (
        Math.hypot(centerX - other.centerX, centerZ - other.centerZ) >
        reach + otherReach + 2 * SHELF_WIDTH + ISLAND_CHANNEL
      );
    });
    if (!clear || Math.hypot(centerX, centerZ) < reach + SHELF_WIDTH + 160) continue;
    const height =
      beachRadius < 38 ? 1.5 + random() * 0.9 : beachRadius < 70 ? 2.4 + random() * 2.4 : 5 + random() * 8;
    islands.push({ centerX, centerZ, beachRadius, scaleZ, height, lobe: random() * 0.04 });
  }
  return islands;
}

export const ISLAND_DEFINITIONS: readonly IslandDefinition[] = generateArchipelago();

/**
 * Islands the shaders evaluate at any moment: the nearest few to the yacht.
 * The rest are too far off for their shallows, surf or wet sand to show.
 */
export const ISLAND_SLOTS = 8;

/**
 * Fills the shader slots with the islands nearest (x, z), nearest first.
 * `shape` receives (centre x, centre z, beach radius, scale z) and `frame`
 * (island index, lobe, 0, 0) per slot; unused slots hold an island far away.
 */
export function selectIslandSlots(x: number, z: number, shape: Float32Array, frame: Float32Array): void {
  const order = ISLAND_DEFINITIONS.map((island, index) => ({
    index,
    distance:
      Math.hypot(x - island.centerX, (z - island.centerZ) / island.scaleZ) * Math.min(1, island.scaleZ) -
      island.beachRadius,
  })).sort((a, b) => a.distance - b.distance);
  for (let slot = 0; slot < ISLAND_SLOTS; slot += 1) {
    const entry = order[slot];
    const island = entry ? ISLAND_DEFINITIONS[entry.index] : undefined;
    shape[slot * 4] = island ? island.centerX : 1.0e6;
    shape[slot * 4 + 1] = island ? island.centerZ : 1.0e6;
    shape[slot * 4 + 2] = island ? island.beachRadius : 1;
    shape[slot * 4 + 3] = island ? island.scaleZ : 1;
    frame[slot * 4] = entry ? entry.index : 0;
    frame[slot * 4 + 1] = island ? island.lobe : 0;
    frame[slot * 4 + 2] = 0;
    frame[slot * 4 + 3] = 0;
  }
}

/** Largest outward excursion of the coastline noise above the nominal ellipse. */
export const MAX_EDGE_NOISE = 1.073 + 0.04;

/** Irregular coastline: radial scale of the terrain at a polar angle. */
export function islandEdgeNoise(angle: number, index: number): number {
  const lobe = ISLAND_DEFINITIONS[index]?.lobe ?? 0;
  return (
    1 +
    Math.sin(angle * 2 + index * 2.3) * lobe +
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

/**
 * Water depth in metres used by physics, the depth sounder, wildlife and the
 * ocean shader's colour. The shelf slopes down from the rendered, irregular
 * waterline, so the shallows the animals avoid are the shallows on screen.
 */
export function waterDepthAt(x: number, z: number): number {
  const open = OPEN_WATER_DEPTH + Math.sin(x * 0.006) * 1.7 + Math.cos(z * 0.005) * 1.2;
  const shore = distanceFromWaterline(x, z);
  const depth = shore < SHELF_WIDTH ? Math.min(open, SHORE_DEPTH + Math.max(0, shore) * SHELF_SLOPE) : open;
  return clamp(depth, 0.35, 24);
}

export const ALL_ISLANDS: readonly number[] = ISLAND_DEFINITIONS.map((_, index) => index);
const CANDIDATE_CELL = 200;
const CANDIDATE_HALF_EXTENT = ARCHIPELAGO_RADIUS + 600;
const CANDIDATE_CELLS = Math.ceil((CANDIDATE_HALF_EXTENT * 2) / CANDIDATE_CELL);

/**
 * For each grid cell, the islands that can be the nearest for some point in
 * it: those whose exact lower bound of the waterline distance over the cell
 * does not exceed the smallest upper bound of any island. A query measures
 * only those, and the answer is exactly the nearest coast.
 */
const CANDIDATE_GRID: readonly (readonly number[])[] = (() => {
  const grid: number[][] = [];
  const outer = MAX_EDGE_NOISE * WATERLINE_RADIAL;
  const inner = (2 - MAX_EDGE_NOISE) * WATERLINE_RADIAL;
  for (let row = 0; row < CANDIDATE_CELLS; row += 1) {
    for (let column = 0; column < CANDIDATE_CELLS; column += 1) {
      const minX = -CANDIDATE_HALF_EXTENT + column * CANDIDATE_CELL;
      const minZ = -CANDIDATE_HALF_EXTENT + row * CANDIDATE_CELL;
      const maxX = minX + CANDIDATE_CELL;
      const maxZ = minZ + CANDIDATE_CELL;
      const bounds = ISLAND_DEFINITIONS.map((island) => {
        // Nearest and farthest points of the cell from the centre, in the
        // island's stretched frame (distance to a point is convex, so the
        // farthest is a corner).
        const dx = Math.max(minX - island.centerX, 0, island.centerX - maxX);
        const dz = Math.max(minZ - island.centerZ, 0, island.centerZ - maxZ) / island.scaleZ;
        const farX = Math.max(Math.abs(minX - island.centerX), Math.abs(maxX - island.centerX));
        const farZ = Math.max(Math.abs(minZ - island.centerZ), Math.abs(maxZ - island.centerZ)) / island.scaleZ;
        return {
          lower: Math.hypot(dx, dz) - island.beachRadius * outer,
          upper: Math.hypot(farX, farZ) - island.beachRadius * inner,
        };
      });
      const ceiling = Math.min(...bounds.map((bound) => bound.upper));
      const list: number[] = [];
      bounds.forEach((bound, index) => {
        if (bound.lower <= ceiling) list.push(index);
      });
      grid.push(list);
    }
  }
  return grid;
})();

/** Islands worth measuring near (x, z), or null outside the indexed area. */
export function islandCandidates(x: number, z: number): readonly number[] | null {
  const column = Math.floor((x + CANDIDATE_HALF_EXTENT) / CANDIDATE_CELL);
  const row = Math.floor((z + CANDIDATE_HALF_EXTENT) / CANDIDATE_CELL);
  if (column < 0 || row < 0 || column >= CANDIDATE_CELLS || row >= CANDIDATE_CELLS) return null;
  return CANDIDATE_GRID[row * CANDIDATE_CELLS + column]!;
}

/**
 * Distance in metres from the visible, irregular waterline of the nearest
 * island (negative on the beach). The ocean shader evaluates the same
 * expression so shore foam and shallow-water colour hug the rendered coast.
 */
export function distanceFromWaterline(x: number, z: number): number {
  return waterlineDistanceAmong(x, z, islandCandidates(x, z) ?? ALL_ISLANDS);
}

function waterlineDistanceAmong(x: number, z: number, indices: readonly number[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let item = 0; item < indices.length; item += 1) {
    const index = indices[item]!;
    const island = ISLAND_DEFINITIONS[index]!;
    const dx = x - island.centerX;
    const dz = (z - island.centerZ) / island.scaleZ;
    const centre = Math.hypot(dx, dz);
    // The coast never reaches beyond MAX_EDGE_NOISE of the radius, so an
    // island that cannot beat the nearest found so far is skipped exactly.
    if (centre - island.beachRadius * MAX_EDGE_NOISE * WATERLINE_RADIAL >= nearest) continue;
    const shore = island.beachRadius * islandEdgeNoise(Math.atan2(dz, dx), index) * WATERLINE_RADIAL;
    nearest = Math.min(nearest, centre - shore);
  }
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

/**
 * Metric distance from the rendered waterline (negative on the beach) and the
 * outward shore normal in `normal`. The raw waterline function is measured in
 * the island's stretched frame, so it is divided by its gradient length to
 * give metres in every direction.
 */
export function shoreClearance(x: number, z: number, normal: { x: number; z: number }): number {
  const step = 0.5;
  const value = distanceFromWaterline(x, z);
  const gx = (distanceFromWaterline(x + step, z) - distanceFromWaterline(x - step, z)) / (2 * step);
  const gz = (distanceFromWaterline(x, z + step) - distanceFromWaterline(x, z - step)) / (2 * step);
  const length = Math.hypot(gx, gz);
  if (!(length > 1e-6)) {
    normal.x = 0;
    normal.z = 1;
    return value;
  }
  normal.x = gx / length;
  normal.z = gz / length;
  return value / length;
}
