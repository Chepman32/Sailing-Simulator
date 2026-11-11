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

test("every star draws its path behind it: spokes from the burst that shorten as the stars slow", async () => {
  const random = seeded(21);
  const rocket = { ...launchRocket(random, 0, 40, 0), shell: "peony" as const, vx: 0, vy: 0, vz: 0, y: 220 };
  const stars: Star[] = [];
  burst(rocket, random, (star) => stars.push(star));
  const shell = stars.filter((star) => star.twinkle !== "flash" && star.twinkle !== "haze");
  // Lit at the burst: the streak starts with no length.
  for (const star of shell) assert.ok(Math.hypot(star.x - star.tx, star.y - star.ty, star.z - star.tz) < 1e-9);
  const streak = (star: Star): number => Math.hypot(star.x - star.tx, star.y - star.ty, star.z - star.tz);
  const mean = (): number => shell.reduce((sum, star) => sum + streak(star), 0) / shell.length;
  for (let step = 0; step < 18; step += 1) for (const star of shell) stepStar(star, 1 / 60);
  const early = mean();
  // A third of a second in: long spokes pointing back at the centre.
  assert.ok(early > 6 && early < 25, `spokes of ${early.toFixed(1)} m`);
  for (const star of shell.slice(0, 40)) {
    const out = Math.hypot(star.x, star.y - 220, star.z);
    const tail = Math.hypot(star.tx, star.ty - 220, star.tz);
    assert.ok(tail < out, "the tail is nearer the burst than the head");
  }
  for (let step = 0; step < 100; step += 1) for (const star of shell) stepStar(star, 1 / 60);
  const late = mean();
  assert.ok(late < early * 0.45, `the streaks shorten as the stars slow (${early.toFixed(1)} → ${late.toFixed(1)} m)`);
  // The same at any frame rate (within a few per cent): the tail follows in time, not in frames.
  const a = { ...shell[0]!, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 40, vy: 0, vz: 0, age: 0 };
  const b = { ...a };
  for (let step = 0; step < 60; step += 1) stepStar(a, 1 / 60);
  for (let step = 0; step < 20; step += 1) stepStar(b, 1 / 20);
  assert.ok(Math.abs(streak(a) - streak(b)) < 0.2 * streak(a));
});

test("a shell opens big, and a show walks round the whole colour wheel", () => {
  const random = seeded(31);
  // A peony reaches some 55 m and more from its centre.
  const rocket = { ...launchRocket(random, 0, 40, 0), shell: "peony" as const, vx: 0, vy: 0, vz: 0, y: 220, size: 1 };
  const stars: Star[] = [];
  burst(rocket, random, (star) => stars.push(star));
  let reach = 0;
  for (let step = 0; step < 100; step += 1) {
    for (const star of stars) {
      stepStar(star, 1 / 60);
      if (star.twinkle !== "flash" && star.twinkle !== "haze") reach = Math.max(reach, Math.hypot(star.x, star.y - 220, star.z));
    }
  }
  assert.ok(reach > 55 && reach < 110, `a peony ${reach.toFixed(0)} m in radius`);
  // Cue after cue the first colour moves on: never the same twice running, every hue within a show.
  const seen = new Set<unknown>();
  let previous: unknown = null;
  let repeats = 0;
  for (let turn = 1; turn <= 34; turn += 1) {
    const cue = nextCue(random, 30, 40, turn);
    if (cue.color === previous) repeats += 1;
    previous = cue.color;
    seen.add(cue.color);
  }
  assert.equal(repeats, 0);
  assert.ok(seen.size >= STAR_COLORS.length - 3, `${seen.size} colours in one show`);
  // Colours are colours: the weakest channel all but absent, not a white that only leans toward a hue.
  for (const [r, g, b] of STAR_COLORS.slice(0, -1)) {
    const sorted = [r, g, b].sort((x, y) => y - x);
    assert.ok(sorted[2]! < sorted[0]! * 0.16, `washed out: ${r}, ${g}, ${b}`);
  }
});

test("the deck fires too: fans of comets on glittering tails, and mines of two colours", async () => {
  const { groundEffect, FAN_COMETS, MINE_STARS, shedSparks } = await import("../../src/simulator/effects/FireworksMath");
  const random = seeded(8);
  let fans = 0;
  let mines = 0;
  for (let turn = 0; turn < 600; turn += 1) {
    const cue = nextCue(random, 30, 40, turn);
    if (cue.ground === "fan") fans += 1;
    if (cue.ground === "mine") mines += 1;
  }
  assert.ok(fans > 15 && fans < 90, `${fans} fans in 600 cues`);
  assert.ok(mines > 10 && mines < 70, `${mines} mines in 600 cues`);
  const base = nextCue(random, 30, 40, 3);
  // A fan: comets thrown up and out along the deck (here along x), in several colours.
  const comets: Star[] = [];
  assert.equal(groundEffect({ ...base, ground: "fan", count: 1, colors: null }, 0, random, 0, 40, 0, 1, 0, (star) => comets.push(star)), FAN_COMETS);
  assert.ok(comets.every((star) => star.vy > 40 && star.sparkle > 50));
  assert.ok(Math.min(...comets.map((star) => star.vx)) < -25 && Math.max(...comets.map((star) => star.vx)) > 25, "spread along the deck");
  assert.ok(comets.every((star) => Math.abs(star.vz) < 2), "in the plane of the deck's length");
  assert.ok(new Set(comets.map((star) => star.color)).size >= 3);
  // Each climbs well above the deck, sheds glitter, and comes down burnt out.
  const comet = comets[3]!;
  const glitter: Star[] = [];
  let top = 0;
  while (stepStar(comet, 1 / 60)) {
    shedSparks(comet, 1 / 60, random, (spark) => glitter.push(spark));
    top = Math.max(top, comet.y);
  }
  assert.ok(top > 110 && top < 220, `a comet to ${top.toFixed(0)} m`);
  assert.ok(glitter.length > 80);
  // A mine: a fountain upward from the deck in two colours, in white crackle.
  const fountain: Star[] = [];
  const count = groundEffect({ ...base, ground: "mine", count: 2, colors: null }, 0, random, 0, 40, 0, 1, 0, (star) => fountain.push(star));
  assert.equal(count, fountain.length);
  assert.ok(count >= MINE_STARS);
  const stars = fountain.filter((star) => star.twinkle !== "flash");
  assert.ok(stars.every((star) => star.vy > 15), "all of it goes up");
  const colours = new Set(stars.filter((star) => star.twinkle !== "crackle").map((star) => star.color));
  assert.equal(colours.size, 2);
  assert.ok(stars.some((star) => star.twinkle === "crackle"));
});
