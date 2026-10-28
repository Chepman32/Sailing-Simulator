import * as THREE from "three";
import { leafCards, leafGeometry } from "./IslandVegetation";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { computeBoundingSphereFast, computeVertexNormalsFast } from "../core/FastGeometry";
import { smoothstep } from "../math";
import { islandEdgeNoise, type IslandDefinition } from "./IslandMath";

/**
 * What makes one island unlike the next: its character (a low sandy cay, a
 * lush island thick with scrub, a hilly one, or one strewn with rounded
 * granite boulders like the Seychelles), the hills on it, and what people
 * have built there — a wooden pier with a thatched hut at its root, or a
 * red-and-white lighthouse whose beams sweep the sea at night. Everything is
 * decided from the island's id, so an island looks the same on every visit.
 *
 * The builders return plain geometry with vertex colours, merged per island
 * into one mesh for the solid parts and one for the parts that glow at
 * night (windows, the lantern), so a furnished island costs two draw calls
 * (and the beams, for a lighthouse).
 */

export type IslandCharacter = "cay" | "lush" | "hilly" | "rocky";

export type Hill = { x: number; z: number; height: number; sigma: number };
export type Clearing = { x: number; z: number; radius: number };

export type IslandProfile = {
  character: IslandCharacter;
  /** Gaussian hills on the interior (island-local metres). */
  hills: Hill[];
  /** Polar angle (as the terrain's) of the pier and hut, or null. */
  pierAngle: number | null;
  pierLength: number;
  /** Polar angle of the lighthouse, or null. */
  lighthouseAngle: number | null;
  /** How strongly the hills read as bare rock (0…1). */
  rockiness: number;
};

/** A pier's footprint, for the yacht to keep off (world metres). */
export type PierFootprint = { x: number; z: number; dirX: number; dirZ: number; length: number; halfWidth: number };

function hash(id: number, salt: number): number {
  let h = Math.imul((id | 0) ^ 0x6a09e667, 0x85ebca6b) ^ Math.imul(salt + 0x9e37, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The islands nearest the start: the first a pier and hut faces, the second a lighthouse. */
function homeIndex(island: IslandDefinition): number {
  // Home islands are slots 0–2 of the start cell (see IslandMath's `islandId`).
  const startCell = (0 + 8192) * 16384 + (0 + 8192);
  const slot = island.id - startCell * 8;
  return slot >= 0 && slot < 3 ? slot : -1;
}

export function islandProfile(island: IslandDefinition): IslandProfile {
  const id = island.id;
  const radius = island.beachRadius;
  const empty: IslandProfile = { character: "cay", hills: [], pierAngle: null, pierLength: 0, lighthouseAngle: null, rockiness: 0 };
  if (island.volcano) return empty;
  const roll = hash(id, 1);
  let character: IslandCharacter;
  if (radius < 30) character = roll < 0.3 ? "rocky" : roll < 0.55 ? "lush" : "cay";
  else character = roll < 0.28 ? "rocky" : roll < 0.58 ? "hilly" : roll < 0.84 ? "lush" : "cay";
  const home = homeIndex(island);
  if (home === 0) character = "lush";
  if (home === 1) character = "rocky";
  if (home === 2) character = "hilly";
  const hills: Hill[] = [];
  const count = character === "hilly" ? 1 + Math.floor(hash(id, 2) * 3) : character === "rocky" ? 1 + Math.floor(hash(id, 2) * 2) : character === "lush" ? 1 : 0;
  for (let index = 0; index < count; index += 1) {
    const angle = hash(id, 10 + index) * Math.PI * 2;
    const radial = Math.sqrt(hash(id, 20 + index)) * 0.38;
    const scale = Math.min(1.6, radius / 45);
    const height = (character === "hilly" ? 3.5 + hash(id, 30 + index) * 7 : character === "rocky" ? 2.5 + hash(id, 30 + index) * 4 : 1 + hash(id, 30 + index) * 2) * scale;
    hills.push({
      x: Math.cos(angle) * radius * radial,
      z: Math.sin(angle) * radius * radial * island.scaleZ,
      height,
      sigma: radius * (0.17 + hash(id, 40 + index) * 0.14),
    });
  }
  let pierAngle: number | null = null;
  let lighthouseAngle: number | null = null;
  if (home === 0) {
    // Facing the start, so the first thing seen is the jetty.
    pierAngle = Math.atan2(-island.centerZ / island.scaleZ, -island.centerX);
  } else if (radius >= 26 && hash(id, 50) < 0.38) {
    pierAngle = hash(id, 51) * Math.PI * 2;
  }
  if (home === 1) {
    lighthouseAngle = Math.atan2(-island.centerZ / island.scaleZ, -island.centerX) + 0.5;
  } else if (radius >= 40 && hash(id, 60) < 0.24) {
    lighthouseAngle = (pierAngle ?? hash(id, 61) * Math.PI * 2) + (pierAngle === null ? 0 : Math.PI);
  }
  return {
    character,
    hills,
    pierAngle,
    pierLength: 20 + hash(id, 52) * 12,
    lighthouseAngle,
    rockiness: character === "rocky" ? 0.85 : character === "hilly" ? 0.35 : 0,
  };
}

/** Extra height of the interior from the island's hills (island-local x, z), faded out before the beach. */
export function hillHeight(profile: IslandProfile, x: number, z: number, radial: number): number {
  if (profile.hills.length === 0) return 0;
  let height = 0;
  for (const hill of profile.hills) {
    const dx = x - hill.x;
    const dz = z - hill.z;
    height += hill.height * Math.exp(-(dx * dx + dz * dz) / (2 * hill.sigma * hill.sigma));
  }
  return height * (1 - smoothstep(0.55, 0.82, radial));
}

/** Island-local point at a polar position (the terrain's own parametrisation). */
export function islandPoint(island: IslandDefinition, radial: number, angle: number): { x: number; z: number } {
  const radius = island.beachRadius * radial * islandEdgeNoise(angle, island);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius * island.scaleZ };
}

/** Outward direction of the coast at a polar angle (unit, island-local). */
function outward(island: IslandDefinition, angle: number): { x: number; z: number } {
  const x = Math.cos(angle) * island.scaleZ;
  const z = Math.sin(angle);
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

/** Where the hut, the lighthouse and their yards are: no palm or shrub grows there. */
export function islandClearings(island: IslandDefinition, profile: IslandProfile): Clearing[] {
  const clearings: Clearing[] = [];
  if (profile.pierAngle !== null) {
    const hut = islandPoint(island, 0.74, profile.pierAngle + 0.2);
    clearings.push({ ...hut, radius: 6.5 });
    const root = islandPoint(island, 0.86, profile.pierAngle);
    clearings.push({ ...root, radius: 4 });
  }
  if (profile.lighthouseAngle !== null) {
    const tower = islandPoint(island, 0.5, profile.lighthouseAngle);
    clearings.push({ ...tower, radius: 8 });
  }
  return clearings;
}

export function inClearing(clearings: readonly Clearing[], x: number, z: number, margin = 0): boolean {
  return clearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + margin);
}

// --- Geometry helpers -----------------------------------------------------------

const scratchColor = new THREE.Color();

/** What a furniture vertex belongs to, for its surface detail (`FurnitureSurface`). */
export const PROP_KIND = { built: 0, rock: 1, foliage: 2 } as const;

/** Non-indexed copy with a vertex colour per vertex (`color` may vary it per vertex) and its kind. */
function painted(geometry: THREE.BufferGeometry, color: (x: number, y: number, z: number, out: THREE.Color) => void, kind: number = PROP_KIND.built): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute("uv");
  if (!flat.getAttribute("normal")) flat.computeVertexNormals();
  const position = flat.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    color(position.getX(index), position.getY(index), position.getZ(index), scratchColor);
    colors[index * 3] = scratchColor.r;
    colors[index * 3 + 1] = scratchColor.g;
    colors[index * 3 + 2] = scratchColor.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  flat.setAttribute("propKind", new THREE.BufferAttribute(new Float32Array(position.count).fill(kind), 1));
  return flat;
}

function solid(hex: number, jitter = 0, seed = 0): (x: number, y: number, z: number, out: THREE.Color) => void {
  const base = new THREE.Color(hex);
  return (x, y, z, out) => {
    const n = jitter > 0 ? Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453 : 0;
    const v = jitter > 0 ? (n - Math.floor(n) - 0.5) * jitter : 0;
    out.copy(base).multiplyScalar(1 + v);
  };
}

function box(width: number, height: number, depth: number, x: number, y: number, z: number, hex: number, jitter = 0.08, seed = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return painted(geometry, solid(hex, jitter, seed));
}

function post(radius: number, bottom: number, top: number, x: number, z: number, hex: number, segments = 7): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius * 0.9, radius, top - bottom, segments);
  geometry.translate(x, (top + bottom) / 2, z);
  return painted(geometry, solid(hex, 0.12, x * 3 + z));
}

/**
 * Welded unit icospheres by subdivision level. `mergeVertices` keys every
 * vertex by a string, and an island has hundreds of blobs: the sphere is
 * welded once and each blob starts from a copy of it.
 */
const unitSpheres = new Map<number, THREE.BufferGeometry>();

function unitSphere(detail: number): THREE.BufferGeometry {
  let sphere = unitSpheres.get(detail);
  if (!sphere) {
    const raw = new THREE.IcosahedronGeometry(1, detail);
    raw.deleteAttribute("normal");
    raw.deleteAttribute("uv");
    sphere = mergeVertices(raw);
    raw.dispose();
    unitSpheres.set(detail, sphere);
  }
  return sphere;
}

/**
 * A rounded granite boulder (or a shrub's blob): a noisy, squashed icosphere.
 * It shares the welded sphere's index (read only: the blob is moved and then
 * written out unindexed by `painted`), and only its positions are new.
 */
function blob(radius: number, squash: number, seed: number, detail: number, roughness: number): THREE.BufferGeometry {
  const sphere = unitSphere(detail);
  const unit = sphere.getAttribute("position").array as Float32Array;
  const array = new Float32Array(unit.length);
  for (let index = 0; index < unit.length; index += 3) {
    // On the unit sphere; the noise is the same at every size.
    const x = unit[index]!;
    const y = unit[index + 1]!;
    const z = unit[index + 2]!;
    const n =
      Math.sin(x * 1.7 + seed) * Math.cos(z * 1.9 - seed * 0.7) * 0.6 +
      Math.sin(y * 3.1 + x * 2.3 + seed * 1.3) * 0.4;
    const scale = radius * (1 + n * roughness);
    array[index] = x * scale;
    array[index + 1] = y * scale * squash;
    array[index + 2] = z * scale;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(array, 3));
  geometry.setIndex(sphere.index);
  computeVertexNormalsFast(geometry);
  return geometry;
}

function transformed(geometry: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, tilt = 0): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.6, "YXZ")),
    new THREE.Vector3(1, 1, 1),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

// --- The pieces -------------------------------------------------------------------

type Surface = (radial: number, angle: number) => number;
type LeafBuffers = { positions: number[]; uvs: number[]; colors: number[]; normals: number[] };
type Parts = { solid: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[]; leaves: LeafBuffers };

/** Granite boulders: clusters on the shore, half in the water, and a few on the hills. */
function addBoulders(island: IslandDefinition, profile: IslandProfile, surface: Surface, parts: Parts): void {
  const id = island.id;
  const small = island.beachRadius < 30;
  const clusters = profile.character === "rocky" ? (small ? 2 : 3) : profile.character === "hilly" ? 1 : 0;
  const granite = new THREE.Color(0x8d8476);
  const pink = new THREE.Color(0x9b8577);
  const wet = new THREE.Color(0x4b4740);
  const lichen = new THREE.Color(0x9d9a6a);
  let seed = 0;
  for (let cluster = 0; cluster < clusters; cluster += 1) {
    const angle = hash(id, 100 + cluster) * Math.PI * 2;
    if (profile.pierAngle !== null && Math.abs(Math.atan2(Math.sin(angle - profile.pierAngle), Math.cos(angle - profile.pierAngle))) < 0.5) continue;
    const stones = 3 + Math.floor(hash(id, 110 + cluster) * (small ? 3 : 5));
    for (let stone = 0; stone < stones; stone += 1) {
      seed += 1;
      const a = angle + (hash(id, 200 + seed) - 0.5) * (small ? 0.7 : 0.45);
      const radial = 0.86 + hash(id, 300 + seed) * 0.2;
      const size = (1.1 + hash(id, 400 + seed) * 2.8) * (stone === 0 ? 1.5 : 1);
      const point = islandPoint(island, radial, a);
      const ground = Math.min(surface(Math.min(radial, 1.05), a), 0.4);
      const tone = hash(id, 500 + seed) < 0.4 ? pink : granite;
      const geometry = blob(size, 0.62 + hash(id, 600 + seed) * 0.25, seed * 1.7 + id * 0.01, 2, 0.16);
      transformed(geometry, point.x, ground + size * 0.25, point.z, hash(id, 700 + seed) * 6.28, (hash(id, 800 + seed) - 0.5) * 0.5);
      parts.solid.push(
        painted(geometry, (x, y, z, out) => {
          const n = Math.sin(x * 2.1 + z * 1.7 + seed) * 0.5 + 0.5;
          out.copy(tone).multiplyScalar(0.86 + n * 0.22);
          // Lichen on the tops, a dark wet band at the waterline.
          out.lerp(lichen, smoothstep(0.55, 0.95, n) * smoothstep(ground + size * 0.5, ground + size * 1.1, y) * 0.45);
          out.lerp(wet, 1 - smoothstep(-0.1, 0.55, y));
        }, PROP_KIND.rock),
      );
    }
  }
  // On the hills of a rocky island: tors standing out of the scrub.
  if (profile.character === "rocky") {
    for (const [index, hill] of profile.hills.entries()) {
      for (let stone = 0; stone < 3; stone += 1) {
        seed += 1;
        const size = 1.4 + hash(id, 900 + seed) * 2.4;
        const x = hill.x + (hash(id, 910 + seed) - 0.5) * hill.sigma * 0.9;
        const z = hill.z + (hash(id, 920 + seed) - 0.5) * hill.sigma * 0.9;
        const radial = Math.hypot(x, z / island.scaleZ) / island.beachRadius;
        const a = Math.atan2(z / island.scaleZ, x);
        const geometry = blob(size, 0.75, seed * 2.3 + index, 2, 0.14);
        transformed(geometry, x, surface(radial, a) + size * 0.35, z, hash(id, 930 + seed) * 6.28, 0.2);
        parts.solid.push(painted(geometry, (px, py, pz, out) => {
          const n = Math.sin(px * 1.9 - pz * 2.3 + seed) * 0.5 + 0.5;
          out.copy(granite).multiplyScalar(0.88 + n * 0.2).lerp(lichen, smoothstep(0.6, 1, n) * 0.4);
        }, PROP_KIND.rock));
      }
    }
  }
}

/** Scrub and bushes under the palms: clumps of small leafy masses, speckled light and dark like foliage. */
function addShrubs(island: IslandDefinition, profile: IslandProfile, surface: Surface, clearings: readonly Clearing[], parts: Parts): void {
  if (island.beachRadius < 20) return;
  const id = island.id;
  const density = profile.character === "lush" ? 0.7 : profile.character === "hilly" ? 0.45 : profile.character === "rocky" ? 0.3 : 0.22;
  const count = Math.min(70, Math.round(island.beachRadius * density));
  const greens = [0x2c6332, 0x3a7334, 0x47803a, 0x30693f, 0x55853a].map((hex) => new THREE.Color(hex));
  const dry = new THREE.Color(0x8a8a46);
  for (let index = 0; index < count; index += 1) {
    const angle = hash(id, 1000 + index) * Math.PI * 2;
    const radial = 0.12 + Math.sqrt(hash(id, 1100 + index)) * 0.55;
    const point = islandPoint(island, radial, angle);
    if (inClearing(clearings, point.x, point.z, 1.5)) continue;
    const ground = surface(radial, angle);
    const green = greens[Math.floor(hash(id, 1200 + index) * greens.length)]!;
    const masses = 4 + Math.floor(hash(id, 1400 + index) * 3);
    const size = 0.8 + hash(id, 1500 + index) * 1.1;
    for (let part = 0; part < masses; part += 1) {
      const r = size * (0.42 + hash(id, 1600 + index * 8 + part) * 0.38);
      const spread = size * 0.85;
      const ox = (hash(id, 1700 + index * 8 + part) - 0.5) * spread * 2;
      const oz = (hash(id, 1800 + index * 8 + part) - 0.5) * spread * 2;
      const lift = hash(id, 1900 + index * 8 + part) * size * 0.5;
      // A dense, dark core; the leafy outline is the leaf cards round it.
      const geometry = blob(r * 0.82, 0.8, index * 3.1 + part * 1.7, 1, 0.38);
      transformed(geometry, point.x + ox, ground + r * 0.5 + lift, point.z + oz, part * 1.3, 0.3);
      leafCards(point.x + ox, ground + r * 0.55 + lift, point.z + oz, r, green, id * 131 + index * 17 + part, parts.leaves);
      const top = ground + r + lift;
      parts.solid.push(
        painted(geometry, (x, y, z, out) => {
          // Leaf speckle: each vertex its own shade, a few sunlit or dry.
          const n = Math.sin(x * 37.1 + z * 29.3 + y * 41.7) * 43758.5453;
          const speckle = n - Math.floor(n);
          out.copy(green).multiplyScalar(0.5 + speckle * 0.5);
          if (speckle > 0.9) out.lerp(dry, 0.5);
          // Darker underneath and inside the clump.
          out.multiplyScalar(0.5 + 0.5 * smoothstep(ground, top, y));
        }, PROP_KIND.foliage),
      );
    }
  }
}

/** A wooden pier on piles from the beach out over the shallows, with a T-head and bollards. */
function addPier(island: IslandDefinition, profile: IslandProfile, parts: Parts): PierFootprint | null {
  if (profile.pierAngle === null) return null;
  const angle = profile.pierAngle;
  const root = islandPoint(island, 0.84, angle);
  const dir = outward(island, angle);
  const length = profile.pierLength;
  const deck = 1.15;
  const width = 2.3;
  const pieces: THREE.BufferGeometry[] = [];
  const wood = 0x8a6a48;
  const weathered = 0x9c8a74;
  // Planks across the deck, each a slightly different grey-brown.
  for (let s = 0; s < length; s += 0.27) {
    pieces.push(box(0.24, 0.06, width, s + 0.12, deck, 0, hash(island.id, Math.round(s * 10)) < 0.5 ? wood : weathered, 0.1, s));
  }
  // The T-head.
  for (let s = 0; s < 4.4; s += 0.27) pieces.push(box(width * 1.9, 0.06, 0.24, length + 0.1, deck, -2.1 + s, weathered, 0.1, s + 50));
  pieces.push(box(length, 0.22, 0.14, length / 2, deck - 0.14, width / 2 - 0.12, 0x5e4630));
  pieces.push(box(length, 0.22, 0.14, length / 2, deck - 0.14, -width / 2 + 0.12, 0x5e4630));
  // Piles down into the sea (and into the sand at the root).
  for (let s = 0.4; s <= length + 0.01; s += 2.6) {
    for (const side of [-1, 1]) pieces.push(post(0.12, -3, deck - 0.05, s, side * (width / 2 - 0.05), 0x5a4532));
  }
  for (const side of [-1, 1]) {
    for (const off of [-1.9, 1.9]) pieces.push(post(0.13, -3, deck - 0.05, length + side * 1.8 + 0.1, off, 0x5a4532));
  }
  // Bollards and a pair of handrails on the T-head.
  for (const off of [-1.8, 1.8]) pieces.push(post(0.1, deck, deck + 0.45, length + 0.1, off, 0x2b2b2b, 9));
  for (const side of [-1, 1]) {
    pieces.push(post(0.05, deck, deck + 1, length + side * 2.1 + 0.1, -2.2, 0x6b5238));
    pieces.push(post(0.05, deck, deck + 1, length + side * 2.1 + 0.1, 2.2, 0x6b5238));
    const rail = new THREE.BoxGeometry(0.07, 0.07, 4.4);
    rail.translate(length + side * 2.1 + 0.1, deck + 0.95, 0);
    pieces.push(painted(rail, solid(0x6b5238, 0.08)));
  }
  // A small boat tied alongside: a dinghy (hull of a squashed half-blob) in faded blue.
  const dinghy = blob(1, 0.42, island.id * 0.37, 2, 0.02);
  dinghy.scale(1.4, 1, 0.62);
  const position = dinghy.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) if (position.getY(index) > 0.05) position.setY(index, 0.05);
  dinghy.computeVertexNormals();
  dinghy.translate(length - 3.5, 0.18, width / 2 + 0.9);
  pieces.push(painted(dinghy, (x, y, z, out) => out.set(y > 0.0 ? 0x8f6b4a : 0x3b6f98)));
  // The deck's height is above the sea, not the sand: the piles stand in both.
  const yaw = Math.atan2(-dir.z, dir.x);
  for (const piece of pieces) parts.solid.push(transformed(piece, root.x, 0, root.z, yaw));
  return {
    x: island.centerX + root.x,
    z: island.centerZ + root.z,
    dirX: dir.x,
    dirZ: dir.z,
    length: length + 2.4,
    halfWidth: width * 0.95 + 0.6,
  };
}

/** A stilt hut of bamboo and thatch near the root of the pier, its door to the sea. */
function addHut(island: IslandDefinition, profile: IslandProfile, surface: Surface, parts: Parts): void {
  if (profile.pierAngle === null) return;
  const angle = profile.pierAngle + 0.2;
  const spot = islandPoint(island, 0.74, angle);
  const dir = outward(island, angle);
  const ground = surface(0.74, angle);
  const solidParts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];
  const floor = 0.75;
  const wallHeight = 2.1;
  // Stilts and floor (front of the hut along +X, the porch out front).
  for (const x of [-1.6, 0, 1.6, 2.8]) for (const z of [-1.5, 1.5]) solidParts.push(post(0.09, -0.8, floor, x, z, 0x6d5136));
  solidParts.push(box(4.6, 0.14, 3.4, 0.6, floor, 0, 0x8e6c45));
  // Bamboo walls: upright poles side by side.
  const bamboo = [0xb89660, 0xa98754, 0xc4a36b];
  const wall = (fromX: number, fromZ: number, toX: number, toZ: number, door: boolean) => {
    const length = Math.hypot(toX - fromX, toZ - fromZ);
    const poles = Math.round(length / 0.13);
    for (let index = 0; index < poles; index += 1) {
      const t = (index + 0.5) / poles;
      const x = fromX + (toX - fromX) * t;
      const z = fromZ + (toZ - fromZ) * t;
      // The doorway: no poles in the middle metre of the front wall.
      if (door && Math.abs(t - 0.5) * length < 0.48) {
        solidParts.push(post(0.065, floor + 1.85, floor + wallHeight, x, z, bamboo[index % 3]!, 6));
        continue;
      }
      solidParts.push(post(0.068, floor, floor + wallHeight, x, z, bamboo[index % 3]!, 6));
    }
  };
  wall(-1.7, -1.4, -1.7, 1.4, false);
  wall(1.7, -1.4, 1.7, 1.4, true);
  wall(-1.7, -1.45, 1.7, -1.45, false);
  wall(-1.7, 1.45, 1.7, 1.45, false);
  // The dark doorway and two windows that glow at night.
  solidParts.push(box(0.04, 1.85, 0.95, 1.66, floor + 0.93, 0, 0x1d140c, 0));
  for (const z of [-1.48, 1.48]) glowParts.push(box(0.8, 0.55, 0.06, 0, floor + 1.35, z, 0xffc777, 0));
  // Porch rail.
  solidParts.push(box(0.06, 0.06, 3.2, 2.85, floor + 0.85, 0, 0x6d5136));
  // Thatch: two layers of a four-sided roof, ragged at the eaves.
  const roofBase = floor + wallHeight;
  for (const [radius, height, lift, tone] of [
    [3.55, 2.2, 0, 0xc9a86a],
    [3.25, 1.9, 0.18, 0xb8955a],
  ] as const) {
    const roof = new THREE.ConeGeometry(radius, height, 4, 3, true);
    roof.rotateY(Math.PI / 4);
    roof.scale(1.18, 1, 1);
    roof.translate(0.4, roofBase + height / 2 + lift - 0.12, 0);
    solidParts.push(
      painted(roof, (x, y, z, out) => {
        const n = Math.sin(x * 9.1 + z * 7.3) * 0.5 + 0.5;
        out.set(tone).multiplyScalar(0.8 + n * 0.3);
      }),
    );
  }
  const yaw = Math.atan2(-dir.z, dir.x);
  for (const piece of solidParts) parts.solid.push(transformed(piece, spot.x, ground, spot.z, yaw));
  for (const piece of glowParts) parts.glow.push(transformed(piece, spot.x, ground, spot.z, yaw));
}

/** Height of the lighthouse's lantern above its foot, metres. */
export const LANTERN_HEIGHT = 17.6;

/** A banded tower, gallery, lantern room and keeper's cottage. */
function addLighthouse(island: IslandDefinition, profile: IslandProfile, surface: Surface, parts: Parts): THREE.Vector3 | null {
  if (profile.lighthouseAngle === null) return null;
  const angle = profile.lighthouseAngle;
  const spot = islandPoint(island, 0.5, angle);
  const dir = outward(island, angle);
  const ground = surface(0.5, angle) - 0.3;
  const pieces: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const white = new THREE.Color(0xf2efe8);
  const red = new THREE.Color(0xc0302c);
  const tower = 15.5;
  pieces.push(post(2.5, -0.5, 1.2, 0, 0, 0x9a948a, 8));
  const shaft = new THREE.CylinderGeometry(1.15, 1.75, tower, 28, 10);
  shaft.translate(0, 1.2 + tower / 2, 0);
  const banded = shaft.toNonIndexed();
  shaft.dispose();
  // Bands by each triangle's centre, so the edges are crisp.
  const position = banded.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let triangle = 0; triangle < position.count / 3; triangle += 1) {
    const y = (position.getY(triangle * 3) + position.getY(triangle * 3 + 1) + position.getY(triangle * 3 + 2)) / 3;
    const band = Math.floor((y - 1.2) / (tower / 5)) % 2 === 1;
    const color = band ? red : white;
    for (let k = 0; k < 3; k += 1) {
      colors[(triangle * 3 + k) * 3] = color.r;
      colors[(triangle * 3 + k) * 3 + 1] = color.g;
      colors[(triangle * 3 + k) * 3 + 2] = color.b;
    }
  }
  banded.deleteAttribute("uv");
  banded.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  banded.setAttribute("propKind", new THREE.BufferAttribute(new Float32Array(banded.getAttribute("position").count).fill(PROP_KIND.built), 1));
  pieces.push(banded);
  // A door and a few small windows up the tower.
  pieces.push(transformed(box(0.12, 1.9, 0.9, 1.68, 2.15, 0, 0x2a2420, 0), 0, 0, 0, 0));
  for (let index = 0; index < 3; index += 1) {
    const y = 5 + index * 3.6;
    const r = 1.75 - (0.6 * (y - 1.2)) / tower + 0.03;
    pieces.push(transformed(box(0.08, 0.7, 0.4, r, y, 0, 0x1a1d22, 0), 0, 0, 0, index * 2.1));
  }
  const top = 1.2 + tower;
  pieces.push(post(1.75, top, top + 0.28, 0, 0, 0x2a2d31, 24));
  // Gallery railing: posts and a rail.
  for (let index = 0; index < 16; index += 1) {
    const a = (index / 16) * Math.PI * 2;
    pieces.push(post(0.03, top + 0.28, top + 1.1, Math.cos(a) * 1.65, Math.sin(a) * 1.65, 0x2a2d31, 5));
  }
  const rail = new THREE.TorusGeometry(1.65, 0.035, 6, 32);
  rail.rotateX(Math.PI / 2);
  rail.translate(0, top + 1.1, 0);
  pieces.push(painted(rail, solid(0x2a2d31)));
  // The lantern room: glazing that glows at night, under a red cupola.
  const lantern = new THREE.CylinderGeometry(0.95, 0.95, 1.6, 16, 1, true);
  lantern.translate(0, top + 0.28 + 0.8, 0);
  glow.push(painted(lantern, solid(0xffe2a0)));
  for (let index = 0; index < 8; index += 1) {
    const a = (index / 8) * Math.PI * 2;
    pieces.push(post(0.035, top + 0.28, top + 1.9, Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0x1d1f22, 5));
  }
  const cupola = new THREE.ConeGeometry(1.2, 1.1, 20);
  cupola.translate(0, top + 1.88 + 0.55, 0);
  pieces.push(painted(cupola, solid(0xa82a26)));
  pieces.push(post(0.05, top + 2.4, top + 3.0, 0, 0, 0x1d1f22, 5));
  // The keeper's cottage beside the tower: white walls, a red roof.
  pieces.push(box(4.2, 2.6, 3.2, -4.4, 1.3, 0.6, 0xf0ece2, 0.04));
  const roof = new THREE.ConeGeometry(3.2, 1.5, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.05, 1, 0.82);
  roof.translate(-4.4, 2.6 + 0.75, 0.6);
  pieces.push(painted(roof, solid(0xa83b2e, 0.06)));
  glow.push(box(0.06, 0.6, 0.7, -2.27, 1.5, 0.6, 0xffc777, 0));
  const yaw = Math.atan2(-dir.z, dir.x);
  for (const piece of pieces) parts.solid.push(transformed(piece, spot.x, ground, spot.z, yaw));
  for (const piece of glow) parts.glow.push(transformed(piece, spot.x, ground, spot.z, yaw));
  return new THREE.Vector3(spot.x, ground + top + 1.08, spot.z);
}

export type IslandFurniture = {
  /** Island-local meshes: solid parts and the parts that glow at night. */
  solid: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Leaf cards round the bushes (island-local), drawn with the leaf-cluster material. */
  leaves: THREE.BufferGeometry | null;
  pier: PierFootprint | null;
  /** Island-local position of the lighthouse's lamp, if it has one. */
  lamp: THREE.Vector3 | null;
};

/** Builds everything that furnishes an island (see `islandProfile`). */
export function furnishIsland(island: IslandDefinition, profile: IslandProfile, surface: Surface): IslandFurniture {
  const parts: Parts = { solid: [], glow: [], leaves: { positions: [], uvs: [], colors: [], normals: [] } };
  const clearings = islandClearings(island, profile);
  addBoulders(island, profile, surface, parts);
  addShrubs(island, profile, surface, clearings, parts);
  const pier = addPier(island, profile, parts);
  addHut(island, profile, surface, parts);
  const lamp = addLighthouse(island, profile, surface, parts);
  const merge = (list: THREE.BufferGeometry[]) => {
    if (list.length === 0) return null;
    const merged = mergeGeometries(list, false);
    list.forEach((geometry) => geometry.dispose());
    if (merged) computeBoundingSphereFast(merged);
    return merged;
  };
  return { solid: merge(parts.solid), glow: merge(parts.glow), leaves: leafGeometry(parts.leaves), pier, lamp };
}

/** Signed distance from (x, z) to a pier's footprint (negative inside) and the outward normal. */
export function pierClearance(pier: PierFootprint, x: number, z: number, normal: { x: number; z: number }): number {
  const dx = x - pier.x;
  const dz = z - pier.z;
  const along = dx * pier.dirX + dz * pier.dirZ;
  const across = -dx * pier.dirZ + dz * pier.dirX;
  const half = pier.length / 2;
  const qa = Math.abs(along - half) - half;
  const qc = Math.abs(across) - pier.halfWidth;
  const outsideA = Math.max(qa, 0);
  const outsideC = Math.max(qc, 0);
  const distance = Math.hypot(outsideA, outsideC) + Math.min(Math.max(qa, qc), 0);
  // The normal: along the nearer face, or from the nearest corner.
  let na = 0;
  let nc = 0;
  if (outsideA > 0 || outsideC > 0) {
    na = outsideA * Math.sign(along - half);
    nc = outsideC * Math.sign(across);
  } else if (qa > qc) {
    na = Math.sign(along - half);
  } else {
    nc = Math.sign(across);
  }
  const length = Math.hypot(na, nc) || 1;
  normal.x = (na * pier.dirX - nc * pier.dirZ) / length;
  normal.z = (na * pier.dirZ + nc * pier.dirX) / length;
  return distance;
}
