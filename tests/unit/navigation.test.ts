import assert from "node:assert/strict";
import test from "node:test";
import { ISLANDS } from "../../src/simulator/environment/IslandShape";
import {
  CHART_HALF_SIZE,
  CHART_LANDMARKS,
  FOG_RESOLUTION,
  decodeFog,
  encodeFog,
  fogCellIndex,
  revealFog,
} from "../../src/simulator/navigation/Exploration";
import { swipeToRudder, tiltToRudder, TILT_DEAD_ZONE_DEGREES } from "../../src/simulator/input/TiltSteering";

test("fog reveals a disc around the yacht and round-trips through storage", () => {
  const fog = new Uint8Array(FOG_RESOLUTION * FOG_RESOLUTION);
  const revealed = revealFog(fog, 0, 0, 100);
  assert.ok(revealed > 50);
  assert.equal(revealFog(fog, 0, 0, 100), 0, "revealing twice adds nothing");
  assert.equal(fog[fogCellIndex(0, 0)], 1);
  assert.equal(fog[fogCellIndex(300, 300)], 0);
  assert.equal(fogCellIndex(CHART_HALF_SIZE + 1, 0), -1);
  const copy = new Uint8Array(fog.length);
  assert.ok(decodeFog(encodeFog(fog), copy));
  assert.deepEqual(copy, fog);
  assert.equal(decodeFog("not base64!", copy), false);
});

test("landmarks lie on the chart and are not all discovered from the start", () => {
  CHART_LANDMARKS.forEach((landmark) => {
    assert.ok(Math.abs(landmark.x) < CHART_HALF_SIZE && Math.abs(landmark.z) < CHART_HALF_SIZE, landmark.id);
  });
  const visibleFromStart = CHART_LANDMARKS.filter((landmark) => Math.hypot(landmark.x, landmark.z) <= landmark.discoveryRange);
  assert.equal(visibleFromStart.length, 0, "the player must sail to discover places");
  // Every landmark must be reachable from navigable water (outside the beach).
  CHART_LANDMARKS.forEach((landmark) => {
    const island = ISLANDS.find((candidate) => landmark.id.startsWith(candidate.name.toLowerCase().split(" ")[0]));
    if (!island) return;
    const centerDistance = Math.hypot(landmark.x - island.centerX, landmark.z - island.centerZ);
    const nearestWater = Math.max(0, island.beachRadius + 3 - centerDistance);
    assert.ok(nearestWater <= landmark.discoveryRange, `${landmark.id} cannot be reached`);
  });
});

test("tilt steering follows the phone roll in every orientation", () => {
  assert.equal(tiltToRudder(45, 0, 0), 0);
  assert.equal(tiltToRudder(45, TILT_DEAD_ZONE_DEGREES - 1, 0), 0, "small wobble is ignored");
  assert.ok(tiltToRudder(0, 25, 0) > 0.8, "flat phone, right edge down steers starboard");
  assert.ok(tiltToRudder(0, -25, 0) < -0.8);
  assert.ok(tiltToRudder(-25, 0, 270) > 0.8 || tiltToRudder(25, 0, 270) > 0.8);
  assert.equal(Math.sign(tiltToRudder(25, 0, 90)), -Math.sign(tiltToRudder(25, 0, 270)));
  assert.equal(tiltToRudder(null, 10, 0), 0);
  assert.equal(swipeToRudder(0, 10_000, 300), 1);
  assert.ok(swipeToRudder(0.2, -50, 300) < 0.2);
});
