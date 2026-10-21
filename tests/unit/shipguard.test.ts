import assert from "node:assert/strict";
import test from "node:test";
import { createShip, nearestHullClearance, shipHullDistance, type Ship } from "../../src/simulator/ships/ShipMath";
import type { OceanSampler } from "../../src/simulator/vessel/VesselPhysics";
import { VesselPhysics, type IslandPhysics } from "../../src/simulator/vessel/VesselPhysics";

const CALM: OceanSampler = { sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) };
const OPEN_WATER: IslandPhysics = {
  depthAt: () => 18,
  avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
  constrainToWater: () => false,
  nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
  shoreClearance: () => 1000,
};

/** A big ship at the origin, bow to +Z, at anchor (so she is a wall that does not move). */
function wall(): Ship {
  const ship = createShip("container", () => 0.5);
  Object.assign(ship, { x: 0, z: 0, heading: 0, speed: 0, active: true, anchored: true });
  return ship;
}

test("the hull clearance is the distance off the side, with the normal pointing out", () => {
  const ship = wall();
  const normal = { x: 0, z: 0 };
  const distance = nearestHullClearance([ship], ship.halfBeam + 7, 0, normal);
  assert.ok(Math.abs(distance - 7) < 0.01);
  assert.ok(normal.x > 0.99, "the starboard side faces +X");
  assert.ok(nearestHullClearance([ship], 5000, 0, normal) > 1000, "a far ship is no obstacle");
  assert.equal(nearestHullClearance([{ ...ship, active: false }], ship.halfBeam + 1, 0, normal), 1e6);
});

test("the yacht turns away from a ship's side by herself instead of running into it or lying against it", () => {
  for (const throttle of [0.8, 0]) {
    const ship = wall();
    const physics = new VesselPhysics(CALM, OPEN_WATER);
    physics.hullClearance = (x, z, normal) => nearestHullClearance([ship], x, z, normal);
    // 60 m off her starboard side, heading straight at it.
    physics.position.set(ship.halfBeam + 60, physics.position.y, 0);
    physics.heading = -Math.PI / 2;
    physics.velocity.set(-4, 0, 0);
    const controls = { throttle, rudder: 0, sailTrim: 1 };
    let closest = Infinity;
    for (let step = 0; step < 90 * 60; step += 1) {
      physics.fixedUpdate(1 / 60, controls, true);
      closest = Math.min(closest, shipHullDistance(ship, physics.position.x, physics.position.z));
    }
    assert.ok(closest > 0.5, `never touched the hull (closest ${closest.toFixed(1)} m, throttle ${throttle})`);
    const end = shipHullDistance(ship, physics.position.x, physics.position.z);
    assert.ok(end > 12 || physics.guard.active === false, `drew off the side (${end.toFixed(1)} m)`);
  }
});

test("a yacht lying against a ship's side gets away", () => {
  const ship = wall();
  const physics = new VesselPhysics(CALM, OPEN_WATER);
  physics.hullClearance = (x, z, normal) => nearestHullClearance([ship], x, z, normal);
  physics.position.set(ship.halfBeam + 2.2, physics.position.y, 40);
  physics.heading = -Math.PI / 2;
  const controls = { throttle: 0.6, rudder: 0, sailTrim: 1 };
  for (let step = 0; step < 40 * 60; step += 1) physics.fixedUpdate(1 / 60, controls, true);
  assert.ok(shipHullDistance(ship, physics.position.x, physics.position.z) > 8, "she is off the hull");
});

import { createShoreGuard, STALL_SECONDS, updateShoreGuard } from "../../src/simulator/vessel/ShoreGuard";
import { START_POSITION } from "../../src/simulator/vessel/VesselPhysics";
import { shoreClearance } from "../../src/simulator/environment/IslandMath";

// A straight coast along z: the beach is x < 0, the open sea +x.
const straightCoast = (x: number, _z: number, normal: { x: number; z: number }): number => {
  normal.x = 1;
  normal.z = 0;
  return x;
};

test("the shore guard turns the short way out to sea when the helmsman does", () => {
  const guard = createShoreGuard();
  // Close in, bow angled at the beach, the guard committed to the long way round.
  const body = { position: { x: 8, z: 0 }, velocity: { x: -1.2, z: -0.4 }, heading: -1.3, yawRate: 0 };
  updateShoreGuard(guard, body, { throttle: 1, rudder: 0, sailTrim: 1 }, true, straightCoast, 1 / 60);
  assert.ok(guard.active, "the guard should take the helm this close");
  guard.turnSide = -1;
  // Seaward (+x) is a turn to starboard from here; the helmsman asks for it.
  updateShoreGuard(guard, body, { throttle: 1, rudder: 1, sailTrim: 1 }, true, straightCoast, 1 / 60);
  assert.equal(guard.turnSide, 1);
});

test("a guard manoeuvre that makes no way out to sea gives up the long turn", () => {
  const guard = createShoreGuard();
  const body = { position: { x: 8, z: 0 }, velocity: { x: -0.3, z: -0.2 }, heading: -1.3, yawRate: 0 };
  updateShoreGuard(guard, body, { throttle: 0.4, rudder: 0, sailTrim: 1 }, true, straightCoast, 1 / 60);
  assert.ok(guard.active);
  guard.turnSide = -1;
  // Held in place (as against a beach), the player not steering.
  for (let step = 0; step < (STALL_SECONDS + 1) * 60; step += 1) {
    updateShoreGuard(guard, body, { throttle: 0.4, rudder: 0, sailTrim: 1 }, true, straightCoast, 1 / 60);
    if (!guard.active) break;
  }
  assert.ok(guard.turnSide === 1 || guard.backing, "the guard must change its plan, not creep along the beach");
});

test("the yacht starts in open water with the islands ahead", () => {
  const normal = { x: 0, z: 1 };
  assert.ok(shoreClearance(START_POSITION.x, START_POSITION.z, normal) > 200, "too close to a beach at the start");
  // Heading 0 (+z): an island within sight ahead.
  let ahead = Infinity;
  for (let run = 0; run < 900; run += 10) ahead = Math.min(ahead, shoreClearance(START_POSITION.x, START_POSITION.z + run, normal));
  assert.ok(ahead < 60, "no island ahead of the start");
});
