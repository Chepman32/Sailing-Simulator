import type { ShipKind, ShipSpec } from "./ShipMath";

/**
 * How an imported ship model is fitted to the simulation, as pure numbers.
 *
 * A downloaded model comes in its author's frame: any axis may be the bow,
 * any unit may be a metre, the keel or the waterline may be at zero, and the
 * scene often carries a sea plane under the hull. These helpers decide which
 * meshes are the sea, how to turn the model so its bow lies along +Z, how far
 * to scale it so its length is the type's real length, and where to put it so
 * it floats at its draught. `ShipModels` applies the result.
 */

/** The model's own axis that points from stern to bow. */
export type BowAxis = "+x" | "-x" | "+z" | "-z";

export type ShipModelSource = {
  /** Published URL of the optimized GLB under `public/`. */
  url: string;
  /** Stern-to-bow axis in the model's own frame. */
  bow: BowAxis;
  /**
   * Height of the waterline above the lowest point of the hull, as a fraction
   * of the draught (1 = the model is a full hull, keel included; 0 = the
   * model is cut off at the waterline). Default 1.
   */
  keel?: number;
  /**
   * Height of the model's own waterline in its own units, when the author
   * modelled it (it overrides `keel`): read off the boot top or antifouling.
   */
  waterline?: number;
  /** Credit line kept with the model (CC BY attribution). */
  credit: string;
};

const SKETCHFAB = "https://sketchfab.com/3d-models/";

/** The 3D models used for each kind, in turn; an empty list keeps the procedural ship. */
export const SHIP_MODELS: Record<ShipKind, readonly ShipModelSource[]> = {
  container: [
    {
      url: "/models/ships/container-rm02.glb",
      bow: "+x",
      waterline: 4.3,
      credit: `“Container Ship” by RM02, CC BY 4.0, ${SKETCHFAB}container-ship-aaa41cca946b4a08bc08cf692b7757be`,
    },
  ],
  tanker: [
    {
      url: "/models/ships/tanker-artblender.glb",
      bow: "-z",
      waterline: 0,
      credit: `“Tanker Ship” by Art Blender, CC BY 4.0, ${SKETCHFAB}tanker-ship-96ebf61af42b4062ae98a6ad848e1a25`,
    },
  ],
  cruise: [
    {
      url: "/models/ships/cruise-siuliano.glb",
      bow: "-z",
      waterline: 23,
      credit: `“Finished Cruise Ship” by siuliano, CC BY 4.0, ${SKETCHFAB}finished-cruise-ship-8fd630ce74c54fe986a792c3ebb5d57b`,
    },
    {
      url: "/models/ships/cruise-farhad.glb",
      bow: "+z",
      waterline: 280,
      credit: `“Cruise Ship” by farhad.Guli, CC BY 4.0, ${SKETCHFAB}cruise-ship-bb782326932e4c179e34f3d6c8e36b86`,
    },
  ],
  bulk: [
    {
      url: "/models/ships/bulk-herve.glb",
      bow: "-z",
      waterline: 3.8,
      credit: `“Bulk Carrier - TFCC HERITAGE - IBEE Corp” by Gwenaël Hervé, CC BY 4.0, ${SKETCHFAB}bulk-carrier-tfcc-heritage-ibee-corp-e78b4f1fdc094a63bb7d6c24d8e7e7dd`,
    },
  ],
  // No model was supplied for the car carrier: it stays procedural.
  carrier: [],
  lng: [
    {
      url: "/models/ships/lng-artblender.glb",
      bow: "+z",
      waterline: 0,
      credit: `“LNG Ship” by Art Blender, CC BY 4.0, ${SKETCHFAB}lng-ship-fa335b96450d4344863bbf5d912a0288`,
    },
  ],
  ferry: [
    {
      url: "/models/ships/ferry-fha.glb",
      bow: "+x",
      waterline: -0.16,
      credit: `“Viking Line M/S Europa (1993)” by FHA_studios, CC BY 4.0, ${SKETCHFAB}viking-line-ms-europa-1993-c27533d9b3024e6c835d5f308a8f278e`,
    },
  ],
  cargo: [
    {
      url: "/models/ships/cargo-hungrydrifter.glb",
      bow: "+x",
      waterline: 38.9,
      credit: `“Cargo ship” by hungry_drifter, CC BY 4.0, ${SKETCHFAB}cargo-ship-b7c97df584824ca682d26daabf401f87`,
    },
  ],
};

export type Bounds3 = { min: [number, number, number]; max: [number, number, number] };

/** Rotation about +Y (three.js convention) that turns `bow` into +Z. */
export function bowYaw(bow: BowAxis): number {
  switch (bow) {
    case "+z":
      return 0;
    case "-z":
      return Math.PI;
    case "+x":
      return -Math.PI / 2;
    case "-x":
      return Math.PI / 2;
  }
}

/**
 * Whether a mesh is the sea or a ground plane the author left in the scene:
 * named so, or flat and reaching well beyond everything else on both
 * horizontal axes (a deck is flat too, but never wider than the hull).
 */
export function isSeaSurface(name: string, mesh: Bounds3, rest: Bounds3 | null): boolean {
  const sizeX = mesh.max[0] - mesh.min[0];
  const sizeY = mesh.max[1] - mesh.min[1];
  const sizeZ = mesh.max[2] - mesh.min[2];
  const flat = sizeY < 0.02 * Math.max(sizeX, sizeZ);
  if (!flat) return false;
  // A flat sheet named as the sea; a pool on deck is never flat at this scale.
  if (/(^|[^a-z])(water|ocean|sea)([^a-z]|$)/iu.test(name)) return true;
  if (!rest) return false;
  const restX = rest.max[0] - rest.min[0];
  const restZ = rest.max[2] - rest.min[2];
  return sizeX > restX * 1.15 && sizeZ > restZ * 1.15;
}

export type ShipModelFit = {
  /** Uniform scale from model units to metres. */
  scale: number;
  /** Translation applied after the yaw and the scale, metres. */
  offset: [number, number, number];
};

/**
 * Scale and offset for a model whose bounds (already turned bow to +Z) are
 * `bounds`: the length along Z becomes the type's length, the hull is centred
 * on the ship's origin, and the waterline is at y = 0 with the keel `draft`
 * below (or the model's bottom at the waterline if it has no underwater part).
 */
export function fitShipModel(bounds: Bounds3, spec: ShipSpec, keel = 1, waterline?: number): ShipModelFit {
  const length = Math.max(1e-6, bounds.max[2] - bounds.min[2]);
  const scale = spec.length / length;
  const centreX = (bounds.min[0] + bounds.max[0]) / 2;
  const centreZ = (bounds.min[2] + bounds.max[2]) / 2;
  const bottom = bounds.min[1] * scale;
  const lift =
    waterline !== undefined ? -waterline * scale : -bottom - spec.draft * Math.min(1, Math.max(0, keel));
  return { scale, offset: [-centreX * scale, lift, -centreZ * scale] };
}

/** Bounds of a set of boxes; null for none. */
export function unionBounds(boxes: readonly Bounds3[]): Bounds3 | null {
  if (boxes.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  return { min, max };
}

/** Stations of a measured hull profile, stern to bow. */
export const HULL_PROFILE_STATIONS = 64;
/** Heights (m, from the waterline) whose hull counts as the ship's side to a yacht's hulls alongside. */
export const HULL_PROFILE_BAND: readonly [number, number] = [-1.2, 3.5];
/**
 * Above the band, up to the yacht's masthead, the ship's side meets her rig,
 * which stands this far inboard of her hulls' outer edge (the outline is
 * 1.85 m off her centreline): a bow flaring out over the water holds her
 * off by its width less this, so the mast does not pass into the flare.
 */
export const RIG_TOP = 9.5;
export const RIG_INSET = 1.6;
/** Spacing of the horizontal cuts through the band, and above it to `RIG_TOP`, metres. */
const HULL_SLICE_STEP = 0.6;
const RIG_SLICE_STEP = 1;

/**
 * The half-width of a model's hull for a yacht alongside, measured station by
 * station from its triangles (ship frame: bow toward +Z, waterline y = 0):
 * the widest point within `band` metres of the waterline in each slice of
 * the length (and, above it, the flare the rig would meet, see `RIG_INSET`)
 * — its vertices there, points along its long edges and horizontal cuts
 * every `HULL_SLICE_STEP` through the band, so a flat side drawn as a few long
 * triangles (a simplified model's) is measured all along, not only at its
 * corners. An imported ship
 * is scaled to its type's length, not its beam, and its hull is never the
 * analytic shape; walls and fenders that follow the measured hull let the
 * yacht come alongside to the metre the eye sees. Empty stations (a gap in
 * the mesh) take their neighbours' width.
 *
 * Several meshes add up: `emptyHullProfile`, `addHullMesh` for each, then
 * `closeHullProfile`; `measureHullProfile` does all three for one mesh.
 * @param positions xyz per vertex, metres, ship frame.
 * @param index three vertex indices per triangle; null for a non-indexed mesh.
 */
export function measureHullProfile(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  halfLength: number,
  band: readonly [number, number] = HULL_PROFILE_BAND,
  stations = HULL_PROFILE_STATIONS,
): Float32Array {
  const profile = emptyHullProfile(stations);
  addHullMesh(profile, positions, index, halfLength, band);
  return closeHullProfile(profile);
}

/** A profile with nothing measured yet (`-1` marks an empty station). */
export function emptyHullProfile(stations = HULL_PROFILE_STATIONS): Float32Array {
  return new Float32Array(stations).fill(-1);
}

/** The heights the triangles are cut at: through the band, then up the rig. */
function sliceHeights(band: readonly [number, number]): number[] {
  const heights: number[] = [];
  for (let height = band[0]; height < band[1]; height += HULL_SLICE_STEP) heights.push(height);
  heights.push(band[1]);
  for (let height = band[1] + RIG_SLICE_STEP; height < RIG_TOP; height += RIG_SLICE_STEP) heights.push(height);
  if (RIG_TOP > band[1]) heights.push(RIG_TOP);
  return heights;
}

/** Widens `profile` to take in one mesh of the hull (see `measureHullProfile`). */
export function addHullMesh(
  profile: Float32Array,
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  halfLength: number,
  band: readonly [number, number] = HULL_PROFILE_BAND,
): void {
  const triangles = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
  const reach = (2 * halfLength) / profile.length / 2;
  const top = Math.max(band[1], RIG_TOP);
  const heights = sliceHeights(band);
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = 3 * (index ? index[3 * triangle]! : 3 * triangle);
    const b = 3 * (index ? index[3 * triangle + 1]! : 3 * triangle + 1);
    const c = 3 * (index ? index[3 * triangle + 2]! : 3 * triangle + 2);
    const ay = positions[a + 1]!;
    const by = positions[b + 1]!;
    const cy = positions[c + 1]!;
    const low = Math.min(ay, by, cy);
    const high = Math.max(ay, by, cy);
    // Most of a ship (the bottom, the upper decks) is nowhere near the yacht.
    if (!(high >= band[0] && low <= top)) continue;
    // The corners and, along any long edge, points a half station apart
    // (a flat plate is measured by its rim); then the horizontal cuts.
    addHullPoint(profile, positions[a]!, ay, positions[a + 2]!, halfLength, band);
    addHullPoint(profile, positions[b]!, by, positions[b + 2]!, halfLength, band);
    addHullPoint(profile, positions[c]!, cy, positions[c + 2]!, halfLength, band);
    sampleEdge(profile, positions, a, b, halfLength, reach, band);
    sampleEdge(profile, positions, b, c, halfLength, reach, band);
    sampleEdge(profile, positions, c, a, halfLength, reach, band);
    for (const height of heights) {
      if (height < low) continue;
      if (height > high) break;
      cutTriangle(profile, positions, a, b, c, height, halfLength, reach, height <= band[1] ? 0 : RIG_INSET);
    }
  }
}

/** Points along an edge longer than `reach` (its ends are measured as corners). */
function sampleEdge(
  profile: Float32Array,
  positions: ArrayLike<number>,
  p: number,
  q: number,
  halfLength: number,
  reach: number,
  band: readonly [number, number],
): void {
  const span = Math.abs(positions[q + 2]! - positions[p + 2]!);
  if (span <= reach) return;
  const samples = Math.min(256, Math.ceil(span / reach));
  for (let sample = 1; sample < samples; sample += 1) {
    const t = sample / samples;
    addHullPoint(
      profile,
      positions[p]! + (positions[q]! - positions[p]!) * t,
      positions[p + 1]! + (positions[q + 1]! - positions[p + 1]!) * t,
      positions[p + 2]! + (positions[q + 2]! - positions[p + 2]!) * t,
      halfLength,
      band,
    );
  }
}

/** Where a triangle crosses the plane y = `height`: a segment, sampled a half station apart. */
function cutTriangle(
  profile: Float32Array,
  positions: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  height: number,
  halfLength: number,
  reach: number,
  inset: number,
): void {
  let count = 0;
  let x0 = 0;
  let z0 = 0;
  let x1 = 0;
  let z1 = 0;
  for (let edge = 0; edge < 3; edge += 1) {
    const p = edge === 0 ? a : edge === 1 ? b : c;
    const q = edge === 0 ? b : edge === 1 ? c : a;
    const dp = positions[p + 1]! - height;
    const dq = positions[q + 1]! - height;
    if ((dp < 0) === (dq < 0)) continue;
    const t = dp / (dp - dq);
    const x = positions[p]! + (positions[q]! - positions[p]!) * t;
    const z = positions[p + 2]! + (positions[q + 2]! - positions[p + 2]!) * t;
    if (count === 0) {
      x0 = x;
      z0 = z;
    } else {
      x1 = x;
      z1 = z;
    }
    count += 1;
  }
  if (count < 2) return;
  const samples = Math.min(256, Math.ceil(Math.abs(z1 - z0) / reach)) + 1;
  for (let sample = 0; sample <= samples; sample += 1) {
    const t = sample / samples;
    widen(profile, Math.max(0, Math.abs(x0 + (x1 - x0) * t) - inset), z0 + (z1 - z0) * t, halfLength);
  }
}

/**
 * Widens `profile` to take in one point of the hull (ship frame, metres):
 * within `band` as it is, above it up to `RIG_TOP` less `RIG_INSET`.
 */
export function addHullPoint(
  profile: Float32Array,
  x: number,
  y: number,
  z: number,
  halfLength: number,
  band: readonly [number, number] = HULL_PROFILE_BAND,
): void {
  if (y >= band[0] && y <= band[1]) widen(profile, Math.abs(x), z, halfLength);
  else if (y > band[1] && y <= RIG_TOP) widen(profile, Math.max(0, Math.abs(x) - RIG_INSET), z, halfLength);
}

function widen(profile: Float32Array, width: number, z: number, halfLength: number): void {
  const t = (z / halfLength + 1) / 2;
  if (!(t >= 0 && t <= 1)) return;
  const stations = profile.length;
  const station = Math.min(stations - 1, Math.floor(t * stations));
  if (width > profile[station]!) profile[station] = width;
}

/** Fills the stations nothing reached and returns the finished profile. */
export function closeHullProfile(profile: Float32Array): Float32Array {
  const stations = profile.length;
  // Fill gaps from the nearest measured stations; the very ends close to 0.
  for (let station = 0; station < stations; station += 1) {
    if (profile[station]! >= 0) continue;
    let left = station - 1;
    while (left >= 0 && profile[left]! < 0) left -= 1;
    let right = station + 1;
    while (right < stations && profile[right]! < 0) right += 1;
    const a = left >= 0 ? profile[left]! : 0;
    const b = right < stations ? profile[right]! : 0;
    profile[station] = Math.max(0, left >= 0 && right < stations ? Math.min(a, b) : Math.max(a, b) * 0.5);
  }
  return profile;
}

/** Half-width of a measured profile at `along` metres from midships (+ toward the bow). */
export function profileHalfWidth(profile: Float32Array, halfLength: number, along: number): number {
  const stations = profile.length;
  const t = (along / halfLength + 1) / 2;
  if (t <= 0 || t >= 1) return 0;
  const position = t * stations - 0.5;
  const index = Math.floor(position);
  const fraction = position - index;
  const a = profile[Math.max(0, Math.min(stations - 1, index))]!;
  const b = profile[Math.max(0, Math.min(stations - 1, index + 1))]!;
  return a + (b - a) * fraction;
}

/** A mesh of a prepared model in the ship frame (metres, bow +Z, waterline y = 0). */
export type ModelMesh = { positions: ArrayLike<number>; index: ArrayLike<number> | null };

/**
 * Lights of a ship model: points (xyz) and their glow (rgb, channel: 0
 * always, 1 under way, 2 at anchor), and the stretch of her length (z from,
 * to) that is accommodation, where her windows are.
 */
export type ModelLights = { positions: Float32Array; lights: Float32Array; block: [number, number] };

const WINDOW_GLOW: readonly [number, number, number] = [1.0, 0.72, 0.42];
const MASTHEAD_GLOW: readonly [number, number, number] = [5, 5, 4.6];
const PORT_GLOW: readonly [number, number, number] = [6, 0.25, 0.2];
const STARBOARD_GLOW: readonly [number, number, number] = [0.2, 6, 1.2];

/**
 * Where an imported ship shows lights at night, read off her model: lit
 * windows scattered over the walls of her accommodation (all along the decks
 * of a liner or a ferry, the block round the bridge of a cargo ship), a
 * masthead light on her highest point and the sidelights at the bridge wings
 * (under way), the anchor lights at bow and stern (at anchor), the stern
 * light. Each point stands a little off its wall, so the model never hides
 * it. The procedural ships carry their own; a model's had been theirs, which
 * floated inside or beside a hull of another shape, or were hidden in it.
 */
export function modelLights(
  meshes: readonly ModelMesh[],
  halfLength: number,
  deck: number,
  passenger: boolean,
  seed = 1,
): ModelLights {
  let state = (seed * 2654435761) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // The ship's height profile along her length, to find the accommodation.
  const stations = 48;
  const heights = new Float32Array(stations).fill(-Infinity);
  let top = -Infinity;
  let topX = 0;
  let topZ = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const station = (z: number) => Math.min(stations - 1, Math.max(0, Math.floor(((z / halfLength + 1) / 2) * stations)));
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i]!;
      const y = p[i + 1]!;
      const z = p[i + 2]!;
      const s = station(z);
      if (y > heights[s]!) heights[s] = y;
      if (y > top) {
        top = y;
        topX = x;
        topZ = z;
      }
      if (y > deck * 0.5) {
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
  }
  if (!Number.isFinite(top)) return { positions: new Float32Array(0), lights: new Float32Array(0), block: [0, 0] };
  if (!Number.isFinite(minZ)) {
    minZ = -halfLength;
    maxZ = halfLength;
  }
  // The accommodation of a cargo ship: the stations within 80 % of the top
  // (around the highest one), widened by a couple of stations.
  let first = station(topZ);
  let last = first;
  const tall = deck + (top - deck) * 0.62;
  while (first > 0 && heights[first - 1]! >= tall) first -= 1;
  while (last < stations - 1 && heights[last + 1]! >= tall) last += 1;
  const blockLow = ((Math.max(0, first - 1) / stations) * 2 - 1) * halfLength;
  const blockHigh = (((Math.min(stations - 1, last + 1) + 1) / stations) * 2 - 1) * halfLength;

  // Walls (near-vertical faces) where windows can be, weighted by area.
  const walls: number[] = [];
  const areas: number[] = [];
  let total = 0;
  const lowest = passenger ? deck * 0.55 : deck + 1.5;
  for (const [meshIndex, mesh] of meshes.entries()) {
    const p = mesh.positions;
    const count = mesh.index ? mesh.index.length : p.length / 3;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = 3 * (mesh.index ? mesh.index[i]! : i);
      const b = 3 * (mesh.index ? mesh.index[i + 1]! : i + 1);
      const c = 3 * (mesh.index ? mesh.index[i + 2]! : i + 2);
      const cy = (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3;
      if (cy < lowest || cy > top - 1) continue;
      const cz = (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
      if (!passenger && (cz < blockLow || cz > blockHigh)) continue;
      const ux = p[b]! - p[a]!;
      const uy = p[b + 1]! - p[a + 1]!;
      const uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!;
      const vy = p[c + 1]! - p[a + 1]!;
      const vz = p[c + 2]! - p[a + 2]!;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-6 || Math.abs(ny) / length > 0.3) continue;
      const area = length / 2;
      total += area;
      walls.push(meshIndex, a, b, c);
      areas.push(total);
    }
  }

  const points: number[] = [];
  const glow: number[] = [];
  const add = (x: number, y: number, z: number, color: readonly [number, number, number], scale: number, channel: number) => {
    points.push(x, y, z);
    glow.push(color[0] * scale, color[1] * scale, color[2] * scale, channel);
  };
  const windows = walls.length === 0 ? 0 : passenger ? 560 : 90;
  for (let window = 0; window < windows; window += 1) {
    const pick = random() * total;
    let low = 0;
    let high = areas.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (areas[middle]! < pick) low = middle + 1;
      else high = middle;
    }
    const [meshIndex, a, b, c] = [walls[low * 4]!, walls[low * 4 + 1]!, walls[low * 4 + 2]!, walls[low * 4 + 3]!];
    const p = meshes[meshIndex]!.positions;
    let r1 = random();
    let r2 = random();
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const x = p[a]! + (p[b]! - p[a]!) * r1 + (p[c]! - p[a]!) * r2;
    const y = p[a + 1]! + (p[b + 1]! - p[a + 1]!) * r1 + (p[c + 1]! - p[a + 1]!) * r2;
    const z = p[a + 2]! + (p[b + 2]! - p[a + 2]!) * r1 + (p[c + 2]! - p[a + 2]!) * r2;
    // Off the wall, outward (away from the centreline, or fore and aft on a front).
    const outX = Math.abs(x) > 1 ? Math.sign(x) * 0.45 : 0;
    const outZ = Math.abs(x) > 1 ? 0 : Math.sign(z) * 0.45;
    const warm = 0.8 + random() * 0.8;
    add(x + outX, y, z + outZ, random() < 0.12 ? [0.85, 0.9, 1] : WINDOW_GLOW, warm, 0);
  }

  // Navigation lights from her own shape.
  const bridgeZ = Math.min(maxZ, Math.max(minZ, topZ));
  add(topX, top + 0.6, topZ, MASTHEAD_GLOW, 1, 1);
  let portX = 0;
  let starboardX = 0;
  let wingY = deck + (top - deck) * 0.55;
  let wingZ = bridgeZ;
  const wingLow = deck + (top - deck) * 0.35;
  const wingHigh = deck + (top - deck) * 0.85;
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const y = p[i + 1]!;
      const z = p[i + 2]!;
      if (y < wingLow || y > wingHigh || Math.abs(z - bridgeZ) > halfLength * 0.12) continue;
      const x = p[i]!;
      if (x > portX) {
        portX = x;
        wingY = y;
        wingZ = z;
      }
      if (x < starboardX) starboardX = x;
    }
  }
  add(portX + 0.4, wingY, wingZ, PORT_GLOW, 1, 1);
  add(starboardX - 0.4, wingY, wingZ, STARBOARD_GLOW, 1, 1);
  add(0, deck + 2.5, minZ - 0.4, MASTHEAD_GLOW, 0.8, 1);
  add(0, deck + 6, maxZ * 0.97, MASTHEAD_GLOW, 0.9, 2);
  add(0, deck + 3, minZ - 0.4, MASTHEAD_GLOW, 0.8, 2);
  return {
    positions: new Float32Array(points),
    lights: new Float32Array(glow),
    block: passenger ? [minZ, maxZ] : [blockLow, blockHigh],
  };
}
