import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRLINER_ALTITUDE_MAX,
  AIRLINER_ALTITUDE_MIN,
  CONTRAIL_FORMATION_TIME,
  CONTRAIL_LIFETIME_MAX,
  CONTRAIL_LIFETIME_MIN,
  LOW_PASS_ALTITUDE_MAX,
  LOW_PASS_HALF_LENGTH,
  LOW_PASS_OFFSET_MAX,
  LOW_PASS_OFFSET_MIN,
  airAbsorptionCutoff,
  contrailOpacity,
  contrailWidth,
  coordinatedBank,
  distanceGain,
  dopplerRatio,
  lowPassVisibility,
  nextAirlinerDelay,
  nextLowPassDelay,
  planAirlinerRoute,
  planLowPass,
  type RandomSource,
  ORBIT_RADIUS_MIN,
  crowInstability,
  lowPassTurnRate,
  planOrbit,
  turbulence,
  waterReflectionDelay,
} from "../../src/simulator/aviation/AviationMath";
import { beaconFlash, landingLightGlare, strobeFlash } from "../../src/simulator/aviation/AircraftLights";

function seeded(seed: number): RandomSource {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

test("low passes fly beside the yacht, never through it, and enter from far away", () => {
  for (let seed = 1; seed < 60; seed += 1) {
    const random = seeded(seed);
    const kind = seed % 2 === 0 ? "banner" : "seaplane";
    const plan = planLowPass(random, 120, -340, kind);
    const forwardX = Math.sin(plan.heading);
    const forwardZ = Math.cos(plan.heading);
    // Closest approach of the straight path to the focus.
    const toFocusX = 120 - plan.startX;
    const toFocusZ = -340 - plan.startZ;
    const along = toFocusX * forwardX + toFocusZ * forwardZ;
    const lateral = Math.hypot(toFocusX - forwardX * along, toFocusZ - forwardZ * along);
    assert.ok(Math.abs(along - LOW_PASS_HALF_LENGTH) < 1e-6, "closest approach is half-way along the pass");
    assert.ok(lateral >= LOW_PASS_OFFSET_MIN - 1e-6 && lateral <= LOW_PASS_OFFSET_MAX + 1e-6);
    // The yacht must be on the side the banner is painted to read from.
    const rightX = Math.cos(plan.heading);
    const rightZ = -Math.sin(plan.heading);
    const sideDot = (toFocusX - forwardX * along) * rightX + (toFocusZ - forwardZ * along) * rightZ;
    assert.equal(Math.sign(sideDot), plan.observerSide);
    assert.ok(plan.altitude > 30 && plan.altitude <= LOW_PASS_ALTITUDE_MAX, "low but clear of masts and gulls");
    assert.ok(plan.speed > 25 && plan.speed < 60);
    assert.ok(Math.abs(plan.duration * plan.speed - LOW_PASS_HALF_LENGTH * 2) < 1e-6);
    assert.ok(Math.abs(coordinatedBank(plan.speed, plan.turnRate)) < 0.1, "gentle passes keep a shallow bank");
  }
});

test("aircraft schedules are periodic and bounded", () => {
  const random = seeded(7);
  for (let index = 0; index < 200; index += 1) {
    const lowPass = nextLowPassDelay(random);
    const airliner = nextAirlinerDelay(random);
    assert.ok(lowPass >= 20 && lowPass <= 90);
    assert.ok(airliner >= 30 && airliner <= 120);
  }
  assert.equal(lowPassVisibility(0, 60), 0);
  assert.equal(lowPassVisibility(30, 60), 1);
  assert.equal(lowPassVisibility(60, 60), 0);
});

test("airliner routes stay high and contrail persistence varies", () => {
  for (let seed = 1; seed < 60; seed += 1) {
    const route = planAirlinerRoute(seeded(seed));
    assert.ok(route.altitude >= AIRLINER_ALTITUDE_MIN && route.altitude <= AIRLINER_ALTITUDE_MAX);
    assert.ok(route.contrailLifetime >= CONTRAIL_LIFETIME_MIN && route.contrailLifetime <= CONTRAIL_LIFETIME_MAX);
    assert.ok(Number.isFinite(route.startX + route.startZ + route.heading + route.duration));
  }
});

test("contrails form behind the engine, widen over time, and dissipate completely", () => {
  const lifetime = 120;
  assert.equal(contrailOpacity(0, lifetime), 0, "ice needs a moment to form behind the exhaust");
  assert.ok(contrailOpacity(CONTRAIL_FORMATION_TIME * 2, lifetime) > 0.6, "a fresh contrail is dense");
  let previousWidth = 0;
  let previousOpacity = Number.POSITIVE_INFINITY;
  for (let age = CONTRAIL_FORMATION_TIME; age < lifetime; age += 2) {
    const width = contrailWidth(age);
    const opacity = contrailOpacity(age, lifetime);
    assert.ok(width > previousWidth, "a contrail keeps spreading");
    assert.ok(opacity <= previousOpacity + 1e-9, "a formed contrail never re-thickens");
    previousWidth = width;
    previousOpacity = opacity;
  }
  assert.ok(contrailWidth(lifetime) > contrailWidth(1) * 6, "old contrails are much wider than fresh ones");
  assert.equal(contrailOpacity(lifetime, lifetime), 0);
  assert.equal(contrailOpacity(lifetime + 10, lifetime), 0);
});

test("aircraft sound follows Doppler, distance and air absorption", () => {
  assert.equal(dopplerRatio(0), 1);
  assert.ok(dopplerRatio(45) > 1.1, "an approaching aircraft sounds higher");
  assert.ok(dopplerRatio(-45) < 0.9, "a receding aircraft sounds lower");
  assert.ok(Number.isFinite(dopplerRatio(10_000)));
  assert.equal(distanceGain(10, 40), 1);
  assert.ok(distanceGain(400, 40) < distanceGain(100, 40));
  assert.ok(airAbsorptionCutoff(1000) < airAbsorptionCutoff(100));
  assert.ok(airAbsorptionCutoff(5000) >= 600);
});

test("sightseeing orbits circle the yacht in a coordinated bank without overflying it", () => {
  for (let seed = 1; seed < 40; seed += 1) {
    const plan = planOrbit(seeded(seed), 50, -80);
    let x = plan.startX;
    let z = plan.startZ;
    let heading = plan.heading;
    let closest = Number.POSITIVE_INFINITY;
    let maxBank = 0;
    const step = 0.05;
    for (let time = 0; time < plan.duration; time += step) {
      const rate = lowPassTurnRate(plan, time);
      heading += rate * step;
      x += Math.sin(heading) * plan.speed * step;
      z += Math.cos(heading) * plan.speed * step;
      closest = Math.min(closest, Math.hypot(x - 50, z + 80));
      maxBank = Math.max(maxBank, Math.abs(coordinatedBank(plan.speed, rate)));
    }
    assert.ok(closest > ORBIT_RADIUS_MIN * 0.85, `orbit came within ${closest.toFixed(1)} m of the yacht`);
    assert.ok(maxBank > 0.45 && maxBank <= 0.75, `orbit bank ${maxBank} should be a visible but sane turn`);
    assert.ok(Math.abs(lowPassTurnRate(plan, 0)) < 1e-9, "the orbit starts with wings level");
    assert.ok(Math.abs(lowPassTurnRate(plan, plan.duration)) < 1e-9, "and ends with wings level");
  }
});

test("turbulence stays a gentle, bounded disturbance", () => {
  for (let time = 0; time < 200; time += 0.37) {
    const gust = turbulence(time, 3.2);
    assert.ok(Math.abs(gust.roll) < 0.05 && Math.abs(gust.pitch) < 0.025 && Math.abs(gust.heave) < 1);
  }
});

test("exterior lights follow anti-collision timing and the landing light flares head-on", () => {
  let flashes = 0;
  let previous = 0;
  for (let time = 0; time < 1.2; time += 0.005) {
    const value = strobeFlash(time);
    if (value > 0.5 && previous <= 0.5) flashes += 1;
    previous = value;
  }
  assert.equal(flashes, 2, "wingtip strobes double-flash once per cycle");
  assert.ok(strobeFlash(0.6) === 0, "strobes are dark between flashes");
  assert.ok(beaconFlash(0.26) > 0.9 && beaconFlash(0.8) === 0);
  assert.equal(landingLightGlare(1), 1);
  assert.ok(landingLightGlare(0.7) < 0.05, "glare only when the nose points at the viewer");
  assert.equal(landingLightGlare(-1), 0);
});

test("sea reflection delay shrinks as the aircraft moves away and contrails pinch with age", () => {
  const near = waterReflectionDelay(60, 80, 6);
  const far = waterReflectionDelay(600, 80, 6);
  assert.ok(near > far && far > 0);
  assert.ok(near < 0.11, "delay fits the reflection delay line");
  assert.equal(crowInstability(0), 0);
  assert.equal(crowInstability(120), 1);
});
