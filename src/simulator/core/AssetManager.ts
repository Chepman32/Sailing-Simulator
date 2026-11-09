import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { LoadingState } from "../types";
import { assetBytes, assetUrl } from "./assetManifest";
import { createGltfLoader } from "./GltfLoading";
import { takePrefetchedModel } from "./startAssets";

export type AnimatedAssetKey =
  | "dolphin" | "shark" | "whale" | "fishSchool" | "seagull"
  | "traderMan" | "traderWoman" | "traderPirate" | "crabRed" | "crabBlue";
/** The island traders' models, in the order they are handed out. */
export const TRADER_MODEL_KEYS = ["traderMan", "traderWoman", "traderPirate"] as const satisfies readonly AnimatedAssetKey[];
export type StaticAssetKey = "yacht";
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
  // In the order they are wanted: what is met at sea first, then ashore.
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
 * The islanders' skin and clothes, as exported, read flat and grey in the
 * scene's light: a matte surface lit only by the sun and a dim sky. They
 * take a little more of the sky's light (and a soft sheen on skin) and a
 * touch more colour, so a figure on the beach looks alive, not dusty.
 */
export function brightenFigure(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.envMapIntensity = 1.6;
      // The texture's roughness (about 0.8) times this: still matte, with a sheen.
      material.roughness = Math.min(material.roughness, 0.82);
      material.color.multiplyScalar(1.1);
      material.needsUpdate = true;
    }
  });
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
