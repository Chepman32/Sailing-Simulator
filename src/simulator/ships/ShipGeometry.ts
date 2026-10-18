import * as THREE from "three";
import { hullHalfWidth, SHIP_SPECS, type ShipKind } from "./ShipMath";

/**
 * Procedural ships: a lofted steel hull with a raked stem, flared bow, sheer
 * and transom, painted in bands (antifouling below the boot top, topsides,
 * deck), and the superstructure of each type: container stacks, a tanker's
 * pipe deck and manifold, a bulk carrier's hatches and cranes, a cruise
 * liner's terraced decks of balconies and lifeboats, a car carrier's slab
 * sides. Every ship is one geometry with vertex colours and one material, so
 * it costs a single draw call.
 *
 * A `light` attribute (rgb intensity, w channel) marks what glows at night:
 * windows and deck lights (channel 0), the navigation lights of a ship under
 * way (1), and the anchor lights of a ship at anchor (2).
 *
 * Ship frame: +Z toward the bow, +X to starboard, +Y up, origin on the
 * waterline amidships; the hull's waterplane is exactly `hullHalfWidth`.
 */

type Vec3 = [number, number, number];

const WINDOW_LIGHT: Vec3 = [1.0, 0.72, 0.42];
const MASTHEAD: Vec3 = [5, 5, 4.6];
const PORT_LIGHT: Vec3 = [6, 0.25, 0.2];
const STARBOARD_LIGHT: Vec3 = [0.2, 6, 1.2];

function linear(hex: number): Vec3 {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

/** Accumulates flat- or smooth-shaded triangles with colour and light. */
class ShipBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly lights: number[] = [];
  /** Lamps and lit windows seen as points of light from afar: x, y, z and r, g, b, channel. */
  readonly beacons: number[] = [];

  triangle(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    color: Vec3,
    light: [number, number, number, number] = [0, 0, 0, 0],
    normals?: [Vec3, Vec3, Vec3],
  ): void {
    const flat = normals ? undefined : faceNormal(a, b, c);
    [a, b, c].forEach((point, index) => {
      this.positions.push(point[0], point[1], point[2]);
      const normal = normals ? normals[index]! : flat!;
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
      this.lights.push(light[0], light[1], light[2], light[3]);
    });
  }

  /** a, b, c, d counter-clockwise seen from the side the face looks toward. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3, light?: [number, number, number, number]): void {
    this.triangle(a, b, c, color, light);
    this.triangle(a, c, d, color, light);
  }

  /**
   * An axis-aligned box (x across, y up, z along), without its bottom face
   * unless asked: it always stands on something.
   */
  box(
    centerX: number,
    bottom: number,
    centerZ: number,
    sizeX: number,
    height: number,
    sizeZ: number,
    color: Vec3,
    options: { light?: [number, number, number, number]; bottomFace?: boolean; top?: Vec3 } = {},
  ): void {
    const x0 = centerX - sizeX / 2;
    const x1 = centerX + sizeX / 2;
    const y0 = bottom;
    const y1 = bottom + height;
    const z0 = centerZ - sizeZ / 2;
    const z1 = centerZ + sizeZ / 2;
    const light = options.light;
    // +Y
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], options.top ?? color, light);
    // +X (starboard)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, light);
    // −X (port)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, light);
    // +Z (forward)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, light);
    // −Z (aft)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, light);
    if (options.bottomFace) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, light);
  }

  /** A box given by its centre and three (orthogonal) half axes, for slanted parts. */
  orientedBox(center: Vec3, axisX: Vec3, axisY: Vec3, axisZ: Vec3, color: Vec3): void {
    const corner = (sx: number, sy: number, sz: number): Vec3 => [
      center[0] + axisX[0] * sx + axisY[0] * sy + axisZ[0] * sz,
      center[1] + axisX[1] * sx + axisY[1] * sy + axisZ[1] * sz,
      center[2] + axisX[2] * sx + axisY[2] * sy + axisZ[2] * sz,
    ];
    const faces: [number, number, number][][] = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
      [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
      [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
      [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    ];
    for (const face of faces) {
      const [a, b, c, d] = face.map(([sx, sy, sz]) => corner(sx, sy, sz)) as [Vec3, Vec3, Vec3, Vec3];
      // Wind each face outward whatever the handedness of the axes.
      const normal = faceNormal(a, b, c);
      const mid: Vec3 = [(a[0] + c[0]) / 2 - center[0], (a[1] + c[1]) / 2 - center[1], (a[2] + c[2]) / 2 - center[2]];
      if (normal[0] * mid[0] + normal[1] * mid[1] + normal[2] * mid[2] < 0) this.quad(d, c, b, a, color);
      else this.quad(a, b, c, d, color);
    }
  }

  /**
   * An upright elliptical prism (funnels, crane pedestals, masts), smooth
   * sides, flat top in `topColor`.
   */
  prism(
    centerX: number,
    centerZ: number,
    bottom: number,
    top: number,
    radiusX: number,
    radiusZ: number,
    color: Vec3,
    topColor: Vec3 = color,
    sides = 10,
    topScale = 1,
  ): void {
    for (let index = 0; index < sides; index += 1) {
      const a0 = (index / sides) * Math.PI * 2;
      const a1 = ((index + 1) / sides) * Math.PI * 2;
      const p = (angle: number, y: number, scale: number): Vec3 => [
        centerX + Math.sin(angle) * radiusX * scale,
        y,
        centerZ + Math.cos(angle) * radiusZ * scale,
      ];
      const n = (angle: number): Vec3 => normalize([Math.sin(angle) / radiusX, 0, Math.cos(angle) / radiusZ]);
      const b0 = p(a0, bottom, 1);
      const b1 = p(a1, bottom, 1);
      const t0 = p(a0, top, topScale);
      const t1 = p(a1, top, topScale);
      this.triangle(b0, b1, t1, color, undefined, [n(a0), n(a1), n(a1)]);
      this.triangle(b0, t1, t0, color, undefined, [n(a0), n(a1), n(a0)]);
      this.triangle([centerX, top, centerZ], t0, t1, topColor);
    }
  }

  /** A small lamp: a cube that glows at night in `light` on `channel`. */
  lamp(x: number, y: number, z: number, light: Vec3, channel: number, size = 0.7): void {
    this.beacon(x, y, z, light, channel);
    this.box(x, y - size / 2, z, size, size, size, [0.9, 0.9, 0.85], {
      light: [light[0], light[1], light[2], channel],
      bottomFace: true,
    });
  }

  beacon(x: number, y: number, z: number, light: Vec3, channel: number): void {
    this.beacons.push(x, y, z, light[0], light[1], light[2], channel);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("shipLight", new THREE.Float32BufferAttribute(this.lights, 4));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  /** The points of light a distant ship shows at night. */
  buildBeacons(): THREE.BufferGeometry {
    const count = this.beacons.length / 7;
    const positions = new Float32Array(count * 3);
    const lights = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) {
      positions.set(this.beacons.slice(index * 7, index * 7 + 3), index * 3);
      lights.set(this.beacons.slice(index * 7 + 3, index * 7 + 7), index * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("shipLight", new THREE.BufferAttribute(lights, 4));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Deterministic noise for per-ship variation (container colours, lit windows). */
function hash(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export type HullPaint = {
  bottom: Vec3;
  bootTop: Vec3;
  topside: Vec3;
  /** Optional band along the top of the topsides (a sheer stripe). */
  stripe?: Vec3;
  deck: Vec3;
};

type HullOptions = {
  halfLength: number;
  halfBeam: number;
  draft: number;
  freeboard: number;
  /** Rise of the deck toward the bow, metres. */
  sheer: number;
  /** How far the stem rakes forward at deck level, metres. */
  rake: number;
  /** Outward flare of the bow topsides, as a fraction of the beam. */
  flare: number;
  paint: HullPaint;
};

/** Deck height above the waterline at `along` metres forward of midships. */
function deckHeight(options: HullOptions, along: number): number {
  const t = THREE.MathUtils.smoothstep(along / options.halfLength, 0.45, 1.05);
  return options.freeboard + options.sheer * t * t;
}

/**
 * The hull: stations along the length, each a section from the port deck
 * edge round the bilge and the flat bottom to the starboard deck edge. At
 * height y the waterplane is shifted forward by the stem's rake (above the
 * water) or aft (the forefoot, below it), so the bow is a raked, curved stem.
 */
function buildHull(builder: ShipBuilder, options: HullOptions): void {
  const { halfLength, halfBeam, draft, rake, flare, paint } = options;
  // Station positions: denser at the ends, where the shape changes.
  const stations: number[] = [];
  const count = 64;
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
    stations.push(-halfLength + (halfLength * 2 + rake) * (0.35 * t + 0.65 * eased));
  }
  const width = (along: number, y: number, deck: number): number => {
    const shift = y > 0 ? rake * (y / Math.max(deck, 1)) : draft * 0.35 * (y / draft);
    const base = hullHalfWidth(halfLength, halfBeam, along - shift);
    const bow = THREE.MathUtils.smoothstep(along / halfLength, 0.35, 1);
    const flared = y > 0 ? 1 + flare * bow * (y / Math.max(deck, 1)) : 1;
    // The flat bottom narrows into the bilge.
    const bilge = y < 0 ? 1 - 0.1 * Math.pow(-y / draft, 6) : 1;
    return Math.min(halfBeam * 1.02, base * flared * bilge);
  };
  // Heights of the section points from the deck edge down to the keel, with
  // the paint band each segment below it belongs to.
  type Level = { y: (deck: number) => number; band: Vec3 };
  const topside = paint.topside;
  const levels: Level[] = [
    { y: (deck) => deck, band: paint.stripe ?? topside },
    { y: (deck) => deck - (paint.stripe ? 2.2 : 0.8), band: topside },
    { y: (deck) => deck * 0.5, band: topside },
    { y: () => 1.1, band: paint.bootTop },
    { y: () => -0.7, band: paint.bottom },
    { y: () => -draft * 0.6, band: paint.bottom },
    { y: () => -draft * 0.93, band: paint.bottom },
    { y: () => -draft, band: paint.bottom },
  ];
  // Grid of section points: ring index runs port deck edge → keel → starboard deck edge.
  const ring = levels.length * 2;
  const grid: Vec3[][] = stations.map((along) => {
    const deck = deckHeight(options, along);
    const starboard = levels.map((level) => {
      const y = level.y(deck);
      const bottomWidth = level === levels[levels.length - 1] ? 0.86 : 1;
      return [width(along, y, deck) * bottomWidth, y, along] as Vec3;
    });
    // Port side from the deck edge down to the keel, then starboard back up.
    const port = starboard.map(([x, y, z]) => [-x, y, z] as Vec3);
    return [...port, ...[...starboard].reverse()];
  });
  const bandOf = (index: number): Vec3 => {
    // Segment between ring points index and index+1; it takes the band of
    // its upper end.
    const half = levels.length;
    const level = index < half ? index : 2 * half - 2 - index;
    return levels[Math.max(0, Math.min(levels.length - 1, level))]!.band;
  };
  // Smooth normals from the grid's tangents.
  const normals: Vec3[][] = grid.map((section, i) =>
    section.map((point, j) => {
      const previous = grid[Math.max(0, i - 1)]![j]!;
      const next = grid[Math.min(grid.length - 1, i + 1)]![j]!;
      const up = section[Math.max(0, j - 1)]!;
      const down = section[Math.min(ring - 1, j + 1)]!;
      const along: Vec3 = [next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]];
      const around: Vec3 = [down[0] - up[0], down[1] - up[1], down[2] - up[2]];
      let normal = normalize([
        around[1] * along[2] - around[2] * along[1],
        around[2] * along[0] - around[0] * along[2],
        around[0] * along[1] - around[1] * along[0],
      ]);
      const outward: Vec3 = [point[0], (point[1] + draft * 0.4) * 0.6, point[2] * (halfBeam / halfLength) * 0.4];
      if (normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];
      // The flat bottom faces straight down.
      if (j === levels.length - 1 || j === levels.length) normal = [0, -1, 0];
      return normal;
    }),
  );
  for (let i = 0; i < grid.length - 1; i += 1) {
    for (let j = 0; j < ring - 1; j += 1) {
      if (j === levels.length - 1) {
        // Across the keel: the flat bottom.
        const a = grid[i]![j]!;
        const b = grid[i]![j + 1]!;
        const c = grid[i + 1]![j + 1]!;
        const d = grid[i + 1]![j]!;
        if (Math.abs(a[0] - b[0]) + Math.abs(c[0] - d[0]) < 1e-3) continue;
        builder.quad(a, b, c, d, paint.bottom);
        continue;
      }
      const a = grid[i]![j]!;
      const b = grid[i]![j + 1]!;
      const c = grid[i + 1]![j + 1]!;
      const d = grid[i + 1]![j]!;
      // Degenerate at the closed stem: skip zero-area pieces.
      if (Math.abs(a[0]) + Math.abs(b[0]) + Math.abs(c[0]) + Math.abs(d[0]) < 1e-4) continue;
      const na = normals[i]![j]!;
      const nb = normals[i]![j + 1]!;
      const nc = normals[i + 1]![j + 1]!;
      const nd = normals[i + 1]![j]!;
      const color = bandOf(j);
      const face = faceNormal(a, b, c);
      const average: Vec3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      if (face[0] * average[0] + face[1] * average[1] + face[2] * average[2] >= 0) {
        builder.triangle(a, b, c, color, undefined, [na, nb, nc]);
        builder.triangle(a, c, d, color, undefined, [na, nc, nd]);
      } else {
        builder.triangle(a, c, b, color, undefined, [na, nc, nb]);
        builder.triangle(a, d, c, color, undefined, [na, nd, nc]);
      }
    }
  }
  // Main deck, following the sheer.
  for (let i = 0; i < grid.length - 1; i += 1) {
    const a = grid[i]![0]!;
    const b = grid[i]![ring - 1]!;
    const c = grid[i + 1]![ring - 1]!;
    const d = grid[i + 1]![0]!;
    if (b[0] - a[0] + (c[0] - d[0]) < 1e-3) continue;
    builder.quad(a, d, c, b, paint.deck);
  }
  // Transom.
  const stern = grid[0]!;
  const centre: Vec3 = [0, (stern[0]![1] - draft) / 2, stern[0]![2]];
  for (let j = 0; j < ring - 1; j += 1) {
    const a = stern[j]!;
    const b = stern[j + 1]!;
    const y = (a[1] + b[1]) / 2;
    const color = y < -0.7 ? paint.bottom : y < 1.1 ? paint.bootTop : paint.topside;
    const face = faceNormal(centre, b, a);
    if (face[2] <= 0) builder.triangle(centre, b, a, color);
    else builder.triangle(centre, a, b, color);
  }
  // The top of the transom, between the two deck edges.
  const left = stern[0]!;
  const right = stern[ring - 1]!;
  if (faceNormal(centre, right, left)[2] <= 0) builder.triangle(centre, right, left, paint.topside);
  else builder.triangle(centre, left, right, paint.topside);
}

/**
 * A deckhouse of `decks` storeys with a band of windows on every storey,
 * lit at night window by window. `front` and `aft` are along-ship positions.
 */
function deckhouse(
  builder: ShipBuilder,
  options: {
    base: number;
    aft: number;
    front: number;
    halfWidth: number;
    decks: number;
    deckHeight?: number;
    wall: Vec3;
    glass: Vec3;
    seed: number;
    litFraction?: number;
    /** Windows on the aft face as well (cruise ships). */
    aftWindows?: boolean;
  },
): void {
  const storey = options.deckHeight ?? 2.9;
  const length = options.front - options.aft;
  const centreZ = (options.front + options.aft) / 2;
  const lit = options.litFraction ?? 0.6;
  for (let deck = 0; deck < options.decks; deck += 1) {
    const y = options.base + deck * storey;
    builder.box(0, y, centreZ, options.halfWidth * 2, storey, length, options.wall);
    // Window bands, proud of the wall so they never z-fight with it.
    const bandBottom = y + storey * 0.38;
    const bandHeight = storey * 0.36;
    const segment = 3.2;
    const segments = Math.max(1, Math.floor(length / segment));
    for (const side of [-1, 1]) {
      for (let index = 0; index < segments; index += 1) {
        const z0 = options.aft + (index + 0.15) * (length / segments);
        const z1 = options.aft + (index + 0.85) * (length / segments);
        const x = side * (options.halfWidth + 0.04);
        const on = hash(options.seed + deck * 31.7 + index * 7.3 + side * 3.1) < lit ? 1 : 0;
        if (on && index % 2 === 0) {
          builder.beacon(side * (options.halfWidth + 0.3), bandBottom + bandHeight * 0.5, (z0 + z1) / 2, [WINDOW_LIGHT[0] * 0.5, WINDOW_LIGHT[1] * 0.5, WINDOW_LIGHT[2] * 0.5], 0);
        }
        const glow: [number, number, number, number] = [WINDOW_LIGHT[0] * on, WINDOW_LIGHT[1] * on, WINDOW_LIGHT[2] * on, 0];
        if (side > 0) builder.quad([x, bandBottom, z1], [x, bandBottom, z0], [x, bandBottom + bandHeight, z0], [x, bandBottom + bandHeight, z1], options.glass, glow);
        else builder.quad([x, bandBottom, z0], [x, bandBottom, z1], [x, bandBottom + bandHeight, z1], [x, bandBottom + bandHeight, z0], options.glass, glow);
      }
    }
    // Front (and aft) faces.
    const across = Math.max(1, Math.floor((options.halfWidth * 2) / segment));
    const faces = options.aftWindows ? [1, -1] : [1];
    for (const face of faces) {
      const z = face > 0 ? options.front + 0.04 : options.aft - 0.04;
      for (let index = 0; index < across; index += 1) {
        const x0 = -options.halfWidth + (index + 0.15) * ((options.halfWidth * 2) / across);
        const x1 = -options.halfWidth + (index + 0.85) * ((options.halfWidth * 2) / across);
        const on = hash(options.seed + deck * 13.1 + index * 5.7 + face * 9.9) < lit ? 1 : 0;
        const glow: [number, number, number, number] = [WINDOW_LIGHT[0] * on, WINDOW_LIGHT[1] * on, WINDOW_LIGHT[2] * on, 0];
        if (face > 0) builder.quad([x0, bandBottom, z], [x1, bandBottom, z], [x1, bandBottom + bandHeight, z], [x0, bandBottom + bandHeight, z], options.glass, glow);
        else builder.quad([x1, bandBottom, z], [x0, bandBottom, z], [x0, bandBottom + bandHeight, z], [x1, bandBottom + bandHeight, z], options.glass, glow);
      }
    }
  }
}

/** Navigation bridge with wings across the full beam, its windows facing forward. */
function bridge(builder: ShipBuilder, base: number, z: number, halfBeam: number, wall: Vec3, glass: Vec3, seed: number): void {
  builder.box(0, base, z, halfBeam * 1.2, 3, 9, wall);
  // Wings out to the ship's side.
  builder.box(0, base + 1.6, z + 2.5, halfBeam * 2.02, 1.4, 4, wall);
  // A continuous band of bridge windows across the front.
  const y = base + 1.2;
  const x = halfBeam * 0.6;
  builder.quad([-x, y, z + 4.54], [x, y, z + 4.54], [x, y + 1.3, z + 4.54], [-x, y + 1.3, z + 4.54], glass, [0.25, 0.3, 0.32, 0]);
  // Sidelights on the wing ends: red to port, green to starboard. With the
  // bow along +Z, local +X is the port side as the view shows it.
  builder.lamp(halfBeam + 0.2, base + 3.4, z + 3.2, PORT_LIGHT, 1);
  builder.lamp(-halfBeam - 0.2, base + 3.4, z + 3.2, STARBOARD_LIGHT, 1);
  // Radar mast with the masthead light.
  builder.box(0, base + 3, z - 1, 0.6, 7, 0.6, wall);
  builder.box(0, base + 8.2, z - 1, 5, 0.4, 0.5, [0.2, 0.2, 0.2]);
  builder.lamp(0, base + 10.3, z - 1, MASTHEAD, 1);
  builder.lamp(0, base + 10.3, z - 1.9, MASTHEAD, 2, 0.6);
  void seed;
}

function funnel(builder: ShipBuilder, z: number, base: number, height: number, radiusX: number, radiusZ: number, color: Vec3, band: Vec3): void {
  const bandBottom = base + height * 0.62;
  builder.prism(0, z, base, bandBottom, radiusX, radiusZ, color, color, 12, 0.98);
  builder.prism(0, z - 0.4, bandBottom, base + height * 0.86, radiusX * 0.98, radiusZ * 0.98, band, band, 12, 0.97);
  builder.prism(0, z - 0.7, base + height * 0.86, base + height, radiusX * 0.95, radiusZ * 0.95, [0.04, 0.04, 0.04], [0.02, 0.02, 0.02], 12, 0.96);
}

/**
 * What makes a steel side read as a ship close up: the anchors stowed in
 * their hawse pipes at the bow, white draught marks at bow, midships and
 * stern, a pale rubbing strake under the deck edge, and the line of the
 * bulwark rail.
 */
function hullFittings(builder: ShipBuilder, hull: HullOptions, kind: ShipKind): void {
  const { halfLength, halfBeam, draft } = hull;
  const white = linear(0xe9e9e4);
  const anchor = linear(0x2a2a2a);
  const surface = (along: number, y: number, side: number, out = 0.06): Vec3 => {
    const deck = deckHeight(hull, along);
    const shift = y > 0 ? hull.rake * (y / Math.max(deck, 1)) : 0;
    const bow = THREE.MathUtils.smoothstep(along / halfLength, 0.35, 1);
    const flared = y > 0 ? 1 + hull.flare * bow * (y / Math.max(deck, 1)) : 1;
    return [side * (Math.min(halfBeam * 1.02, hullHalfWidth(halfLength, halfBeam, along - shift) * flared) + out), y, along];
  };
  const patch = (along: number, y: number, side: number, width: number, height: number, color: Vec3, out = 0.06): void => {
    const a = surface(along - width / 2, y, side, out);
    const b = surface(along + width / 2, y, side, out);
    const c = surface(along + width / 2, y + height, side, out);
    const d = surface(along - width / 2, y + height, side, out);
    if (side > 0) builder.quad(a, d, c, b, color);
    else builder.quad(a, b, c, d, color);
  };
  for (const side of [-1, 1]) {
    // Hawse pipe and the stowed anchor.
    const hawseAlong = halfLength * 0.9;
    const hawseY = deckHeight(hull, hawseAlong) - 4.2;
    patch(hawseAlong, hawseY, side, 2.4, 2.2, linear(0x111111), 0.05);
    patch(hawseAlong - 0.1, hawseY - 2.2, side, 1.6, 2.6, anchor, 0.25);
    // Draught marks: a column of white ticks at bow, midships and stern.
    for (const along of [halfLength * 0.82, 0, -halfLength * 0.9]) {
      for (let y = -1; y < Math.min(hull.freeboard - 2, draft * 0.9 + 1); y += 1) {
        patch(along, y + 0.4, side, 0.6, 0.12, white, 0.07);
      }
    }
    if (kind !== "cruise" && kind !== "carrier") {
      // A pale rubbing strake a metre under the deck edge.
      for (let along = -halfLength * 0.95; along < halfLength * 0.9; along += 6) {
        patch(along + 3, deckHeight(hull, along + 3) - 1.3, side, 6.05, 0.22, linear(0x9a9a92), 0.05);
      }
    }
  }
}

const PAINTS: Record<ShipKind, HullPaint[]> = {
  container: [
    { bottom: linear(0x7a2a22), bootTop: linear(0x1d1d1d), topside: linear(0x1f3550), deck: linear(0x55595c) },
    { bottom: linear(0x7a2a22), bootTop: linear(0x1d1d1d), topside: linear(0x2b2d30), deck: linear(0x55595c) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x1d1d1d), topside: linear(0x7d2424), deck: linear(0x55595c) },
  ],
  tanker: [
    { bottom: linear(0x6e2a26), bootTop: linear(0x141414), topside: linear(0x1c1c1e), deck: linear(0x5b6b48) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x141414), topside: linear(0x5a1d1d), deck: linear(0x606a52) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x141414), topside: linear(0x22303f), deck: linear(0x6b4a3a) },
  ],
  cruise: [
    { bottom: linear(0x4a1f22), bootTop: linear(0x1b2d4a), topside: linear(0xf0f1ee), stripe: linear(0x1b3a6b), deck: linear(0x9a7b5b) },
    { bottom: linear(0x4a1f22), bootTop: linear(0x22252a), topside: linear(0xf2f2ef), stripe: linear(0x0d5c75), deck: linear(0x9a7b5b) },
    { bottom: linear(0x4a1f22), bootTop: linear(0x1f1f24), topside: linear(0x1f2533), stripe: linear(0xf2f2ef), deck: linear(0x9a7b5b) },
  ],
  bulk: [
    { bottom: linear(0x6e2a26), bootTop: linear(0x161616), topside: linear(0x2a2c2f), deck: linear(0x6b3b2b) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x161616), topside: linear(0x5c2420), deck: linear(0x5d6a4f) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x161616), topside: linear(0x283c52), deck: linear(0x6b3b2b) },
  ],
  carrier: [
    { bottom: linear(0x6e2a26), bootTop: linear(0x1a2738), topside: linear(0xe8e9e6), stripe: linear(0x1a2738), deck: linear(0x5c5f61) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x1a1a1a), topside: linear(0x2c4157), stripe: linear(0xdfe2e3), deck: linear(0x5c5f61) },
    { bottom: linear(0x6e2a26), bootTop: linear(0x1a1a1a), topside: linear(0xd9dbd8), stripe: linear(0x8a1f1f), deck: linear(0x5c5f61) },
  ],
};

const CONTAINER_COLOURS = [0x2b5f8a, 0x9b2d24, 0x2f6b3d, 0xc7c2b6, 0xd28c2c, 0x6a6f74, 0x1f3a5f, 0xb33a3a, 0xd9b83a, 0x7b4a2d, 0x3f7f8c, 0xe6e4dc].map(linear);

const WHITE = linear(0xeeeeea);
const GLASS = linear(0x1d2a33);
const STEEL = linear(0x5d6266);
const DARK = linear(0x2a2c2e);

/** Builds one ship of `kind` in colour scheme `scheme` (0–2). */
export function buildShipGeometry(
  kind: ShipKind,
  scheme: number,
  seed = scheme * 17.3 + 4.1,
): { hull: THREE.BufferGeometry; beacons: THREE.BufferGeometry } {
  const spec = SHIP_SPECS[kind];
  const halfLength = spec.length / 2;
  const halfBeam = spec.beam / 2;
  const paint = PAINTS[kind][scheme % 3]!;
  const builder = new ShipBuilder();
  const hull: HullOptions = {
    halfLength,
    halfBeam,
    draft: spec.draft,
    freeboard: spec.freeboard,
    sheer: kind === "carrier" ? 1 : 3.2,
    rake: kind === "cruise" ? 9 : kind === "carrier" ? 5 : 7,
    flare: kind === "carrier" ? 0.02 : 0.08,
    paint,
  };
  buildHull(builder, hull);
  const deck = spec.freeboard;
  const sternLight = (y: number): void => builder.lamp(0, y, -halfLength + 0.5, MASTHEAD, 1, 0.6);
  hullFittings(builder, hull, kind);

  switch (kind) {
    case "container": {
      // Accommodation and bridge well aft, funnel behind them.
      const houseZ = -halfLength * 0.66;
      deckhouse(builder, { base: deck, aft: houseZ - 7, front: houseZ + 7, halfWidth: halfBeam * 0.62, decks: 7, wall: WHITE, glass: GLASS, seed, litFraction: 0.45 });
      bridge(builder, deck + 7 * 2.9, houseZ + 2, halfBeam, WHITE, GLASS, seed);
      funnel(builder, houseZ - 16, deck, 26, 3.4, 4.6, linear(0x1c2a3a), linear(0xc9c9c4));
      // Container bays from the house to the forecastle: 40-foot boxes, nine
      // to thirteen rows across, stacked to an uneven skyline that drops
      // toward the bow for the bridge's line of sight.
      const rows = Math.floor((halfBeam * 2 - 1.6) / 2.5);
      const firstBay = houseZ + 9.5;
      const lastBay = halfLength * 0.74;
      const bayLength = 12.4;
      let bay = 0;
      for (let z = firstBay + bayLength / 2; z < lastBay; z += bayLength + 0.6, bay += 1) {
        const forward = THREE.MathUtils.smoothstep(z / halfLength, 0.35, 0.78);
        const width = Math.min(rows, Math.floor((hullHalfWidth(halfLength, halfBeam, z + bayLength / 2) * 2 - 1.6) / 2.5));
        // Hatch cover under the stacks.
        builder.box(0, deck, z, width * 2.5 + 0.6, 0.9, bayLength + 0.3, linear(0x4a4f52));
        for (let row = 0; row < width; row += 1) {
          const x = (row - (width - 1) / 2) * 2.5;
          const tiers = Math.max(1, Math.round(2 + hash(seed + bay * 3.1 + row * 0.7) * 4.5 - forward * 2.5));
          for (let tier = 0; tier < tiers; tier += 1) {
            const colour = CONTAINER_COLOURS[Math.floor(hash(seed * 1.3 + bay * 17.1 + row * 5.3 + tier * 2.9) * CONTAINER_COLOURS.length)]!;
            const shade = 0.9 + hash(bay + row * 1.7 + tier * 3.3) * 0.18;
            builder.box(x, deck + 0.9 + tier * 2.6, z, 2.42, 2.55, bayLength, [colour[0] * shade, colour[1] * shade, colour[2] * shade]);
          }
        }
      }
      // Forecastle and foremast.
      builder.box(0, deck + 3.2, halfLength * 0.88, 2.5, 1.2, 10, STEEL);
      builder.box(0, deck + 3.2, halfLength * 0.84, 0.5, 9, 0.5, WHITE);
      builder.lamp(0, deck + 12.6, halfLength * 0.84, MASTHEAD, 1);
      builder.lamp(0, deck + 7, halfLength * 0.93, MASTHEAD, 2, 0.6);
      sternLight(deck + 1.4);
      break;
    }
    case "tanker": {
      const houseZ = -halfLength * 0.78;
      deckhouse(builder, { base: deck, aft: houseZ - 8, front: houseZ + 7, halfWidth: halfBeam * 0.7, decks: 6, wall: WHITE, glass: GLASS, seed, litFraction: 0.5 });
      bridge(builder, deck + 6 * 2.9, houseZ + 1.5, halfBeam, WHITE, GLASS, seed);
      funnel(builder, houseZ - 12, deck + 6, 18, 3, 4, linear(0xd9d6cf), linear(0x2e5e8c));
      // Pipe deck: a rack of cargo lines down the centre, a raised catwalk.
      const start = houseZ + 9;
      const end = halfLength * 0.86;
      const pipeLength = end - start;
      for (const x of [-1.6, -0.8, 0, 0.8, 1.6]) builder.box(x, deck + 0.6, (start + end) / 2, 0.5, 0.5, pipeLength, linear(0x6f7e5a));
      builder.box(4.2, deck + 2.2, (start + end) / 2, 1.2, 0.15, pipeLength, linear(0xb8b8b0));
      for (let z = start; z < end; z += 12) builder.box(4.2, deck, z, 0.3, 2.2, 0.3, STEEL);
      // Manifold amidships with its hose crane.
      for (const x of [-1, 1]) builder.box(x * halfBeam * 0.5, deck + 0.6, 0, halfBeam * 0.9, 0.7, 0.7, linear(0x6f7e5a));
      builder.prism(halfBeam * 0.55, -6, deck, deck + 9, 0.8, 0.8, linear(0xd6c34a));
      builder.orientedBox([halfBeam * 0.55, deck + 10.5, -1], [0.35, 0, 0], [0, 0.35, 0], [0, 0, 5.5], linear(0xd6c34a));
      // Forecastle and foremast.
      builder.box(0, deck + 3.2, halfLength * 0.9, 9, 0.8, 8, STEEL);
      builder.box(0, deck + 3, halfLength * 0.86, 0.6, 10, 0.6, linear(0xd9d6cf));
      builder.lamp(0, deck + 13.4, halfLength * 0.86, MASTHEAD, 1);
      builder.lamp(0, deck + 7, halfLength * 0.94, MASTHEAD, 2, 0.6);
      sternLight(deck + 1.4);
      break;
    }
    case "bulk": {
      const houseZ = -halfLength * 0.75;
      deckhouse(builder, { base: deck, aft: houseZ - 7, front: houseZ + 6, halfWidth: halfBeam * 0.65, decks: 6, wall: WHITE, glass: GLASS, seed, litFraction: 0.5 });
      bridge(builder, deck + 6 * 2.9, houseZ + 1, halfBeam, WHITE, GLASS, seed);
      funnel(builder, houseZ - 11, deck + 6, 16, 2.8, 3.8, paint.topside, linear(0xd9d6cf));
      // Five holds with raised hatch covers, four deck cranes between them.
      const holds = 5;
      const first = houseZ + 14;
      const last = halfLength * 0.78;
      const pitch = (last - first) / holds;
      for (let hold = 0; hold < holds; hold += 1) {
        const z = first + pitch * (hold + 0.5);
        builder.box(0, deck, z, halfBeam * 1.15, 1.6, pitch * 0.72, linear(0x7a3a2a), { top: linear(0x8a4432) });
        builder.box(0, deck + 1.6, z, halfBeam * 0.9, 0.5, pitch * 0.72, linear(0x7a3a2a));
        if (hold < holds - 1) {
          const craneZ = z + pitch / 2;
          const side = hold % 2 === 0 ? 1 : -1;
          builder.prism(side * 1.5, craneZ, deck, deck + 9, 1.4, 1.4, linear(0xd6c34a), linear(0xd6c34a), 10);
          builder.box(side * 1.5, deck + 9, craneZ, 3.2, 3, 3.6, linear(0xd6c34a));
          // Jib stowed at an angle over the next hatch.
          const length = pitch * 0.85;
          const angle = 0.38;
          builder.orientedBox(
            [side * 1.5, deck + 10.5 + Math.sin(angle) * length * 0.5 - 1, craneZ + Math.cos(angle) * length * 0.5],
            [0.5, 0, 0],
            [0, Math.cos(angle) * 0.5, -Math.sin(angle) * 0.5],
            [0, Math.sin(angle) * length * 0.5, Math.cos(angle) * length * 0.5],
            linear(0xd6c34a),
          );
        }
      }
      builder.box(0, deck + 3.2, halfLength * 0.9, 8, 0.8, 8, STEEL);
      builder.box(0, deck + 3, halfLength * 0.87, 0.6, 9, 0.6, WHITE);
      builder.lamp(0, deck + 12.4, halfLength * 0.87, MASTHEAD, 1);
      builder.lamp(0, deck + 7, halfLength * 0.94, MASTHEAD, 2, 0.6);
      sternLight(deck + 1.4);
      break;
    }
    case "cruise": {
      // Ten decks of cabins with balconies, terraced back at the bow and
      // stepped at the stern, lit window by window at night.
      const decks = 10;
      const storey = 2.9;
      const wall = scheme === 2 ? linear(0xf2f2ef) : WHITE;
      for (let level = 0; level < decks; level += 1) {
        const front = halfLength * 0.66 - Math.pow(level, 1.35) * 1.6;
        const aft = -halfLength * 0.86 + level * 1.4;
        const halfWidth = halfBeam * (level < 2 ? 0.97 : 0.99);
        deckhouse(builder, {
          base: deck + level * storey,
          aft,
          front,
          halfWidth,
          decks: 1,
          deckHeight: storey,
          wall,
          glass: linear(0x1b3a52),
          seed: seed + level * 11.1,
          litFraction: 0.72,
          aftWindows: true,
        });
      }
      const top = deck + decks * storey;
      // Pool deck, a lido roof and the bridge at the front of the top storeys.
      builder.box(0, top, -halfLength * 0.1, halfBeam * 1.1, 0.2, 26, linear(0x2a8fb0));
      builder.box(0, top, -halfLength * 0.4, halfBeam * 1.5, 3.2, 30, wall);
      bridge(builder, deck + 7 * storey, halfLength * 0.66 - Math.pow(7, 1.35) * 1.6 - 4.5, halfBeam, wall, GLASS, seed);
      funnel(builder, -halfLength * 0.62, top, 14, 4.2, 7.5, wall, paint.stripe ?? linear(0x1b3a6b));
      // Lifeboats along both sides on the promenade deck.
      const boats = 9;
      for (const side of [-1, 1]) {
        for (let boat = 0; boat < boats; boat += 1) {
          const z = -halfLength * 0.55 + boat * ((halfLength * 1.05) / boats);
          builder.box(side * (halfBeam + 0.9), deck + 3.4, z, 3.6, 2.6, 10, linear(0xe8792a), { top: linear(0xf09a3e), bottomFace: true });
        }
      }
      builder.lamp(0, top + 4, halfLength * 0.2, MASTHEAD, 1);
      builder.lamp(0, deck + 4, halfLength * 0.96, MASTHEAD, 2, 0.6);
      sternLight(deck + 1.4);
      break;
    }
    case "carrier": {
      // A slab-sided box from the waterline to the weather deck; bridge at
      // the front of the roof, a small funnel aft, a row of vents.
      const roof = deck;
      bridge(builder, roof, halfLength * 0.72, halfBeam * 0.98, WHITE, GLASS, seed);
      deckhouse(builder, { base: roof, aft: halfLength * 0.62, front: halfLength * 0.76, halfWidth: halfBeam * 0.5, decks: 1, wall: WHITE, glass: GLASS, seed });
      funnel(builder, -halfLength * 0.8, roof, 9, 2.4, 3.4, WHITE, linear(0x2c4157));
      for (let z = -halfLength * 0.6; z < halfLength * 0.55; z += 14) {
        for (const side of [-1, 1]) builder.box(side * (halfBeam - 3), roof, z, 2.2, 1.6, 2.2, STEEL);
      }
      // Ventilation openings down the slab sides.
      for (const side of [-1, 1]) {
        for (let z = -halfLength * 0.8; z < halfLength * 0.7; z += 9) {
          const x = side * (hullHalfWidth(halfLength, halfBeam, z) + 0.05);
          const y = roof - 5;
          if (side > 0) builder.quad([x, y, z + 2], [x, y, z], [x, y + 1.6, z], [x, y + 1.6, z + 2], DARK);
          else builder.quad([x, y, z], [x, y, z + 2], [x, y + 1.6, z + 2], [x, y + 1.6, z], DARK);
        }
      }
      builder.lamp(0, roof + 4, halfLength * 0.94, MASTHEAD, 2, 0.6);
      sternLight(roof - 2);
      break;
    }
  }
  // Anchor light at the stern for a ship at anchor.
  builder.lamp(0, deck + 3, -halfLength + 2, MASTHEAD, 2, 0.6);
  return { hull: builder.build(), beacons: builder.buildBeacons() };
}
