import { distanceFromWaterline, islandsInCell, WORLD_CELL, type IslandDefinition } from "../environment/IslandMath";
import { islandProfile, traderSpot } from "../environment/IslandProps";
import { traderLanding, beachLanding } from "../map/TravelMath";
import { findOpenWater } from "../vessel/RescueMath";
import type { Campaign, ChartPoint, Location, Sector } from "./StoryTypes";

/**
 * The campaign's map in world terms, and its places fitted to the
 * procedural sea. Pure and deterministic: the same campaign data always
 * resolve to the same islands, beaches and anchorages, so the tests, the
 * chart and the game agree.
 *
 * World x is west (−east), z is north (see AGENTS.md §5).
 */

export function toWorld(point: ChartPoint): { x: number; z: number } {
  return { x: -point[0], z: point[1] };
}

/** A sector's or the zone's outline as world (x, z) pairs, flattened. */
export type Outline = { points: Float64Array; minX: number; maxX: number; minZ: number; maxZ: number };

export type Atlas = {
  sectors: { sector: Sector; outline: Outline }[];
  zone: Outline;
};

/** The chart points of a ring of borders, junctions counted once. */
export function ringPoints(campaign: Campaign, ring: readonly { border: string; reverse?: boolean }[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const { border, reverse } of ring) {
    const found = campaign.borders.find((entry) => entry.id === border);
    if (!found) throw new Error(`Unknown border "${border}"`);
    const points = reverse ? [...found.points].reverse() : found.points;
    for (const point of points) {
      const last = out[out.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      out.push(point);
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function outlineOf(points: readonly ChartPoint[]): Outline {
  const flat = new Float64Array(points.length * 2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  points.forEach((point, index) => {
    const x = -point[0];
    const z = point[1];
    flat[index * 2] = x;
    flat[index * 2 + 1] = z;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  });
  return { points: flat, minX, maxX, minZ, maxZ };
}

export function buildAtlas(campaign: Campaign): Atlas {
  return {
    sectors: campaign.sectors.map((sector) => ({ sector, outline: outlineOf(ringPoints(campaign, sector.ring)) })),
    zone: outlineOf(ringPoints(campaign, campaign.quarantine)),
  };
}

/** Even-odd test of a point against an outline. */
export function insideOutline(outline: Outline, x: number, z: number): boolean {
  if (x < outline.minX || x > outline.maxX || z < outline.minZ || z > outline.maxZ) return false;
  const points = outline.points;
  const count = points.length / 2;
  let inside = false;
  for (let index = 0, previous = count - 1; index < count; previous = index, index += 1) {
    const xi = points[index * 2]!;
    const zi = points[index * 2 + 1]!;
    const xj = points[previous * 2]!;
    const zj = points[previous * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to an outline's edge, m (positive whichever side). */
export function distanceToOutline(outline: Outline, x: number, z: number): number {
  const points = outline.points;
  const count = points.length / 2;
  let best = Infinity;
  for (let index = 0, previous = count - 1; index < count; previous = index, index += 1) {
    const ax = points[previous * 2]!;
    const az = points[previous * 2 + 1]!;
    const bx = points[index * 2]!;
    const bz = points[index * 2 + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const length = dx * dx + dz * dz;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

/** The sector a world point lies in, or null outside the quarantine zone. */
export function sectorAt(atlas: Atlas, x: number, z: number): Sector | null {
  if (!insideOutline(atlas.zone, x, z)) return null;
  for (const entry of atlas.sectors) if (insideOutline(entry.outline, x, z)) return entry.sector;
  // On a border to the last millimetre: the nearest sector.
  let best: Sector | null = null;
  let distance = Infinity;
  for (const entry of atlas.sectors) {
    const away = distanceToOutline(entry.outline, x, z);
    if (away < distance) {
      distance = away;
      best = entry.sector;
    }
  }
  return best;
}

// --- Places fitted to the sea ------------------------------------------------

/** A story place in the world: where it is, the island it is on (if any), where a walker stands there. */
export type Place = {
  id: string;
  x: number;
  z: number;
  radius: number;
  island: IslandDefinition | null;
  /** Where a walker is set down, and which way he faces (null for a place at sea). */
  landing: { x: number; z: number; yaw: number } | null;
  /** A trader's porch, for a person who stands there. */
  porch: { x: number; z: number; facing: number } | null;
};

/** Open water this far from any shore counts for an anchorage or a place at sea, m. */
export const PLACE_WATER_CLEARANCE = 45;

function islandsNear(x: number, z: number, reach: number): IslandDefinition[] {
  const out: IslandDefinition[] = [];
  const cells = Math.ceil(reach / WORLD_CELL);
  const column = Math.floor(x / WORLD_CELL);
  const row = Math.floor(z / WORLD_CELL);
  for (let dc = -cells; dc <= cells; dc += 1) for (let dr = -cells; dr <= cells; dr += 1) out.push(...islandsInCell(column + dc, row + dr));
  return out;
}

function nearestIsland(x: number, z: number, accept: (island: IslandDefinition) => boolean, reach = 1500): IslandDefinition | null {
  let best: IslandDefinition | null = null;
  let distance = Infinity;
  for (const island of islandsNear(x, z, reach)) {
    if (!accept(island)) continue;
    const away = Math.hypot(island.centerX - x, island.centerZ - z);
    if (away < distance) {
      distance = away;
      best = island;
    }
  }
  return best;
}

const pureClearance = (x: number, z: number, normal: { x: number; z: number }): number => {
  const here = distanceFromWaterline(x, z);
  const east = distanceFromWaterline(x + 2, z);
  const north = distanceFromWaterline(x, z + 2);
  const gx = east - here;
  const gz = north - here;
  const length = Math.hypot(gx, gz) || 1;
  normal.x = gx / length;
  normal.z = gz / length;
  return here;
};

/** The nearest open water to (x, z), well clear of every shore. */
export function openWaterNear(x: number, z: number, need = PLACE_WATER_CLEARANCE): { x: number; z: number } {
  if (distanceFromWaterline(x, z) >= need) return { x, z };
  return findOpenWater(x, z, pureClearance, need) ?? { x, z };
}

/** The point toward the zone's heart (the caldera) from a place: which side of an island a story lands on by default. */
const HEART = toWorld([-856, -14]);

/** Where a story place is in the world. */
export function resolvePlace(location: Location): Place {
  const base = toWorld(location.at);
  const empty = { island: null, landing: null, porch: null };
  if (location.snap === "point") return { id: location.id, ...base, radius: location.radius, ...empty };
  if (location.snap === "water") {
    const water = openWaterNear(base.x, base.z);
    return { id: location.id, ...water, radius: location.radius, ...empty };
  }
  if (location.snap === "pier") {
    const island = nearestIsland(base.x, base.z, (entry) => traderSpot(entry, islandProfile(entry)) !== null, 2500);
    const porch = island ? traderSpot(island, islandProfile(island)) : null;
    if (island && porch) {
      return { id: location.id, x: porch.x, z: porch.z, radius: location.radius, island, landing: traderLanding(porch), porch };
    }
    return { id: location.id, ...base, radius: location.radius, ...empty };
  }
  const island = nearestIsland(base.x, base.z, () => true);
  if (!island) return { id: location.id, ...base, radius: location.radius, ...empty };
  const away = Math.hypot(base.x - island.centerX, base.z - island.centerZ);
  const from = away > 5 ? base : { x: island.centerX + (HEART.x - island.centerX) * 10, z: island.centerZ + (HEART.z - island.centerZ) * 10 };
  return { id: location.id, x: island.centerX, z: island.centerZ, radius: location.radius, island, landing: beachLanding(island, from), porch: null };
}

/** The shelf this far out from the waterline lies some 8–9 m deep: a diver's reach. */
export const SEABED_ITEM_OFFSHORE = 18;

/**
 * A point on the sea floor near a place, on the shelf of the nearest island
 * on the side toward the place: where a sunken thing lies within a dive.
 */
export function seabedNear(x: number, z: number): { x: number; z: number } {
  const island = nearestIsland(x, z, () => true);
  if (!island) return { x, z };
  let dirX = x - island.centerX;
  let dirZ = z - island.centerZ;
  const length = Math.hypot(dirX, dirZ) || 1;
  dirX /= length;
  dirZ /= length;
  let inner = 0;
  let outer = island.beachRadius * Math.max(1, island.scaleZ) * 1.6 + 120;
  for (let step = 0; step < 32; step += 1) {
    const middle = (inner + outer) / 2;
    if (distanceFromWaterline(island.centerX + dirX * middle, island.centerZ + dirZ * middle) < SEABED_ITEM_OFFSHORE) inner = middle;
    else outer = middle;
  }
  return { x: island.centerX + dirX * inner, z: island.centerZ + dirZ * inner };
}
