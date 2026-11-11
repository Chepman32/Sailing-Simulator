import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CONTRAIL_NIGHT_OPACITY, contrailNightDim, LOW_PASS_NIGHT_END, LOW_PASS_NIGHT_START, lowPassesFly } from "../../src/simulator/aircraft/AircraftMath";
import { wadeDepthMix, wadeTone } from "../../src/simulator/audio/BodySounds";
import { sunShadowsOn, QUALITY_SETTINGS } from "../../src/simulator/core/QualityManager";
import { blobShadowShape } from "../../src/simulator/diver/BlobShadows";
import { WADE_STEP_DEPTH } from "../../src/simulator/diver/DiverMath";
import { CRAB_SETTINGS } from "../../src/simulator/diver/SeabedCrabs";

test("no light plane flies at night, and an airliner's trail is a little fainter under the moon", () => {
  assert.equal(lowPassesFly(0), true);
  assert.equal(lowPassesFly(LOW_PASS_NIGHT_START - 0.01), true);
  // From dusk on none sets out; one still up when night has fallen is gone.
  assert.equal(lowPassesFly(LOW_PASS_NIGHT_START), false);
  assert.equal(lowPassesFly(1), false);
  assert.ok(LOW_PASS_NIGHT_START < 0.5 && LOW_PASS_NIGHT_END > LOW_PASS_NIGHT_START && LOW_PASS_NIGHT_END < 0.8);
  // The trail: all of it by day, fainter than the 0.35 it used to keep at night, but still there.
  assert.equal(contrailNightDim(0), 1);
  assert.equal(contrailNightDim(1), CONTRAIL_NIGHT_OPACITY);
  assert.ok(CONTRAIL_NIGHT_OPACITY < 0.35 && CONTRAIL_NIGHT_OPACITY > 0.15);
  // Through dusk it fades without a step.
  let last = 1;
  for (let night = 0; night <= 1.0001; night += 0.02) {
    const dim = contrailNightDim(night);
    assert.ok(dim <= last + 1e-9 && last - dim < 0.03, `a step at ${night.toFixed(2)}`);
    last = dim;
  }
});

test("a step at the water's edge is soft and dull; the splash and its sparkle come in with the depth", () => {
  // A film of water: the recording is quiet, short and under a low low-pass (nothing that crackles like ice).
  assert.ok(WADE_STEP_DEPTH <= 0.06);
  const film = wadeTone(wadeDepthMix(WADE_STEP_DEPTH));
  assert.ok(film.lowpass !== null && film.lowpass < 1500, `the film of water is played under ${film.lowpass} Hz`);
  assert.ok(film.gain < 0.16 && film.length < 0.5);
  // Ankle-deep: still muffled.
  const ankle = wadeTone(wadeDepthMix(0.15));
  assert.ok(ankle.lowpass !== null && ankle.lowpass < 2200 && ankle.gain < 0.22);
  // Knee-deep: the full slosh as recorded.
  const knee = wadeTone(wadeDepthMix(0.5));
  assert.equal(knee.lowpass, null);
  assert.ok(knee.gain > 0.45 && knee.length === 1);
  // It grows with the depth, never jumps.
  let last = wadeTone(0);
  for (let depth = 0; depth <= 0.5; depth += 0.01) {
    const tone = wadeTone(wadeDepthMix(depth));
    assert.ok(tone.gain >= last.gain - 1e-9 && tone.gain - last.gain < 0.03);
    assert.ok((tone.lowpass ?? 1e9) >= (last.lowpass ?? 1e9) - 1e-6 || last.lowpass === null);
    last = tone;
  }
});

test("the sun casts shadows at every preset on a computer; a phone below high gets blob shadows", () => {
  for (const preset of ["low", "medium", "high", "ultra"] as const) assert.equal(sunShadowsOn(preset, false), true, preset);
  assert.equal(sunShadowsOn("low", true), false);
  assert.equal(sunShadowsOn("medium", true), false);
  assert.equal(sunShadowsOn("high", true), true);
  assert.ok(QUALITY_SETTINGS.low.shadowMapSize >= 1024);
  // A blob shadow lies away from the sun, as long as the sun is low, within bounds.
  const sun = new THREE.Vector3(1, 1, 0).normalize();
  const noon = blobShadowShape(1.75, 0, 1, 0);
  assert.ok(noon.length < 1);
  const morning = { ...blobShadowShape(1.75, sun.x, sun.y, sun.z) };
  assert.ok(Math.abs(morning.dirX + 1) < 1e-9 && Math.abs(morning.dirZ) < 1e-9, "away from the sun");
  assert.ok(Math.abs(morning.length - 1.75) < 1e-6, "45°: as long as he is tall");
  const low = new THREE.Vector3(0, 0.1, 1).normalize();
  const evening = blobShadowShape(1.75, low.x, low.y, low.z);
  assert.ok(evening.length <= 1.75 * 2.4 + 1e-9 && evening.dirZ < -0.99);
});

test("the crabs of the seabed are far bigger than those of the beach", () => {
  const { seabed, beach } = CRAB_SETTINGS;
  assert.ok(seabed.size[0] >= 1.1 && seabed.size[1] >= 2, `seabed crabs ${seabed.size[0]}–${seabed.size[1]} m`);
  assert.ok(seabed.size[0] > beach.size[1] * 5, "the smallest of the deep dwarfs the largest ashore");
  // Fewer of them than there were (40), spread wider, so the floor is not paved with shells.
  assert.ok(seabed.range >= 28 && seabed.count <= 32);
  // A big crab's walk covers ground in proportion (it is not a giant creeping at a small crab's pace).
  assert.ok(seabed.speed[1] >= 0.4);
});

test("an eruption is a spray of thousands of fine cinders, and a shell a cloud of hundreds of fine stars", async () => {
  const { BOMBS, SPARKS, sparkCount, sparkLife, bombFlight } = await import("../../src/simulator/effects/VolcanoMath");
  const { SHELL_STARS, STAR_FINENESS, starKindle, STAR_KINDLE } = await import("../../src/simulator/effects/FireworksMath");
  // Cinders outnumber the bombs forty to one; a phone still draws over a thousand.
  assert.ok(SPARKS >= 4000 && SPARKS > BOMBS * 40);
  assert.equal(sparkCount(1), SPARKS);
  assert.ok(sparkCount(0.35) > 1500 && sparkCount(0.35) < SPARKS * 0.4);
  assert.equal(sparkCount(0), sparkCount(0.2));
  // They glow two to five seconds, and are thrown from a few tens of metres to as high as the bombs.
  const ember = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };
  let low = 0;
  let high = 0;
  for (let index = 0; index < 600; index += 1) {
    const life = sparkLife(index, 3);
    assert.ok(life >= 2.2 && life <= 5);
    assert.ok(bombFlight(1e3, index, 3, ember, true));
    const speed = Math.hypot(ember.vx, ember.vy + 9.81 * ember.t, ember.vz);
    assert.ok(speed >= 16 && speed <= 86.5);
    if (speed < 35) low += 1;
    if (speed > 60) high += 1;
  }
  assert.ok(low > 300 && high > 30, `${low} low, ${high} high of 600`);
  // Shells: several hundred stars each, each drawn well under a metre wide.
  assert.ok(SHELL_STARS.peony >= 600 && SHELL_STARS.rainbow >= 600 && SHELL_STARS.willow >= 300);
  assert.ok(1.9 * STAR_FINENESS < 0.9);
  // A fresh star kindles (so a shell's stars, all on one spot at the burst, are not a white ball); glitter is lit at once.
  assert.ok(starKindle(0, 2.5) <= 0.12 && starKindle(STAR_KINDLE, 2.5) === 1 && starKindle(STAR_KINDLE / 2, 2.5) < 0.6);
  assert.equal(starKindle(0, 0.6), 1);
});

test("a ship far off is veiled at her waterline exactly as the sea she floats in, which stays sea out to her", async () => {
  const { HORIZON_FADE_START, HORIZON_FADE_END, SEA_HAZE_GLSL } = await import("../../src/simulator/environment/shaders/oceanShader");
  const { SPAWN_MAX_RUN } = await import("../../src/simulator/ships/ShipMath");
  const { OCEAN_SIZE } = await import("../../src/simulator/environment/OceanGrid");
  // The sea does not melt into the sky's colour before the farthest ship (it used to, from 1250 m).
  assert.ok(HORIZON_FADE_START > SPAWN_MAX_RUN + 400, `the last fade starts at ${HORIZON_FADE_START} m`);
  assert.ok(HORIZON_FADE_END <= OCEAN_SIZE / 2 && HORIZON_FADE_END > HORIZON_FADE_START);
  // The same function as the ocean's, in numbers: on a clear day the water two kilometres off is still a third itself.
  const seaHaze = (distance: number, haze: number): number => {
    const reach = 1 - 0.5 * haze;
    const air = 1 - Math.exp(-Math.pow(distance * 0.00056 * (1 + haze * 7.5), 1.6));
    const t = Math.min(1, Math.max(0, (distance - HORIZON_FADE_START * reach) / ((HORIZON_FADE_END - HORIZON_FADE_START) * reach)));
    return Math.max(air * 0.9, t * t * (3 - 2 * t));
  };
  assert.match(SEA_HAZE_GLSL, /0\.00056/);
  assert.match(SEA_HAZE_GLSL, /7\.5/);
  assert.ok(seaHaze(300, 0) < 0.06);
  assert.ok(seaHaze(2000, 0) < 0.68, `${seaHaze(2000, 0).toFixed(2)} of the sea at 2 km is haze`);
  assert.ok(seaHaze(HORIZON_FADE_END, 0) === 1);
  // In thick weather it closes in, as it did.
  assert.ok(seaHaze(600, 1) > 0.85 && seaHaze(1700, 1) === 1);
  let last = 0;
  for (let distance = 0; distance <= 3400; distance += 25) {
    const value = seaHaze(distance, 0);
    assert.ok(value >= last - 1e-9);
    last = value;
  }
});

test("a handheld draws at 1.5 device pixels at least; a touch-screen laptop is a computer", async () => {
  const { maxDprFor, HANDHELD_MIN_DPR, isHandheld } = await import("../../src/simulator/core/QualityManager");
  const { budgetPixelRatio } = await import("../../src/simulator/core/RenderBudget");
  assert.equal(maxDprFor(QUALITY_SETTINGS.low, false), QUALITY_SETTINGS.low.maxDpr);
  assert.equal(maxDprFor(QUALITY_SETTINGS.low, true), HANDHELD_MIN_DPR);
  assert.equal(maxDprFor(QUALITY_SETTINGS.high, true), Math.max(HANDHELD_MIN_DPR, QUALITY_SETTINGS.high.maxDpr));
  // A phone (390 × 844, three device pixels) at the low preset: 1.5, within the budget; it was 1.
  const phone = budgetPixelRatio(3, maxDprFor(QUALITY_SETTINGS.low, true), QUALITY_SETTINGS.low.pixelBudget, 390, 844);
  assert.equal(phone, 1.5);
  assert.ok(390 * 844 * phone * phone <= QUALITY_SETTINGS.low.pixelBudget);
  // A tablet's bigger screen is held by the budget, not by the ratio.
  const tablet = budgetPixelRatio(2, maxDprFor(QUALITY_SETTINGS.low, true), QUALITY_SETTINGS.low.pixelBudget, 1180, 820);
  assert.ok(tablet < 1.1 && 1180 * 820 * tablet * tablet <= QUALITY_SETTINGS.low.pixelBudget * 1.001);
  // Handheld is decided by the main pointer alone (touch points on a laptop's screen do not count).
  const globals = globalThis as unknown as { window?: unknown };
  const previous = globals.window;
  try {
    globals.window = { matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" }) };
    assert.equal(isHandheld(), true);
    globals.window = { matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 10 } };
    assert.equal(isHandheld(), false);
  } finally {
    globals.window = previous;
  }
});
