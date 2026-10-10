import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { shareSkeletons } from "../../src/simulator/core/AssetManager";
import { mergeSkinnedParts } from "../../src/simulator/core/SkinnedMerge";
import { batchStaticMeshes, coincidentShells, type ShellBounds } from "../../src/simulator/core/StaticBatching";
import { simplifiedFish } from "../../src/simulator/wildlife/ReefFishController";

const box = (min: [number, number, number], max: [number, number, number]): ShellBounds => ({ min, max });

test("stacked copies of one shell are found, distinct parts are not", () => {
  const bounds = [
    box([-1.76, -0.8, -2.79], [1.76, 0.8, 2.79]), // coachroof
    box([-1.81, -0.79, -2.78], [1.81, 0.8, 2.78]), // a copy 5 cm wider
    box([-1.8, -0.8, -2.8], [1.8, 0.8, 2.8]), // another copy
    box([-1.76, -0.8, -2.79], [1.76, 0.8, 2.79]), // same box, other material
    box([-0.3, 0, -0.3], [0.3, 0.2, 0.3]), // small fitting
    box([-0.3, 0, -0.3], [0.3, 0.2, 0.3]), // its twin: too small to matter
    box([2, -1, -4], [3.5, 0.6, 4]), // a hull
  ];
  const keys = ["fiberglass", "fiberglass", "fiberglass", "glass", "steel", "steel", "fiberglass"];
  assert.deepEqual(coincidentShells(bounds, keys, 0.06), [1, 2]);
  assert.deepEqual(coincidentShells(bounds, keys, 0.01), [], "a tight tolerance keeps every shell");
});

test("static batching merges by key in the parent's space and keeps every triangle facing out", () => {
  const parent = new THREE.Group();
  parent.position.set(4, 1, -2);
  parent.rotation.y = 0.7;
  const shared = new THREE.MeshStandardMaterial({ name: "steel" });
  const disposed: string[] = [];
  const steel = (name: string): THREE.MeshStandardMaterial => {
    const material = shared.clone();
    material.addEventListener("dispose", () => disposed.push(name));
    return material;
  };
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel("a"));
  a.name = "a";
  a.position.set(1, 0, 0);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.5), steel("b"));
  b.name = "b";
  b.position.set(-2, 1, 0);
  b.scale.set(-1, 1, 1); // mirrored, as some exporters leave port-side parts
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ name: "glass" }));
  const nested = new THREE.Group();
  nested.rotation.x = 0.4;
  nested.add(b);
  parent.add(a, nested, glass);
  parent.updateMatrixWorld(true);

  const before = new THREE.Box3().setFromObject(a, true).union(new THREE.Box3().setFromObject(b, true));
  const result = batchStaticMeshes(parent, [a, b, glass], (mesh) => (mesh.material as THREE.Material).name, "Test");

  assert.equal(result.batches.length, 1, "the lone glass pane is left alone");
  assert.equal(result.merged, 2);
  assert.equal(a.parent, null);
  assert.equal(b.parent, null);
  assert.equal(glass.parent, parent);
  assert.deepEqual(disposed, ["b"], "only the redundant material is released");

  const batch = result.batches[0];
  assert.equal(batch.parent, parent);
  assert.equal(batch.geometry.index!.count / 3, 24, "both boxes keep all twelve triangles");
  parent.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(batch, true);
  assert.ok(after.min.distanceTo(before.min) < 1e-5 && after.max.distanceTo(before.max) < 1e-5, "world placement is unchanged");

  // Winding must agree with the stored normals, including the mirrored box.
  const position = batch.geometry.getAttribute("position");
  const normal = batch.geometry.getAttribute("normal");
  const index = batch.geometry.index!;
  const [p0, p1, p2, n, face] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    p0.fromBufferAttribute(position, index.getX(triangle));
    p1.fromBufferAttribute(position, index.getX(triangle + 1));
    p2.fromBufferAttribute(position, index.getX(triangle + 2));
    face.subVectors(p2, p1).cross(p0.clone().sub(p1)).normalize();
    n.fromBufferAttribute(normal, index.getX(triangle));
    assert.ok(face.dot(n) > 0.99, `triangle ${triangle / 3} is inside out`);
  }
});

test("distant reef fish keep their shape with a fraction of the triangles", () => {
  // A fish-like spindle: unit length along Z, flattened sideways, textured.
  const body = new THREE.SphereGeometry(0.5, 32, 24);
  body.scale(0.18, 0.42, 1);
  const detail = body;
  const simplified = simplifiedFish(detail);
  assert.ok(simplified, "the spindle simplifies");
  const sourceTriangles = detail.index!.count / 3;
  const triangles = simplified.getAttribute("position").count / 3;
  assert.ok(triangles < sourceTriangles * 0.4, `expected a large reduction, got ${triangles} of ${sourceTriangles}`);
  assert.ok(simplified.getAttribute("uv") && simplified.getAttribute("normal"), "texture and lighting attributes survive");
  detail.computeBoundingBox();
  simplified.computeBoundingBox();
  const source = detail.boundingBox!;
  const reduced = simplified.boundingBox!;
  assert.ok(Math.abs(reduced.max.z - source.max.z) < 0.03 && Math.abs(reduced.min.z - source.min.z) < 0.03, "length is kept");
  assert.ok(reduced.max.y > source.max.y * 0.85, "the back keeps its height");
});

test("meshes of one animal share a skeleton, so its bones upload once per frame", () => {
  const root = new THREE.Group();
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  bones[1].position.y = 1;
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skinned = (skeleton: THREE.Skeleton): THREE.SkinnedMesh => {
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.bind(skeleton, new THREE.Matrix4()); // an explicit bind matrix keeps the given inverses
    root.add(mesh);
    return mesh;
  };
  // Separate Skeleton objects over the same bones, as GLTFLoader creates them.
  const body = skinned(new THREE.Skeleton(bones));
  const eye = skinned(new THREE.Skeleton(bones));
  const fin = skinned(new THREE.Skeleton(bones));
  // Same bones, different bind pose: must stay separate.
  const rebound = new THREE.Skeleton(bones, [new THREE.Matrix4().makeTranslation(0, 2, 0), new THREE.Matrix4()]);
  const odd = skinned(rebound);
  // Other bones entirely.
  const other = skinned(new THREE.Skeleton([new THREE.Bone()]));

  assert.equal(shareSkeletons(root), 2);
  assert.equal(eye.skeleton, body.skeleton);
  assert.equal(fin.skeleton, body.skeleton);
  assert.notEqual(odd.skeleton, body.skeleton);
  assert.notEqual(other.skeleton, body.skeleton);
  assert.equal(shareSkeletons(root), 0, "sharing is idempotent");
});

function riggedModel(): { model: THREE.Group; bones: THREE.Bone[]; parts: THREE.SkinnedMesh[] } {
  const model = new THREE.Group();
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  bones[1].add(bones[2]);
  bones[1].position.set(0, 0.6, 0);
  bones[2].position.set(0.4, 0.5, 0);
  model.add(bones[0]);
  const colours = [0xffffff, 0x222222, 0xffcc00];
  const parts = colours.map((colour, index) => {
    const geometry = new THREE.BoxGeometry(0.3, 1.4, 0.3, 1, 6, 1);
    const position = geometry.getAttribute("position");
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const t = THREE.MathUtils.clamp((position.getY(vertex) + 0.7) / 1.4, 0, 1);
      skinIndex.push(index === 2 ? 1 : 0, index === 2 ? 2 : 1, 0, 0);
      skinWeight.push(1 - t, t, 0, 0);
    }
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4 + index * 0.2 }));
    // Each part sits somewhere else in the file, as the gull's fourteen do.
    mesh.position.set(index * 0.7 - 0.5, index * 0.2, -index * 0.3);
    mesh.rotation.set(0.1 * index, 0.5 * index, 0);
    mesh.scale.setScalar(1 + index * 0.1);
    model.add(mesh);
    return mesh;
  });
  model.rotation.set(-Math.PI / 2, 0.3, 0);
  model.scale.setScalar(2);
  model.updateMatrixWorld(true);
  // glTF-style binding: one skin per part, bound where the part sits.
  parts.forEach((part) => part.bind(new THREE.Skeleton(bones), part.matrixWorld));
  return { model, bones, parts };
}

function posedWorldVertices(meshes: THREE.SkinnedMesh[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : mesh.geometry.getAttribute("position").count;
    for (let corner = 0; corner < count; corner += 1) {
      const vertex = index ? index.getX(corner) : corner;
      out.push(mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  }
  return out;
}

test("a flat-coloured rig merges into one skinned mesh that deforms exactly as its parts did", () => {
  const { model, bones, parts } = riggedModel();
  const pose = (): void => {
    bones[1].rotation.set(0.5, 0.2, -0.7);
    bones[2].rotation.set(-0.4, 0, 0.9);
    model.position.set(3, 12, -4);
    model.rotation.y += 0.8;
    model.updateMatrixWorld(true);
  };
  pose();
  const expected = posedWorldVertices(parts);
  const colours = parts.map((part) => (part.material as THREE.MeshStandardMaterial).color.clone());
  model.rotation.y -= 0.8;
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const merged = mergeSkinnedParts(model);
  assert.ok(merged, "the parts merge");
  let skinned = 0;
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinned += 1;
  });
  assert.equal(skinned, 1, "one skinned mesh remains");
  assert.ok((merged.material as THREE.MeshStandardMaterial).vertexColors);

  pose();
  const actual = posedWorldVertices([merged]);
  assert.equal(actual.length, expected.length);
  const worst = actual.reduce((max, vertex, index) => Math.max(max, vertex.distanceTo(expected[index])), 0);
  assert.ok(worst < 1e-5, `merged rig moved a vertex by ${worst}`);

  const colour = merged.geometry.getAttribute("color");
  const perPart = expected.length / parts.length;
  parts.forEach((_, index) => {
    const corner = merged.geometry.getIndex()!.getX(index * perPart);
    const r = colour.getX(corner);
    assert.ok(Math.abs(r - colours[index].r) < 1e-6, "each part keeps its colour");
  });
});

test("rigs that cannot merge exactly are left alone", () => {
  const textured = riggedModel();
  (textured.parts[1].material as THREE.MeshStandardMaterial).map = new THREE.Texture();
  assert.equal(mergeSkinnedParts(textured.model), null, "a textured part needs its UVs and map");

  const bent = riggedModel();
  // One part bound in a different pose: no single offset reconciles it.
  const inverses = bent.parts[2].skeleton.boneInverses.map((matrix) => matrix.clone());
  inverses[2].multiply(new THREE.Matrix4().makeRotationZ(0.3));
  bent.parts[2].bind(new THREE.Skeleton(bent.bones, inverses), bent.parts[2].bindMatrix);
  assert.equal(mergeSkinnedParts(bent.model), null);
  let skinned = 0;
  bent.model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinned += 1;
  });
  assert.equal(skinned, 3, "the model is untouched");
});
