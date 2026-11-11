import * as THREE from "three";

/**
 * The upright surfaces of a group of buildings (walls, rails, posts, piles,
 * a cottage's garden wall, the hut's porch) as a sparse grid seen from
 * above: each cell a few centimetres across keeps the span of heights its
 * upright faces occupy. A walker is blocked by a cell whose span reaches
 * above a step and below head height — so a rail stops him, a garden wall
 * can be jumped over, and nothing solid is walked through, whatever its
 * shape, without a hand-made collider for each prop.
 *
 * Sparse (a `Map` from cell to span), because an island is a hundred metres
 * across and its buildings cover a few hundred square metres of it.
 */

/** Steeper surfaces than this (cosine of the slope) are upright. */
const UPRIGHT_COSINE = 0.72;

export class UprightGrid {
  private readonly spans = new Map<number, number>();
  private low = new Float32Array(1024);
  private high = new Float32Array(1024);
  private count = 0;

  constructor(private readonly cell = 0.1) {}

  get size(): number {
    return this.count;
  }

  private key(column: number, row: number): number {
    // Columns and rows within ±2^20 cells (±100 km at 10 cm).
    return (column + 1_048_576) * 2_097_152 + (row + 1_048_576);
  }

  private add(x: number, y: number, z: number): void {
    const key = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const index = this.spans.get(key);
    if (index === undefined) {
      if (this.count === this.low.length) {
        const grow = (array: Float32Array) => {
          const next = new Float32Array(array.length * 2);
          next.set(array);
          return next;
        };
        this.low = grow(this.low);
        this.high = grow(this.high);
      }
      this.spans.set(key, this.count);
      this.low[this.count] = y;
      this.high[this.count] = y;
      this.count += 1;
      return;
    }
    if (y < this.low[index]!) this.low[index] = y;
    if (y > this.high[index]!) this.high[index] = y;
  }

  /**
   * Adds the upright triangles of `geometry` placed by `matrix` (world).
   * Each is sampled over its surface closer than half a cell; triangles that
   * lie lower than `minY` everywhere (a pile's foot under the sand) are left out.
   */
  addGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, minY = -Infinity): void {
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const half = this.cell * 0.5;
    for (let corner = 0; corner + 2 < count; corner += 3) {
      a.fromBufferAttribute(position, index ? index.getX(corner) : corner).applyMatrix4(matrix);
      b.fromBufferAttribute(position, index ? index.getX(corner + 1) : corner + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, index ? index.getX(corner + 2) : corner + 2).applyMatrix4(matrix);
      if (Math.max(a.y, b.y, c.y) < minY) continue;
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      const area = normal.length();
      if (area < 1e-7 || Math.abs(normal.y) / area >= UPRIGHT_COSINE) continue;
      const edge = Math.max(a.distanceTo(b), a.distanceTo(c), b.distanceTo(c));
      const steps = Math.min(200, Math.max(1, Math.ceil(edge / half)));
      for (let i = 0; i <= steps; i += 1) {
        for (let j = 0; j <= steps - i; j += 1) {
          const u = i / steps;
          const v = j / steps;
          const w = 1 - u - v;
          this.add(a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v);
        }
      }
    }
  }

  /** Whether something upright stands at (x, z) between `feetY + stepUp` and `feetY + headroom`. */
  at(x: number, z: number, feetY: number, stepUp: number, headroom = 1.8): boolean {
    const index = this.spans.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (index === undefined) return false;
    return this.high[index]! > feetY + stepUp && this.low[index]! < feetY + headroom;
  }

  /** Whether a body of `radius` at (x, z), feet at `feetY`, would be inside anything upright. */
  blocked(x: number, z: number, feetY: number, stepUp: number, radius = 0.24): boolean {
    if (this.at(x, z, feetY, stepUp)) return true;
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      if (this.at(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, feetY, stepUp)) return true;
    }
    // A thin rail between two samples of the outline: the half radius too.
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
      if (this.at(x + Math.cos(angle) * radius * 0.5, z + Math.sin(angle) * radius * 0.5, feetY, stepUp)) return true;
    }
    return false;
  }
}
