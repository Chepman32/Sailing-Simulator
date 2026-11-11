import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeThunder, thunderReverb } from "../../src/simulator/audio/ThunderSynth";
import { distanceFromWaterline, islandsInCell, onLavaFlow, waterDepthAt } from "../../src/simulator/environment/IslandMath";
import { oceanOrbitalVelocity, sampleOcean, setSeaScale } from "../../src/simulator/environment/OceanMath";
import { POI_CLEARANCE } from "../../src/simulator/effects/PoiMath";
import { beachLanding, islandById, LANDING_INLAND, placeDestination, traderLanding } from "../../src/simulator/map/TravelMath";
import { WHALE_SHORE, whaleDepthExact, WHALE_SHORE_KEEP } from "../../src/simulator/wildlife/ShoreAvoidance";

/** A repeatable random sequence. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function zeroCrossingRate(samples: Float32Array, rate: number): number {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) if (samples[index - 1]! < 0 !== samples[index]! < 0) crossings += 1;
  return crossings / (samples.length / rate);
}

test("thunder is heard from the bolt: late and low far off, early and sharp close by", () => {
  const rate = 22050;
  const close = synthesizeThunder({ distance: 250, pan: 0.2 }, rate, seeded(5));
  const far = synthesizeThunder({ distance: 6000, pan: -0.4 }, rate, seeded(5));
  // It starts when the nearest part of the channel is heard (sound covers a kilometre in three seconds).
  assert.ok(close.arrival > 0.4 && close.arrival < 250 / 343 + 0.1, `close arrival ${close.arrival.toFixed(2)} s`);
  assert.ok(far.arrival > 15 && far.arrival < 6000 / 343 + 0.5, `far arrival ${far.arrival.toFixed(2)} s`);
  // A close strike keeps its treble; far off only the rumble is left.
  assert.ok(zeroCrossingRate(close.left, rate) > zeroCrossingRate(far.left, rate) * 1.8, "close is brighter");
  // Seconds of roll, every sample finite and within the peak.
  for (const sound of [close, far]) {
    assert.ok(sound.left.length / rate > 2.5, "it rolls on");
    let peak = 0;
    for (let index = 0; index < sound.left.length; index += 1) {
      assert.ok(Number.isFinite(sound.left[index]!) && Number.isFinite(sound.right[index]!));
      peak = Math.max(peak, Math.abs(sound.left[index]!), Math.abs(sound.right[index]!));
    }
    assert.ok(peak > 0.5 && peak <= 0.91);
  }
  // A strike to the right is louder in the right ear.
  const right = synthesizeThunder({ distance: 800, pan: 0.95 }, rate, seeded(9));
  const energy = (samples: Float32Array) => samples.reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy(right.right) > energy(right.left) * 1.3);
  // The echo it rolls on in dies away.
  const [echo] = thunderReverb(rate, 3.6, seeded(2));
  const quarter = Math.floor(echo.length / 4);
  assert.ok(energy(echo.subarray(0, quarter)) > energy(echo.subarray(quarter * 3)) * 20);
});

test("whales keep twice as far off a coast as before", () => {
  const island = islandsInCell(0, 1)[0]!;
  // Walk straight out from the island's centre to the waterline, then on out to sea.
  let along = 0;
  const point = (distance: number) => ({ x: island.centerX + distance, z: island.centerZ });
  while (distanceFromWaterline(point(along).x, point(along).z) < 0) along += 1;
  const at = (off: number) => {
    let distance = along;
    while (distanceFromWaterline(point(distance).x, point(distance).z) < off) distance += 0.5;
    return point(distance);
  };
  // Where the shelf alone already let a whale steer (28 m out), the water now reads too shallow.
  const old = at(30);
  assert.ok(waterDepthAt(old.x, old.z) >= WHALE_SHORE.minDepth * 0.95, "deep enough by the old reckoning");
  assert.ok(whaleDepthExact(old.x, old.z) < WHALE_SHORE.minDepth * 0.75, "too shallow now");
  // The hard line (three quarters of their depth) lies at least twice as far out as the old 21 m.
  const hard = at(42);
  assert.ok(whaleDepthExact(hard.x, hard.z) < WHALE_SHORE.minDepth * 0.75);
  // Past the band the sea is as deep as it is.
  const open = at(WHALE_SHORE_KEEP + 2);
  assert.equal(whaleDepthExact(open.x, open.z), waterDepthAt(open.x, open.z));
});

test("a swimmer is surged to and fro by the swell, much more in a storm, less the deeper he is", () => {
  const swing = (depth: number) => {
    let peak = 0;
    let mean = 0;
    const out = { x: 0, z: 0 };
    for (let step = 0; step < 400; step += 1) {
      oceanOrbitalVelocity(3000, -2500, step * 0.05, depth, out);
      peak = Math.max(peak, Math.hypot(out.x, out.z));
      mean += out.x / 400;
    }
    return { peak, mean };
  };
  try {
    setSeaScale(1);
    const fair = swing(0);
    setSeaScale(4.2);
    const storm = swing(0);
    const deep = swing(12);
    assert.ok(fair.peak > 0.15 && fair.peak < 1.5, `fair weather sway ${fair.peak.toFixed(2)} m/s`);
    assert.ok(storm.peak > fair.peak * 2.5, `storm surge ${storm.peak.toFixed(2)} m/s`);
    assert.ok(deep.peak < storm.peak * 0.8, "fainter at depth");
    // To and fro: it carries him nowhere on average.
    assert.ok(Math.abs(storm.mean) < storm.peak * 0.4);
    // And the storm lifts and drops him by metres.
    let low = Infinity;
    let high = -Infinity;
    for (let step = 0; step < 400; step += 1) {
      const height = sampleOcean(3000, -2500, step * 0.05).height;
      low = Math.min(low, height);
      high = Math.max(high, height);
    }
    assert.ok(high - low > 3, `heave ${(high - low).toFixed(1)} m`);
  } finally {
    setSeaScale(1);
  }
});

test("fast travel finds the places: at sea aboard, ashore on foot on the beach", () => {
  const isOpen = (x: number, z: number) => distanceFromWaterline(x, z) > POI_CLEARANCE;
  // Island ids encode their cell.
  for (const island of [...islandsInCell(3, -2), ...islandsInCell(-4, 5)]) assert.equal(islandById(island.id)?.id, island.id);
  assert.equal(islandById(-1), null);
  // A place on the water: by yacht.
  const wreck = placeDestination("wreck:home-wreck", isOpen);
  assert.ok(wreck && wreck.by === "yacht" && wreck.kind === "wreck");
  assert.equal(placeDestination("nonsense", isOpen), null);
  assert.equal(placeDestination("barge:home-wreck", isOpen), null, "the kind must match");
  // A volcano: on foot, on its beach, off the lava.
  let volcano = null;
  for (let column = -2; column <= 2 && !volcano; column += 1) volcano = islandsInCell(column, 0).find((island) => island.volcano) ?? null;
  assert.ok(volcano, "a volcano near the start");
  const destination = placeDestination(`volcano:${volcano.id}`, isOpen);
  assert.ok(destination && destination.by === "foot");
  for (const from of [{ x: volcano.centerX + 2000, z: volcano.centerZ }, { x: volcano.centerX, z: volcano.centerZ - 2000 }]) {
    const landing = beachLanding(volcano, from);
    assert.ok(landing, "a landing");
    const off = distanceFromWaterline(landing.x, landing.z);
    assert.ok(off < -LANDING_INLAND + 1.5 && off > -LANDING_INLAND - 1.5, `on the beach, ${(-off).toFixed(1)} m in`);
    assert.ok(!onLavaFlow(volcano, landing.x, landing.z, 6), "off the lava");
    // On the side he came from, facing inland.
    const side = Math.hypot(landing.x - from.x, landing.z - from.z);
    assert.ok(side < Math.hypot(volcano.centerX - from.x, volcano.centerZ - from.z));
    const inland = Math.atan2(volcano.centerX - landing.x, volcano.centerZ - landing.z);
    assert.ok(Math.abs(Math.atan2(Math.sin(inland - landing.yaw), Math.cos(inland - landing.yaw))) < 1e-6);
  }
  // Before a trader: a few steps in front of his porch, facing him.
  const porch = { x: 100, z: 50, facing: 0.7 };
  const greeting = traderLanding(porch);
  assert.ok(Math.abs(Math.hypot(greeting.x - porch.x, greeting.z - porch.z) - 3.2) < 1e-6);
  assert.ok(Math.abs(Math.atan2(Math.sin(greeting.yaw - (porch.facing + Math.PI)), Math.cos(greeting.yaw - (porch.facing + Math.PI)))) < 1e-6);
});
