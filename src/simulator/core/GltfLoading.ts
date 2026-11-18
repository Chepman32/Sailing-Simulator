import type * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { isHandheld } from "./QualityManager";
import { disposeModel, limitModelTextures } from "./ModelResources";

/**
 * A GLTFLoader for the game's models: they are packed with meshoptimizer
 * (`EXT_meshopt_compression`, see `scripts/pack-models.mjs`), a third of
 * their raw size or less, and decoded here at several hundred MB/s.
 */
export function createGltfLoader(manager?: THREE.LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (isHandheld()) loader.register(() => ({
    name: "MobileTextureBudget",
    afterRoot: async (result) => {
      try {
        await limitModelTextures(result.scenes);
      } catch (error) {
        disposeModel(result.scenes);
        throw error;
      }
    },
  }));
  return loader;
}
