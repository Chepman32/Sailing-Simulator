import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DeckField } from "../../src/simulator/diver/DeckField";
import {
  airUse,
  createSwimState,
  DIVE_DEPTH,
  hullDistance,
  isFloating,
  minutesLeft,
  refillAir,
  SEABED_CLEARANCE,
  stepSwim,
  SURFACE_EYE,
  type SwimInput,
  type SwimWorld,
} from "../../src/simulator/diver/DiverMath";

const calm: SwimWorld = { surface: () => 0, seabedDepth: () => 12 };
const wavy = (time: { t: number }): SwimWorld => ({ surface: (x) => 0.6 * Math.sin(x * 0.2 + time.t * 1.1), seabedDepth: () => 12 });
const still = (patch: Partial<SwimInput> = {}): SwimInput => ({ moveX: 0, moveY: 0, vertical: 0, sprint: false, yaw: 0, pitch: 0, ...patch });

function run(world: SwimWorld, input: SwimInput, seconds: number, state = createSwimState(0, SURFACE_EYE, 0), tick?: (t: number) => void) {
  let depth = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    tick?.(t);
    depth = stepSwim(state, input, world, 1 / 60);
  }
  return { state, depth };
}

test("a swimmer floats with his head out and rides the waves", () => {
  const time = { t: 0 };
  const world = wavy(time);
  const state = createSwimState(3, world.surface(3, 0) + SURFACE_EYE, 0);
  let worst = 0;
  run(world, still(), 20, state, (t) => {
    time.t = t;
    if (t > 3) worst = Math.max(worst, Math.abs(state.y - (world.surface(state.x, state.z) + SURFACE_EYE)));
  });
  assert.ok(worst < 0.12, `eyes strayed ${worst.toFixed(2)} m from the float line`);
  assert.equal(state.air, 1, "no air from the tank at the surface");
});

test("he swims level at the surface where he faces, and dives when asked or when he ducks", () => {
  const ahead = run(calm, still({ moveY: 1, yaw: Math.PI / 2 }), 6).state;
  assert.ok(ahead.x > 4 && Math.abs(ahead.z) < 0.2, "swims along +X when facing it");
  assert.ok(Math.abs(ahead.y - SURFACE_EYE) < 0.05, "stays at the surface");
  const down = run(calm, still({ vertical: -1 }), 4).state;
  assert.ok(-down.y > 3, `sinks on purpose (${(-down.y).toFixed(1)} m)`);
  const duck = run(calm, still({ moveY: 1, pitch: -0.9 }), 5).state;
  assert.ok(-duck.y > 3, "a duck dive takes him down");
  assert.equal(isFloating(0.1, still({ moveY: 1, pitch: -0.9 }), false), false);
});

test("under water he is neutral, swims along his line of sight, and never goes through the sand or out of the sea", () => {
  const state = createSwimState(0, -5, 0);
  run(calm, still(), 10, state);
  assert.ok(Math.abs(state.y + 5) < 0.2, "neutral buoyancy: he stays at his depth");
  run(calm, still({ moveY: 1, pitch: -1.2, sprint: true }), 15, state);
  assert.ok(state.y >= -12 + SEABED_CLEARANCE - 1e-6, "kept off the sand");
  run(calm, still({ moveY: 1, pitch: 1.2, sprint: true }), 20, state);
  assert.ok(state.y <= SURFACE_EYE + 0.081, "never above the water");
});

test("the tank drains faster at depth, is refilled aboard, and an empty one brings him up", () => {
  assert.equal(airUse(0, false), 0);
  assert.ok(airUse(20, false) > airUse(5, false) * 1.9, "three atmospheres at twenty metres");
  assert.ok(airUse(10, true) > airUse(10, false));
  assert.ok(minutesLeft(1, 0) > 40 && minutesLeft(1, 20) < 20);
  assert.equal(refillAir(0.2, 10), 1);
  const state = createSwimState(0, -10, 0, 0.0001);
  run(calm, still({ vertical: -1 }), 40, state);
  assert.ok(state.y > -DIVE_DEPTH, `an empty tank brings him up (at ${state.y.toFixed(1)} m)`);
});

test("the hulls push a swimmer off", () => {
  const normal = { x: 0, z: 0 };
  const inside = hullDistance(1.71, 0, 1.71, 0.34, 4.32, 0.46, normal);
  assert.ok(inside < 0);
  const between = hullDistance(0, 0, 1.71, 0.34, 4.32, 0.46, normal);
  assert.ok(between > 1, "between the hulls is open water");
  const astern = hullDistance(1.71, -6, 1.71, 0.34, 4.32, 0.46, normal);
  assert.ok(astern > 1 && normal.z < -0.9, "astern the push is aft");
});

test("the deck field finds floors, steps, walls and the sea", () => {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 6).rotateX(-Math.PI / 2));
  floor.position.y = 0.6;
  const step = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  step.position.set(1, 0.9, 0);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2));
  roof.position.set(-1, 2.8, 1);
  const cabin = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  cabin.position.set(-1, 1.6, -2);
  root.add(floor, step, roof, cabin);
  const field = new DeckField(root);
  const plain = field.floor(0.5, 1.5, 0.6, 0.42);
  assert.ok(plain.found && Math.abs(plain.height - 0.6) < 0.01);
  const up = field.floor(1, 0, 0.6, 0.42);
  assert.ok(up.found && Math.abs(up.height - 0.9) < 0.01, "a step up is taken");
  const underRoof = field.floor(-1, 1, 0.6, 0.42);
  assert.ok(underRoof.found && Math.abs(underRoof.height - 0.6) < 0.01, "under the hardtop the sole is the floor");
  const wall = field.floor(-1, -2, 0.6, 0.42);
  assert.ok(!wall.found && wall.wall, "the cabin is a wall from the deck");
  const sea = field.floor(5, 0, 0.6, 0.42);
  assert.ok(!sea.found && !sea.wall, "beyond the deck is the sea");
});

test("the diver HUD is translated into every interface language", async () => {
  const { LANGUAGE_OPTIONS } = await import("../../app/components/i18n");
  const { getDiverMessages, DIVER_LANGUAGES } = await import("../../app/components/diverMessages");
  assert.equal(DIVER_LANGUAGES.length, LANGUAGE_OPTIONS.length);
  const required = Object.keys(getDiverMessages("en")).filter((key) => key !== "metres" && key !== "bar");
  for (const { code } of LANGUAGE_OPTIONS) {
    const messages = getDiverMessages(code) as Record<string, string | undefined>;
    for (const key of required) assert.ok(messages[key] && messages[key]!.length > 0, `${code}.${key}`);
  }
});
