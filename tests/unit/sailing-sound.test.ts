import assert from "node:assert/strict";
import test from "node:test";
import { boatSoundLevels, sailFillCrack, SPRAY_START_KNOTS } from "../../src/simulator/audio/BoatSoundMath";
import { GUST_SLOT, gustEvent, MAX_GUST_FACTOR, sampleWind } from "../../src/simulator/environment/WindMath";

const calm = { knots: 0, waves: 1, apparentWind: 10, gust: 0, gustApproaching: 0, luff: 0, trimRate: 0 };

test("slap at rest gives way to the bow wave's rush, and spray only above 6 knots", () => {
  const rest = boatSoundLevels(calm);
  const slow = boatSoundLevels({ ...calm, knots: 3 });
  const fast = boatSoundLevels({ ...calm, knots: 9 });
  assert.ok(rest.slap > 0.5 && rest.rush < 0.01);
  assert.ok(fast.slap < rest.slap * 0.3, "the slap is drowned by the rush at speed");
  assert.ok(fast.rush > slow.rush * 4 && fast.rushTone > slow.rushTone);
  assert.equal(boatSoundLevels({ ...calm, knots: SPRAY_START_KNOTS - 0.5 }).spray, 0);
  assert.ok(fast.spray > 0.5 && fast.sprayRate > 1);
});

test("the sail flogs only when it luffs in a breeze; the winch clicks only while trimming in", () => {
  assert.equal(boatSoundLevels(calm).flog, 0);
  assert.ok(boatSoundLevels({ ...calm, luff: 1, apparentWind: 16 }).flog > 0.9);
  assert.ok(boatSoundLevels({ ...calm, luff: 1, apparentWind: 2 }).flog < 0.05, "no breeze, no flogging");
  assert.equal(boatSoundLevels(calm).winchClicks, 0);
  assert.ok(boatSoundLevels({ ...calm, trimRate: 0.3 }).winchClicks > 15);
  assert.ok(boatSoundLevels({ ...calm, trimRate: -0.3 }).sheetSlip > 0.5);
  assert.ok(sailFillCrack(0.9, 0.1, 15) > 0.5, "the sail cracks full on the new tack");
  assert.equal(sailFillCrack(0.3, 0.1, 15), 0);
});

test("a gust is one event: heard coming, then the wind rises and eases, within bounds", () => {
  let events = 0;
  let warned = 0;
  let previous = 0;
  for (let time = 0; time < GUST_SLOT * 40; time += 0.25) {
    const event = gustEvent(time);
    if (event.envelope > 0.5 && previous <= 0.5) events += 1;
    if (event.approaching > 0.5) warned += 1;
    previous = event.envelope;
    const wind = sampleWind(time, { x: 0, z: 0, speed: 0, gust: 1 });
    assert.ok(wind.gust <= MAX_GUST_FACTOR + 1e-9);
    assert.ok(Math.abs(event.extra) <= 0.45 + 1e-9);
  }
  assert.ok(events >= 18 && events <= 34, `${events} gusts in ${(GUST_SLOT * 40) / 60} minutes`);
  assert.ok(warned > 0, "gusts are heard before they arrive");
  // Before a gust arrives it is approaching; during it, the wind is stronger.
  for (let time = 0; time < GUST_SLOT * 6; time += 0.25) {
    const event = gustEvent(time);
    if (event.envelope > 0.9) {
      assert.ok(sampleWind(time, { x: 0, z: 0, speed: 0, gust: 1 }).gust > 1.05);
      break;
    }
  }
});

test("a big splash is bright water, not a boom: bubbles and spray above 400 Hz, a late shower", async () => {
  const { renderSplash, splashDuration, bubbleFrequency } = await import("../../src/simulator/audio/SplashSynth");
  assert.ok(Math.abs(bubbleFrequency(0.001) - 3260) < 1, "a 1 mm bubble rings near 3.3 kHz");
  const rate = 24000;
  const whale = renderSplash(rate, 1, 3).samples;
  const small = renderSplash(rate, 0.2, 3).samples;
  assert.ok(whale.length > small.length * 2, "a whale's splash lasts much longer");
  assert.equal(whale.length, Math.ceil(splashDuration(1) * rate));
  let peak = 0;
  let lowEnergy = 0;
  let energy = 0;
  let low = 0;
  const pole = Math.exp((-2 * Math.PI * 300) / rate);
  for (const sample of whale) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
    low = pole * low + (1 - pole) * sample;
    lowEnergy += low * low;
    energy += sample * sample;
  }
  assert.ok(peak <= 0.91 && peak > 0.5);
  assert.ok(lowEnergy / energy < 0.25, `energy below ~300 Hz is ${(lowEnergy / energy).toFixed(2)} of the whole`);
  // The water thrown up is still falling back a second after the impact.
  const window = (from: number) => {
    let sum = 0;
    for (let index = Math.floor(from * rate); index < Math.floor((from + 0.1) * rate); index += 1) sum += whale[index] ** 2;
    return Math.sqrt(sum / (0.1 * rate));
  };
  assert.ok(window(1.0) > window(0) * 0.2, "an audible shower follows the impact");
  assert.ok(window(3.1) < window(0.1) * 0.1, "and dies away");
  // Deterministic per seed, different between seeds.
  assert.deepEqual(renderSplash(rate, 0.5, 9).samples.slice(0, 200), renderSplash(rate, 0.5, 9).samples.slice(0, 200));
  assert.notDeepEqual(renderSplash(rate, 0.5, 9).samples.slice(0, 200), renderSplash(rate, 0.5, 10).samples.slice(0, 200));
});
