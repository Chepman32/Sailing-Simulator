import assert from "node:assert/strict";
import test from "node:test";
import { createDust, GRAIN_LIFE_MAX, GRAIN_SIZE, grainLook, MAX_GRAINS, stepDust, SWEEP_SECONDS } from "../../app/components/dustMath";

function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("a prompt dissolves into grains a pixel or two across", () => {
  const dust = createDust(100, 200, 180, 46, () => 0, seeded());
  assert.equal(dust.size, GRAIN_SIZE);
  assert.ok(dust.count > 3000, `${dust.count} grains`);
  assert.ok(dust.count <= MAX_GRAINS);
  // Transparent corners give no grains.
  const round = createDust(0, 0, 40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 20 ? 0 : -1), seeded());
  assert.ok(round.count < dust.count && round.count > 400);
});

test("the grains are released by a sweep and all gone within a couple of seconds", () => {
  const dust = createDust(300, 300, 120, 40, () => 0, seeded());
  const target = { x: 20, y: 20 };
  const start = Math.hypot(dust.x[0]! - target.x, dust.y[0]! - target.y);
  let time = 0;
  let visible = dust.count;
  // The first frame: the far right column is still waiting.
  stepDust(dust, 1 / 60, target.x, target.y, (time += 1 / 60));
  assert.ok(dust.age[dust.count - 1]! < 0);
  while (visible > 0 && time < 5) visible = stepDust(dust, 1 / 60, target.x, target.y, (time += 1 / 60));
  assert.equal(visible, 0);
  assert.ok(time <= SWEEP_SECONDS + 0.15 + GRAIN_LIFE_MAX + 0.05, `took ${time.toFixed(2)} s`);
  assert.ok(Math.hypot(dust.x[0]! - target.x, dust.y[0]! - target.y) < start * 0.8, "drifts toward the button");
  for (let index = 0; index < dust.count; index += 1) assert.ok(Number.isFinite(dust.x[index]!) && Number.isFinite(dust.y[index]!));
});

test("a grain fades out as it shrinks", () => {
  assert.deepEqual(grainLook(-0.2, 1), { alpha: 1, scale: 1 });
  const half = grainLook(0.5, 1);
  assert.ok(half.alpha < 0.5 && half.scale < 1);
  assert.equal(grainLook(1, 1).alpha, 0);
});
