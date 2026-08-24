import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { LoadingState } from "../types";

export type AnimatedAssetKey = "dolphin" | "shark" | "whale" | "fishSchool" | "seagull";
export type StaticAssetKey = "yacht" | "palms";
export type AssetKey = StaticAssetKey | AnimatedAssetKey;

export type AnimatedAssetInstance = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

type AssetDefinition = {
  url: string;
  label: string;
  required: boolean;
};

const ASSETS = {
  yacht: { url: "/models/yacht-sailboat-pbr.glb", label: "Loading yacht", required: true },
  palms: { url: "/models/palm-trees-quaternius.glb", label: "Planting islands", required: true },
  dolphin: { url: "/models/dolphin-animated.glb", label: "Loading dolphins", required: true },
  shark: { url: "/models/shark-animated.glb", label: "Loading sharks", required: false },
  whale: { url: "/models/whale-animated.glb", label: "Loading whales", required: false },
  fishSchool: { url: "/models/tropical-fish-school.glb", label: "Loading tropical fish", required: false },
  seagull: { url: "/models/seagull-animated.glb", label: "Loading seabirds", required: false },
} satisfies Record<AssetKey, AssetDefinition>;

const ASSET_ENTRIES = Object.entries(ASSETS) as Array<[AssetKey, AssetDefinition]>;

export const ASSET_LOAD_TOTAL = ASSET_ENTRIES.length;

const REQUIRED_ANIMATED_ASSETS = new Set<AnimatedAssetKey>(["dolphin"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
};

export class AssetManager {
  private readonly loadingManager = new THREE.LoadingManager();
  private readonly loader = new GLTFLoader(this.loadingManager);
  private readonly assets = new Map<AssetKey, GLTF>();
  private completedLoads = 0;

  constructor(private readonly onProgress?: (state: LoadingState) => void) {}

  async load(): Promise<void> {
    this.completedLoads = 0;
    this.assets.clear();
    this.emitProgress("Loading vessel and wildlife", false);

    const requiredFailures: string[] = [];
    await Promise.all(
      ASSET_ENTRIES.map(async ([key, definition]) => {
        try {
          const asset = await this.loader.loadAsync(definition.url);
          this.assets.set(key, asset);
        } catch (error) {
          if (definition.required) {
            requiredFailures.push(`${key}: ${errorMessage(error)}`);
          } else {
            console.warn(`Optional 3D asset \"${key}\" could not be loaded and will be skipped.`, error);
          }
        } finally {
          this.completedLoads += 1;
          this.emitProgress(definition.label, false);
        }
      }),
    );

    if (requiredFailures.length > 0) {
      throw new Error(`Required 3D assets failed to load (${requiredFailures.join("; ")}).`);
    }

    this.emitProgress("Scene ready", true);
  }

  yacht(): THREE.Group {
    return this.cloneScene("yacht", false);
  }

  palms(): THREE.Group {
    return this.cloneScene("palms", false);
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
    return {
      scene: cloneSkinned(asset.scene) as THREE.Group,
      animations: asset.animations,
    };
  }

  has(key: AssetKey): boolean {
    return this.assets.has(key);
  }

  dispose(): void {
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

  private emitProgress(label: string, ready: boolean): void {
    this.onProgress?.({
      loaded: this.completedLoads,
      total: ASSET_LOAD_TOTAL,
      label,
      ready,
    });
  }
}
