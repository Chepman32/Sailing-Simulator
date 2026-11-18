import type * as THREE from "three";

/**
 * `renderer.compileAsync` without its one sharp edge: three's version polls
 * every material it compiled until each program reports ready, and a
 * material disposed in the meantime (an island streamed out as the yacht is
 * moved across the map, a story prop cleared) has no program any more, so
 * its timer throws outside any promise. Here a material that has lost its
 * program simply counts as done.
 */
export function compileSafely(renderer: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene | null = null): Promise<void> {
  let pending: Set<THREE.Material>;
  try {
    pending = renderer.compile(object, camera, scene) as unknown as Set<THREE.Material>;
  } catch (error) {
    return Promise.reject(error);
  }
  if (!(pending instanceof Set) || pending.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      for (const material of pending) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } }).currentProgram;
        if (!program || program.isReady()) pending.delete(material);
      }
      if (pending.size === 0) resolve();
      else setTimeout(check, 10);
    };
    setTimeout(check, 0);
  });
}
