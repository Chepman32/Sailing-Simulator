import { distanceFromWaterline, islandsInCell, onLavaFlow, type IslandDefinition } from "../environment/IslandMath";
import { poiInCell, poisAround, type PlaceKind } from "../effects/PoiMath";

/**
 * Fast travel to a place found before, in numbers. A place out at sea (the
 * party barge, the wreck, the monolith) is reached aboard: the yacht comes
 * to lie in open water off it, her bow toward it. A place ashore (a
 * volcano's island, a trader's porch) is reached on foot: the skipper stands
 * on the beach (by the trader, who turns to greet him), and the yacht lies at
 * anchor in the nearest open water off that spot, ready for when he wants
 * her. Pure; `Simulator.fastTravel` moves them.
 */

export type TravelKind = PlaceKind | "trader";

export type TravelDestination = {
  /** The logbook's key of the place (`volcano:…`, `wreck:…`), or `trader:<island id>`. */
  key: string;
  kind: TravelKind;
  /** Where the place is (the chart's marker), m. */
  x: number;
  z: number;
  /** Aboard the yacht (a place on the water) or on foot (a place ashore). */
  by: "yacht" | "foot";
};

/** How far into the beach from the waterline a walker is set down, m. */
export const LANDING_INLAND = 7;
/** How far in front of a trader the walker stands, m. */
export const TRADER_GREETING = 3.2;

/** The island with the given id (ids encode their cell), or null. */
export function islandById(id: number): IslandDefinition | null {
  if (!Number.isFinite(id) || id < 0) return null;
  const key = Math.floor(id / 8);
  const column = Math.floor(key / 16384) - 8192;
  const row = (key % 16384) - 8192;
  return islandsInCell(column, row).find((island) => island.id === id) ?? null;
}

/**
 * Where a logbook entry lies and how it is reached, or null for a key that
 * no longer names anything (`isOpen` vets open water, as the places use).
 */
export function placeDestination(key: string, isOpen: (x: number, z: number) => boolean): TravelDestination | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const kind = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (kind === "volcano") {
    const island = islandById(Number(id));
    return island ? { key, kind: "volcano", x: island.centerX, z: island.centerZ, by: "foot" } : null;
  }
  if (kind !== "barge" && kind !== "wreck" && kind !== "monolith") return null;
  let poi = null;
  if (id.startsWith("home-")) {
    poi = poisAround(0, 0, 1200, isOpen).find((entry) => entry.id === id) ?? null;
  } else {
    const [column, row] = id.split(":").map(Number);
    if (Number.isFinite(column) && Number.isFinite(row)) poi = poiInCell(column!, row!, isOpen);
  }
  if (!poi || poi.kind !== kind) return null;
  return { key, kind: poi.kind, x: poi.x, z: poi.z, by: "yacht" };
}

/** Where a walker comes to stand before a trader (his porch at `spot`, looking out along `facing`), and which way he faces. */
export function traderLanding(spot: { x: number; z: number; facing: number }): { x: number; z: number; yaw: number } {
  const x = spot.x + Math.sin(spot.facing) * TRADER_GREETING;
  const z = spot.z + Math.cos(spot.facing) * TRADER_GREETING;
  return { x, z, yaw: Math.atan2(spot.x - x, spot.z - z) };
}

/**
 * A spot on an island's beach `LANDING_INLAND` metres in from the water,
 * on the side facing `from` (where the traveller comes from) if it can be,
 * clear of the lava, facing inland; null if no side will do.
 */
export function beachLanding(island: IslandDefinition, from: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
  const toward = Math.atan2(from.x - island.centerX, from.z - island.centerZ);
  const reach = island.beachRadius * Math.max(1, island.scaleZ) * 1.6 + 60;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    // Toward the traveller first, then fanning out either side.
    const swing = Math.ceil(attempt / 2) * 0.26 * (attempt % 2 === 0 ? 1 : -1);
    const bearing = toward + swing;
    const dirX = Math.sin(bearing);
    const dirZ = Math.cos(bearing);
    // Along the bearing, from the centre (inland) out to the open sea: where
    // the shore lies `LANDING_INLAND` behind the waterline.
    let inner = 0;
    let outer = reach;
    if (distanceFromWaterline(island.centerX + dirX * outer, island.centerZ + dirZ * outer) < 0) continue;
    for (let step = 0; step < 28; step += 1) {
      const middle = (inner + outer) / 2;
      const off = distanceFromWaterline(island.centerX + dirX * middle, island.centerZ + dirZ * middle);
      if (off < -LANDING_INLAND) inner = middle;
      else outer = middle;
    }
    const x = island.centerX + dirX * inner;
    const z = island.centerZ + dirZ * inner;
    if (onLavaFlow(island, x, z, 6)) continue;
    return { x, z, yaw: Math.atan2(island.centerX - x, island.centerZ - z) };
  }
  return null;
}
