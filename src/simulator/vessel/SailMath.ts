import * as THREE from "three";

/**
 * How the mainsail is shaped for the wind, as pure numbers, and the mesh
 * work that lets a thin imported sail bend like cloth.
 */

export type SailShape = {
  /** Signed depth of the belly, fraction of the chord (negative = toward the authored leeward side). */
  draft: number;
  /** How far the head opens away from the mast line (twist), fraction of the chord. */
  twist: number;
  /** Amplitude of the free edges' shaking, fraction of the chord. */
  flutter: number;
  /** Slack cloth wrinkles across the panels, 0…1. */
  wrinkle: number;
};

/** Deepest belly of a drawing sail, fraction of the chord. */
export const MAX_DRAFT = 0.2;

/**
 * The cloth's shape from the pressure on it. A drawing sail bellies in
 * proportion to the wind and to how much power the trim asks of it (trim is
 * 0.2…1); a luffing one loses its belly, its leech and head shake, and slack
 * panels wrinkle. In a gale the head twists open to spill wind.
 */
export function sailShape(apparentWindSpeed: number, luff: number, trim: number): SailShape {
  const wind = Math.max(0, Number.isFinite(apparentWindSpeed) ? apparentWindSpeed : 0);
  const drawing = 1 - Math.min(1, Math.max(0, luff));
  const power = Math.min(1, Math.max(0, (trim - 0.2) / 0.8));
  const pressure = Math.min(1, wind / 11);
  const fullness = 0.3 + 0.7 * power;
  return {
    draft: -MAX_DRAFT * Math.min(1, 0.4 + pressure) * fullness * drawing,
    twist: 0.05 * (1 - power) + 0.07 * Math.max(0, pressure - 0.55) * drawing,
    flutter: (0.012 + 0.07 * Math.min(1, wind / 8)) * (luff * 0.9 + (1 - power) * 0.25 * drawing),
    wrinkle: Math.min(1, luff * 1.2 + (1 - power) * 0.25),
  };
}

/**
 * Splits every triangle edge longer than `maxEdge` at its midpoint (each
 * pass turns one triangle into four) so a sail made of a few large
 * triangles has enough vertices to curve. Positions, normals and UVs are
 * interpolated; the result is not indexed.
 */
export function tessellate(geometry: THREE.BufferGeometry, maxEdge: number, maxPasses = 6): THREE.BufferGeometry {
  let current = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const names = ["position", "normal", "uv"].filter((name) => current.getAttribute(name));
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const position = current.getAttribute("position");
    const triangles = position.count / 3;
    let longest = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let t = 0; t < triangles; t += 1) {
      for (let k = 0; k < 3; k += 1) {
        a.fromBufferAttribute(position, t * 3 + k);
        b.fromBufferAttribute(position, t * 3 + ((k + 1) % 3));
        longest = Math.max(longest, a.distanceTo(b));
      }
    }
    if (longest <= maxEdge) break;
    const source = names.map((name) => current.getAttribute(name));
    const next = source.map((attribute) => new Float32Array(attribute.count * 4 * attribute.itemSize));
    for (let t = 0; t < triangles; t += 1) {
      source.forEach((attribute, slot) => {
        const size = attribute.itemSize;
        const corner = (k: number, component: number): number => attribute.array[(t * 3 + k) * size + component]!;
        const mid = (i: number, j: number, component: number): number => (corner(i, component) + corner(j, component)) / 2;
        // Encoding: [i, i] = corner i; [i, j] with i != j = midpoint.
        const at = (point: [number, number], component: number): number =>
          point[0] === point[1] ? corner(point[0], component) : mid(point[0], point[1], component);
        const quads: [number, number][][] = [
          [[0, 0], [0, 1], [2, 0]],
          [[0, 1], [1, 1], [1, 2]],
          [[2, 0], [1, 2], [2, 2]],
          [[0, 1], [1, 2], [2, 0]],
        ];
        quads.forEach((triangle, index) => {
          triangle.forEach((point, k) => {
            for (let component = 0; component < size; component += 1) {
              next[slot]![((t * 4 + index) * 3 + k) * size + component] = at(point, component);
            }
          });
        });
      });
    }
    const refined = new THREE.BufferGeometry();
    names.forEach((name, slot) => {
      refined.setAttribute(name, new THREE.BufferAttribute(next[slot]!, source[slot]!.itemSize));
    });
    current.dispose();
    current = refined;
  }
  current.computeBoundingBox();
  return current;
}
