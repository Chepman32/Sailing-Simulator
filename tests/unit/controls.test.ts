import assert from "node:assert/strict";
import test from "node:test";

test("rebinding a key swaps it with the action that had it, and never takes a reserved key", async () => {
  const { DEFAULT_KEYS, rebind, keyLabel, BINDING_ACTIONS } = await import("../../src/simulator/input/KeyBindings");
  const moved = rebind(DEFAULT_KEYS, "jump", "KeyE");
  assert.equal(moved.jump, "KeyE");
  assert.equal(moved.interact, "Space", "the action that had the key takes the old one");
  const codes = BINDING_ACTIONS.map((action) => moved[action]);
  assert.equal(new Set(codes).size, codes.length, "no two actions share a key");
  assert.deepEqual(rebind(DEFAULT_KEYS, "jump", "Escape"), { ...DEFAULT_KEYS });
  assert.equal(keyLabel("KeyW"), "W");
  assert.equal(keyLabel("ShiftLeft"), "Shift");
});

test("a jump is not lost to a bump: a press just after leaving the ground still springs", async () => {
  const { createWalkState, stepWalk, COYOTE_TIME } = await import("../../src/simulator/diver/DiverMath");
  // A ledge: the ground drops a metre at x = 0.
  const world = { ground: (x: number) => (x < 0 ? 1 : 0), surface: () => -5 };
  const walker = createWalkState(-0.05, 1, 0);
  const input = { moveX: 0, moveY: 1, sprint: false, yaw: Math.PI / 2, jump: false };
  for (let step = 0; step < 4 && walker.grounded; step += 1) stepWalk(walker, input, world, 1 / 60);
  assert.ok(!walker.grounded, "walked off the ledge");
  assert.ok(walker.airTime < COYOTE_TIME);
  stepWalk(walker, { ...input, jump: true }, world, 1 / 60);
  assert.ok(walker.jumped && walker.vy > 0, "the late press still springs");
});

test("the sea's own waves die on the beach and are full offshore", async () => {
  const { shoreCalm, SHORE_CALM_FAR } = await import("../../src/simulator/environment/SurfMath");
  assert.equal(shoreCalm(-1), 0);
  assert.ok(shoreCalm(0) < 0.05);
  assert.equal(shoreCalm(SHORE_CALM_FAR + 1), 1);
  assert.ok(shoreCalm(6) > 0.2 && shoreCalm(6) < 0.8);
});
