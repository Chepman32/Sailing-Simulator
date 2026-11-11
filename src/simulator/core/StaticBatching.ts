import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Static batching for imported models.
 *
 * A detailed GLB arrives split into many meshes: the yacht has more than forty,
 * most of them a rail or a fitting of a hundred-odd triangles. Each one costs a
 * draw call in the colour pass and another in the shadow pass, and on a phone
 * that per-call CPU work, not the triangles, is what limits the frame rate.
 * Parts that never move relative to each other and share a material are merged
 * into one mesh per material.
 */

export type ShellBounds = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

/**
 * Indices of meshes whose bounds coincide, within `tolerance` metres on every
 * face, with an earlier mesh of the same key: stacked copies of one shell, as
 * modelling tools leave behind (the yacht's coachroof exists three times, a few
 * centimetres apart). The copies stay visible, since they differ in detail,
 * but only the first needs to cast a shadow; the shadow map sees the same
 * silhouette either way.
 */
export function coincidentShells(
  bounds: readonly ShellBounds[],
  keys: readonly string[],
  tolerance: number,
  minimumSize = 1,
): number[] {
  const copies: number[] = [];
  const isCopy = new Array<boolean>(bounds.length).fill(false);
  for (let index = 0; index < bounds.length; index += 1) {
    const candidate = bounds[index];
    const size = Math.max(
      candidate.max[0] - candidate.min[0],
      candidate.max[1] - candidate.min[1],
      candidate.max[2] - candidate.min[2],
    );
    if (size < minimumSize) continue;
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (isCopy[earlier] || keys[earlier] !== keys[index]) continue;
      const original = bounds[earlier];
      let coincides = true;
      for (let axis = 0; axis < 3 && coincides; axis += 1) {
        coincides =
          Math.abs(original.min[axis] - candidate.min[axis]) <= tolerance &&
          Math.abs(original.max[axis] - candidate.max[axis]) <= tolerance;
      }
      if (coincides) {
        isCopy[index] = true;
        copies.push(index);
        break;
      }
    }
  }
  return copies;
}

export type StaticBatchResult = {
  /** One mesh per group of two or more members, added to the parent. */
  readonly batches: THREE.Mesh[];
  /** Geometries created here; the caller owns and disposes them. */
  readonly geometries: THREE.BufferGeometry[];
  /** Number of source meshes replaced by the batches. */
  readonly merged: number;
};

const matrix = new THREE.Matrix4();
const inverseParent = new THREE.Matrix4();

/**
 * Merges the meshes that share a key into one mesh each, expressed in
 * `parent`'s space and added to it. The first member's material is kept and
 * the other members' materials are disposed; the members leave the scene
 * graph. Groups of one are left as they are. The meshes must not move relative
 * to `parent` afterwards.
 */
export function batchStaticMeshes(
  parent: THREE.Object3D,
  meshes: readonly THREE.Mesh[],
  keyOf: (mesh: THREE.Mesh) => string,
  name: string,
): StaticBatchResult {
  const groups = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material) || mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) continue;
    if (mesh.geometry.morphAttributes.position) continue;
    const key = keyOf(mesh);
    const group = groups.get(key);
    if (group) group.push(mesh);
    else groups.set(key, [mesh]);
  }

  parent.updateMatrixWorld(true);
  inverseParent.copy(parent.matrixWorld).invert();
  const batches: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let merged = 0;

  groups.forEach((members) => {
    if (members.length < 2) return;
    const shared = commonAttributes(members);
    if (!shared.has("position")) return;
    const parts = members.map((mesh) => {
      matrix.multiplyMatrices(inverseParent, mesh.matrixWorld);
      return bakedGeometry(mesh.geometry, matrix, shared);
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!geometry) return;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const first = members[0];
    const material = first.material as THREE.Material;
    const batch = new THREE.Mesh(geometry, material);
    batch.name = `${name}:${material.name || material.type}`;
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.userData.batchedFrom = members.map((mesh) => mesh.name);
    parent.add(batch);

    const released = new Set<THREE.Material>();
    members.forEach((mesh) => {
      const own = mesh.material as THREE.Material;
      if (own !== material) released.add(own);
      mesh.removeFromParent();
    });
    released.forEach((own) => own.dispose());
    batches.push(batch);
    geometries.push(geometry);
    merged += members.length;
  });

  return { batches, geometries, merged };
}

function commonAttributes(meshes: readonly THREE.Mesh[]): Set<string> {
  const shared = new Set(Object.keys(meshes[0].geometry.attributes));
  for (const mesh of meshes) {
    const own = mesh.geometry.attributes;
    for (const attribute of [...shared]) {
      const reference = meshes[0].geometry.getAttribute(attribute);
      const candidate = own[attribute];
      if (!candidate || candidate.itemSize !== reference.itemSize || candidate.normalized !== reference.normalized) {
        shared.delete(attribute);
      }
    }
  }
  return shared;
}

/** A copy of `source` with `transform` applied, the given attributes, and an index. */
function bakedGeometry(source: THREE.BufferGeometry, transform: THREE.Matrix4, attributes: Set<string>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const attribute of attributes) {
    const from = source.getAttribute(attribute);
    // Interleaved or quantised data is expanded so every member merges alike.
    const array = new Float32Array(from.count * from.itemSize);
    for (let index = 0; index < from.count; index += 1) {
      for (let component = 0; component < from.itemSize; component += 1) {
        array[index * from.itemSize + component] = from.getComponent(index, component);
      }
    }
    geometry.setAttribute(attribute, new THREE.BufferAttribute(array, from.itemSize));
  }
  const count = source.getAttribute("position").count;
  const index = source.getIndex();
  const indices = new Uint32Array(index ? index.count : count);
  for (let position = 0; position < indices.length; position += 1) indices[position] = index ? index.getX(position) : position;
  // A mirroring transform turns every triangle inside out once it is baked in;
  // three.js only compensates for mirrored objects, not mirrored vertices.
  if (transform.determinant() < 0) {
    for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
      const second = indices[triangle + 1];
      indices[triangle + 1] = indices[triangle + 2];
      indices[triangle + 2] = second;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.applyMatrix4(transform);
  return geometry;
}
