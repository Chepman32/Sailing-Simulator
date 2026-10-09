import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Merges the flat-coloured skinned parts of one rigged model into a single
 * skinned mesh with vertex colours.
 *
 * The licensed seagull arrives as fourteen skinned meshes in nine untextured
 * colours (body, wings, beak, legs, eyes), each with its own skin. A flock of
 * four therefore cost up to fifty-six draw calls and fifty-six bone uploads a
 * frame for barely a thousand triangles per bird. All parts are bound to the
 * same bones; their skins differ only by where each part sat when it was
 * bound, which is one rigid offset per part. Baking that offset into the
 * part's vertices lets every part use the first part's skin exactly.
 *
 * Returns the merged mesh, or null with the model untouched when the parts
 * cannot be merged exactly: textured or emissive materials, other bones, or
 * bind poses that are not one offset apart.
 */
export function mergeSkinnedParts(model: THREE.Object3D, tolerance = 1e-4): THREE.SkinnedMesh | null {
  const parts: THREE.SkinnedMesh[] = [];
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) parts.push(object);
  });
  if (parts.length < 2) return null;
  if (!parts.every(isFlatColoured)) return null;

  const reference = parts[0];
  const bones = reference.skeleton.bones;
  if (!parts.every((part) => sameBones(part.skeleton.bones, bones))) return null;

  // Rest transform of each bone as the reference skin sees it.
  const referenceRest = reference.skeleton.boneInverses.map((inverse) =>
    new THREE.Matrix4().multiplyMatrices(inverse, reference.bindMatrix).invert(),
  );

  const geometries: THREE.BufferGeometry[] = [];
  const offset = new THREE.Matrix4();
  const candidate = new THREE.Matrix4();
  const colour = new THREE.Color();
  let roughness = 0;
  let metalness = 0;
  let weightTotal = 0;
  let doubleSided = false;

  for (const part of parts) {
    const used = usedBones(part.geometry);
    if (used.length === 0) return null;
    // offset = (IBM_ref · bind_ref)⁻¹ · (IBM_part · bind_part), the same for every bone.
    let first = true;
    for (const bone of used) {
      candidate.multiplyMatrices(part.skeleton.boneInverses[bone], part.bindMatrix).premultiply(referenceRest[bone]);
      if (first) {
        offset.copy(candidate);
        first = false;
      } else if (!matricesAgree(offset, candidate, tolerance)) {
        return null;
      }
    }

    const material = part.material as THREE.MeshStandardMaterial;
    const geometry = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "skinIndex", "skinWeight"] as const) {
      const source = part.geometry.getAttribute(name);
      if (!source) {
        geometries.forEach((built) => built.dispose());
        return null;
      }
      geometry.setAttribute(name, expanded(source));
    }
    const count = geometry.getAttribute("position").count;
    colour.copy(material.color);
    const colours = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) colour.toArray(colours, index * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const index = part.geometry.getIndex();
    const indices = new Uint32Array(index ? index.count : count);
    for (let position = 0; position < indices.length; position += 1) indices[position] = index ? index.getX(position) : position;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // Moves the vertices (and normals) into the reference skin's bind space.
    geometry.applyMatrix4(offset);
    if (offset.determinant() < 0) flipWinding(indices);
    geometries.push(geometry);

    const weight = indices.length / 3;
    roughness += material.roughness * weight;
    metalness += material.metalness * weight;
    weightTotal += weight;
    doubleSided ||= material.side === THREE.DoubleSide;
  }

  const geometry = mergeGeometries(geometries, false);
  geometries.forEach((built) => built.dispose());
  if (!geometry) return null;

  const material = new THREE.MeshStandardMaterial({
    name: "MergedFlatColours",
    vertexColors: true,
    roughness: roughness / weightTotal,
    metalness: metalness / weightTotal,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  const merged = new THREE.SkinnedMesh(geometry, material);
  merged.name = `${reference.name || "Skinned"}_Merged`;
  merged.position.copy(reference.position);
  merged.quaternion.copy(reference.quaternion);
  merged.scale.copy(reference.scale);
  merged.castShadow = reference.castShadow;
  merged.receiveShadow = reference.receiveShadow;
  merged.frustumCulled = reference.frustumCulled;
  (reference.parent ?? model).add(merged);
  merged.bind(reference.skeleton, reference.bindMatrix);
  parts.forEach((part) => part.removeFromParent());
  return merged;
}

function isFlatColoured(mesh: THREE.SkinnedMesh): boolean {
  const material = mesh.material;
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return false;
  if (material.transparent || material.vertexColors || mesh.geometry.morphAttributes.position) return false;
  const maps = [
    material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.emissiveMap,
    material.alphaMap, material.aoMap, material.bumpMap, material.displacementMap, material.lightMap,
  ];
  return maps.every((map) => !map) && material.emissive.getHex() === 0;
}

function sameBones(a: readonly THREE.Bone[], b: readonly THREE.Bone[]): boolean {
  return a.length === b.length && a.every((bone, index) => bone === b[index]);
}

function usedBones(geometry: THREE.BufferGeometry): number[] {
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) return [];
  const used = new Set<number>();
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      if (skinWeight.getComponent(vertex, slot) > 0) used.add(skinIndex.getComponent(vertex, slot));
    }
  }
  return [...used];
}

function matricesAgree(a: THREE.Matrix4, b: THREE.Matrix4, tolerance: number): boolean {
  const scale = Math.max(1, ...a.elements.map(Math.abs));
  return a.elements.every((value, index) => Math.abs(value - b.elements[index]) <= tolerance * scale);
}

/** A plain, non-interleaved copy so every part merges alike. */
function expanded(source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const integer = source.array instanceof Uint8Array || source.array instanceof Uint16Array;
  const array = integer && !source.normalized
    ? new Uint16Array(source.count * source.itemSize)
    : new Float32Array(source.count * source.itemSize);
  for (let index = 0; index < source.count; index += 1) {
    for (let component = 0; component < source.itemSize; component += 1) {
      array[index * source.itemSize + component] = source.getComponent(index, component);
    }
  }
  return new THREE.BufferAttribute(array, source.itemSize);
}

function flipWinding(indices: Uint32Array): void {
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const second = indices[triangle + 1];
    indices[triangle + 1] = indices[triangle + 2];
    indices[triangle + 2] = second;
  }
}
