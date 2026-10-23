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
