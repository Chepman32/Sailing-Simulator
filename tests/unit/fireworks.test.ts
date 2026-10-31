import assert from "node:assert/strict";
import test from "node:test";
import {
  burst,
  DAY_GAP,
  launchRocket,
  nextShowGap,
  NIGHT_GAP,
  SHELL_KINDS,
  splitStar,
  starBrightness,
  stepRocket,
  stepStar,
  type Star,
} from "../../src/simulator/effects/FireworksMath";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("shows come every minute or two after dark and now and then by day", () => {
  const random = seeded(4);
  for (let index = 0; index < 50; index += 1) {
    const night = nextShowGap(random, 1);
    const day = nextShowGap(random, 0);
    assert.ok(night >= NIGHT_GAP.min && night <= NIGHT_GAP.max);
    assert.ok(day >= DAY_GAP.min && day <= DAY_GAP.max);
  }
});

test("a rocket climbs high on a gold trail and bursts into a shell of stars that fade", () => {
  const random = seeded(9);
  for (let index = 0; index < 30; index += 1) {
    const rocket = launchRocket(random, 0, 42, 0);
    const trail: Star[] = [];
    let time = 0;
    while (!stepRocket(rocket, 1 / 60, random, (star) => trail.push(star))) time += 1 / 60;
    assert.ok(rocket.y > 120 && rocket.y < 330, `bursts at ${rocket.y.toFixed(0)} m`);
    assert.ok(time > 2 && trail.length > 40, "a visible climb with sparks");
    const stars: Star[] = [];
    const count = burst(rocket, random, (star) => stars.push(star));
    assert.equal(count, stars.length);
    assert.ok(count >= 48);
    // The shell opens to tens of metres and burns out within a few seconds.
    const start = { x: stars[0]!.x, y: stars[0]!.y, z: stars[0]!.z };
    let spread = 0;
    let age = 0;
    let alive = stars.length;
    while (alive > 0 && age < 10) {
      alive = 0;
      for (const star of stars) if (stepStar(star, 1 / 60)) alive += 1;
      age += 1 / 60;
      if (age < 1.2) for (const star of stars) spread = Math.max(spread, Math.hypot(star.x - start.x, star.y - start.y, star.z - start.z));
    }
    assert.ok(age < 7, "burns out");
    assert.ok(spread > (rocket.shell === "crackle" ? 10 : 20), `the shell opens wide (${spread.toFixed(0)} m)`);
    const star = stars[0]!;
    assert.ok(starBrightness({ ...star, age: 0 }, 1) === 1 && starBrightness({ ...star, age: star.life }, 1) === 0);
  }
  assert.ok(SHELL_KINDS.length >= 5);
});

test("a crossette star splits into four", () => {
  const random = seeded(2);
  const rocket = { ...launchRocket(random, 0, 40, 0), shell: "crossette" as const };
  const stars: Star[] = [];
  burst(rocket, random, (star) => stars.push(star));
  // Every star splits (the burst's white flash is not a star).
  assert.ok(stars.filter((star) => star.twinkle !== "flash").every((star) => star.split > 0));
  const pieces: Star[] = [];
  splitStar(stars[0]!, random, (star) => pieces.push(star));
  assert.equal(pieces.length, 4);
  assert.ok(pieces.every((piece) => piece.split < 0));
});
