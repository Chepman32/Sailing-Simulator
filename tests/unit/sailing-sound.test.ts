import assert from "node:assert/strict";
import test from "node:test";
import { boatSoundLevels, sailFillCrack } from "../../src/simulator/audio/BoatSoundMath";
import { GUST_SLOT, gustEvent, MAX_GUST_FACTOR, sampleWind } from "../../src/simulator/environment/WindMath";

const calm = { knots: 0, waves: 1, apparentWind: 10, gust: 0, gustApproaching: 0, luff: 0, trimRate: 0 };

test("water laps at the hulls at rest (softly on a calm sea) and falls silent under way; no knocks at speed", () => {
  const rest = boatSoundLevels(calm);
  const lop = boatSoundLevels({ ...calm, waves: 3 });
  const slow = boatSoundLevels({ ...calm, knots: 3 });
  const fast = boatSoundLevels({ ...calm, knots: 9 });
  assert.ok(rest.slap > 0.2 && rest.slap < 0.4 && rest.rush < 0.01, "a calm day's lapping is faint");
  assert.ok(lop.slap > rest.slap * 2, "louder in a lop");
  assert.equal(fast.slap, 0, "no slaps (heard as knocks) once she is under way");
  assert.ok(fast.rush > slow.rush * 4 && fast.rushTone > slow.rushTone);
  assert.ok(!("spray" in fast), "no spray bursts against the hulls");
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
