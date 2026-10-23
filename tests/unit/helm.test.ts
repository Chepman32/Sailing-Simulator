import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CHART_RANGES,
  chartProject,
  chartRange,
  compassCardAngle,
  ENGINE_IDLE_RPM,
  ENGINE_MAX_RPM,
  engineRpm,
  formatBearing,
  LEVER_THROW,
  leverAngle,
  windNeedleAngle,
} from "../../src/simulator/vessel/HelmInstruments";

/** Where a world point appears on screen for a camera looking along `heading`: −1 left … 1 right. */
function screenSide(dx: number, dz: number, heading: number): number {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 2, 0);
  camera.lookAt(Math.sin(heading) * 10, 2, Math.cos(heading) * 10);
  camera.updateMatrixWorld();
  return Math.sign(new THREE.Vector3(dx, 2, dz).project(camera).x);
}

test("helm chart: head-up, the yacht's bow up the screen, and left and right as in the view", () => {
  const point = { x: 0, y: 0 };
  for (const heading of [0, 0.7, 2.4, -1.9]) {
    // Ahead of the bow is straight up the screen.
    chartProject(Math.sin(heading) * 300, Math.cos(heading) * 300, heading, 600, 320, 300, point);
    assert.ok(Math.abs(point.x - 320) < 1e-6 && Math.abs(point.y - 150) < 1e-6);
    // Something off the bow is on the same side of the chart as it is in the view.
    for (const side of [-1, 1]) {
      const dx = Math.cos(heading) * side * 200 + Math.sin(heading) * 100;
      const dz = -Math.sin(heading) * side * 200 + Math.cos(heading) * 100;
      chartProject(dx, dz, heading, 600, 320, 300, point);
      assert.equal(Math.sign(point.x - 320), screenSide(dx, dz, heading));
    }
  }
});

test("helm chart: the range steps with speed, with hysteresis, and stays one of the plotter's ranges", () => {
  assert.equal(chartRange(0, 600), CHART_RANGES[0]);
  let range: number = CHART_RANGES[0];
  for (let speed = 0; speed <= 12; speed += 0.25) {
    const next = chartRange(speed, range);
    assert.ok((CHART_RANGES as readonly number[]).includes(next));
    assert.ok(next >= range, "accelerating never shrinks the range");
    range = next;
  }
  assert.equal(range, CHART_RANGES[CHART_RANGES.length - 1]);
  // Just below a step up, coming back down, it holds.
  assert.equal(chartRange(2.4, 1200), 1200);
});

test("helm instruments: needles, revolutions, compass and lever", () => {
  // The apparent wind over the +X side shows on the side of the view it comes from.
  const angle = windNeedleAngle(1);
  assert.equal(Math.sign(Math.sin(angle)), screenSide(1, 0, 0));
  assert.equal(windNeedleAngle(Number.NaN), 0);
  assert.equal(engineRpm(0.5, false), 0);
  assert.equal(engineRpm(0, true), ENGINE_IDLE_RPM);
  assert.equal(engineRpm(-1, true), ENGINE_MAX_RPM);
  // The card turns against the yacht and stays in [0, 2π).
  for (const heading of [0, 1, -2, 7]) {
    const card = compassCardAngle(heading);
    assert.ok(card >= 0 && card < Math.PI * 2);
    assert.ok(Math.abs(Math.sin(card + heading)) < 1e-9 && Math.cos(card + heading) > 0);
  }
  assert.equal(formatBearing(0), "000");
  // The heading grows toward +X, which is to port: a compass reads 270 there.
  assert.equal(formatBearing(Math.PI / 2), "270");
  assert.equal(formatBearing(-Math.PI / 2), "090");
  assert.equal(formatBearing(Math.PI * 2 - 0.001), "000");
  assert.equal(leverAngle(1), LEVER_THROW);
  assert.equal(leverAngle(-3), -LEVER_THROW);
  assert.equal(leverAngle(Number.NaN), 0);
});

test("the helm station stands on the aft deck, not over the water behind the transom", async () => {
  const { readFileSync } = await import("node:fs");
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { HELM_EYE, HELM_SEAT_AFT_Z, HELM_X } = await import("../../src/simulator/vessel/HelmStation");
  const data = readFileSync(new URL("../../public/models/yacht-sailboat-pbr.glb", import.meta.url));
  const gltf = await new Promise<{ scene: import("three").Group }>((resolve, reject) =>
    new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", resolve, reject),
  );
  // The same placement as `Vessel`: bow to +Z, 9.4 m long, waterline offset.
  const model = gltf.scene;
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(9.4 / Math.max(size.z, size.x));
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  model.position.z -= bounds.getCenter(new THREE.Vector3()).z;
  model.position.y -= bounds.min.y + 1.06;
  model.updateMatrixWorld(true);
  const meshes: import("three").Mesh[] = [];
  model.traverse((object) => {
    const mesh = object as import("three").Mesh;
    if (!mesh.isMesh) return;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => (material.side = THREE.DoubleSide));
    meshes.push(mesh);
  });
  const ray = new THREE.Raycaster();
  const deckUnder = (x: number, z: number): number | null => {
    ray.set(new THREE.Vector3(x, 1.25, z), new THREE.Vector3(0, -1, 0));
    ray.far = 4;
    return ray.intersectObjects(meshes, false)[0]?.point.y ?? null;
  };
  // Under the helmsman's feet and under the seat's after edge (its corners too).
  for (const [x, z] of [
    [HELM_EYE.x, HELM_EYE.z],
    [HELM_X - 0.3, HELM_SEAT_AFT_Z + 0.02],
    [HELM_X + 0.3, HELM_SEAT_AFT_Z + 0.02],
  ] as const) {
    const deck = deckUnder(x, z);
    assert.ok(deck !== null && deck > 0.4, `no deck under (${x.toFixed(2)}, ${z.toFixed(2)}): ${deck}`);
  }
});

test("the helmsman's arms reach the rim without stretching and bend toward the pole", async () => {
  const { solveTwoBone } = await import("../../src/simulator/vessel/HelmsmanPose");
  const elbow = { x: 0, y: 0, z: 0 };
  const shoulder = { x: 0.19, y: 1.42, z: 0 };
  const grip = { x: 0.3, y: 1.1, z: 0.5 };
  solveTwoBone(shoulder, grip, 0.29, 0.35, { x: 0.6, y: 0.9, z: -0.2 }, elbow);
  const upper = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y, elbow.z - shoulder.z);
  const lower = Math.hypot(grip.x - elbow.x, grip.y - elbow.y, grip.z - elbow.z);
  assert.ok(Math.abs(upper - 0.29) < 1e-6 && Math.abs(lower - 0.35) < 1e-6, `${upper} ${lower}`);
  assert.ok(elbow.x > 0.25, "the elbow bends outward, toward the pole");
  // Out of reach: the limb straightens toward the target, never stretches.
  const far = solveTwoBone(shoulder, { x: 0.19, y: 1.42, z: 2 }, 0.29, 0.35, { x: 0.6, y: 0.9, z: 0 }, elbow);
  assert.ok(far <= 0.64 && Number.isFinite(elbow.x + elbow.y + elbow.z));
});

test("the helmsman leans against the heel, within limits, and his hands never cross on the rim", async () => {
  const { gripAngles, helmsmanLean, HELMSMAN_MAX_LEAN } = await import("../../src/simulator/vessel/HelmsmanPose");
  const heeled = helmsmanLean(0.2, 0, 0);
  assert.ok(heeled.roll > 0.14 && heeled.roll < 0.2, "most of the heel is countered");
  assert.ok(Math.abs(helmsmanLean(1.2, -1, 3).roll) <= HELMSMAN_MAX_LEAN);
  assert.ok(Math.abs(helmsmanLean(1.2, -1, 3).pitch) <= HELMSMAN_MAX_LEAN);
  for (const wheel of [-3.5, -1, 0, 0.4, 3.5]) {
    const grips = gripAngles(wheel);
    assert.ok(grips.left - grips.right > 1.8, `hands ${grips.left} / ${grips.right} at wheel ${wheel}`);
  }
});
