import { clamp } from "../math";

/**
 * Pure island geometry shared by collision, bathymetry, terrain meshing and
 * the ocean shader. Keeping it free of rendering imports lets the same
 * definitions be unit-tested and compiled into GLSL constants.
 *
 * The world has no edge. It is cut into square cells of {@link WORLD_CELL}
 * metres; every cell holds at least one island (its "primary") and now and
 * then a cay or two more, all placed deterministically from the cell's
 * coordinates. An island never reaches the edge of its cell (see
 * {@link cellMargin}), so islands of neighbouring cells can never touch and
 * a query only has to look at the nine cells around a point.
 */
export type IslandDefinition = {
  /** Unique and stable for a given place in the world; the key of every per-island cache. */
  id: number;
  /** Small number that seeds this island's coastline and surf phases (kept small for GLSL). */
  seed: number;
  centerX: number;
  centerZ: number;
  beachRadius: number;
  /** The island is an ellipse: its Z extent is `beachRadius × scaleZ`. */
  scaleZ: number;
  /** Height of the summit above mean sea level, metres. */
  height: number;
  /** Two-lobed bulge of the coastline (0 = none), as a fraction of the radius. */
  lobe: number;
  /** A volcanic island: a smoking cone with a crater, black sand, lava (see VolcanoSystem). */
  volcano?: boolean;
};

/**
 * Cells whose primary island is a volcano: the one east of the start (seen
 * smoking on the horizon from the first moment), and about one cell in ten
 * elsewhere.
 */
export function isVolcanoCell(column: number, row: number): boolean {
  if (column === 1 && row === 0) return true;
  if (Math.abs(column) + Math.abs(row) <= 1) return false;
  return hashCell(column * 31 + 7, row * 17 - 3) % 1000 < 100;
}

/** Radial position (fraction of the beach radius) of the crater rim and the foot of the cone. */
export const VOLCANO_RIM = 0.14;
export const VOLCANO_FOOT = 0.84;
/** How deep the crater floor lies below the rim, as a fraction of the height. */
export const VOLCANO_CRATER_DEPTH = 0.16;

/**
 * Height of a volcano's cone at `radial` (fraction of the beach radius) and
 * `angle`, metres: concave slopes rising ever steeper to the rim, gullies
 * cut down the flanks, a bowl of a crater at the top.
 */
export function volcanoHeight(radial: number, angle: number, height: number, seed: number): number {
  const base = 1.36;
  const rise = Math.max(0, height - base);
  if (radial >= VOLCANO_FOOT) return base;
  if (radial > VOLCANO_RIM) {
    const t = (VOLCANO_FOOT - radial) / (VOLCANO_FOOT - VOLCANO_RIM);
    const cone = Math.pow(t, 1.45);
    // Ridges and erosion gullies running down the flanks, sharper higher up.
    const gullies =
      (Math.sin(angle * 7 + seed * 1.7) * 0.45 +
        Math.sin(angle * 17 - seed + radial * 6) * 0.35 +
        Math.abs(Math.sin(angle * 31 + seed * 0.3 + radial * 14)) * 0.5 - 0.25) *
      t * (1 - t) * rise * 0.16;
    const lip = Math.exp(-Math.pow((radial - VOLCANO_RIM) / 0.03, 2)) * rise * 0.025;
    return base + rise * cone + gullies + lip;
  }
  // Inside the rim: down into the crater.
  const inside = radial / VOLCANO_RIM;
  const bowl = 1 - VOLCANO_CRATER_DEPTH * (1 - inside * inside);
  return base + rise * bowl;
}

/** Mean open-water depth in metres. */
export const OPEN_WATER_DEPTH = 17.5;
/** Width of the sloping shelf around each beach in metres. */
export const SHELF_WIDTH = 34;
export const SHORE_DEPTH = 0.38;
export const SHELF_SLOPE = 0.46;
/** Terrain radius (as a fraction of the beach radius) where sand meets still water. */
export const WATERLINE_RADIAL = 0.975;

/** Side of one world cell, metres: there is an island in every one, so one lies every 1–2 km. */
export const WORLD_CELL = 1200;
/** Open water kept between two islands' shelves, metres. */
const ISLAND_CHANNEL = 70;
/** Largest island seed (exclusive). */
const SEED_RANGE = 96;

/** A small, fast, deterministic generator (mulberry32). */
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

function hashCell(column: number, row: number): number {
  // Two avalanche rounds, so neighbouring and mirrored cells share no stream.
  let h = Math.imul((column | 0) ^ 0x5a11ab1e, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  h = Math.imul((h ^ (h >>> 13)) + (row | 0) * 0x27d4eb2d, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The three islands closest to the start (cell 0, 0); the rest of that cell is generated around them. */
const HOME_ISLANDS: readonly Omit<IslandDefinition, "id" | "seed">[] = [
  { centerX: -115, centerZ: -65, beachRadius: 54, scaleZ: 0.72, height: 1.78, lobe: 0 },
  { centerX: 138, centerZ: -28, beachRadius: 46, scaleZ: 0.82, height: 1.96, lobe: 0 },
  { centerX: 25, centerZ: 175, beachRadius: 36, scaleZ: 0.68, height: 2.14, lobe: 0 },
];

/** How far out the starting archipelago is listed (see {@link START_ISLANDS}), metres. */
export const ARCHIPELAGO_RADIUS = 2600;

/** Index of the world cell containing the coordinate `v`. Cell (0, 0) is centred on the start. */
export function worldCell(v: number): number {
  return Math.floor((v + WORLD_CELL / 2) / WORLD_CELL);
}

/** How far from the edge of its cell an island's centre must stay so no two islands of different cells conflict. */
function cellMargin(reach: number): number {
  return reach + SHELF_WIDTH + ISLAND_CHANNEL / 2;
}

const reachOf = (island: Pick<IslandDefinition, "beachRadius" | "scaleZ">): number =>
  island.beachRadius * Math.max(1, island.scaleZ);

function cellKey(column: number, row: number): number {
  return (column + 8192) * 16384 + (row + 8192);
}

function islandId(column: number, row: number, slot: number): number {
  return cellKey(column, row) * 8 + slot;
}

/**
 * Generates the islands of one cell: a primary island of any size (mostly
 * cays and islets, some wooded islands, one in eight a large high island)
 * and, at random, one or two more. Placement is deterministic, so physics,
 * the ocean shader and the terrain all see the same world on every load.
 */
function generateCell(column: number, row: number): IslandDefinition[] {
  const random = seededRandom(hashCell(column, row));
  const centerX = column * WORLD_CELL;
  const centerZ = row * WORLD_CELL;
  const islands: IslandDefinition[] = [];
  const start = column === 0 && row === 0;
  if (start) {
    HOME_ISLANDS.forEach((home, slot) => {
      islands.push({ ...home, id: islandId(column, row, slot), seed: slot });
    });
  }
  const roll = random();
  const extras = roll < 0.42 ? 0 : roll < 0.78 ? 1 : 2;
  let volcano = isVolcanoCell(column, row);
  const wanted = (start ? HOME_ISLANDS.length : 1) + extras;
  let attempts = 0;
  while (islands.length < wanted && attempts < 80) {
    attempts += 1;
    const size = random();
    // Mostly small; one in eight is a large, high island. A volcano is big and round.
    let beachRadius = size < 0.55 ? 16 + random() * 22 : size < 0.875 ? 38 + random() * 30 : 72 + random() * 46;
    let scaleZ = 0.55 + random() * 0.95;
    if (volcano) {
      beachRadius = 150 + size * 40;
      scaleZ = 0.86 + random() * 0.28;
    }
    const reach = beachRadius * Math.max(1, scaleZ);
    const margin = cellMargin(reach);
    const x = centerX - WORLD_CELL / 2 + margin + random() * (WORLD_CELL - 2 * margin);
    const z = centerZ - WORLD_CELL / 2 + margin + random() * (WORLD_CELL - 2 * margin);
    const height = volcano
      ? 64 + random() * 22
      : beachRadius < 38 ? 1.5 + random() * 0.9 : beachRadius < 70 ? 2.4 + random() * 2.4 : 5 + random() * 8;
    const lobe = random() * 0.04;
    const seed = Math.floor(random() * SEED_RANGE);
    const clear = islands.every((other) => {
      return Math.hypot(x - other.centerX, z - other.centerZ) > reach + reachOf(other) + 2 * SHELF_WIDTH + ISLAND_CHANNEL;
    });
    // The start itself is open water, as it always was.
    if (!clear || (start && Math.hypot(x, z) < reach + SHELF_WIDTH + 160)) continue;
    islands.push({
      id: islandId(column, row, islands.length),
      seed,
      centerX: x,
      centerZ: z,
      beachRadius,
      scaleZ,
      height,
      lobe,
      ...(volcano ? { volcano: true } : {}),
    });
    volcano = false;
  }
  return islands;
}

const CELL_CACHE_LIMIT = 4096;
const cellCache = new Map<number, readonly IslandDefinition[]>();
const aroundCache = new Map<number, readonly IslandDefinition[]>();

/** The islands of one world cell. */
export function islandsInCell(column: number, row: number): readonly IslandDefinition[] {
  const key = cellKey(column, row);
  let cell = cellCache.get(key);
  if (!cell) {
    if (cellCache.size >= CELL_CACHE_LIMIT) {
      // Cells regenerate identically, so the oldest half can simply go.
      let drop = CELL_CACHE_LIMIT / 2;
      for (const old of cellCache.keys()) {
        cellCache.delete(old);
        if (--drop <= 0) break;
      }
    }
    cell = generateCell(column, row);
    cellCache.set(key, cell);
  }
  return cell;
}

/** The islands of the nine cells around the one containing (x, z): every island that can be nearest to the point. */
export function islandsAround(x: number, z: number): readonly IslandDefinition[] {
  const column = worldCell(x);
  const row = worldCell(z);
  const key = cellKey(column, row);
  let around = aroundCache.get(key);
  if (!around) {
    if (aroundCache.size >= CELL_CACHE_LIMIT) {
      let drop = CELL_CACHE_LIMIT / 2;
      for (const old of aroundCache.keys()) {
        aroundCache.delete(old);
        if (--drop <= 0) break;
      }
    }
    const list: IslandDefinition[] = [];
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) list.push(...islandsInCell(column + dx, row + dz));
    }
    around = list;
    aroundCache.set(key, around);
  }
  return around;
}

/** Every island whose beach lies within `radius` metres of (x, z), nearest first. */
export function islandsWithin(x: number, z: number, radius: number): IslandDefinition[] {
  const cells = Math.ceil((radius + WORLD_CELL / 2) / WORLD_CELL);
  const column = worldCell(x);
  const row = worldCell(z);
  const found: { island: IslandDefinition; gap: number }[] = [];
  for (let dz = -cells; dz <= cells; dz += 1) {
    for (let dx = -cells; dx <= cells; dx += 1) {
      for (const island of islandsInCell(column + dx, row + dz)) {
        const gap = Math.hypot(x - island.centerX, (z - island.centerZ) / island.scaleZ) * Math.min(1, island.scaleZ) - island.beachRadius;
        if (gap <= radius) found.push({ island, gap });
      }
    }
  }
  return found.sort((a, b) => a.gap - b.gap).map((entry) => entry.island);
}

/**
 * The archipelago around the start, the home islands first: what a sailor
 * sees in the first minutes, and a stable set for tests.
 */
export const START_ISLANDS: readonly IslandDefinition[] = (() => {
  const homes = islandsInCell(0, 0).slice(0, HOME_ISLANDS.length);
  const rest = islandsWithin(0, 0, ARCHIPELAGO_RADIUS).filter((island) => !homes.includes(island));
  return [...homes, ...rest];
})();

/**
 * Islands the shaders evaluate at any moment: the nearest few to the yacht.
 * The rest are too far off for their shallows, surf or wet sand to show.
 */
export const ISLAND_SLOTS = 8;

/**
 * Fills the shader slots with the islands nearest (x, z), nearest first.
 * `shape` receives (centre x, centre z, beach radius, scale z) and `frame`
 * (island seed, lobe, 0, 0) per slot; unused slots hold an island far away.
 */
export function selectIslandSlots(x: number, z: number, shape: Float32Array, frame: Float32Array): void {
  const order = islandsAround(x, z)
    .map((island) => ({
      island,
      distance:
        Math.hypot(x - island.centerX, (z - island.centerZ) / island.scaleZ) * Math.min(1, island.scaleZ) -
        island.beachRadius,
    }))
    .sort((a, b) => a.distance - b.distance);
  for (let slot = 0; slot < ISLAND_SLOTS; slot += 1) {
    const entry = order[slot];
    const island = entry?.island;
    shape[slot * 4] = island ? island.centerX : 1.0e6;
    shape[slot * 4 + 1] = island ? island.centerZ : 1.0e6;
    shape[slot * 4 + 2] = island ? island.beachRadius : 1;
    shape[slot * 4 + 3] = island ? island.scaleZ : 1;
    frame[slot * 4] = island ? island.seed : 0;
    frame[slot * 4 + 1] = island ? island.lobe : 0;
    frame[slot * 4 + 2] = 0;
    frame[slot * 4 + 3] = 0;
  }
}

/** Largest outward excursion of the coastline noise above the nominal ellipse. */
export const MAX_EDGE_NOISE = 1.073 + 0.04;

/** Irregular coastline: radial scale of the terrain at a polar angle. */
export function islandEdgeNoise(angle: number, island: Pick<IslandDefinition, "seed" | "lobe">): number {
  const seed = island.seed;
  return (
    1 +
    Math.sin(angle * 2 + seed * 2.3) * island.lobe +
    Math.sin(angle * 3 + seed * 1.7) * 0.038 +
    Math.sin(angle * 7 - seed * 0.9) * 0.023 +
    Math.cos(angle * 11 + seed * 0.6) * 0.012
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

/**
 * Distance in metres from the visible, irregular waterline of the nearest
 * island (negative on the beach). The ocean shader evaluates the same
 * expression so shore foam and shallow-water colour hug the rendered coast.
 * Exact wherever an island is within about a kilometre; farther out it is the
 * distance to the nearest island of the nine cells around the point.
 */
export function distanceFromWaterline(x: number, z: number): number {
  return waterlineDistanceAmong(x, z, islandsAround(x, z));
}

function waterlineDistanceAmong(x: number, z: number, islands: readonly IslandDefinition[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < islands.length; index += 1) {
    const island = islands[index]!;
    const dx = x - island.centerX;
    const dz = (z - island.centerZ) / island.scaleZ;
    const centre = Math.hypot(dx, dz);
    // The coast never reaches beyond MAX_EDGE_NOISE of the radius, so an
    // island that cannot beat the nearest found so far is skipped exactly.
    if (centre - island.beachRadius * MAX_EDGE_NOISE * WATERLINE_RADIAL >= nearest) continue;
    const shore = island.beachRadius * islandEdgeNoise(Math.atan2(dz, dx), island) * WATERLINE_RADIAL;
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
