import assert from "node:assert/strict";
import test from "node:test";
import {
  FLARE_APEX,
  FLARE_LIFE,
  FLARE_RISE,
  flareBrightness,
  flareHeight,
  flareIllumination,
  flarePosition,
  flareSceneWeight,
  smokeOpacity,
} from "../../src/simulator/effects/FlareMath";

const launch = { x: 10, y: 2, z: -5, leanX: 1, leanZ: 0, windX: 3, windZ: -1, seed: 0.4 };

test("a flare climbs to its apex, then sinks slowly under its parachute and drifts downwind", () => {
  assert.equal(flareHeight(0), 0);
  assert.ok(Math.abs(flareHeight(FLARE_RISE) - FLARE_APEX) < 1e-9);
  assert.ok(flareHeight(FLARE_RISE * 0.5) > FLARE_APEX * 0.7, "fast off the launcher");
  const top = flarePosition(launch, FLARE_RISE, { x: 0, y: 0, z: 0 });
  const later = flarePosition(launch, FLARE_RISE + 6, { x: 0, y: 0, z: 0 });
  assert.ok(later.y < top.y && top.y - later.y < 40, "sinks, but slowly");
  assert.ok(later.x > top.x && later.z < top.z, "drifts with the wind");
  assert.ok(top.x > launch.x, "leans downwind as it climbs");
});

test("the star ignites at the apex, burns for seconds with a flicker, and goes out", () => {
  assert.ok(flareBrightness(1, 0.4) < 0.15, "only the motor's spark on the way up");
  const burn: number[] = [];
  for (let age = FLARE_RISE + 0.5; age < FLARE_RISE + 7; age += 0.25) burn.push(flareBrightness(age, 0.4));
  assert.ok(Math.min(...burn) > 0.7 && Math.max(...burn) <= 1.1);
  assert.ok(Math.max(...burn) - Math.min(...burn) > 0.05, "it flickers");
  assert.equal(flareBrightness(FLARE_LIFE + 0.1, 0.4), 0);
  assert.ok(smokeOpacity(FLARE_LIFE) > 0.3, "the smoke outlives the star");
});

test("its light falls off with distance and matters at night, hardly by day", () => {
  assert.ok(Math.abs(flareIllumination(1, FLARE_APEX) - 1) < 1e-9);
  assert.ok(flareIllumination(1, 400) < 0.25 && flareIllumination(1, 400) > 0);
  assert.ok(flareSceneWeight(1) > 0.95 && flareSceneWeight(0) < 0.1);
});
