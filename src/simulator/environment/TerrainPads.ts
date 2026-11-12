/**
 * Ground the story levels it: a terrain pad is a rectangle of an island
 * flattened to a height (the yard of an outpost, a camp's clearing), the
 * terrain easing back to its natural shape over `blend` metres round it,
 * and nothing — no palm, shrub, rock or grass — growing on it or within
 * `clear` metres of it.
 *
 * Pads are world data, registered once before the islands are built
 * (`setTerrainPads`), and read by the terrain's height (`IslandSystem`) and
 * by everything that places vegetation (`islandClearings`). Pure.
 */

export type TerrainPad = {
  id: string;
  /** Centre, world metres. */
  x: number;
  z: number;
  /** Half extents along the pad's own axes, m. */
  halfX: number;
  halfZ: number;
  /** The pad's +x axis, radians from world +x toward world +z. */
  angle: number;
  /** Height of the levelled ground, m above mean sea level. */
  height: number;
  /** Width of the slope back to the natural ground, m. */
  blend: number;
  /** Nothing grows within this many metres outside the rectangle (default 2). */
  clear?: number;
  /** Only lower the ground to `height` (a cut), never raise it. */
  cutOnly?: boolean;
};

let pads: readonly TerrainPad[] = [];
let revision = 0;

/** The story's pads (replaces any set before); returns the revision, for caches keyed on it. */
export function setTerrainPads(list: readonly TerrainPad[]): number {
  pads = [...list];
  revision += 1;
  return revision;
}

export function terrainPads(): readonly TerrainPad[] {
  return pads;
}

export function terrainPadRevision(): number {
  return revision;
}

/** Signed distance from (x, z) to the pad's rectangle (negative inside), m. */
export function padDistance(pad: TerrainPad, x: number, z: number): number {
  const dx = x - pad.x;
  const dz = z - pad.z;
  const cos = Math.cos(pad.angle);
  const sin = Math.sin(pad.angle);
  const u = Math.abs(dx * cos + dz * sin) - pad.halfX;
  const v = Math.abs(-dx * sin + dz * cos) - pad.halfZ;
  const outside = Math.hypot(Math.max(u, 0), Math.max(v, 0));
  return outside > 0 ? outside : Math.max(u, v);
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** The ground at (x, z) with the pads applied to the natural height `natural`. */
export function padHeight(x: number, z: number, natural: number): number {
  if (pads.length === 0) return natural;
  let height = natural;
  for (const pad of pads) {
    const reach = Math.max(pad.halfX, pad.halfZ) + pad.blend;
    if (Math.abs(x - pad.x) > reach * 1.5 || Math.abs(z - pad.z) > reach * 1.5) continue;
    const distance = padDistance(pad, x, z);
    if (distance >= pad.blend) continue;
    const weight = 1 - smooth(distance / pad.blend);
    const target = pad.cutOnly ? Math.min(pad.height, height) : pad.height;
    height = height + (target - height) * weight;
  }
  return height;
}

/** Whether (x, z) is on a pad or within its cleared margin (plus `margin`). */
export function inPadClearing(x: number, z: number, margin = 0): boolean {
  for (const pad of pads) {
    const reach = Math.max(pad.halfX, pad.halfZ) + (pad.clear ?? 2) + margin;
    if (Math.abs(x - pad.x) > reach * 1.5 || Math.abs(z - pad.z) > reach * 1.5) continue;
    if (padDistance(pad, x, z) < (pad.clear ?? 2) + margin) return true;
  }
  return false;
}

/** Distance from (x, z) to the nearest pad's cleared edge (negative inside), m; Infinity with none near. */
export function padClearingEdge(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const pad of pads) {
    const reach = Math.max(pad.halfX, pad.halfZ) + (pad.clear ?? 2) + 8;
    if (Math.abs(x - pad.x) > reach * 1.5 || Math.abs(z - pad.z) > reach * 1.5) continue;
    best = Math.min(best, padDistance(pad, x, z) - (pad.clear ?? 2));
  }
  return best;
}
