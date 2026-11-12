import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { LoadingState } from "../types";
import { assetBytes, assetUrl } from "./assetManifest";
import { createGltfLoader } from "./GltfLoading";
import { takePrefetchedModel } from "./startAssets";
import { injectAfter, patchMaterialShader } from "./ShaderPatch";

export type AnimatedAssetKey =
  | "dolphin" | "shark" | "whale" | "fishSchool" | "seagull"
  | "traderMan" | "traderWoman" | "traderPirate" | "crabRed" | "crabBlue";
/** The island traders' models, in the order they are handed out. */
export const TRADER_MODEL_KEYS = ["traderMan", "traderWoman", "traderPirate"] as const satisfies readonly AnimatedAssetKey[];
export type StaticAssetKey = "yacht" | "sportYacht" | "skiff";
export type AssetKey = StaticAssetKey | AnimatedAssetKey;

export type AnimatedAssetInstance = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

type AssetDefinition = {
  url: string;
  label: string;
  required: boolean;
  /**
   * "start": needed for the first frame (the yacht, her skipper, the
   * dolphins that meet her, the gulls overhead). "later": fetched once the
   * scene runs, one after another (`loadLater`); until each arrives its
   * animal or islander stands in procedurally or waits.
   */
  stage: "start" | "later";
};

const ASSETS = {
  yacht: { url: "/models/yacht-sailboat-pbr.glb", label: "Loading yacht", required: true, stage: "start" },
  dolphin: { url: "/models/dolphin-animated.glb", label: "Loading dolphins", required: true, stage: "start" },
  seagull: { url: "/models/seagull-animated.glb", label: "Loading seabirds", required: false, stage: "start" },
  traderMan: { url: "/models/trader-man.glb", label: "Loading the skipper", required: false, stage: "start" },
  // In the order they are wanted: the story's boats (the prologue's sport
  // yacht, the skiff of M01; drawn in code until they come), what is met
  // at sea, then ashore.
  sportYacht: { url: "/models/sport-yacht.glb", label: "Loading the sport yacht", required: false, stage: "later" },
  skiff: { url: "/models/skiff-center-console.glb", label: "Loading the skiff", required: false, stage: "later" },
  shark: { url: "/models/shark-animated.glb", label: "Loading sharks", required: false, stage: "later" },
  whale: { url: "/models/blue-whale-rigged-pbr-v2.glb", label: "Loading whale", required: false, stage: "later" },
  crabRed: { url: "/models/crab-red.glb", label: "Loading crabs", required: false, stage: "later" },
  traderWoman: { url: "/models/trader-woman.glb", label: "Loading islanders", required: false, stage: "later" },
  traderPirate: { url: "/models/trader-pirate.glb", label: "Loading islanders", required: false, stage: "later" },
  crabBlue: { url: "/models/crab-blue.glb", label: "Loading crabs", required: false, stage: "later" },
  fishSchool: { url: "/models/tropical-fish-school.glb", label: "Loading tropical fish", required: false, stage: "later" },
} satisfies Record<AssetKey, AssetDefinition>;

const ASSET_ENTRIES = Object.entries(ASSETS) as Array<[AssetKey, AssetDefinition]>;
const START_ENTRIES = ASSET_ENTRIES.filter(([, definition]) => definition.stage === "start");
const LATER_ENTRIES = ASSET_ENTRIES.filter(([, definition]) => definition.stage === "later");

/** The models fetched before the first frame (the rest follow, `loadLater`). */
export const START_ASSET_KEYS: readonly AssetKey[] = START_ENTRIES.map(([key]) => key);
export const LATER_ASSET_KEYS: readonly AssetKey[] = LATER_ENTRIES.map(([key]) => key);
export const START_ASSET_URLS: readonly string[] = START_ENTRIES.map(([, definition]) => definition.url);

/**
 * Steps of the loading bar for the downloads: the bar moves with the bytes
 * that have arrived (`assetBytes`), not by whole files, so on a slow line it
 * keeps creeping instead of standing still for half a minute at a time.
 */
export const ASSET_LOAD_TOTAL = 30;
/**
 * Steps of the loading bar after the downloads: building the scene, compiling
 * its shaders (most of the wait on a phone or tablet) and the first frame.
 * The bar is only full, and the interface only shown, once that frame is on
 * screen: before, a tablet showed the controls over a black canvas for many
 * seconds while every shader compiled.
 */
export const SCENE_LOAD_STEPS = 10;
export const LOAD_STEPS_TOTAL = ASSET_LOAD_TOTAL + SCENE_LOAD_STEPS;

const REQUIRED_ANIMATED_ASSETS = new Set<AnimatedAssetKey>(["dolphin"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
};

export class AssetManager {
  private readonly loadingManager = new THREE.LoadingManager();
  private readonly loader = createGltfLoader(this.loadingManager);
  private readonly assets = new Map<AssetKey, GLTF>();
  /** Bytes received of each file of the start (for the loading bar). */
  private readonly received = new Map<AssetKey, number>();
  private laterLoad: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly onProgress?: (state: LoadingState) => void) {}

  /**
   * Fetches one model (its URL carries its content hash, `assetUrl`), or
   * takes it from the page's early prefetch (`startAssets.ts`) when that
   * has it under way.
   */
  private async fetch(key: AssetKey, definition: AssetDefinition, onBytes?: (bytes: number) => void): Promise<void> {
    let asset: GLTF | null = null;
    const early = takePrefetchedModel(definition.url);
    if (early) {
      const timer = setInterval(() => onBytes?.(early.received), 120);
      try {
        const buffer = await early.data;
        onBytes?.(buffer.byteLength);
        asset = await this.loader.parseAsync(buffer, "");
      } catch {
        asset = null;
      } finally {
        clearInterval(timer);
      }
    }
    asset ??= await this.loader.loadAsync(assetUrl(definition.url), (event) => onBytes?.(event.loaded));
    if (this.disposed) return;
    if ((TRADER_MODEL_KEYS as readonly string[]).includes(key)) brightenFigure(asset.scene);
    this.assets.set(key, asset);
  }

  /** Loads the models the first frame needs (all at once: the line is used to the full). */
  async load(): Promise<void> {
    this.assets.clear();
    this.received.clear();
    const total = START_ENTRIES.reduce((sum, [, definition]) => sum + assetBytes(definition.url), 0);
    let label = "Loading vessel and wildlife";
    const report = () => {
      let arrived = 0;
      for (const [key, definition] of START_ENTRIES) arrived += Math.min(assetBytes(definition.url), this.received.get(key) ?? 0);
      this.emitProgress((arrived / Math.max(1, total)) * ASSET_LOAD_TOTAL, label, false);
    };
    report();

    const requiredFailures: string[] = [];
    await Promise.all(
      START_ENTRIES.map(async ([key, definition]) => {
        try {
          await this.fetch(key, definition, (bytes) => {
            this.received.set(key, bytes);
            report();
          });
        } catch (error) {
          if (definition.required) {
            requiredFailures.push(`${key}: ${errorMessage(error)}`);
          } else {
            console.warn(`Optional 3D asset \"${key}\" could not be loaded and will be skipped.`, error);
          }
        } finally {
          this.received.set(key, assetBytes(definition.url));
          label = definition.label;
          report();
        }
      }),
    );

    if (requiredFailures.length > 0) {
      throw new Error(`Required 3D assets failed to load (${requiredFailures.join("; ")}).`);
    }

    this.emitProgress(ASSET_LOAD_TOTAL, "Building the scene", false);
  }

  /**
   * Fetches the remaining models in the background, one at a time so each
   * arrives as soon as it can (`onAsset` hears of each). Safe to call again:
   * the same load is returned.
   */
  loadLater(onAsset?: (key: AssetKey) => void): Promise<void> {
    this.laterLoad ??= (async () => {
      for (const [key, definition] of LATER_ENTRIES) {
        if (this.disposed) return;
        if (this.assets.has(key)) continue;
        try {
          await this.fetch(key, definition);
          if (!this.disposed) onAsset?.(key);
        } catch (error) {
          console.warn(`Optional 3D asset \"${key}\" could not be loaded and will be skipped.`, error);
        }
      }
    })();
    return this.laterLoad;
  }

  yacht(): THREE.Group {
    return this.cloneScene("yacht", false);
  }

  /** A copy of a model that may not have come yet (null until it has). */
  scene(key: StaticAssetKey): THREE.Group | null {
    return this.assets.has(key) ? this.cloneScene(key, false) : null;
  }


  dolphin(): AnimatedAssetInstance {
    const asset = this.animated("dolphin");
    if (!asset) throw new Error("Required dolphin asset was requested before it finished loading.");
    return asset;
  }

  animated(key: AnimatedAssetKey): AnimatedAssetInstance | undefined {
    const asset = this.assets.get(key);
    if (!asset) {
      if (REQUIRED_ANIMATED_ASSETS.has(key)) {
        throw new Error(`Required asset ${key} was requested before it finished loading.`);
      }
      return undefined;
    }
    const scene = cloneSkinned(asset.scene) as THREE.Group;
    shareSkeletons(scene);
    return { scene, animations: asset.animations };
  }

  has(key: AssetKey): boolean {
    return this.assets.has(key);
  }

  dispose(): void {
    this.disposed = true;
    this.assets.forEach((asset) => {
      asset.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose();
          });
          material.dispose();
        });
      });
    });
    this.assets.clear();
  }

  private cloneScene(key: StaticAssetKey, skinned: boolean): THREE.Group {
    const scene = this.require(key).scene;
    return (skinned ? cloneSkinned(scene) : scene.clone(true)) as THREE.Group;
  }

  private require(key: AssetKey): GLTF {
    const asset = this.assets.get(key);
    if (!asset) throw new Error(`Asset ${key} was requested before it finished loading.`);
    return asset;
  }

  private emitProgress(loaded: number, label: string, ready: boolean): void {
    this.onProgress?.({
      loaded,
      total: LOAD_STEPS_TOTAL,
      label,
      ready,
    });
  }
}

/**
 * The islanders as exported look dull and angular in the scene, for two
 * separate reasons, both put right here once per model:
 *
 * - **angular**: the meshes are dense (110 000 triangles) but their surface
 *   is crumpled at the scale of a triangle: a vertex normal stands 8–15°
 *   off the faces round it, and the two sides of a texture seam do not
 *   agree. Lit, a cheek or a shoulder then shows its facets, and worse once
 *   the mesh is simplified with distance. `smoothFigureNormals` rebuilds
 *   the normals from the shape itself, welded across seams and relaxed over
 *   the neighbouring vertices, so skin shades as one smooth surface;
 * - **dull**: a matte surface lit only by the sun and a dim sky, with
 *   textures painted grey-pale. They take more of the sky's light, a soft
 *   sheen, and their colours are graded (`FIGURE_GRADE`): more saturation,
 *   the darks lifted a little, a touch warmer, so a figure on the beach
 *   looks alive and sunlit, not dusty.
 */
export function brightenFigure(root: THREE.Object3D): void {
  const smoothed = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!smoothed.has(mesh.geometry)) {
      smoothed.add(mesh.geometry);
      smoothFigureNormals(mesh.geometry);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.envMapIntensity = 1.9;
      // The texture's roughness (about 0.8) times this: still matte, with a sheen.
      material.roughness = Math.min(material.roughness, 0.74);
      material.color.multiplyScalar(1.12);
      // The exported normal maps are all but flat and only add their
      // compression's grain to the shading.
      if (material.normalMap) material.normalScale.setScalar(0.35);
      gradeFigureColor(material);
      material.needsUpdate = true;
    }
  });
}

/** How a figure's texture colours are graded (see `brightenFigure`). */
export const FIGURE_GRADE = { saturation: 1.28, lift: 0.86, warmth: 0.035 } as const;

/**
 * The grade as numbers (the shader does the same): linear RGB in, linear
 * RGB out. Greys stay grey (a little lighter in the darks), colours gain
 * saturation, and nothing goes below zero.
 */
export function gradeFigureRgb(r: number, g: number, b: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const { saturation, lift, warmth } = FIGURE_GRADE;
  const lifted = [Math.pow(Math.max(r, 0), lift), Math.pow(Math.max(g, 0), lift), Math.pow(Math.max(b, 0), lift)];
  const luma = lifted[0]! * 0.2126 + lifted[1]! * 0.7152 + lifted[2]! * 0.0722;
  out[0] = Math.max(0, luma + (lifted[0]! - luma) * saturation) * (1 + warmth);
  out[1] = Math.max(0, luma + (lifted[1]! - luma) * saturation);
  out[2] = Math.max(0, luma + (lifted[2]! - luma) * saturation) * (1 - warmth);
  return out;
}

function gradeFigureColor(material: THREE.MeshStandardMaterial): void {
  const { saturation, lift, warmth } = FIGURE_GRADE;
  patchMaterialShader(material, "figure-grade", (shader) => {
    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "map_fragment",
      /* glsl */ `{
        vec3 figureLifted = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(${lift.toFixed(3)}));
        float figureLuma = dot(figureLifted, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = max(vec3(0.0), mix(vec3(figureLuma), figureLifted, ${saturation.toFixed(3)})) * vec3(${(1 + warmth).toFixed(3)}, 1.0, ${(1 - warmth).toFixed(3)});
      }`,
    );
  });
}

/**
 * Rebuilds a figure's vertex normals as those of a smooth surface: the
 * area-weighted normals of the faces round each point (points at the same
 * place, such as the two sides of a texture seam, counted as one), then
 * relaxed `passes` times over the neighbouring points, which irons out the
 * triangle-scale crumple of a scanned or generated mesh without touching
 * its shape. Works on normals stored as floats or as normalised integers.
 * Returns the mean angle (radians) the normals were turned by.
 */
export function smoothFigureNormals(geometry: THREE.BufferGeometry, passes = 3): number {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (!position || !normal || !index) return 0;
  const count = position.count;
  // Points at the same place share one normal.
  const weld = new Int32Array(count);
  const seen = new Map<string, number>();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const grid = 1 / (Math.max(size.x, size.y, size.z, 1e-6) * 2e-5);
  let welded = 0;
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(position.getX(i) * grid)},${Math.round(position.getY(i) * grid)},${Math.round(position.getZ(i) * grid)}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = welded;
      welded += 1;
      seen.set(key, id);
    }
    weld[i] = id;
  }
  const px = new Float32Array(welded);
  const py = new Float32Array(welded);
  const pz = new Float32Array(welded);
  for (let i = 0; i < count; i += 1) {
    const id = weld[i]!;
    px[id] = position.getX(i);
    py[id] = position.getY(i);
    pz[id] = position.getZ(i);
  }
  // The faces' normals, weighted by their area, gathered at each point.
  let current = new Float32Array(welded * 3);
  const triangles = index.count / 3;
  const corners = new Int32Array(index.count);
  for (let t = 0; t < triangles; t += 1) {
    const a = weld[index.getX(t * 3)]!;
    const b = weld[index.getX(t * 3 + 1)]!;
    const c = weld[index.getX(t * 3 + 2)]!;
    corners[t * 3] = a;
    corners[t * 3 + 1] = b;
    corners[t * 3 + 2] = c;
    const e1x = px[b]! - px[a]!;
    const e1y = py[b]! - py[a]!;
    const e1z = pz[b]! - pz[a]!;
    const e2x = px[c]! - px[a]!;
    const e2y = py[c]! - py[a]!;
    const e2z = pz[c]! - pz[a]!;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const corner of [a, b, c]) {
      current[corner * 3] += nx;
      current[corner * 3 + 1] += ny;
      current[corner * 3 + 2] += nz;
    }
  }
  const normalise = (values: Float32Array): void => {
    for (let i = 0; i < welded; i += 1) {
      const length = Math.hypot(values[i * 3]!, values[i * 3 + 1]!, values[i * 3 + 2]!) || 1;
      values[i * 3] /= length;
      values[i * 3 + 1] /= length;
      values[i * 3 + 2] /= length;
    }
  };
  normalise(current);
  // Relaxed over the neighbours along the edges (each point keeps half of its own).
  let next = new Float32Array(welded * 3);
  for (let pass = 0; pass < passes; pass += 1) {
    next.set(current);
    for (let t = 0; t < triangles; t += 1) {
      for (let k = 0; k < 3; k += 1) {
        const from = corners[t * 3 + k]!;
        const to = corners[t * 3 + ((k + 1) % 3)]!;
        // (An edge is seen from the triangle on each side: once each way.)
        next[to * 3] += current[from * 3]! * 0.17;
        next[to * 3 + 1] += current[from * 3 + 1]! * 0.17;
        next[to * 3 + 2] += current[from * 3 + 2]! * 0.17;
        next[from * 3] += current[to * 3]! * 0.17;
        next[from * 3 + 1] += current[to * 3 + 1]! * 0.17;
        next[from * 3 + 2] += current[to * 3 + 2]! * 0.17;
      }
    }
    normalise(next);
    const swap = current;
    current = next;
    next = swap;
  }
  let turned = 0;
  for (let i = 0; i < count; i += 1) {
    const id = weld[i]! * 3;
    const ox = normal.getX(i);
    const oy = normal.getY(i);
    const oz = normal.getZ(i);
    const length = Math.hypot(ox, oy, oz) || 1;
    turned += Math.acos(Math.min(1, Math.max(-1, (ox * current[id]! + oy * current[id + 1]! + oz * current[id + 2]!) / length)));
    normal.setXYZ(i, current[id]!, current[id + 1]!, current[id + 2]!);
  }
  normal.needsUpdate = true;
  return turned / Math.max(1, count);
}

/**
 * GLTFLoader and SkeletonUtils.clone give every skinned mesh its own Skeleton,
 * even when the meshes of one animal are bound to the very same bones. Each
 * skeleton recomputes its bone matrices and re-uploads its bone texture every
 * frame, so a gull modelled as fourteen meshes cost fourteen uploads. Meshes
 * bound to the same bones with the same inverse bind matrices share one
 * skeleton instead. Returns the number of skeletons made redundant.
 */
export function shareSkeletons(root: THREE.Object3D): number {
  const kept: THREE.Skeleton[] = [];
  let replaced = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const own = object.skeleton;
    const match = kept.find((candidate) => sameBinding(candidate, own));
    if (!match) {
      kept.push(own);
    } else if (match !== own) {
      object.skeleton = match;
      own.dispose();
      replaced += 1;
    }
  });
  return replaced;
}

function sameBinding(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (a === b) return true;
  if (a.bones.length !== b.bones.length) return false;
  for (let index = 0; index < a.bones.length; index += 1) {
    if (a.bones[index] !== b.bones[index] || !a.boneInverses[index].equals(b.boneInverses[index])) return false;
  }
  return true;
}
