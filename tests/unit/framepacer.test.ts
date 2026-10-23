import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_MAX_FPS, FramePacer, UNFOCUSED_MAX_FPS } from "../../src/simulator/core/FramePacer";

function rendered(refreshHz: number, maxFps: number, seconds = 10, jitterMs = 0): number {
  const pacer = new FramePacer();
  const step = 1000 / refreshHz;
  let frames = 0;
  for (let tick = 1; tick * step < seconds * 1000; tick += 1) {
    const jitter = jitterMs * Math.sin(tick * 12.9898);
    if (pacer.shouldRender(tick * step + jitter, maxFps)) frames += 1;
  }
  return frames / seconds;
}

test("frame pacer: high-refresh displays render at the cap, 60 Hz displays lose nothing", () => {
  assert.ok(Math.abs(rendered(120, ACTIVE_MAX_FPS) - 60) < 1.5, "120 Hz renders every other frame");
  assert.ok(Math.abs(rendered(144, ACTIVE_MAX_FPS) - 60) < 2.5, "144 Hz still averages 60 fps, not 48");
  assert.ok(rendered(60, ACTIVE_MAX_FPS) > 58.5, "a 60 Hz display renders every frame");
  assert.ok(rendered(60, ACTIVE_MAX_FPS, 10, 1.5) > 57, "display jitter does not drop frames");
  assert.ok(Math.abs(rendered(60, UNFOCUSED_MAX_FPS) - 30) < 1.5, "an unfocused page renders at half rate");
  assert.ok(rendered(30, ACTIVE_MAX_FPS) > 29, "a slow display is never throttled further");
});

test("frame pacer: resynchronises after a stall without a burst of frames", () => {
  const pacer = new FramePacer();
  assert.ok(pacer.shouldRender(1000, 60));
  assert.ok(pacer.shouldRender(5000, 60), "first frame after a long stall renders");
  assert.ok(!pacer.shouldRender(5004, 60), "and the next callback right behind it does not");
});

test("adaptive quality keeps its detail as long as the scene holds 30 fps", async () => {
  const budget = await import("../../src/simulator/core/RenderBudget");
  const judge = new budget.FpsJudge(budget.SLOW_FPS);
  for (let index = 0; index < budget.FPS_WARMUP_WINDOWS; index += 1) judge.observe(10, 60);
  assert.equal(judge.observe(31, 60), "neutral", "31 fps is acceptable, not slow");
  assert.equal(judge.observe(24, 60), "slow");
  // A GPU frame of 20 ms (50 fps) must not lower the render scale.
  const governor = new budget.GpuGovernor();
  let verdict = "steady";
  for (let time = 0; time < 20; time += 0.1) verdict = governor.observe(20, time, 0.1);
  assert.equal(governor.scale, 1);
  assert.notEqual(verdict, "overloaded");
});
