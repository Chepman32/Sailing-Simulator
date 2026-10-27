import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";

/**
 * Screen-size levels of detail for heavy authored meshes (the shark, the
 * whale, the gulls, the ships' models, the far side of the yacht).
 *
 * Each level is the same vertices with a simplified index buffer
 * (meshoptimizer: quadric simplification that keeps UV and normal seams),
 * so skinning, morphs, materials and animation are untouched: the mesh just
 * draws fewer of its own triangles. A mesh switches level by how large it
 * is on screen (bounding-sphere radius over distance), with hysteresis so it
 * never flickers between two. A 51k-triangle shark a dozen metres down
 * covers a few hundred pixels; at that size a sixth of its triangles is
 * indistinguishable, and the full mesh comes back as soon as it is close.
 *
 * Levels are built once per source geometry (clones share them) after the
 * simplifier's WebAssembly is ready, one new geometry per frame so a fresh
 * model never stalls the frame; until then meshes draw at full detail.
 */

/** A level: the fraction of the triangles kept, and the screen size (radius / distance) below which it is used. */
export type LodStep = { ratio: number; below: number };

/** Default steps: full when large on screen, a third when middling, an eighth when small. */
export const DEFAULT_LOD_STEPS: readonly LodStep[] = [
  { ratio: 0.33, below: 0.16 },
  { ratio: 0.12, below: 0.055 },
];

/** Relative change in screen size needed to switch back up a level (hysteresis). */
const HYSTERESIS = 1.18;

type Entry = {
  mesh: THREE.Mesh;
  full: THREE.BufferGeometry;
  levels: THREE.BufferGeometry[] | null;
  steps: readonly LodStep[];
  current: number;
  radius: number;
};

/**
 * Index of the level for `size` (radius / distance), given the level in use:
 * a mesh steps down as soon as it is small enough and steps back up only
 * once it is clearly larger again.
 */
export function chooseLodLevel(size: number, current: number, steps: readonly LodStep[]): number {
  let level = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const threshold = steps[index]!.below * (index + 1 <= current ? HYSTERESIS : 1);
    if (size < threshold) level = index + 1;
  }
  return level;
}

export class ScreenLod {
  private readonly entries: Entry[] = [];
  private readonly cache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();
  private ready = false;
  private readonly waiting: Entry[] = [];
  private readonly centre = new THREE.Vector3();
  /** Triangles drawn at full detail for each registered mesh vs. what is drawn now (for diagnostics). */
  readonly stats = { full: 0, drawn: 0 };

  constructor() {
    void MeshoptSimplifier.ready.then(
      () => {
        this.ready = MeshoptSimplifier.supported;
      },
      () => {
        this.ready = false;
      },
    );
  }

  /**
   * Registers every mesh under `root` with at least `minTriangles` triangles.
   * `steps` may be tuned per kind (an animal at depth tolerates more).
   */
  register(root: THREE.Object3D, minTriangles = 3000, steps: readonly LodStep[] = DEFAULT_LOD_STEPS): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      if (this.entries.some((entry) => entry.mesh === object)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const position = geometry.getAttribute("position");
      if (!position || position.count < 3) return;
      const triangles = (geometry.index ? geometry.index.count : position.count) / 3;
      if (triangles < minTriangles) return;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const entry: Entry = { mesh: object, full: geometry, levels: null, steps, current: 0, radius: geometry.boundingSphere?.radius ?? 1 };
      this.entries.push(entry);
      this.waiting.push(entry);
    });
  }

  /** Picks each mesh's level for this camera. Cheap: one distance per registered mesh. */
  update(camera: THREE.PerspectiveCamera): void {
    this.buildPending();
    const focal = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let full = 0;
    let drawn = 0;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!;
      const mesh = entry.mesh;
      if (!mesh.parent) {
        // Removed from the scene (a ship replaced, an animal omitted): forget it.
        mesh.geometry = entry.full;
        this.entries.splice(index, 1);
        continue;
      }
      if (!entry.levels) continue;
      this.centre.copy(entry.full.boundingSphere!.center).applyMatrix4(mesh.matrixWorld);
      const radius = entry.radius * mesh.matrixWorld.getMaxScaleOnAxis();
      const distance = Math.max(0.1, this.centre.distanceTo(camera.position));
      // Size relative to the half-height of the view.
      const size = (radius / distance) * focal * 0.5;
      const level = chooseLodLevel(size, entry.current, entry.steps);
      if (level !== entry.current) {
        entry.current = level;
        mesh.geometry = level === 0 ? entry.full : entry.levels[level - 1]!;
      }
      const triangles = (entry.full.index ? entry.full.index.count : entry.full.getAttribute("position").count) / 3;
      full += triangles;
      drawn += level === 0 ? triangles : (mesh.geometry.index!.count / 3);
    }
    this.stats.full = full;
    this.stats.drawn = drawn;
  }

  dispose(): void {
    for (const entry of this.entries) entry.mesh.geometry = entry.full;
    this.entries.length = 0;
    // The levels share their attributes with the source geometry, which its
    // owner disposes; disposing a level would free those buffers too, so the
    // levels are left to the garbage collector.
  }

  /**
   * Builds levels for waiting meshes: every one whose levels are already
   * cached, but at most one that needs simplifying, so a new model never
   * stalls a frame for longer than one simplification.
   */
  private buildPending(): void {
    if (!this.ready) return;
    let simplified = false;
    while (this.waiting.length > 0) {
      const entry = this.waiting[0]!;
      const cached = this.isCached(entry);
      if (!cached && simplified) return;
      this.waiting.shift();
      if (!entry.mesh.parent) continue;
      this.build(entry);
      if (!cached) simplified = true;
    }
  }

  private isCached(entry: Entry): boolean {
    const byRatio = this.cache.get(entry.full);
    return Boolean(byRatio && entry.steps.every((step) => byRatio.has(step.ratio)));
  }

  private build(entry: Entry): void {
    const source = entry.full;
    let byRatio = this.cache.get(source);
    if (!byRatio) {
      byRatio = new Map();
      this.cache.set(source, byRatio);
    }
    const levels: THREE.BufferGeometry[] = [];
    for (const step of entry.steps) {
      let level = byRatio.get(step.ratio);
      if (!level) {
        level = simplifiedGeometry(source, step.ratio) ?? source;
        byRatio.set(step.ratio, level);
      }
      levels.push(level);
    }
    entry.levels = levels;
  }
}

/**
 * A geometry that shares every attribute of `source` but draws a simplified
 * index buffer keeping about `ratio` of the triangles. Null if it cannot be
 * simplified (no positions) or the result would not save anything.
 */
export function simplifiedGeometry(source: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry | null {
  const position = source.getAttribute("position");
  if (!position) return null;
  const positions = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    positions[index * 3] = position.getX(index);
    positions[index * 3 + 1] = position.getY(index);
    positions[index * 3 + 2] = position.getZ(index);
  }
  let indices: Uint32Array;
  if (source.index) {
    indices = new Uint32Array(source.index.count);
    for (let index = 0; index < source.index.count; index += 1) indices[index] = source.index.getX(index);
  } else {
    indices = new Uint32Array(position.count);
    for (let index = 0; index < position.count; index += 1) indices[index] = index;
  }
  // Groups (multi-material meshes) are simplified separately so each keeps its own range.
  const groups = source.groups.length > 0 ? source.groups : [{ start: 0, count: indices.length, materialIndex: 0 }];
  const out: number[] = [];
  const newGroups: { start: number; count: number; materialIndex?: number }[] = [];
  for (const group of groups) {
    const slice = indices.slice(group.start, Math.min(indices.length, group.start + group.count));
    const target = Math.max(3, Math.floor((slice.length * ratio) / 3) * 3);
    const [simplified] = MeshoptSimplifier.simplify(slice, positions, 3, target, 0.08, ["Prune"]);
    newGroups.push({ start: out.length, count: simplified.length, materialIndex: group.materialIndex });
    for (let index = 0; index < simplified.length; index += 1) out.push(simplified[index]!);
  }
  if (out.length >= indices.length * 0.92) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  const morphs = geometry.morphAttributes as Record<string, (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]>;
  for (const [name, list] of Object.entries(source.morphAttributes)) morphs[name] = list;
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(new IndexArray(out), 1));
  if (source.groups.length > 0) for (const group of newGroups) geometry.addGroup(group.start, group.count, group.materialIndex);
  // Culling and skinned bounds stay those of the full mesh.
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.name = `${source.name || "geometry"}_lod${Math.round(ratio * 100)}`;
  geometry.userData = { ...source.userData, lodOf: source.uuid };
  return geometry;
}
