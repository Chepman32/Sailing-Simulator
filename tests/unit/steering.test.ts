import assert from "node:assert/strict";
import test from "node:test";
import { swipeToRudder, tiltToRudder, TILT_DEAD_ZONE_DEGREES } from "../../src/simulator/input/TiltSteering";

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
