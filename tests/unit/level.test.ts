import assert from "node:assert/strict";
import test from "node:test";
import { CROUCHED_HEIGHT, LevelCollision, rayBox, STANDING_HEIGHT } from "../../src/simulator/level/LevelCollision";
import { inPadClearing, padDistance, padHeight, setTerrainPads } from "../../src/simulator/environment/TerrainPads";
import { levelPads } from "../../src/simulator/level/LevelSystem";

test("a walker stands on the highest floor not above his feet, and walks under an upper storey", () => {
  const level = new LevelCollision();
  level.addFloor({ x: 0, z: 0, halfX: 5, halfZ: 5, angle: 0, y: 1.2 });
  level.addFloor({ x: 0, z: 0, halfX: 5, halfZ: 5, angle: 0, y: 4.4 });
  // The upper storey's slab, 0.25 thick.
  level.addSolid({ x: 0, z: 0, halfX: 5, halfZ: 5, angle: 0, bottom: 4.15, top: 4.4 });
  assert.equal(level.floorAt(1, 1, 1.2), 1.2, "on the ground floor");
  assert.equal(level.floorAt(1, 1, 4.4), 4.4, "upstairs");
  assert.equal(level.floorAt(1, 1), 4.4, "from above: the top");
  assert.equal(level.floorAt(7, 0, 1.2), Number.NEGATIVE_INFINITY, "off the building");
  assert.equal(level.blocked(1, 1, 1.2), false, "the slab is well over his head");
  assert.equal(level.blocked(1, 1, 4.4), false, "and under his feet upstairs");
  assert.ok(Math.abs(level.headroom(1, 1, 1.2) - 2.95) < 1e-9);
});

test("a stair is a ramp underfoot, and a culvert's roof wants a crouch", () => {
  const level = new LevelCollision();
  // Rising 3 m along its own +x over 6 m, turned to run along world +z.
  level.addFloor({ x: 0, z: 3, halfX: 3, halfZ: 0.6, angle: Math.PI / 2, y: 0, rise: 3 });
  assert.ok(Math.abs(level.floorAt(0, 0.0, 0) - 0) < 1e-9, "the foot");
  assert.ok(Math.abs(level.floorAt(0, 3, 1.4) - 1.5) < 1e-9, "half way");
  assert.ok(Math.abs(level.floorAt(0, 6, 2.9) - 3) < 1e-9, "the head");
  // A culvert: a roof 1.3 m over the floor.
  level.addSolid({ x: 20, z: 0, halfX: 1, halfZ: 4, angle: 0, bottom: 1.3, top: 1.6 });
  assert.equal(level.blocked(20, 0, 0, 0.3, STANDING_HEIGHT), true, "standing, he does not fit");
  assert.equal(level.blocked(20, 0, 0, 0.3, CROUCHED_HEIGHT), false, "crouched, he does");
});

test("walls keep a body out at its radius; a low kerb is stepped over", () => {
  const level = new LevelCollision();
  level.addSolid({ x: 0, z: 0, halfX: 2, halfZ: 0.1, angle: 0, bottom: 0, top: 3 });
  level.addSolid({ x: 10, z: 0, halfX: 2, halfZ: 0.1, angle: 0, bottom: 0, top: 0.2 });
  assert.equal(level.blocked(0, 0.35, 0), true);
  assert.equal(level.blocked(0, 0.45, 0), false);
  assert.equal(level.blocked(10, 0, 0), false, "a kerb");
  // Turned 90°: the wall now runs along z.
  const turned = new LevelCollision();
  turned.addSolid({ x: 0, z: 0, halfX: 2, halfZ: 0.1, angle: Math.PI / 2, bottom: 0, top: 3 });
  assert.equal(turned.blocked(0, 1.5, 0), true);
  assert.equal(turned.blocked(1.5, 0, 0), false);
});

test("sight passes through glass and windows, not walls; rounds stop at what stops them", () => {
  const level = new LevelCollision();
  // A wall with a window: wall pieces either side and below/above the gap.
  level.addSolid({ x: -2, z: 0, halfX: 1.5, halfZ: 0.1, angle: 0, bottom: 0, top: 3 });
  level.addSolid({ x: 2, z: 0, halfX: 1.5, halfZ: 0.1, angle: 0, bottom: 0, top: 3 });
  level.addSolid({ x: 0, z: 0, halfX: 0.5, halfZ: 0.1, angle: 0, bottom: 0, top: 1 });
  level.addSolid({ x: 0, z: 0, halfX: 0.5, halfZ: 0.1, angle: 0, bottom: 2.2, top: 3 });
  assert.equal(level.canSee(0, 1.6, -5, 0, 1.6, 5), true, "through the window");
  assert.equal(level.canSee(-2, 1.6, -5, -2, 1.6, 5), false, "through the wall");
  assert.equal(level.canSee(0, 0.5, -5, 0, 0.5, 5), false, "under the sill");
  level.addSolid({ x: 0, z: 10, halfX: 3, halfZ: 0.02, angle: 0, bottom: 0, top: 3, opaque: false, stopsRounds: true, material: "glass" });
  assert.equal(level.canSee(0, 1.6, 5, 0, 1.6, 15), true, "through the glass");
  const hit = level.raycast(0, 1.6, 5, 0, 0, 1, 20);
  assert.ok(hit && Math.abs(hit.z - 9.98) < 1e-6 && hit.solid.material === "glass", "the round stops at the armoured glass");
  assert.ok(hit && Math.abs(hit.normalZ + 1) < 1e-9, "struck on its near face");
  const box = { x: 0, z: 0, halfX: 1, halfZ: 1, angle: 0.3, bottom: 0, top: 2 };
  assert.equal(rayBox(box, 5, 1, 5, 1, 0, 0, 10), null, "a ray going away");
  assert.ok(rayBox(box, -5, 1, 0, 1, 0, 0, 10), "a ray going through");
});

test("cover: a low wall between a crouching body and a shooter", () => {
  const level = new LevelCollision();
  level.addSolid({ x: 0, z: 1, halfX: 1, halfZ: 0.2, angle: 0, bottom: 0, top: 1, cover: true });
  assert.equal(level.covered(0, 0, 0, 0, 20), true);
  assert.equal(level.covered(0, 0, 0, 0, -20), false, "the shooter on the same side");
});

test("terrain pads level the ground, blend back to it and keep it clear", () => {
  setTerrainPads([{ id: "yard", x: 100, z: 50, halfX: 10, halfZ: 5, angle: 0, height: 1.2, blend: 4, clear: 3 }]);
  assert.ok(Math.abs(padHeight(100, 50, 5) - 1.2) < 1e-9, "inside: the pad's height");
  assert.equal(padHeight(150, 50, 5), 5, "far: the natural ground");
  const edge = padHeight(112, 50, 5);
  assert.ok(edge > 1.2 && edge < 5, "between, on the slope");
  assert.equal(inPadClearing(111, 50), true);
  assert.equal(inPadClearing(114, 50), false);
  assert.ok(Math.abs(padDistance({ id: "a", x: 0, z: 0, halfX: 2, halfZ: 1, angle: Math.PI / 2, height: 0, blend: 1 }, 0, 3) - 1) < 1e-9, "turned 90°");
  setTerrainPads([]);
  // A level's pads in the world: a pad 10 m forward of a level facing east lies 10 m east (world x = −east).
  const pads = levelPads([{ id: "l", frame: { x: 0, z: 0, y: 0, bearing: 90 }, pads: [{ at: [0, 10], w: 4, d: 2, height: 1 }], build: () => undefined }]);
  assert.ok(Math.abs(pads[0]!.x + 10) < 1e-9 && Math.abs(pads[0]!.z) < 1e-9);
});
