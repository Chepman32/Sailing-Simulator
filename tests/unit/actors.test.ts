import assert from "node:assert/strict";
import test from "node:test";
import { ActorBrain, sightOf, type Senses } from "../../src/simulator/actors/ActorBrain";
import { PlayerHealth } from "../../src/simulator/actors/PlayerHealth";
import { conditionHolds, createCampaign, type Facts } from "../../src/simulator/story/CampaignMath";

/**
 * The people on foot of M01: what a guard sees, how he goes from his
 * routine to a challenge to a fight; the skipper's health; and the story's
 * conditions over the world.
 */

const quiet = (over: Partial<Senses> = {}): Senses => ({
  sight: 0,
  player: { x: 0, z: 10 },
  heard: null,
  body: null,
  report: null,
  hitFrom: null,
  shotAt: null,
  squadStanding: 4,
  distance: 10,
  health: 1,
  ...over,
});

test("a guard sees what is in front of him, near, standing, moving — and little of a crouched man far off", () => {
  const base = { distance: 8, angle: 0, clear: true, crouched: false, moving: 1, alert: false, light: 1 };
  const near = sightOf(base);
  assert.ok(near > 0.5, `near and in front: ${near}`);
  assert.equal(sightOf({ ...base, clear: false }), 0, "not through a wall");
  assert.ok(sightOf({ ...base, crouched: true, distance: 20 }) < sightOf({ ...base, distance: 20 }), "crouching hides");
  assert.equal(sightOf({ ...base, angle: 2.4 }), 0, "nothing behind his back");
  assert.ok(sightOf({ ...base, light: 0.3, distance: 20 }) < sightOf({ ...base, distance: 20 }), "less at night");
});

test("seen plainly, a guard grows suspicious first and raises his gun only after a beat", () => {
  const brain = new ActorBrain();
  const plain = quiet({ sight: 0.9, distance: 6 });
  let time = 0;
  while (brain.state === "routine" && time < 5) {
    brain.think(0.1, plain, null);
    time += 0.1;
  }
  assert.equal(brain.state, "suspicious", "a challenge before a fight");
  assert.ok(brain.barks.includes("noticed"));
  const roused = time;
  while (brain.state === "suspicious" && time < 10) {
    brain.think(0.1, plain, null);
    time += 0.1;
  }
  assert.equal(brain.state, "combat");
  assert.ok(time - roused >= 3, `the beat before the fight: ${(time - roused).toFixed(1)} s`);
});

test("a shot fired or a round past his head puts him in the fight at once; a lone wounded man gives up", () => {
  const brain = new ActorBrain();
  brain.think(0.1, quiet({ heard: { at: { x: 0, z: 30 }, loudness: 0.4, kind: "shot" } }), null);
  assert.equal(brain.state, "combat");
  assert.ok(brain.barks.includes("firstShot"));
  brain.think(0.1, quiet({ sight: 0.8, distance: 6, squadStanding: 1, health: 0.4 }), null);
  assert.equal(brain.state, "surrender");
  const commander = new ActorBrain(undefined, false);
  commander.alarm({ x: 0, z: 0 }, true);
  commander.think(0.1, quiet({ sight: 0.8, distance: 6, squadStanding: 1, health: 0.4 }), null);
  assert.equal(commander.state, "combat", "some never give up");
});

test("the radio sends the squad searching; a scripted man has no will of his own until released", () => {
  const brain = new ActorBrain();
  brain.alarm({ x: 5, z: 5 }, false);
  assert.equal(brain.state, "search");
  brain.script();
  const intent = brain.think(0.1, quiet({ sight: 1, distance: 3 }), { x: 1, z: 1 });
  assert.equal(brain.state, "scripted");
  assert.equal(intent.goal, null);
  brain.release();
  assert.equal(brain.state, "routine");
});

test("his health: a hit stays a wound past the quarter it reached, steadies after a while, and a bandage closes it", () => {
  const health = new PlayerHealth();
  health.hurt(40, 0);
  assert.equal(health.health, 60);
  for (let t = 0; t < 20; t += 0.1) health.update(0.1);
  assert.equal(health.health, 75, "steadied up to the next quarter, no further");
  health.bandages = 1;
  assert.ok(health.bandage());
  for (let t = 0; t < 4; t += 0.1) health.update(0.1);
  assert.equal(health.health, 100);
  assert.equal(health.bandages, 0);
  assert.equal(health.bandage(), false, "no bandage left");
  health.hurt(150, 1);
  assert.ok(health.dead);
});

test("a story condition holds only when all it asks is so, or any of its alternatives is", () => {
  const state = createCampaign();
  state.flags.push("m01_beacon_seen");
  const facts: Facts = {
    events: new Set(["shot"]),
    dialogueIdle: true,
    stepTime: () => 12,
    yacht: { x: 0, z: 0 },
    skipper: { x: 10, z: 0 },
    aboard: false,
    hull: 1,
    cutscene: false,
    place: (id) => (id === "stvor9:p01" ? { x: 12, z: 0, radius: 3 } : null),
    world: { inArea: (name) => name === "stvor9:archive", actor: (id) => (id === "mark" ? { x: 10, z: 5 } : null), alert: "suspicious", health: 0.4, still: 0, crouched: true },
  };
  const holds = (when: Parameters<typeof conditionHolds>[0]) => conditionHolds(when, state, facts, "m01", "infiltrate");
  assert.ok(holds({ flags: ["m01_beacon_seen"], steps: ["infiltrate"], stepTime: 10, quiet: true, event: "shot" }));
  assert.ok(!holds({ not: ["m01_beacon_seen"] }));
  assert.ok(holds({ area: "stvor9:archive", crouched: true, alert: "suspicious", health: 0.5 }));
  assert.ok(!holds({ alert: "combat" }));
  assert.ok(holds({ near: { at: "stvor9:p01", radius: 3 }, nearActor: { id: "mark", radius: 6 } }));
  assert.ok(!holds({ far: { at: "stvor9:p01", radius: 3 } }));
  assert.ok(holds({ any: [{ flags: ["nope"] }, { event: "shot" }] }));
  assert.ok(!holds({ any: [{ flags: ["nope"] }, { event: "rock" }] }));
  assert.ok(!conditionHolds({ area: "stvor9:archive" }, state, { ...facts, aboard: true }, "m01", "infiltrate"), "not in an area while at the wheel");
});
