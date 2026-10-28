import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";
import { simplifyLevel, type LodGroup, type LodLevelData } from "./LodSimplify";

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
 * Levels are built once per source geometry (clones share them) in a web
 * worker, so a fresh model never stalls a frame; until they arrive meshes
 * draw at full detail.
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
  private worker: Worker | null = null;
  private workerFailed = false;
  private jobId = 0;
  private inFlight: { id: number; source: THREE.BufferGeometry; ratios: number[] } | null = null;
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
      const triangles = triangleCount(entry.full);
      full += triangles;
      drawn += level === 0 ? triangles : triangleCount(mesh.geometry);
    }
    this.stats.full = full;
    this.stats.drawn = drawn;
  }

  dispose(): void {
    for (const entry of this.entries) entry.mesh.geometry = entry.full;
    this.entries.length = 0;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = null;
    // The levels share their attributes with the source geometry, which its
    // owner disposes; disposing a level would free those buffers too, so the
    // levels are left to the garbage collector.
  }

  /**
   * Builds levels for waiting meshes. Simplifying runs in a worker
   * (`LodWorker`), one source geometry at a time; every mesh sharing that
   * geometry then takes the cached levels. Without workers it runs here, at
   * most one geometry per frame.
   */
  private buildPending(): void {
    for (let index = this.waiting.length - 1; index >= 0; index -= 1) {
      const entry = this.waiting[index]!;
      if (!entry.mesh.parent) {
        this.waiting.splice(index, 1);
      } else if (this.isCached(entry)) {
        this.build(entry);
        this.waiting.splice(index, 1);
      }
    }
    if (this.inFlight || this.waiting.length === 0) return;
    const entry = this.waiting[0]!;
    const byRatio = this.levelsOf(entry.full);
    const ratios = entry.steps.map((step) => step.ratio).filter((ratio) => !byRatio.has(ratio));
    const worker = this.ensureWorker();
    if (worker) {
      const data = extractMeshData(entry.full);
      if (!data) {
        for (const ratio of ratios) byRatio.set(ratio, entry.full);
        return;
      }
      const id = ++this.jobId;
      this.inFlight = { id, source: entry.full, ratios };
      worker.postMessage({ id, positions: data.positions, indices: data.indices, groups: data.groups, ratios }, [data.positions.buffer, data.indices.buffer]);
      return;
    }
    if (!this.ready) return;
    this.waiting.shift();
    this.build(entry);
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker;
    if (typeof Worker === "undefined") {
      this.workerFailed = true;
      return null;
    }
    try {
      const worker = new Worker(new URL("./LodWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = this.onWorkerMessage;
      worker.onerror = () => {
        // Fall back to simplifying here; the job in flight is simply redone.
        this.workerFailed = true;
        worker.terminate();
        this.worker = null;
        this.inFlight = null;
      };
      this.worker = worker;
    } catch {
      this.workerFailed = true;
    }
    return this.worker;
  }

  private readonly onWorkerMessage = (event: MessageEvent<{ id: number; levels: LodLevelData[] | null }>): void => {
    const job = this.inFlight;
    if (!job || job.id !== event.data.id) return;
    this.inFlight = null;
    const byRatio = this.levelsOf(job.source);
    job.ratios.forEach((ratio, index) => {
      const data = event.data.levels?.[index];
      byRatio.set(ratio, (data && levelGeometry(job.source, data, ratio)) ?? job.source);
    });
  };

  private levelsOf(source: THREE.BufferGeometry): Map<number, THREE.BufferGeometry> {
    let byRatio = this.cache.get(source);
    if (!byRatio) {
      byRatio = new Map();
      this.cache.set(source, byRatio);
    }
    return byRatio;
  }

  private isCached(entry: Entry): boolean {
    const byRatio = this.cache.get(entry.full);
    return Boolean(byRatio && entry.steps.every((step) => byRatio.has(step.ratio)));
  }

  private build(entry: Entry): void {
    const source = entry.full;
    const byRatio = this.levelsOf(source);
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

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
}

type MeshData = { positions: Float32Array; indices: Uint32Array; groups: LodGroup[] };

/** Positions and indices of `source` as fresh arrays (fast copies where the layout allows). */
function extractMeshData(source: THREE.BufferGeometry): MeshData | null {
  const position = source.getAttribute("position");
  if (!position || position.count < 3) return null;
  let positions: Float32Array;
  if (position instanceof THREE.BufferAttribute && position.itemSize === 3 && position.array instanceof Float32Array && !position.normalized) {
    positions = position.array.slice(0, position.count * 3);
  } else {
    positions = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      positions[index * 3] = position.getX(index);
      positions[index * 3 + 1] = position.getY(index);
      positions[index * 3 + 2] = position.getZ(index);
    }
  }
  let indices: Uint32Array;
  if (source.index) {
    const array = source.index.array;
    indices = array instanceof Uint32Array ? array.slice(0, source.index.count) : Uint32Array.from(array.subarray(0, source.index.count));
  } else {
    indices = new Uint32Array(position.count);
    for (let index = 0; index < position.count; index += 1) indices[index] = index;
  }
  const groups: LodGroup[] = source.groups.length > 0
    ? source.groups.map((group) => ({ start: group.start, count: group.count, materialIndex: group.materialIndex }))
    : [{ start: 0, count: indices.length, materialIndex: 0 }];
  return { positions, indices, groups };
}

/** The level as a geometry sharing `source`'s attributes; null if it saves too little. */
function levelGeometry(source: THREE.BufferGeometry, data: LodLevelData, ratio: number): THREE.BufferGeometry | null {
  const position = source.getAttribute("position");
  const fullCount = source.index ? source.index.count : position.count;
  if (data.indices.length >= fullCount * 0.92) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  const morphs = geometry.morphAttributes as Record<string, (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]>;
  for (const [name, list] of Object.entries(source.morphAttributes)) morphs[name] = list;
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(IndexArray === Uint32Array ? data.indices : new Uint16Array(data.indices), 1));
  if (source.groups.length > 0) for (const group of data.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  // Culling and skinned bounds stay those of the full mesh.
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.name = `${source.name || "geometry"}_lod${Math.round(ratio * 100)}`;
  geometry.userData = { ...source.userData, lodOf: source.uuid };
  return geometry;
}

/**
 * A geometry that shares every attribute of `source` but draws a simplified
 * index buffer keeping about `ratio` of the triangles. Null if it cannot be
 * simplified (no positions) or the result would not save anything.
 */
export function simplifiedGeometry(source: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry | null {
  const data = extractMeshData(source);
  if (!data) return null;
  return levelGeometry(source, simplifyLevel(MeshoptSimplifier, data.positions, data.indices, data.groups, ratio), ratio);
}
