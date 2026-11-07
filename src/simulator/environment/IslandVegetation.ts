import * as THREE from "three";
import { computeBoundingSphereFast } from "../core/FastGeometry";
import { coverageMipmaps } from "./PalmModels";
import { islandEdgeNoise, terrainNoise, type IslandDefinition } from "./IslandMath";

/**
 * The low vegetation that makes an island's ground read as growing things
 * rather than painted turf:
 *
 * - **grass tufts**: clumps of curved blades scattered over the grass, thin
 *   in the interior and dense along the vegetation line, where beach grass
 *   meets the sand in a ragged fringe instead of a ruled edge. Static
 *   geometry merged per island (one draw call), swaying in the breeze in the
 *   vertex shader, drawn only near the camera;
 * - **bushes**: leafy masses of glossy beach-shrub leaves (sea grape,
 *   scaevola): a shadowed core of solid foliage under dozens of cut-out leaf
 *   clumps standing out from it at all angles, lit as a rounded volume,
 *   swaying in the breeze. A walker pushes through them.
 */

/** A deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Bushes ----------------------------------------------------------------------------

/**
 * Share of the leaf texture's width taken by the leaf clump; the strip to its
 * right is solid foliage (no holes), for the shadowed core of each bush.
 */
export const LEAF_ATLAS_SPLIT = 0.875;

/**
 * The bushes' leaf texture: a dense clump of glossy, pointed beach-shrub
 * leaves (scaevola, sea grape) seen from outside the bush, radiating from
 * twigs at its middle, dark deep inside and lit at the tips, with a ragged,
 * leafy outline cut out of the alpha. To its right, a strip of solid
 * foliage for the cores. Coverage-preserving mipmaps keep distant bushes as
 * full as near ones.
 */
export function createLeafClusterTexture(): THREE.DataTexture {
  const size = 512;
  const clumpWidth = Math.round(size * LEAF_ATLAS_SPLIT);
  const rng = random(913);
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  const leaf = (x: number, y: number, length: number, angle: number, hue: number, light: number, saturation: number) => {
    const width = length * (0.36 + rng() * 0.14);
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    // Lit on one side of the midrib, shaded on the other: a leaf folded a little along it.
    const gradient = g.createLinearGradient(0, -width / 2, 0, width / 2);
    gradient.addColorStop(0, `hsl(${hue + 6}, ${saturation}%, ${light + 9}%)`);
    gradient.addColorStop(0.48, `hsl(${hue + 3}, ${saturation}%, ${light + 4}%)`);
    gradient.addColorStop(0.52, `hsl(${hue}, ${saturation + 4}%, ${light - 2}%)`);
    gradient.addColorStop(1, `hsl(${hue - 4}, ${saturation + 6}%, ${light - 7}%)`);
    g.fillStyle = gradient;
    g.beginPath();
    // A pointed ellipse: rounded at the stalk, tapering to a tip.
    g.moveTo(0, 0);
    g.bezierCurveTo(length * 0.22, -width * 0.62, length * 0.72, -width * 0.55, length, 0);
    g.bezierCurveTo(length * 0.72, width * 0.55, length * 0.22, width * 0.62, 0, 0);
    g.fill();
    // A thin, dark rim and a pale midrib.
    g.strokeStyle = `hsla(${hue - 8}, ${saturation}%, ${Math.max(6, light - 14)}%, 0.55)`;
    g.lineWidth = 0.8;
    g.stroke();
    g.strokeStyle = `hsla(${hue + 18}, 35%, ${light + 22}%, 0.55)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(length * 0.04, 0);
    g.lineTo(length * 0.9, 0);
    g.stroke();
    // A glossy highlight along the lit half.
    g.strokeStyle = `hsla(${hue + 25}, 40%, ${light + 34}%, ${0.18 + rng() * 0.2})`;
    g.lineWidth = Math.max(1, width * 0.12);
    g.beginPath();
    g.moveTo(length * 0.25, -width * 0.18);
    g.quadraticCurveTo(length * 0.55, -width * 0.3, length * 0.8, -width * 0.1);
    g.stroke();
    g.restore();
  };
  // Twigs first (seen between the leaves deep inside), then leaves from the
  // back (dark) to the front (bright), each pointing out from the middle.
  const cx = clumpWidth / 2;
  const cy = size / 2;
  g.strokeStyle = "hsl(28, 30%, 16%)";
  g.lineCap = "round";
  for (let twig = 0; twig < 9; twig += 1) {
    const a = (twig / 9) * Math.PI * 2 + rng() * 0.5;
    g.lineWidth = 3 + rng() * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(a + 0.3) * 60, cy + Math.sin(a + 0.3) * 60, cx + Math.cos(a) * 150, cy + Math.sin(a) * 150);
    g.stroke();
  }
  const leaves = 520;
  const reach = Math.min(clumpWidth, size) * 0.47;
  for (let index = 0; index < leaves; index += 1) {
    const depth = index / leaves;
    const a = rng() * Math.PI * 2;
    // Front leaves crowd the middle; the back ones reach out to the ragged rim.
    const r = Math.pow(rng(), 0.75 + depth * 0.6) * reach * (0.62 + 0.38 * (1 - depth * 0.5));
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const length = 26 + rng() * 22;
    const angle = a + (rng() - 0.5) * 1.1;
    const older = rng() < 0.06;
    const hue = older ? 62 + rng() * 10 : 98 + (rng() - 0.5) * 24;
    const light = (older ? 34 : 13) + depth * 22 + rng() * 6;
    const saturation = (older ? 48 : 42) + rng() * 16;
    leaf(x, y, length, angle, hue, light, saturation);
  }
  // The core strip: solid foliage, leaves packed edge to edge, all in shadow.
  g.save();
  g.beginPath();
  g.rect(clumpWidth, 0, size - clumpWidth, size);
  g.clip();
  g.fillStyle = "hsl(104, 40%, 11%)";
  g.fillRect(clumpWidth, 0, size - clumpWidth, size);
  for (let index = 0; index < 260; index += 1) {
    leaf(clumpWidth + rng() * (size - clumpWidth), rng() * size, 18 + rng() * 14, rng() * Math.PI * 2, 100 + (rng() - 0.5) * 20, 12 + rng() * 12, 40 + rng() * 12);
  }
  g.restore();
  const image = g.getImageData(0, 0, size, size).data;
  // The core strip is fully opaque whatever the leaves left.
  for (let y = 0; y < size; y += 1) for (let x = clumpWidth; x < size; x += 1) image[(y * size + x) * 4 + 3] = 255;
  const data = new Uint8Array(image.buffer.slice(0));
  const texture = new THREE.DataTexture(new Uint8Array(data), size, size, THREE.RGBAFormat);
  texture.mipmaps = coverageMipmaps(data, size, size, 0.5);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export type LeafBuffers = { positions: number[]; uvs: number[]; colors: number[]; normals: number[]; sway: number[] };

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchD = new THREE.Vector3();
const scratchN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One leafy mass of a bush, centred at (x, y, z) with radius r, its foot at
 * `ground`: a shadowed core of solid foliage and, over it, a few dozen leaf
 * clumps standing out from its surface at all angles, so it reads as a
 * rounded, leafy volume with a broken outline from any side. Every vertex's
 * normal points out from the mass's middle (lit like a ball of leaves, not
 * like flat cards), darker underneath and deep inside; `sway` grows with
 * height above the ground, for the breeze.
 */
export function leafMass(x: number, y: number, z: number, r: number, ground: number, tint: THREE.Color, seed: number, out: LeafBuffers): void {
  const rng = random(seed);
  const top = y + r;
  const swayAt = (py: number) => Math.max(0, Math.min(1, (py - ground) / Math.max(0.3, top - ground)));
  const shadeAt = (px: number, py: number, pz: number, depth: number, jitter: number) => {
    const height = swayAt(py);
    const ao = (0.5 + 0.5 * height) * (0.62 + 0.38 * depth) * jitter;
    return ao;
  };
  const push = (p: THREE.Vector3, u: number, v: number, shade: number, normal: THREE.Vector3) => {
    out.positions.push(p.x, p.y, p.z);
    out.uvs.push(u, v);
    out.colors.push(tint.r * shade * 1.7, tint.g * shade * 1.7, tint.b * shade * 1.7);
    out.normals.push(normal.x, normal.y, normal.z);
    out.sway.push(swayAt(p.y));
  };
  const sphereNormal = (p: THREE.Vector3, target: THREE.Vector3) =>
    target.set(p.x - x, (p.y - y) * 0.85 + r * 0.25, p.z - z).normalize();

  // The core: an octahedral ball of solid foliage, squashed a little, in shadow.
  const core = r * 0.66;
  const corners: [number, number, number][] = [
    [0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -0.55, 0],
  ];
  const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]] as const;
  // Each face split into four, the new corners pushed out to the ball.
  const lift = (v: THREE.Vector3) => v.normalize().multiplyScalar(core);
  for (const [i0, i1, i2] of faces) {
    const a = scratchA.fromArray(corners[i0]!).normalize().multiplyScalar(core);
    const b = scratchB.fromArray(corners[i1]!).normalize().multiplyScalar(core);
    const c = scratchC.fromArray(corners[i2]!).normalize().multiplyScalar(core);
    const ab = lift(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    const bc = lift(new THREE.Vector3().addVectors(b, c).multiplyScalar(0.5));
    const ca = lift(new THREE.Vector3().addVectors(c, a).multiplyScalar(0.5));
    for (const triangle of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) {
      for (const corner of triangle) {
        const p = scratchD.set(x + corner.x, y + corner.y * 0.85, z + corner.z);
        const u = LEAF_ATLAS_SPLIT + 0.01 + rng() * (0.98 - LEAF_ATLAS_SPLIT);
        push(p, u, rng(), shadeAt(p.x, p.y, p.z, 0.2, 0.85), sphereNormal(p, scratchN));
      }
    }
  }

  // The leaf clumps over it, more on a bigger mass, fewer facing the ground.
  const cards = Math.round(14 + r * 18);
  const across = new THREE.Vector3();
  const along = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();
  for (let card = 0; card < cards; card += 1) {
    // A direction out of the mass, spread evenly (golden spiral) and jittered,
    // the lower hemisphere thinned out.
    const t = (card + 0.5) / cards;
    const elevation = Math.asin(1 - 1.55 * t) + (rng() - 0.5) * 0.25;
    const heading = card * 2.39996 + rng() * 0.6;
    facing.set(Math.cos(elevation) * Math.cos(heading), Math.sin(elevation), Math.cos(elevation) * Math.sin(heading));
    const depth = 0.55 + rng() * 0.4;
    centre.set(x, y, z).addScaledVector(facing, r * depth);
    centre.y = Math.max(centre.y, ground + r * 0.18);
    // The clump's plane: square to the outward direction, rolled at random,
    // tipped a little so neighbours cross each other.
    const tilt = (rng() - 0.5) * 1.0;
    along.crossVectors(Math.abs(facing.y) > 0.92 ? scratchA.set(1, 0, 0) : UP, facing).normalize();
    across.crossVectors(facing, along).normalize();
    const roll = rng() * Math.PI * 2;
    const cos = Math.cos(roll);
    const sin = Math.sin(roll);
    const u0 = scratchB.copy(along).multiplyScalar(cos).addScaledVector(across, sin);
    const v0 = scratchC.copy(across).multiplyScalar(cos).addScaledVector(along, -sin);
    u0.addScaledVector(facing, tilt * 0.4).normalize();
    const half = r * (0.5 + rng() * 0.22);
    const jitter = 0.82 + rng() * 0.34;
    const quad: [number, number, number, number][] = [
      [-1, -1, 0, 1],
      [1, -1, LEAF_ATLAS_SPLIT, 1],
      [1, 1, LEAF_ATLAS_SPLIT, 0],
      [-1, -1, 0, 1],
      [1, 1, LEAF_ATLAS_SPLIT, 0],
      [-1, 1, 0, 0],
    ];
    for (const [a, b, u, v] of quad) {
      corner.copy(centre).addScaledVector(u0, a * half).addScaledVector(v0, b * half);
      push(corner, u, v, shadeAt(corner.x, corner.y, corner.z, depth, jitter), sphereNormal(corner, scratchN));
    }
  }
}

export function leafGeometry(out: LeafBuffers): THREE.BufferGeometry | null {
  if (out.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(out.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(out.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(out.colors, 3));
  geometry.setAttribute("leafSway", new THREE.Float32BufferAttribute(out.sway, 1));
  computeBoundingSphereFast(geometry);
  return geometry;
}

// --- Grass ----------------------------------------------------------------------------

/** Most tufts on one island (the spacing widens on a large island to stay under this). */
export const MAX_TUFTS = 2600;

/** Where an island's turf is (radial is the terrain's own, see `IslandSystem.createIslandTerrain`). */
export function grassAmount(island: IslandDefinition, x: number, z: number): { grass: number; radial: number; angle: number } {
  const angle = Math.atan2(z / island.scaleZ, x);
  const radial = Math.hypot(x, z / island.scaleZ) / (island.beachRadius * islandEdgeNoise(angle, island));
  const patch = terrainNoise(x * 0.11 + island.seed * 17.3, z * 0.11 - island.seed * 9.1);
  const edge = 0.7 + (patch - 0.5) * 0.16;
  // Full turf inside the vegetation line, a fringe straggling onto the sand.
  const grass = radial < edge - 0.06 ? 1 : radial < edge + 0.05 ? 1 - (radial - (edge - 0.06)) / 0.11 : 0;
  return { grass, radial, angle };
}

/**
 * Grass tufts for one island, in island-local space. `ground(radial, angle)`
 * is the terrain height, `blocked(x, z)` excludes clearings and buildings.
 * Each tuft is a handful of blades leaning out from its root, each blade a
 * tapered, curving strip of three triangles; `sway` (0 at the root, 1 at
 * the tip) drives the wind.
 */
export function buildGrass(
  island: IslandDefinition,
  ground: (radial: number, angle: number) => number,
  blocked: (x: number, z: number) => boolean,
): THREE.BufferGeometry | null {
  if (island.volcano || island.beachRadius < 12) return null;
  const rng = random(island.id ^ 0x5bd1e995);
  const reach = island.beachRadius * Math.max(1, island.scaleZ) * 0.85;
  // Spacing of the scatter inside the turf; the fringe is three times denser.
  let spacing = 2.2;
  const area = Math.PI * reach * reach * 0.5;
  if (area / (spacing * spacing) > MAX_TUFTS * 0.65) spacing = Math.sqrt(area / (MAX_TUFTS * 0.65));
  // Written straight into typed arrays (an island holds up to some 200k
  // vertices), sized once for the most tufts this island can take: no array
  // per vertex, no regrowing, no copy from a JS array at the end.
  const clump = spacing * 2.4;
  const around = Math.round((Math.PI * 2 * island.beachRadius * 0.72) / 0.6);
  const candidates = (Math.floor((2 * reach) / clump) + 1) ** 2 * MAX_TUSSOCK_TUFTS + around * 3;
  const buffers = new GrassBuffers(Math.min(MAX_TUFTS, candidates) * MAX_BLADES * GRASS_BLADE_VERTICES);
  const base = new THREE.Color();
  const tip = new THREE.Color();
  let tufts = 0;
  const plant = (x: number, z: number, scale: number, dry: number) => {
    const { grass, radial, angle } = grassAmount(island, x, z);
    if (grass <= 0.05 || blocked(x, z) || tufts >= MAX_TUFTS) return;
    tufts += 1;
    const y = ground(Math.min(radial, 1.02), angle) - 0.03;
    const blades = 5 + Math.floor(rng() * (MAX_BLADES - 4));
    const height = (0.28 + rng() * 0.32) * scale * (0.6 + 0.4 * grass);
    base.setRGB(0.09, 0.2 + rng() * 0.05, 0.05);
    tip.setRGB(0.32 + dry * 0.3, 0.5 + dry * 0.1, 0.16 + dry * 0.02);
    buffers.reserve(blades * GRASS_BLADE_VERTICES);
    for (let blade = 0; blade < blades; blade += 1) {
      const heading = rng() * Math.PI * 2;
      const lean = 0.25 + rng() * 0.55;
      const h = height * (0.65 + rng() * 0.5);
      const w = 0.018 + rng() * 0.012;
      const dx = Math.cos(heading);
      const dz = Math.sin(heading);
      // Across the blade: square to its lean, flat to the ground.
      const ax = -dz * w;
      const az = dx * w;
      const ox = x + (rng() - 0.5) * 0.12;
      const oz = z + (rng() - 0.5) * 0.12;
      // Three stations up the blade (t = 0, ½, 1), bending further out as it
      // rises; the blade narrows from full width to 0.7 to a point.
      const bend = Math.sin(lean) * h;
      const out1 = bend * 0.25;
      const x1 = ox + dx * out1;
      const y1 = y + Math.cos(lean * 0.5) * h * 0.5;
      const z1 = oz + dz * out1;
      const x2 = ox + dx * bend;
      const y2 = y + Math.cos(lean) * h;
      const z2 = oz + dz * bend;
      // Grass is lit like the ground it covers (normals toward the sky),
      // with a hint of the blade's own facing so tufts are not flat.
      const nx = dx * 0.25;
      const nz = dz * 0.25;
      buffers.quad(ox, y, oz, 1, 0, x1, y1, z1, 0.7, 0.5, ax, az, nx, nz, h, base, tip);
      buffers.quad(x1, y1, z1, 0.7, 0.5, x2, y2, z2, 0, 1, ax, az, nx, nz, h, base, tip);
    }
  };
  // Tussocks: clumps of tufts round a jittered grid of centres, a few
  // metres apart, thick where the ground is wild and absent on short turf.
  for (let gx = -reach; gx <= reach; gx += clump) {
    for (let gz = -reach; gz <= reach; gz += clump) {
      const cx = gx + (rng() - 0.5) * clump;
      const cz = gz + (rng() - 0.5) * clump;
      const wild = terrainNoise(cx * 0.05 + 11.3, cz * 0.05 - 4.1);
      if (wild < 0.35) continue;
      const dry = terrainNoise(cx * 0.07 + 3.1, cz * 0.07) > 0.6 ? 0.75 : rng() * 0.3;
      const count = 3 + Math.floor(wild * (MAX_TUSSOCK_TUFTS - 2));
      for (let tuft = 0; tuft < count; tuft += 1) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 1.1;
        plant(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.75 + rng() * 0.6 + wild * 0.3, dry);
      }
    }
  }
  // The fringe along the vegetation line: dense, taller beach grass.
  for (let index = 0; index < around; index += 1) {
    for (let row = 0; row < 3; row += 1) {
      const angle = (index + rng()) / around * Math.PI * 2;
      const edgeRadial = 0.7 + (terrainNoise(Math.cos(angle) * island.beachRadius * 0.077 + island.seed * 17.3, Math.sin(angle) * island.beachRadius * 0.077 - island.seed * 9.1) - 0.5) * 0.16;
      const radial = edgeRadial + (rng() - 0.6) * 0.07 - row * 0.03;
      const r = island.beachRadius * radial * islandEdgeNoise(angle, island);
      plant(Math.cos(angle) * r, Math.sin(angle) * r * island.scaleZ, 1.1 + rng() * 0.6, 0.35 + rng() * 0.4);
    }
  }
  return buffers.geometry();
}

/** Vertices of one blade: two quads of two triangles. */
const GRASS_BLADE_VERTICES = 12;
/** Most blades in a tuft (5…7). */
const MAX_BLADES = 7;
/** Most tufts round one tussock centre (3…8: wild ground is below 1). */
const MAX_TUSSOCK_TUFTS = 8;

/** Growable typed arrays for the grass vertices (position, normal, colour, sway). */
class GrassBuffers {
  private capacity: number;
  private count = 0;
  private positions: Float32Array;
  private normals: Float32Array;
  private colors: Float32Array;
  private sway: Float32Array;

  /** `capacity` vertices to start with (more are made room for if needed). */
  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.ceil(capacity));
    this.positions = new Float32Array(this.capacity * 3);
    this.normals = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sway = new Float32Array(this.capacity);
  }

  /** Room for `vertices` more. */
  reserve(vertices: number): void {
    const needed = this.count + vertices;
    if (needed <= this.capacity) return;
    const capacity = Math.max(needed, this.capacity * 2, 4096);
    const grow = (array: Float32Array, size: number): Float32Array<ArrayBuffer> => {
      const next = new Float32Array(capacity * size);
      next.set(array.subarray(0, this.count * size));
      return next;
    };
    this.positions = grow(this.positions, 3);
    this.normals = grow(this.normals, 3);
    this.colors = grow(this.colors, 3);
    this.sway = grow(this.sway, 1);
    this.capacity = capacity;
  }

  /**
   * One segment of a blade from (x0, y0, z0) to (x1, y1, z1): half-widths
   * `w0`, `w1` times the across vector (ax, az), and `t0`, `t1` up the blade
   * for the colour (root `base` to `tip`) and the sway (t² of height `h`).
   */
  quad(
    x0: number, y0: number, z0: number, w0: number, t0: number,
    x1: number, y1: number, z1: number, w1: number, t1: number,
    ax: number, az: number, nx: number, nz: number, h: number,
    base: THREE.Color, tip: THREE.Color,
  ): void {
    this.vertex(x0 - ax * w0, y0, z0 - az * w0, t0, nx, nz, h, base, tip);
    this.vertex(x0 + ax * w0, y0, z0 + az * w0, t0, nx, nz, h, base, tip);
    this.vertex(x1 + ax * w1, y1, z1 + az * w1, t1, nx, nz, h, base, tip);
    this.vertex(x0 - ax * w0, y0, z0 - az * w0, t0, nx, nz, h, base, tip);
    this.vertex(x1 + ax * w1, y1, z1 + az * w1, t1, nx, nz, h, base, tip);
    this.vertex(x1 - ax * w1, y1, z1 - az * w1, t1, nx, nz, h, base, tip);
  }

  private vertex(x: number, y: number, z: number, t: number, nx: number, nz: number, h: number, base: THREE.Color, tip: THREE.Color): void {
    const index = this.count;
    this.count += 1;
    const i3 = index * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.normals[i3] = nx;
    this.normals[i3 + 1] = 0.95;
    this.normals[i3 + 2] = nz;
    this.colors[i3] = base.r + (tip.r - base.r) * t;
    this.colors[i3 + 1] = base.g + (tip.g - base.g) * t;
    this.colors[i3 + 2] = base.b + (tip.b - base.b) * t;
    this.sway[index] = t * t * h;
  }

  /**
   * The finished geometry, or null when nothing grew. Arrays mostly filled
   * are handed over as views (no copy; the GPU gets only the vertices), the
   * others cut to size so an island does not keep the spare room.
   */
  geometry(): THREE.BufferGeometry | null {
    if (this.count === 0) return null;
    const count = this.count;
    const view = count >= this.capacity * 0.75;
    const cut = (array: Float32Array, size: number) => (view ? array.subarray(0, count * size) : array.slice(0, count * size));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(cut(this.positions, 3), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(cut(this.normals, 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(cut(this.colors, 3), 3));
    geometry.setAttribute("sway", new THREE.BufferAttribute(cut(this.sway, 1), 1));
    computeBoundingSphereFast(geometry);
    return geometry;
  }
}

/** The grass material: vertex colours, both faces, a breeze that moves the tips. */
export function createGrassMaterial(time: { value: number }, strength: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ name: "IslandGrass", vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = time;
    shader.uniforms.uGrassStrength = strength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float sway;\nuniform float uGrassTime;\nuniform float uGrassStrength;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           vec4 rootWorld = modelMatrix * vec4(position, 1.0);
           float gust = sin(uGrassTime * 1.7 + rootWorld.x * 0.31 + rootWorld.z * 0.23) * 0.6 + sin(uGrassTime * 3.9 + rootWorld.x * 1.3) * 0.25;
           transformed.x += sway * (0.35 + gust) * 0.22 * uGrassStrength;
           transformed.z += sway * (0.2 + gust * 0.6) * 0.14 * uGrassStrength;
         }`,
      );
  };
  material.customProgramCacheKey = () => "island-grass-v1";
  return material;
}
