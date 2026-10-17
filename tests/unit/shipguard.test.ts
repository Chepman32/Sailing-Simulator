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
