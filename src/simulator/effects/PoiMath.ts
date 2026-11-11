/**
 * Strange places on the sea, in numbers: where they are, how big, and how
 * close the yacht must come to find them.
 *
 * Besides the volcanic islands (which are islands, see `IslandMath`), the sea
 * holds a party barge lying at anchor with music thumping across the water,
 * the wreck of a pirate galleon stranded on a reef, and a black monolith
 * standing out of open water. Three of them lie within a kilometre of the
 * start; beyond, about one `POI_CELL` square in two holds one, placed by a
 * hash of the square, always in open water. Pure.
 */

export type PoiKind = "barge" | "wreck" | "monolith";
/** Everything the logbook counts as a discovery (volcanoes included). */
export type PlaceKind = PoiKind | "volcano";

export type Poi = {
  /** Stable key (the square, or "home-…"). */
  id: string;
  kind: PoiKind;
  x: number;
  z: number;
  /** Which way she lies, radians (bow toward +Z at 0). */
  heading: number;
};

/** Side of one square of the POI grid, metres (two island cells). */
export const POI_CELL = 2400;
const POI_CHANCE = 0.5;
/** Open water a place needs around it, metres. */
export const POI_CLEARANCE = 140;

/** Half extents of each place's footprint on the water (across, along), metres. */
export const POI_FOOTPRINT: Record<PoiKind, readonly [number, number]> = {
  // A pontoon barge.
  barge: [6, 14],
  // The reef the galleon struck: rocks around the hull.
  wreck: [13, 24],
  // The slab and its plinth of rock under the water.
  monolith: [2.6, 2.6],
};

/** How near a place must come to count as found, metres. */
export const DISCOVERY_RANGE: Record<PlaceKind, number> = {
  barge: 220,
  wreck: 220,
  monolith: 160,
  volcano: 420,
};

/** The three places near the start (moved out to open water if an island is there). */
const HOME: readonly Poi[] = [
  { id: "home-barge", kind: "barge", x: -300, z: -560, heading: 0.6 },
  { id: "home-wreck", kind: "wreck", x: 560, z: 420, heading: 2.2 },
  { id: "home-monolith", kind: "monolith", x: -640, z: 300, heading: 0.3 },
];

function hash(column: number, row: number, salt: number): number {
  let h = Math.imul((column | 0) ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul((h ^ (h >>> 13)) + Math.imul(row | 0, 0x1b873593), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Nearest open water to (x, z) on a widening spiral, or null. */
function settle(x: number, z: number, isOpen: (x: number, z: number) => boolean): { x: number; z: number } | null {
  if (isOpen(x, z)) return { x, z };
  for (let ring = 1; ring <= 8; ring += 1) {
    for (let step = 0; step < 12; step += 1) {
      const angle = (step / 12) * Math.PI * 2 + ring;
      const px = x + Math.cos(angle) * ring * 60;
      const pz = z + Math.sin(angle) * ring * 60;
      if (isOpen(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** The place in POI square (column, row), or null. */
export function poiInCell(column: number, row: number, isOpen: (x: number, z: number) => boolean): Poi | null {
  // The start square holds the home places instead.
  if (column === 0 && row === 0) return null;
  if (hash(column, row, 3) >= POI_CHANCE) return null;
  const kinds: PoiKind[] = ["barge", "wreck", "monolith"];
  const kind = kinds[Math.floor(hash(column, row, 5) * kinds.length) % kinds.length]!;
  const margin = 400;
  const x = column * POI_CELL - POI_CELL / 2 + margin + hash(column, row, 7) * (POI_CELL - 2 * margin);
  const z = row * POI_CELL - POI_CELL / 2 + margin + hash(column, row, 11) * (POI_CELL - 2 * margin);
  const spot = settle(x, z, isOpen);
  if (!spot) return null;
  return { id: `${column}:${row}`, kind, x: spot.x, z: spot.z, heading: hash(column, row, 13) * Math.PI * 2 };
}

const homeCache = new Map<string, Poi | null>();

/** Every place within `radius` of (x, z), nearest first. */
export function poisAround(x: number, z: number, radius: number, isOpen: (x: number, z: number) => boolean): Poi[] {
  const found: { poi: Poi; distance: number }[] = [];
  const consider = (poi: Poi | null): void => {
    if (!poi) return;
    const distance = Math.hypot(poi.x - x, poi.z - z);
    if (distance <= radius) found.push({ poi, distance });
  };
  for (const home of HOME) {
    if (!homeCache.has(home.id)) {
      const spot = settle(home.x, home.z, isOpen);
      homeCache.set(home.id, spot ? { ...home, x: spot.x, z: spot.z } : null);
    }
    consider(homeCache.get(home.id) ?? null);
  }
  const first = Math.floor((x - radius) / POI_CELL + 0.5);
  const last = Math.floor((x + radius) / POI_CELL + 0.5);
  const top = Math.floor((z - radius) / POI_CELL + 0.5);
  const bottom = Math.floor((z + radius) / POI_CELL + 0.5);
  for (let row = top; row <= bottom; row += 1) {
    for (let column = first; column <= last; column += 1) consider(poiInCell(column, row, isOpen));
  }
  found.sort((a, b) => a.distance - b.distance);
  return found.map((entry) => entry.poi);
}

/**
 * Distance from (x, z) to a place's footprint (an ellipse for the reef, a
 * rectangle with rounded corners otherwise), negative inside, and the
 * outward normal there.
 */
export function poiClearance(poi: Poi, x: number, z: number, normal: { x: number; z: number }): number {
  const [halfAcross, halfAlong] = POI_FOOTPRINT[poi.kind];
  const forwardX = Math.sin(poi.heading);
  const forwardZ = Math.cos(poi.heading);
  const dx = x - poi.x;
  const dz = z - poi.z;
  const along = dx * forwardX + dz * forwardZ;
  const across = dx * forwardZ - dz * forwardX;
  let localAlong: number;
  let localAcross: number;
  let distance: number;
  if (poi.kind === "wreck") {
    // Ellipse, approximated by scaling to a circle.
    const scaled = Math.hypot(across / halfAcross, along / halfAlong);
    const size = Math.min(halfAcross, halfAlong) * (0.6 + 0.4 * Math.min(1, scaled));
    distance = (scaled - 1) * size;
    localAcross = across / (halfAcross * halfAcross);
    localAlong = along / (halfAlong * halfAlong);
  } else {
    const outsideAcross = Math.abs(across) - halfAcross;
    const outsideAlong = Math.abs(along) - halfAlong;
    const outside = Math.hypot(Math.max(outsideAcross, 0), Math.max(outsideAlong, 0));
    distance = outside + Math.min(Math.max(outsideAcross, outsideAlong), 0);
    if (outside > 0) {
      localAcross = Math.max(outsideAcross, 0) * Math.sign(across);
      localAlong = Math.max(outsideAlong, 0) * Math.sign(along);
    } else if (outsideAcross > outsideAlong) {
      localAcross = Math.sign(across) || 1;
      localAlong = 0;
    } else {
      localAcross = 0;
      localAlong = Math.sign(along) || 1;
    }
  }
  const nx = localAcross * forwardZ + localAlong * forwardX;
  const nz = -localAcross * forwardX + localAlong * forwardZ;
  const length = Math.hypot(nx, nz) || 1;
  normal.x = nx / length;
  normal.z = nz / length;
  return distance;
}

/** Nearest footprint among `pois` (1e6 if none), writing its outward normal. */
export function nearestPoiClearance(pois: readonly Poi[], x: number, z: number, normal: { x: number; z: number }): number {
  let nearest = 1e6;
  let nx = 0;
  let nz = 1;
  for (const poi of pois) {
    if (Math.abs(poi.x - x) > 120 || Math.abs(poi.z - z) > 120) continue;
    const distance = poiClearance(poi, x, z, normal);
    if (distance < nearest) {
      nearest = distance;
      nx = normal.x;
      nz = normal.z;
    }
  }
  normal.x = nx;
  normal.z = nz;
  return nearest;
}
