import assert from "node:assert/strict";
import test from "node:test";
import {
  DOME_CENTRE,
  DOME_HITS,
  droneCondition,
  droneToWorld,
  hitChance,
  HULL_HITS,
  JET_CENTRES,
  JET_HITS,
  leakSpeedFactor,
  stepEngineHeat,
  stepSuspicion,
  strikeDrone,
  yachtSignature,
  type DronePose,
} from "../../src/simulator/combat/CombatMath";
import { MAGAZINE, Rifle, RELOAD_TIME } from "../../src/simulator/combat/Rifle";

const calm = { engineRunning: false, shaft: 0, speed: 5, engineHeat: 0, night: 0, haze: 0, rain: 0, storm: 0 };

test("the yacht's signature: a diesel is heard a kilometre off, a sail is seen a few hundred metres, less at night in rain", () => {
  const full = yachtSignature({ ...calm, engineRunning: true, shaft: 1, engineHeat: 1 });
  assert.ok(full.reach > 1150 && full.reach < 1300, `engine ${full.reach.toFixed(0)} m`);
  const sail = yachtSignature(calm);
  assert.ok(sail.reach > 240 && sail.reach < 290, `sail ${sail.reach.toFixed(0)} m`);
  const hidden = yachtSignature({ ...calm, night: 1, rain: 1 });
  assert.ok(hidden.reach > 80 && hidden.reach < 130, `sail at night in rain ${hidden.reach.toFixed(0)} m`);
  // Stopping the engine does not make her cold at once.
  let heat = 1;
  for (let second = 0; second < 30; second += 1) heat = stepEngineHeat(heat, false, 1);
  assert.ok(heat > 0.4 && yachtSignature({ ...calm, engineHeat: heat }).reach > 280, "still warm half a minute later");
  for (let second = 0; second < 40; second += 1) heat = stepEngineHeat(heat, false, 1);
  assert.equal(heat, 0);
});

test("suspicion grows faster close in, drains away out of reach, and is never an instant failure", () => {
  let close = 0;
  let far = 0;
  let seconds = 0;
  while (close < 1 && seconds < 60) {
    close = stepSuspicion(close, 40, 260, 0.1);
    seconds += 0.1;
  }
  assert.ok(seconds > 1.2 && seconds < 3, `spotted close in after ${seconds.toFixed(1)} s`);
  seconds = 0;
  while (far < 1 && seconds < 60) {
    far = stepSuspicion(far, 240, 260, 0.1);
    seconds += 0.1;
  }
  assert.ok(seconds > 8, `at the edge it takes ${seconds.toFixed(1)} s`);
  let fading = 1;
  for (let step = 0; step < 100; step += 1) fading = stepSuspicion(fading, 500, 260, 0.1);
  assert.ok(fading < 0.5);
});

test("a round finds the dome from anywhere, the jets only from astern, and the armour everywhere else", () => {
  const pose: DronePose = { x: 100, y: 0, z: 50, heading: 0.7, pitch: 0.04, roll: -0.03 };
  const point = { x: 0, y: 0, z: 0 };
  const shootAt = (local: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }) => {
    droneToWorld(local, pose, point);
    const dir = { x: point.x - from.x, y: point.y - from.y, z: point.z - from.z };
    const length = Math.hypot(dir.x, dir.y, dir.z);
    return strikeDrone(from, { x: dir.x / length, y: dir.y / length, z: dir.z / length }, pose);
  };
  // From the side, level with the deck.
  const side = { x: pose.x + Math.cos(pose.heading) * 150, y: 2.2, z: pose.z - Math.sin(pose.heading) * 150 };
  assert.equal(shootAt(DOME_CENTRE, side)?.zone, "dome");
  assert.equal(shootAt(JET_CENTRES[0], side)?.zone, "hull", "the jets are behind the hull from abeam");
  assert.equal(shootAt({ x: 0, y: 0.6, z: 1 }, side)?.zone, "hull");
  // From astern.
  const astern = { x: pose.x - Math.sin(pose.heading) * 120, y: 1.2, z: pose.z - Math.cos(pose.heading) * 120 };
  assert.equal(shootAt(JET_CENTRES[1], astern)?.zone, "jet");
  // A miss is a miss.
  assert.equal(strikeDrone(side, { x: 0, y: 1, z: 0 }, pose), null);
});

test("hits add up: three in the dome blind it, the jets stop it, the armour takes a long beating", () => {
  assert.equal(droneCondition({ dome: DOME_HITS - 1, jets: 0, hull: 5 }), "fighting");
  assert.equal(droneCondition({ dome: DOME_HITS, jets: 0, hull: 0 }), "blind");
  assert.equal(droneCondition({ dome: 0, jets: JET_HITS, hull: 0 }), "stopped");
  assert.equal(droneCondition({ dome: DOME_HITS, jets: JET_HITS, hull: HULL_HITS }), "wrecked");
  assert.equal(DOME_HITS, 3, "the design document promises three rounds in the dome");
});

test("a drone's aim: good close in, poor far off, worse against a fast yacht at night", () => {
  assert.ok(hitChance(100, 2, 0.5, 0, 0) > hitChance(400, 2, 0.5, 0, 0) * 2);
  assert.ok(hitChance(200, 9, 0.5, 0, 0) < hitChance(200, 1, 0.5, 0, 0));
  assert.ok(hitChance(200, 4, 0.5, 1, 1) < hitChance(200, 4, 0.5, 0, 0));
  assert.equal(hitChance(600, 0, 0, 0, 0), 0);
});

test("a holed hull slows her, and the rifle reloads by itself", () => {
  assert.equal(leakSpeedFactor(0.8), 1);
  assert.ok(leakSpeedFactor(0.25) < 0.85 && leakSpeedFactor(0.05) >= 0.58);
  const rifle = new Rifle();
  assert.equal(rifle.trigger(), false, "not drawn");
  rifle.drawn = true;
  let fired = 0;
  for (let step = 0; step < 200; step += 1) {
    if (rifle.trigger()) fired += 1;
    rifle.update(0.05);
    if (fired === MAGAZINE) break;
  }
  assert.equal(fired, MAGAZINE);
  assert.equal(rifle.ammo, 0);
  assert.equal(rifle.trigger(), false, "reloading");
  for (let t = 0; t < RELOAD_TIME + 0.1; t += 0.05) rifle.update(0.05);
  assert.equal(rifle.ammo, MAGAZINE);
});
