import type * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * A GLTFLoader for the game's models: they are packed with meshoptimizer
 * (`EXT_meshopt_compression`, see `scripts/pack-models.mjs`), a third of
 * their raw size or less, and decoded here at several hundred MB/s.
 */
export function createGltfLoader(manager?: THREE.LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
