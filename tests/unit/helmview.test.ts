import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { headSwingRate, helmViewQuaternion, STEADY_PITCH_SHARE, STEADY_ROLL_SHARE } from "../../src/simulator/camera/HelmView";
import { sampleOcean } from "../../src/simulator/environment/OceanMath";
import { VesselPhysics, type IslandPhysics, type OceanSampler } from "../../src/simulator/vessel/VesselPhysics";

const OPEN_WATER: IslandPhysics = {
  depthAt: () => 60,
  avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
  constrainToWater: () => false,
  nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
  shoreClearance: () => 1e6,
};

/** The yacht's attitude as `Vessel.update` sets it. */
function attitude(pitch: number, heading: number, roll: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, heading, -roll, "YXZ"));
}

/** Where a point of the helm station (in the yacht's frame, relative to the eye) is in the view, as angles off its centre (rad). */
function inView(view: THREE.Quaternion, yacht: THREE.Quaternion, point: THREE.Vector3): [number, number] {
  const p = point.clone().applyQuaternion(yacht).applyQuaternion(view.clone().invert());
  return [Math.atan2(p.x, -p.z), Math.atan2(p.y, -p.z)];
}

test("at the helm the station stands still in the view however quickly the yacht pitches, rolls and turns", () => {
  // The compass, half a metre ahead of the eye and a little below.
  const compass = new THREE.Vector3(0.1, -0.35, 0.55);
  const view = new THREE.Quaternion();
  // A slow swing the neck has taken out (constant here), and where he looks: down a little, off to one side.
  const slowPitch = 0.05;
  const slowRoll = -0.04;
  const still = inView(
    helmViewQuaternion(view, attitude(slowPitch, 0.7, slowRoll), slowPitch, slowRoll, STEADY_PITCH_SHARE, STEADY_ROLL_SHARE, 0.3, 0.18),
    attitude(slowPitch, 0.7, slowRoll),
    compass,
  );
  // The quick part: thrown about by a steep sea, at any heading.
  let random = 12345;
  const next = (): number => ((random = (random * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let sample = 0; sample < 400; sample += 1) {
    const yacht = attitude(slowPitch + next() * 0.3, next() * Math.PI, slowRoll + next() * 0.4);
    helmViewQuaternion(view, yacht, slowPitch, slowRoll, STEADY_PITCH_SHARE, STEADY_ROLL_SHARE, 0.3, 0.18);
    const [x, y] = inView(view, yacht, compass);
    assert.ok(Math.abs(x - still[0]) < 1e-9 && Math.abs(y - still[1]) < 1e-9, `the compass moved in the view (${x - still[0]}, ${y - still[1]})`);
  }
});

test("at the helm the neck keeps the horizon level over a slow swell", () => {
  const view = new THREE.Quaternion();
  const up = new THREE.Vector3();
  for (const [pitch, roll] of [[0.12, 0], [0, 0.15], [-0.1, -0.12], [0.08, 0.2]] as const) {
    // Her attitude and the slow swing are the same thing: all of it is slow.
    helmViewQuaternion(view, attitude(pitch, 1.1, roll), pitch, roll, STEADY_PITCH_SHARE, STEADY_ROLL_SHARE, 0, 0);
    up.set(0, 1, 0).applyQuaternion(view);
    const tilt = Math.acos(Math.min(1, up.y));
    const hers = Math.acos(Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(attitude(pitch, 1.1, roll)).y));
    assert.ok(tilt < hers * 0.12 + 0.004, `the view tilts ${tilt.toFixed(3)} rad with her ${hers.toFixed(3)}`);
    // And he faces where she heads.
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(view);
    assert.ok(Math.abs(Math.atan2(ahead.x, ahead.z) - 1.1) < 0.03);
  }
});

test("at full speed the helm station barely moves in the view from one frame to the next", () => {
  // The real sea and the real hull, flat out; the view as the camera builds it at 60 fps.
  const clock = { time: 0 };
  const ocean: OceanSampler = { sample: (x, z) => sampleOcean(x, z, clock.time) };
  const physics = new VesselPhysics(ocean, OPEN_WATER);
  const controls = { throttle: 1, rudder: 0, sailTrim: 1 };
  const delta = 1 / 60;
  const compass = new THREE.Vector3(0.1, -0.35, 0.55);
  const view = new THREE.Quaternion();
  let headPitch = Number.NaN;
  let headRoll = Number.NaN;
  let last: [number, number] | null = null;
  let worst = 0;
  let total = 0;
  let count = 0;
  let fastest = 0;
  for (let step = 0; step < 60 * 90; step += 1) {
    clock.time += delta;
    // (A touch of helm now and then, as when steering.)
    controls.rudder = Math.sin(clock.time * 0.4) * 0.25;
    physics.fixedUpdate(delta, controls, true);
    const swing = 1 - Math.exp(-headSwingRate(physics.telemetry.forwardSpeed) * delta);
    headPitch = Number.isFinite(headPitch) ? headPitch + (physics.pitch - headPitch) * swing : physics.pitch;
    headRoll = Number.isFinite(headRoll) ? headRoll + (physics.roll - headRoll) * swing : physics.roll;
    const yacht = attitude(physics.pitch, physics.heading, physics.roll);
    helmViewQuaternion(view, yacht, headPitch, headRoll, STEADY_PITCH_SHARE, STEADY_ROLL_SHARE, 0, 0.1);
    const now = inView(view, yacht, compass);
    fastest = Math.max(fastest, physics.telemetry.speedKnots);
    if (last && step > 60 * 25) {
      const moved = Math.hypot(now[0] - last[0], now[1] - last[1]);
      worst = Math.max(worst, moved);
      total += moved;
      count += 1;
    }
    last = now;
  }
  assert.ok(fastest > 14, `she was flat out (${fastest.toFixed(1)} kn)`);
  // On a 1080p screen (66° up and down) a pixel is about a milliradian.
  assert.ok(worst < 0.0008, `the station jumped ${(worst * 1000).toFixed(2)} mrad in one frame`);
  assert.ok(total / count < 0.0003, `the station drifts ${((total / count) * 1000).toFixed(2)} mrad a frame on average`);
});
