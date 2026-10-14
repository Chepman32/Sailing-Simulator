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
  assert.equal(formatBearing(Math.PI / 2), "090");
  assert.equal(formatBearing(-Math.PI / 2), "270");
  assert.equal(formatBearing(Math.PI * 2 - 0.001), "000");
  assert.equal(leverAngle(1), LEVER_THROW);
  assert.equal(leverAngle(-3), -LEVER_THROW);
  assert.equal(leverAngle(Number.NaN), 0);
});
