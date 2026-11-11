import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";
import { chooseLodLevel, DEFAULT_LOD_STEPS, simplifiedGeometry } from "../../src/simulator/core/ScreenLod";

test("a simplified level keeps the source's vertices and attributes and draws fewer triangles", async () => {
  await MeshoptSimplifier.ready;
  const source = new THREE.SphereGeometry(1, 96, 64);
  source.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(source.getAttribute("position").count * 4), 4));
  source.computeBoundingSphere();
  const level = simplifiedGeometry(source, 0.2)!;
  assert.ok(level, "simplified");
  assert.equal(level.getAttribute("position"), source.getAttribute("position"), "shares the vertex buffer");
  assert.equal(level.getAttribute("skinIndex"), source.getAttribute("skinIndex"), "skinning attributes untouched");
  const full = source.index!.count / 3;
  const drawn = level.index!.count / 3;
  assert.ok(drawn < full * 0.3 && drawn > full * 0.08, `${drawn} of ${full}`);
  assert.ok(level.boundingSphere && Math.abs(level.boundingSphere.radius - source.boundingSphere!.radius) < 1e-9);
  for (let index = 0; index < level.index!.count; index += 1) assert.ok(level.index!.getX(index) < source.getAttribute("position").count);
});

test("levels switch by size on screen, with hysteresis", () => {
  assert.equal(chooseLodLevel(0.5, 0, DEFAULT_LOD_STEPS), 0);
  assert.equal(chooseLodLevel(0.1, 0, DEFAULT_LOD_STEPS), 1);
  assert.equal(chooseLodLevel(0.02, 0, DEFAULT_LOD_STEPS), 2);
  // Just above a threshold after having dropped below it: stays down.
  assert.equal(chooseLodLevel(0.17, 1, DEFAULT_LOD_STEPS), 1);
  assert.equal(chooseLodLevel(0.2, 1, DEFAULT_LOD_STEPS), 0);
});

test("a mesh whose level is its own non-indexed geometry is counted, not crashed on", async () => {
  await MeshoptSimplifier.ready;
  const { ScreenLod } = await import("../../src/simulator/core/ScreenLod");
  const lod = new ScreenLod();
  await MeshoptSimplifier.ready;
  // A non-indexed mesh too coarse to simplify usefully: its levels are itself.
  const geometry = new THREE.BoxGeometry(1, 1, 1, 30, 30, 30).toNonIndexed();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const scene = new THREE.Scene();
  scene.add(mesh);
  lod.register(scene, 100, [{ ratio: 0.95, below: 10 }]);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 500);
  scene.updateMatrixWorld(true);
  for (let frame = 0; frame < 5; frame += 1) assert.doesNotThrow(() => lod.update(camera));
  assert.ok(lod.stats.drawn > 0);
  lod.dispose();
});
