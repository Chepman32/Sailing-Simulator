import assert from "node:assert/strict";
import test from "node:test";
import {
  boomAngle,
  camberProfile,
  camberRatio,
  DRAFT_POSITION,
  leechTwist,
  leewardSide,
  MAX_BOOM_ANGLE,
  MIN_BOOM_ANGLE,
  sailFill,
} from "../../src/simulator/vessel/SailShape";
import { skipperLean } from "../../src/simulator/vessel/Vessel";

test("sails set to leeward and ease out as the wind moves aft", () => {
  // Air flowing toward starboard means wind from port: sails go to starboard.
  assert.equal(leewardSide(0.9), 1);
  assert.equal(leewardSide(-0.9), -1);
  const closeHauled = boomAngle(Math.PI - 0.7, 1);
  const beamReach = boomAngle(Math.PI / 2, 1);
  const run = boomAngle(0.05, 1);
  assert.ok(closeHauled < beamReach && beamReach < run);
  assert.ok(closeHauled >= MIN_BOOM_ANGLE && run <= MAX_BOOM_ANGLE);
  assert.ok(boomAngle(Math.PI / 2, 0.3) > beamReach, "easing the sheet lets the boom out");
});

test("wind fills the sail; head to wind or calm it luffs flat", () => {
  assert.ok(sailFill(Math.PI / 2, 8, 0.8) > 0.8);
  assert.ok(sailFill(Math.PI - 0.1, 8, 0.8) < 0.05, "in irons the sail cannot draw");
  assert.ok(sailFill(Math.PI / 2, 0.2, 0.8) < 0.05, "no breeze, no belly");
  assert.ok(sailFill(Math.PI / 2, 8, 0.2) < sailFill(Math.PI / 2, 8, 0.8));
  assert.equal(camberRatio(0, 0.7), 0);
  assert.ok(camberRatio(1, 0.7) > camberRatio(1, 1), "hard sheeting flattens the sail");
  assert.ok(camberRatio(1, 0.7) <= 0.13);
});

test("camber peaks at the draft position and vanishes at luff and leech", () => {
  assert.ok(Math.abs(camberProfile(0)) < 1e-9);
  assert.ok(Math.abs(camberProfile(1)) < 1e-9);
  assert.ok(Math.abs(camberProfile(DRAFT_POSITION) - 1) < 1e-9);
  assert.ok(camberProfile(0.2) < 1 && camberProfile(0.7) < 1);
  assert.ok(leechTwist(1, 0.3) > leechTwist(1, 1) && leechTwist(0, 0.5) === 0);
});

test("the skipper leans against the heel instead of tilting with the hull", () => {
  assert.ok(skipperLean(0.2, 0) > 0.14 && skipperLean(-0.2, 0) < -0.14);
  assert.ok(Math.abs(skipperLean(0, 3)) < 0.03);
});
