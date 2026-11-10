import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { brightenFigure, FIGURE_GRADE, gradeFigureRgb, smoothFigureNormals } from "../../src/simulator/core/AssetManager";
import { chooseLodLevel } from "../../src/simulator/core/ScreenLod";

/** A sphere whose surface is crumpled at the scale of its triangles, with a texture seam, like a generated figure's skin. */
function crumpledSphere(quantised: boolean): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const position = geometry.getAttribute("position");
  const point = new THREE.Vector3();
  // The same bump for points at the same place (the seam's two sides stay together).
  const bump = (x: number, y: number, z: number): number => {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return (n - Math.floor(n) - 0.5) * 0.05;
  };
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    const key = [Math.round(point.x * 1e4) / 1e4, Math.round(point.y * 1e4) / 1e4, Math.round(point.z * 1e4) / 1e4] as const;
    point.multiplyScalar(1 + bump(...key));
    position.setXYZ(i, point.x, point.y, point.z);
  }
  // Normals as exported: those of the crumpled faces, each side of the seam its own.
  geometry.computeVertexNormals();
  if (quantised) {
    const normal = geometry.getAttribute("normal");
    const packed = new THREE.BufferAttribute(new Int16Array(normal.count * 3), 3, true);
    for (let i = 0; i < normal.count; i += 1) packed.setXYZ(i, normal.getX(i), normal.getY(i), normal.getZ(i));
    geometry.setAttribute("normal", packed);
  }
  return geometry;
}

/** Mean angle (degrees) between the normals and the true ones of the sphere, away from the poles. */
function roughness(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  let total = 0;
  let count = 0;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i).normalize();
    if (Math.abs(p.y) > 0.9) continue;
    n.fromBufferAttribute(normal, i).normalize();
    total += THREE.MathUtils.radToDeg(Math.acos(Math.min(1, n.dot(p))));
    count += 1;
  }
  return total / count;
}

test("a figure's crumpled skin is shaded as a smooth surface, and its seams close", () => {
  for (const quantised of [false, true]) {
    const geometry = crumpledSphere(quantised);
    const before = roughness(geometry);
    assert.ok(before > 4, `the test surface is crumpled (${before.toFixed(1)}° off)`);
    const turned = smoothFigureNormals(geometry);
    const after = roughness(geometry);
    assert.ok(turned > 0.02, "the normals were rebuilt");
    assert.ok(after < before * 0.45, `smoothed: ${before.toFixed(1)}° → ${after.toFixed(1)}°`);
    // Every normal is still a unit vector pointing outward.
    const normal = geometry.getAttribute("normal");
    const position = geometry.getAttribute("position");
    const seam = new Map<string, THREE.Vector3>();
    for (let i = 0; i < normal.count; i += 1) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      const p = new THREE.Vector3().fromBufferAttribute(position, i);
      assert.ok(Math.abs(n.length() - 1) < 0.01);
      assert.ok(n.dot(p) > 0.5);
      // Points at the same place (the two sides of the texture seam) share one normal.
      const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
      const other = seam.get(key);
      if (other) assert.ok(other.distanceTo(n) < 0.01, "a seam shows");
      else seam.set(key, n);
    }
  }
});

test("a figure's colours are graded warmer and richer, greys stay grey, and its materials take the grade", () => {
  // Pale skin as painted: more colour, not darker.
  const skin = gradeFigureRgb(0.45, 0.22, 0.15);
  const saturation = (rgb: readonly number[]): number => (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
  assert.ok(saturation(skin) > saturation([0.45, 0.22, 0.15]) * 1.08);
  assert.ok(skin[0] + skin[1] + skin[2] >= 0.45 + 0.22 + 0.15);
  // A grey stays (nearly) grey and a dark one is lifted.
  const grey = gradeFigureRgb(0.05, 0.05, 0.05);
  assert.ok(grey[1] > 0.05 && Math.abs(grey[0] - grey[2]) < grey[1] * 2.5 * FIGURE_GRADE.warmth);
  // Black is black, nothing is negative.
  assert.deepEqual(gradeFigureRgb(0, 0, 0), [0, 0, 0]);
  for (const value of gradeFigureRgb(1, 0, 0)) assert.ok(value >= 0);

  const material = new THREE.MeshStandardMaterial({ roughness: 1 });
  const figure = new THREE.Mesh(crumpledSphere(false), material);
  const before = material.customProgramCacheKey();
  brightenFigure(figure);
  assert.ok(material.roughness < 0.8 && material.envMapIntensity > 1.5);
  assert.notEqual(material.customProgramCacheKey(), before, "the graded program is its own");
  const shader = { fragmentShader: "void main() {\n#include <map_fragment>\n}", vertexShader: "", uniforms: {} };
  material.onBeforeCompile(shader as never, null as never);
  assert.match(shader.fragmentShader, /figureLuma/);
});

test("a person keeps every triangle to about 9 m and is never a rough 15 % within 30 m", () => {
  // The steps as `Simulator` registers people (radius / distance).
  const steps = [
    { ratio: 0.4, below: 0.1 },
    { ratio: 0.15, below: 0.03 },
  ];
  const radius = 0.9;
  assert.equal(chooseLodLevel(radius / 3, 0, steps), 0);
  assert.equal(chooseLodLevel(radius / 8, 0, steps), 0, "talking distance: the full figure");
  assert.equal(chooseLodLevel(radius / 14, 0, steps), 1);
  assert.equal(chooseLodLevel(radius / 28, 1, steps), 1);
  assert.equal(chooseLodLevel(radius / 45, 1, steps), 2);
});
