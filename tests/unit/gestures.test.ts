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
