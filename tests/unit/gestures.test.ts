import assert from "node:assert/strict";
import test from "node:test";
import { DoubleTapGesture } from "../../src/simulator/input/DoubleTapGesture";

function tap(gesture: DoubleTapGesture, time: number, x = 100, y = 100): boolean {
  gesture.down(1, x, y, time);
  return gesture.up(1, x, y, time + 40);
}

test("two nearby completed taps activate once, including shortly after startup", () => {
  const gesture = new DoubleTapGesture();
  assert.equal(tap(gesture, 0), false);
  assert.equal(tap(gesture, 150, 104, 103), true);
  assert.equal(tap(gesture, 250), false);
});

test("slow or distant taps do not activate a photo-mode exit", () => {
  const gesture = new DoubleTapGesture();
  tap(gesture, 0);
  assert.equal(tap(gesture, 500), false);
  assert.equal(tap(gesture, 600, 200), false);
});

test("dragging out and back or holding cannot become a double tap", () => {
  const gesture = new DoubleTapGesture();
  tap(gesture, 0);
  gesture.down(1, 100, 100, 100);
  gesture.move(1, 160, 100);
  assert.equal(gesture.up(1, 100, 100, 140), false);
  assert.equal(tap(gesture, 200), false);
  gesture.down(1, 100, 100, 300);
  assert.equal(gesture.up(1, 100, 100, 700), false);
  assert.equal(tap(gesture, 750), false);
});

test("multi-touch and cancelled pointers clear pending taps", () => {
  const gesture = new DoubleTapGesture();
  tap(gesture, 0);
  gesture.down(1, 100, 100, 100);
  gesture.cancel();
  assert.equal(gesture.up(2, 120, 100, 120), false);
  assert.equal(gesture.up(1, 100, 100, 140), false);
  assert.equal(tap(gesture, 200), false);
  assert.equal(tap(gesture, 300), true);
});

test("the walking stick has a dead centre, reaches full speed at its rim, and keeps its direction", async () => {
  const { stickDeflection, STICK_REACH, STICK_DEAD } = await import("../../app/components/steering");
  // A thumb resting where it landed moves nothing.
  assert.deepEqual(stickDeflection(0, 0), { x: 0, y: 0 });
  assert.deepEqual(stickDeflection(STICK_REACH * STICK_DEAD * 0.9, 0), { x: 0, y: 0 });
  // Out of the dead centre the speed starts from nothing (no jump), and is full at the rim and beyond.
  const just = stickDeflection(STICK_REACH * (STICK_DEAD + 0.01), 0);
  assert.ok(just.x > 0 && just.x < 0.03);
  assert.ok(Math.abs(stickDeflection(STICK_REACH, 0).x - 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(stickDeflection(300, -400).x, stickDeflection(300, -400).y) - 1) < 1e-9, "never past the rim");
  // The direction is the thumb's.
  const diagonal = stickDeflection(30, -30);
  assert.ok(Math.abs(diagonal.x + diagonal.y) < 1e-9 && diagonal.x > 0.5);
  // Pushed to the rim it is a run (the controller sprints past 0.97).
  assert.ok(Math.hypot(stickDeflection(0, -STICK_REACH).x, stickDeflection(0, -STICK_REACH).y) > 0.97);
});
