import * as THREE from "three";

/**
 * Where a person can stand aboard: a layered height field in the yacht's
 * own frame, built once from her meshes.
 *
 * Every upward-facing triangle (decks, cockpit sole, steps, the coachroof,
 * the helm seat) is rasterised into a grid of cells a few centimetres
 * across; each cell keeps the heights of the surfaces above it (several
 * layers: the cockpit sole under the hardtop, the hardtop itself). Standing
 * at some height, the floor is the highest layer no more than a step above
 * the feet; a cell whose every layer is higher is a wall; a cell with none
 * is the sea. Upright surfaces (the mast, stanchions, the sides of the
 * cabin and the helm pedestal, a seat's front) are kept as well, as the
 * height span they occupy in each cell: wherever one stands between a step
 * and head height it is a wall too, so nothing upright is walked through.
 */

/** Cell size, m. */
const CELL = 0.06;
/** Most surfaces kept per cell. */
const LAYERS = 4;
/** Two surfaces closer than this in a cell are one. */
const MERGE = 0.08;
/** Steeper surfaces than this (cosine of the slope) are not floors. */
const FLOOR_COSINE = 0.72;
/** Anything solid lower than this above the feet is in the way of a standing man. */
const HEADROOM = 1.85;

export type DeckFloor = { height: number; found: boolean };

export class DeckField {
  readonly minX: number;
  readonly minZ: number;
  readonly columns: number;
  readonly rows: number;
  /** LAYERS heights per cell, NaN for none, highest first. */
  private readonly heights: Float32Array;
  /** Lowest and highest point of upright surfaces in each cell, NaN for none. */
  private readonly uprightLow: Float32Array;
  private readonly uprightHigh: Float32Array;

  constructor(root: THREE.Object3D, skip: (object: THREE.Object3D) => boolean = () => false) {
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const triangles: number[] = [];
    const upright: number[] = [];
    const matrix = new THREE.Matrix4();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const box = new THREE.Box3();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) return;
      if (!object.visible || skip(object)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const position = geometry.getAttribute("position");
      if (!position) return;
      matrix.multiplyMatrices(toRoot, object.matrixWorld);
      const index = geometry.getIndex();
      const count = index ? index.count : position.count;
      for (let corner = 0; corner + 2 < count; corner += 3) {
        const ia = index ? index.getX(corner) : corner;
        const ib = index ? index.getX(corner + 1) : corner + 1;
        const ic = index ? index.getX(corner + 2) : corner + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(matrix);
        b.fromBufferAttribute(position, ib).applyMatrix4(matrix);
        c.fromBufferAttribute(position, ic).applyMatrix4(matrix);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        const area = normal.length();
        if (area < 1e-6) continue;
        // Either winding: an imported model's triangles face either way.
        if (Math.abs(normal.y) / area < FLOOR_COSINE) {
          upright.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          continue;
        }
        triangles.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      }
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, 1));
    this.minX = box.min.x - CELL;
    this.minZ = box.min.z - CELL;
    this.columns = Math.max(1, Math.ceil((box.max.x - this.minX) / CELL) + 2);
    this.rows = Math.max(1, Math.ceil((box.max.z - this.minZ) / CELL) + 2);
    this.heights = new Float32Array(this.columns * this.rows * LAYERS).fill(Number.NaN);
    for (let offset = 0; offset < triangles.length; offset += 9) this.rasterise(triangles, offset);
    this.uprightLow = new Float32Array(this.columns * this.rows).fill(Number.NaN);
    this.uprightHigh = new Float32Array(this.columns * this.rows).fill(Number.NaN);
    for (let offset = 0; offset < upright.length; offset += 9) this.rasteriseUpright(upright, offset);
  }

  /**
   * An upright triangle seen from above is a sliver: it is sampled over its
   * surface (closer than half a cell) and each cell it crosses keeps the
   * span of heights it covers there.
   */
  private rasteriseUpright(t: number[], o: number): void {
    const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
    const bx = t[o + 3]!, by = t[o + 4]!, bz = t[o + 5]!;
    const cx = t[o + 6]!, cy = t[o + 7]!, cz = t[o + 8]!;
    // Only what reaches into the deck's footprint matters.
    if (Math.max(ax, bx, cx) < this.minX || Math.max(az, bz, cz) < this.minZ) return;
    const edge = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
    const steps = Math.min(140, Math.max(1, Math.ceil(edge / (CELL * 0.5))));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps - i; j += 1) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        const x = ax * w + bx * u + cx * v;
        const y = ay * w + by * u + cy * v;
        const z = az * w + bz * u + cz * v;
        const column = Math.floor((x - this.minX) / CELL);
        const row = Math.floor((z - this.minZ) / CELL);
        if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) continue;
        const cell = row * this.columns + column;
        const low = this.uprightLow[cell]!;
        const high = this.uprightHigh[cell]!;
        this.uprightLow[cell] = Number.isNaN(low) ? y : Math.min(low, y);
        this.uprightHigh[cell] = Number.isNaN(high) ? y : Math.max(high, y);
      }
    }
  }

  /** Whether something upright stands in the cell at (x, z) between a step and head height. */
  private uprightAt(x: number, z: number, feetY: number, stepUp: number): boolean {
    const column = Math.floor((x - this.minX) / CELL);
    const row = Math.floor((z - this.minZ) / CELL);
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return false;
    const cell = row * this.columns + column;
    const high = this.uprightHigh[cell]!;
    if (Number.isNaN(high)) return false;
    return high > feetY + stepUp && this.uprightLow[cell]! < feetY + HEADROOM;
  }

  /**
   * Whether a body of `radius` standing at (x, z) with its feet at `feetY`
   * would be inside anything (a wall, the mast, a stanchion): checked round
   * its outline, so the eyes never come close enough to see through a wall.
   */
  blocked(x: number, z: number, feetY: number, stepUp: number, radius = 0.24): boolean {
    for (let index = 0; index <= 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const r = index === 8 ? 0 : radius;
      const px = x + Math.cos(angle) * r;
      const pz = z + Math.sin(angle) * r;
      if (this.uprightAt(px, pz, feetY, stepUp)) return true;
      if (this.floor(px, pz, feetY, stepUp).wall) return true;
    }
    return false;
  }

  /** Writes one triangle's heights into the cells whose centres it covers. */
  private rasterise(t: number[], o: number): void {
    const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
    const bx = t[o + 3]!, by = t[o + 4]!, bz = t[o + 5]!;
    const cx = t[o + 6]!, cy = t[o + 7]!, cz = t[o + 8]!;
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-10) return;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.minX) / CELL));
    const c1 = Math.min(this.columns - 1, Math.ceil((Math.max(ax, bx, cx) - this.minX) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.minZ) / CELL));
    const r1 = Math.min(this.rows - 1, Math.ceil((Math.max(az, bz, cz) - this.minZ) / CELL));
    for (let row = r0; row <= r1; row += 1) {
      const pz = this.minZ + (row + 0.5) * CELL;
      for (let column = c0; column <= c1; column += 1) {
        const px = this.minX + (column + 0.5) * CELL;
        const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator;
        const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator;
        const w2 = 1 - w0 - w1;
        // A little slack, so cells on a shared edge are covered by one or the other.
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        this.insert(column, row, w0 * ay + w1 * by + w2 * cy);
      }
    }
  }

  private insert(column: number, row: number, height: number): void {
    const base = (row * this.columns + column) * LAYERS;
    const h = this.heights;
    for (let layer = 0; layer < LAYERS; layer += 1) {
      const existing = h[base + layer]!;
      if (Number.isNaN(existing)) {
        h[base + layer] = height;
        this.sort(base);
        return;
      }
      if (Math.abs(existing - height) < MERGE) {
        h[base + layer] = Math.max(existing, height);
        return;
      }
    }
    // Full: keep the highest surfaces.
    if (height > h[base + LAYERS - 1]!) {
      h[base + LAYERS - 1] = height;
      this.sort(base);
    }
  }

  private sort(base: number): void {
    const values: number[] = [];
    for (let layer = 0; layer < LAYERS; layer += 1) {
      const value = this.heights[base + layer]!;
      if (!Number.isNaN(value)) values.push(value);
    }
    values.sort((p, q) => q - p);
    for (let layer = 0; layer < LAYERS; layer += 1) this.heights[base + layer] = layer < values.length ? values[layer]! : Number.NaN;
  }

  /**
   * The floor under (x, z) for feet at `feetY` (all in the yacht's frame):
   * the highest surface no more than `stepUp` above the feet. Something solid
   * between a step and head height (a coachroof, the side of the cabin) is a
   * wall; a roof overhead (the hardtop) is not. Nothing at all is the sea.
   */
  floor(x: number, z: number, feetY: number, stepUp: number): { found: boolean; height: number; wall: boolean } {
    const column = Math.floor((x - this.minX) / CELL);
    const row = Math.floor((z - this.minZ) / CELL);
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return { found: false, height: -Infinity, wall: false };
    if (this.uprightAt(x, z, feetY, stepUp)) return { found: false, height: -Infinity, wall: true };
    const base = (row * this.columns + column) * LAYERS;
    for (let layer = 0; layer < LAYERS; layer += 1) {
      const value = this.heights[base + layer]!;
      if (Number.isNaN(value)) break;
      if (value > feetY + stepUp) {
        if (value < feetY + HEADROOM) return { found: false, height: -Infinity, wall: true };
        continue;
      }
      return { found: true, height: value, wall: false };
    }
    return { found: false, height: -Infinity, wall: false };
  }

  /** The floor at (x, z) checked over a small footprint (the feet are not a point). */
  footing(x: number, z: number, feetY: number, stepUp: number, radius = 0.12): { found: boolean; height: number; wall: boolean } {
    let best = -Infinity;
    let found = false;
    let wall = false;
    for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
      const sample = this.floor(x + dx, z + dz, feetY, stepUp);
      if (sample.wall) wall = true;
      if (sample.found) {
        found = true;
        best = Math.max(best, sample.height);
      }
    }
    return { found: found && !wall, height: best, wall };
  }

  /** The highest floor anywhere in a column (to put him down on deck from the water). */
  top(x: number, z: number, below = Infinity): number {
    const column = Math.floor((x - this.minX) / CELL);
    const row = Math.floor((z - this.minZ) / CELL);
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return -Infinity;
    const base = (row * this.columns + column) * LAYERS;
    for (let layer = 0; layer < LAYERS; layer += 1) {
      const value = this.heights[base + layer]!;
      if (Number.isNaN(value)) break;
      if (value <= below) return value;
    }
    return -Infinity;
  }
}
