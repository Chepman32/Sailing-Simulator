import assert from "node:assert/strict";
import test from "node:test";
import {
  burst,
  harmony,
  heartPoint,
  nextCue,
  STAR_COLORS,
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
    // (A palm is a dozen thick comets; a cluster's bomblets each bloom into a sphere of their own.)
    assert.ok(count >= (rocket.shell === "cluster" || rocket.shell === "palm" ? 12 : 48), `${rocket.shell}: ${count}`);
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
    assert.ok(spread > (rocket.shell === "crackle" ? 10 : 20), `the ${rocket.shell} opens wide (${spread.toFixed(0)} m)`);
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
  // Every star splits (the burst's white flash and its lit smoke are not stars).
  assert.ok(stars.filter((star) => star.twinkle !== "flash" && star.twinkle !== "haze").every((star) => star.split > 0));
  const pieces: Star[] = [];
  splitStar(stars[0]!, random, (star) => pieces.push(star));
  assert.equal(pieces.length, 4);
  assert.ok(pieces.every((piece) => piece.split < 0));
});

test("a cluster's bomblets each bloom into a small sphere of their own colour", () => {
  const random = seeded(5);
  const rocket = { ...launchRocket(random, 0, 40, 0), shell: "cluster" as const };
  const stars: Star[] = [];
  burst(rocket, random, (star) => stars.push(star));
  const bomblets = stars.filter((star) => star.bloom > 0);
  assert.ok(bomblets.length >= 8);
  assert.ok(new Set(bomblets.map((star) => star.later)).size >= 3, "a bouquet of colours");
  const bloom: Star[] = [];
  splitStar(bomblets[0]!, random, (star) => bloom.push(star));
  assert.equal(bloom.length, bomblets[0]!.bloom);
  assert.ok(bloom.every((star) => star.color === bomblets[0]!.later && star.bloom === 0 && star.split < 0));
});

test("shows are many-coloured: shells of two and three colours, volleys in several", () => {
  const random = seeded(11);
  // The palette's hues go together: never two neighbours on the colour wheel.
  for (let index = 0; index < 200; index += 1) {
    const [a, b, c] = harmony(random, 3);
    assert.ok(a !== b && b !== c && a !== c);
  }
  const colours = new Set<unknown>();
  let multicolour = 0;
  let volleys = 0;
  for (let index = 0; index < 400; index += 1) {
    const cue = nextCue(random, 30, 40);
    colours.add(cue.color);
    if (cue.colors && new Set(cue.colors).size > 1) volleys += 1;
    const rocket = launchRocket(random, 0, 40, 0, false, cue);
    const stars: Star[] = [];
    burst(rocket, random, (star) => stars.push(star));
    const used = new Set(stars.filter((star) => star.twinkle !== "flash" && star.twinkle !== "haze").map((star) => star.later ?? star.color));
    if (used.size > 1) multicolour += 1;
  }
  assert.ok(colours.size >= STAR_COLORS.length - 2, `${colours.size} colours`);
  assert.ok(multicolour > 400 * 0.5, `${multicolour} of 400 shells in more than one colour`);
  assert.ok(volleys > 10, `${volleys} volleys in several colours`);
});

test("a heart opens facing the onlookers", () => {
  const random = seeded(3);
  // Toward a viewer due +x of the burst.
  const rocket = { ...launchRocket(random, 0, 40, 0, false, undefined, 0, Math.atan2(0 - 300, 0 - 0)), shell: "heart" as const, vx: 0, vy: 0, vz: 0 };
  const stars: Star[] = [];
  burst(rocket, random, (star) => stars.push(star));
  const outline = stars.filter((star) => star.twinkle !== "flash" && star.twinkle !== "haze");
  // Its plane is square to the line of sight: no spread toward the viewer.
  for (const star of outline) assert.ok(Math.abs(star.vx) < 1e-6 * (1 + Math.abs(star.vz)), `${star.vx}`);
  assert.ok(Math.max(...outline.map((star) => Math.abs(star.vz))) > 20);
  const [x, y] = heartPoint(Math.PI / 2);
  assert.ok(x > 0.9 && Math.abs(y) < 0.5);
});
