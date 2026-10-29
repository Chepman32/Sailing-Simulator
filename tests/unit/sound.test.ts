import assert from "node:assert/strict";
import test from "node:test";
import { windFury, windSoundLevels } from "../../src/simulator/audio/WindSoundMath";
import { boatSoundLevels, sailFillCrack } from "../../src/simulator/audio/BoatSoundMath";
import { audibleSlam, steadyLeewardSide } from "../../src/simulator/vessel/BoomDynamics";
import { createWeather } from "../../src/simulator/environment/WeatherMath";

const calm = (apparentWind: number) => windSoundLevels({ trueWind: 7.7, apparentWind, storm: 0, windScale: 1, gust: 0, gustApproaching: 0, wander: 0 });

test("on a fair day the wind is barely a breath, even at twenty knots under power", () => {
  for (const apparent of [3, 8, 14, 20]) {
    const levels = calm(apparent);
    assert.ok(levels.breeze < 0.004, `breeze ${levels.breeze} at ${apparent} m/s apparent`);
    assert.equal(levels.roar, 0);
    assert.equal(levels.howl, 0);
    assert.equal(levels.shriek, 0);
    assert.equal(levels.spindrift, 0);
  }
  assert.ok(calm(20).breeze > calm(3).breeze, "the yacht's own speed still freshens it a little");
});

test("a storm roars and howls, a hurricane shrieks, and gusts swell it", () => {
  const storm = createWeather("storm");
  const hurricane = createWeather("hurricane");
  const at = (weather: typeof storm, gust: number) =>
    windSoundLevels({ trueWind: 7.7 * weather.wind, apparentWind: 7.7 * weather.wind, storm: weather.storm, windScale: weather.wind, gust, gustApproaching: 0, wander: 0 });
  assert.equal(windFury(createWeather("clear").storm, createWeather("clear").wind), 0);
  const gale = at(storm, 0);
  assert.ok(gale.roar > calm(8).breeze * 6, "the roar dwarfs a fair day's breeze");
  assert.ok(gale.howl > 0.02);
  assert.ok(at(hurricane, 0).shriek > 0 && at(hurricane, 0).roar > gale.roar);
  const gusting = at(storm, 1);
  assert.ok(gusting.roar > gale.roar && gusting.howlPitch > gale.howlPitch && gusting.roarTone > gale.roarTone);
});

test("the rigging only sings in a real blow, and a sail under power is quiet", () => {
  const motoring = boatSoundLevels({ knots: 20, waves: 1, apparentWind: 30, gust: 0, gustApproaching: 0, luff: 1, trimRate: 0, trueWind: 15, motoring: 1 });
  assert.equal(motoring.rigging, 0, "no whistle from the yacht's own breeze");
  const sailing = boatSoundLevels({ knots: 6, waves: 1, apparentWind: 30, gust: 0, gustApproaching: 0, luff: 1, trimRate: 0, trueWind: 15, motoring: 0 });
  assert.ok(motoring.flog < sailing.flog * 0.5, "the flogging is softer under power");
  const gale = boatSoundLevels({ knots: 6, waves: 3, apparentWind: 40, gust: 0, gustApproaching: 0, luff: 0, trimRate: 0, trueWind: 40, motoring: 0 });
  assert.ok(gale.rigging > 0.6);
  assert.equal(sailFillCrack(1, 0.1, 25, 0.8), 0, "no fill crack while the engines drive her");
  assert.ok(sailFillCrack(1, 0.1, 25, 0) > 0);
  assert.equal(sailFillCrack(1, 0.1, 6, 0), 0, "nor in a breath of wind");
});

test("the sails' side holds steady near head to wind and dead downwind, and only a real gybe slams", () => {
  let side = 1;
  // Apparent wind wavering a few degrees either side of dead ahead.
  for (const angle of [0.05, -0.08, 0.1, -0.12, 0.06]) side = steadyLeewardSide(side, angle);
  assert.equal(side, 1);
  // Clearly on the other side: it changes.
  assert.equal(steadyLeewardSide(1, 0.6), -1);
  assert.equal(steadyLeewardSide(-1, -0.6), 1);
  assert.equal(audibleSlam(1, 0.4, 10), 0, "a boom crossing a luffing sail is silent");
  assert.equal(audibleSlam(1, 2.6, 1.5), 0, "nor in a breath of apparent wind");
  assert.ok(audibleSlam(1, 2.6, 9) > 0.9, "a gybe in a breeze slams");
});
