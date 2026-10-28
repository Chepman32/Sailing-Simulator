/**
 * The simplification itself, free of three.js so the LOD worker can run it:
 * a simplified index buffer (meshoptimizer quadric simplification) per
 * draw group, keeping about `ratio` of the triangles.
 */

export type LodGroup = { start: number; count: number; materialIndex?: number };

export type LodSimplifier = {
  simplify(indices: Uint32Array, positions: Float32Array, stride: number, target: number, error: number, flags?: string[]): [Uint32Array, number];
};

export type LodLevelData = { indices: Uint32Array; groups: LodGroup[] };

export function simplifyLevel(
  simplifier: LodSimplifier,
  positions: Float32Array,
  indices: Uint32Array,
  groups: readonly LodGroup[],
  ratio: number,
): LodLevelData {
  const parts: Uint32Array[] = [];
  const newGroups: LodGroup[] = [];
  let total = 0;
  for (const group of groups) {
    const slice = indices.subarray(group.start, Math.min(indices.length, group.start + group.count));
    const target = Math.max(3, Math.floor((slice.length * ratio) / 3) * 3);
    const [simplified] = simplifier.simplify(slice.slice(), positions, 3, target, 0.08, ["Prune"]);
    newGroups.push({ start: total, count: simplified.length, materialIndex: group.materialIndex });
    parts.push(simplified);
    total += simplified.length;
  }
  const out = new Uint32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return { indices: out, groups: newGroups };
}
