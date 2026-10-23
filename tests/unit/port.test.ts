import assert from "node:assert/strict";
import test from "node:test";
import type * as THREE from "three";
import { screenRollDegrees, swipeToRudder, tiltToRudder, TILT_FULL_RUDDER_DEGREES } from "../../app/components/steering";
import { getMessages, LANGUAGE_OPTIONS } from "../../app/components/i18n";
import { ENGLISH_PORT_MESSAGES } from "../../app/components/portMessages";
import { photoShot, segmentHitsYachtBox, yachtBlocksSight, type PhotoShot, type PhotoSubject } from "../../src/simulator/camera/PhotoDirector";
import { QualityManager } from "../../src/simulator/core/QualityManager";
import { AUTO_GPU_TARGET_MS, AUTO_SLOW_FPS, GPU_TARGET_MS } from "../../src/simulator/core/RenderBudget";
import { canSoundHorn, HORN_MIN_INTERVAL, SHIP_MIN_SPACING } from "../../src/simulator/ships/ShipMath";
import { stepSkipperLean } from "../../src/simulator/vessel/Skipper";
import { CHART_CELL, CHART_MAX_CELLS, CHART_REVEAL_RADIUS, ExploredChart } from "../../src/simulator/world/ExploredChart";

function renderer(): THREE.WebGLRenderer {
  return { shadowMap: { enabled: false, type: 0 }, setPixelRatio: () => undefined } as unknown as THREE.WebGLRenderer;
}

test("only Auto changes the quality by itself, and it aims for about 30 fps", () => {
  const globals = globalThis as unknown as { window?: unknown };
  const previous = globals.window;
  globals.window = { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 };
  try {
    assert.ok(AUTO_SLOW_FPS <= 30 && AUTO_SLOW_FPS >= 24);
    assert.ok(AUTO_GPU_TARGET_MS > GPU_TARGET_MS * 2, "auto tolerates a 30 fps frame");
    const changes: string[] = [];
    const fixed = new QualityManager(renderer(), "high", (preset) => changes.push(preset));
    fixed.setAdaptive(false);
    for (let window = 0; window < 200; window += 1) {
      fixed.observeFps(10);
      fixed.observeGpu("overloaded");
    }
    assert.equal(fixed.current, "high", "a chosen preset is never lowered");
    assert.deepEqual(changes, []);
    const auto = new QualityManager(renderer(), "high", () => undefined);
    for (let window = 0; window < 40; window += 1) auto.observeFps(45);
    assert.equal(auto.current, "high", "45 fps is above the 30 fps target: no change");
    for (let window = 0; window < 40; window += 1) auto.observeFps(12);
    assert.notEqual(auto.current, "high", "a slow session steps down");
  } finally {
    globals.window = previous;
  }
});

test("the chart reveals squares around the yacht, forgets the oldest, and survives a reload", () => {
  const chart = new ExploredChart();
  assert.equal(chart.isExploredAt(5000, 5000), false);
  assert.equal(chart.observe(0, 0), true);
  assert.equal(chart.observe(1, 1), false, "the same square adds nothing");
  assert.equal(chart.isExploredAt(CHART_REVEAL_RADIUS - CHART_CELL, 0), true);
  assert.equal(chart.isExploredAt(CHART_REVEAL_RADIUS + 3 * CHART_CELL, 0), false);
  chart.observe(4 * CHART_CELL, 0);
  const restored = new ExploredChart(chart.serialize());
  assert.equal(restored.size, chart.size);
  assert.equal(restored.isExploredAt(0, 0), true);
  assert.equal(new ExploredChart(["bad", "1,2", "x,y"]).size, 1);
  const big = new ExploredChart();
  for (let step = 0; step < 400; step += 1) big.observe(step * CHART_CELL * 2, 0);
  assert.ok(big.size <= CHART_MAX_CELLS);
});

test("photo shots stand where the yacht's sails are not between the camera and the subject", () => {
  assert.equal(segmentHitsYachtBox({ x: -10, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }), true);
  assert.equal(segmentHitsYachtBox({ x: -10, y: 12, z: 0 }, { x: 10, y: 12, z: 0 }), false);
  for (const heading of [0, 0.9, 2.1, -1.4, 3]) {
    // A subject dead ahead of the bow: the plain "behind her" shot looks through the rig.
    const subject: PhotoSubject = { kind: "whale", x: Math.sin(heading) * 60, y: 0, z: Math.cos(heading) * 60, size: 12 };
    const shot: PhotoShot = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 50 };
    photoShot(subject, 0, 0.5, 0, shot, heading);
    assert.equal(
      yachtBlocksSight(shot.position, shot.target, 0, 0.5, 0, heading),
      false,
      `heading ${heading}: the yacht stands in the shot`,
    );
  }
});

test("no two ship horns sound closer than thirty seconds, and ships keep 1.5 km apart", () => {
  assert.ok(HORN_MIN_INTERVAL >= 30);
  assert.equal(canSoundHorn(100, 80), false);
  assert.equal(canSoundHorn(110, 80), true);
  assert.equal(canSoundHorn(0, -Infinity), true);
  assert.ok(SHIP_MIN_SPACING >= 1500);
});

test("the skipper's balance spring stays bounded and settles against the heel", () => {
  const lean = { lean: 0, velocity: 0 };
  let peak = 0;
  for (let step = 0; step < 600; step += 1) peak = Math.max(peak, Math.abs(stepSkipperLean(lean, 0.25, 0, 1 / 60)));
  assert.ok(peak <= 0.5);
  assert.ok(Math.abs(lean.lean - 0.25 * 0.82) < 0.01);
});

test("tilt and swipe steering map to a bounded rudder", () => {
  assert.equal(screenRollDegrees({ beta: 10, gamma: 20 }, 0), 20);
  assert.equal(screenRollDegrees({ beta: 10, gamma: 20 }, 90), 10);
  assert.equal(screenRollDegrees({ beta: 10, gamma: 20 }, 270), -10);
  assert.equal(tiltToRudder(5, 4), 0, "dead zone around neutral");
  assert.equal(tiltToRudder(TILT_FULL_RUDDER_DEGREES + 10, 0), 1);
  assert.equal(tiltToRudder(-TILT_FULL_RUDDER_DEGREES - 10, 0), -1);
  assert.equal(swipeToRudder(0.9, 500), 1);
  assert.ok(swipeToRudder(0, 55) > 0.4);
});

test("the chart, quality, photo and steering words exist in all thirty languages", () => {
  const keys = Object.keys(ENGLISH_PORT_MESSAGES);
  for (const { code } of LANGUAGE_OPTIONS) {
    const messages = getMessages(code) as unknown as Record<string, string>;
    for (const key of keys) assert.ok(typeof messages[key] === "string" && messages[key]!.length > 0, `${code} lacks ${key}`);
  }
});
