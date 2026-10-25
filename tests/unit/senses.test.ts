import assert from "node:assert/strict";
import test from "node:test";
import { onboardLevel, onboardWet } from "../../src/simulator/audio/AudioSystem";
import { approachValue, hornHarmonic, hornLength } from "../../src/simulator/audio/HornSynth";
import { BELL_PRIME } from "../../src/simulator/audio/BellSynth";
import { FlareCamera, FLARE_SHOT_DISTANCE, FLARE_SHOT_HOLD, FLARE_SHOT_RETURN } from "../../src/simulator/camera/FlareCamera";
import { FLARE_APEX, FLARE_RISE, flarePosition, type FlareLaunch } from "../../src/simulator/effects/FlareMath";
import { LOW_PASS_HALF, lowPassPose, planLowPass, seeded, STUNT_ROLL, stuntRollAngle, stuntSmokeOn, type AircraftPose } from "../../src/simulator/aircraft/AircraftMath";
import { angleDifference, gravityRollDegrees, wheelToRudder } from "../../app/components/steering";

// --- Horn and bell ------------------------------------------------------------

test("the yacht's horn is a marine horn: low, with its strength in the tube's band, not a bright two-tone beep", () => {
  const fundamental = 146.8;
  const formant = 560;
  const level = (n: number) => hornHarmonic(n, fundamental, formant);
  // Below the flare cut-off the horn barely radiates: the fundamental is weaker than the harmonics around the formant.
  assert.ok(level(1) < level(3) && level(1) < level(4), "fundamental below the formant harmonics");
  // The strongest harmonic sits in the tube's band (350–800 Hz).
  let best = 1;
  for (let n = 1; n <= 40; n += 1) if (level(n) > level(best)) best = n;
  const peak = best * fundamental;
  assert.ok(peak > 350 && peak < 800, `strongest partial at ${peak.toFixed(0)} Hz`);
  // The top rolls off.
  assert.ok(level(35) < level(4) * 0.1);
  // A call lasts its blasts plus the release.
  assert.ok(Math.abs(hornLength({ blasts: [{ offset: 0, duration: 2.4 }], release: 0.4 }) - 3.6) < 1e-9);
  assert.ok(Math.abs(approachValue(0, 1, 1e9, 0.2) - 1) < 1e-9 && approachValue(0, 1, 0, 0.2) === 0);
});

test("the bell and the horn are heard from where they are on the yacht", () => {
  // Full level standing at the helm, smaller from the chase camera, faint from far off.
  assert.ok(onboardLevel(5, 5) > 0.99);
  assert.ok(onboardLevel(18, 5) < 0.35 && onboardLevel(18, 5) > 0.2);
  assert.ok(onboardLevel(120, 5) < 0.05);
  assert.ok(onboardLevel(0, 5) <= 1.25, "never blown up by a camera at the bell");
  // The farther, the more of it is sea echo.
  assert.ok(onboardWet(150) > onboardWet(20) && onboardWet(20) > onboardWet(2));
  // A small bronze bell: the strike note (an octave above the prime) is in the upper register.
  assert.ok(BELL_PRIME * 2 > 1000 && BELL_PRIME * 2 < 2200);
});

// --- Tilt steering -------------------------------------------------------------

test("turning the phone like a wheel steers, in portrait and in landscape, upright or tilted back", () => {
  const g = 9.81;
  for (const screen of [0, 90, 270]) {
    for (const back of [0, 35]) {
      // Gravity's reaction in device axes for a phone turned clockwise by `turn` degrees, held at `screen`.
      const reading = (turn: number) => {
        const inPlane = g * Math.cos((back * Math.PI) / 180);
        // In screen axes "up" leans to the left when the phone turns clockwise.
        const sx = -inPlane * Math.sin((turn * Math.PI) / 180);
        const sy = inPlane * Math.cos((turn * Math.PI) / 180);
        // Screen axes back to device axes.
        const theta = (screen * Math.PI) / 180;
        return { ax: sx * Math.cos(theta) - sy * Math.sin(theta), ay: sx * Math.sin(theta) + sy * Math.cos(theta) };
      };
      const neutral = gravityRollDegrees(reading(0).ax, reading(0).ay, screen)!;
      const right = gravityRollDegrees(reading(20).ax, reading(20).ay, screen)!;
      const left = gravityRollDegrees(reading(-20).ax, reading(-20).ay, screen)!;
      assert.ok(wheelToRudder(right, neutral) > 0.5, `screen ${screen}, back ${back}: a right turn steers right`);
      assert.ok(wheelToRudder(left, neutral) < -0.5, `screen ${screen}, back ${back}: a left turn steers left`);
      assert.equal(wheelToRudder(neutral, neutral), 0);
      // iOS reports the opposite sign: the steering is the same.
      const flipped = gravityRollDegrees(-reading(20).ax, -reading(20).ay, screen)!;
      const flippedNeutral = gravityRollDegrees(-reading(0).ax, -reading(0).ay, screen)!;
      assert.ok(Math.abs(wheelToRudder(flipped, flippedNeutral) - wheelToRudder(right, neutral)) < 1e-9);
    }
  }
  // A phone lying flat gives no wheel angle at all.
  assert.equal(gravityRollDegrees(0.4, 0.3, 0), null);
  assert.ok(Math.abs(angleDifference(-175, 175) - 10) < 1e-9);
});

// --- The flare shot --------------------------------------------------------------

test("the camera pulls back 70–95 m to show a flare climb to its apex and sink a little, then hands back", () => {
  const launch: FlareLaunch = { x: 10, y: 3, z: -4, leanX: 1, leanZ: 0, windX: 5, windZ: 0, seed: 1 };
  const shot = new FlareCamera();
  shot.start(launch, { x: 10, z: 30 }, 0);
  const flat = () => 0;
  let apexSeen = false;
  let maxBlend = 0;
  let time = 0;
  while (shot.running && time < 20) {
    shot.update(1 / 30, flat);
    time += 1 / 30;
    maxBlend = Math.max(maxBlend, shot.blend);
    const distance = Math.hypot(shot.shot.position.x - launch.x, shot.shot.position.z - launch.z);
    if (shot.blend > 0.5) assert.ok(distance > FLARE_SHOT_DISTANCE.start * 0.95 && distance < FLARE_SHOT_DISTANCE.end * 1.2, `camera ${distance.toFixed(0)} m out`);
    // On the side the normal camera was on (+Z here), square to the lean (+X).
    if (shot.blend > 0.5) assert.ok(shot.shot.position.z > launch.z + 50);
    if (time > FLARE_RISE && time < FLARE_SHOT_HOLD) {
      // Looking up at the flare: the aim follows it to within a few degrees.
      const flare = flarePosition(launch, time, { x: 0, y: 0, z: 0 });
      apexSeen ||= flare.y - launch.y > FLARE_APEX * 0.95;
      const aim = shot.shot.target;
      const eye = shot.shot.position;
      const toFlare = Math.atan2(flare.y - eye.y, Math.hypot(flare.x - eye.x, flare.z - eye.z));
      const toAim = Math.atan2(aim.y - eye.y, Math.hypot(aim.x - eye.x, aim.z - eye.z));
      assert.ok(Math.abs(toFlare - toAim) < 0.3, `aim off by ${(toFlare - toAim).toFixed(2)} rad at ${time.toFixed(1)} s`);
    }
  }
  assert.ok(apexSeen, "the shot holds through the apex");
  assert.ok(maxBlend > 0.99, "fully on the flare");
  assert.ok(!shot.running && time < FLARE_SHOT_HOLD + FLARE_SHOT_RETURN + 0.2, "then the normal camera is back");

  // A drag by the player gives the camera straight back.
  const cancelled = new FlareCamera();
  cancelled.start(launch, { x: 0, z: 0 }, 0);
  for (let step = 0; step < 30; step += 1) cancelled.update(1 / 30, flat);
  cancelled.cancel();
  for (let step = 0; step < Math.ceil((FLARE_SHOT_RETURN + 0.1) * 30); step += 1) cancelled.update(1 / 30, flat);
  assert.ok(!cancelled.running);
});

// --- The aerobatic plane -------------------------------------------------------

test("the aerobatic plane flies low and fast past the yacht and rolls right round as it passes, trailing smoke", () => {
  const random = seeded(12);
  const pass = planLowPass(0, 0, random, "stunt");
  assert.ok(pass.altitude >= 45 && pass.altitude <= 70 && pass.speed > 70);
  const pose: AircraftPose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, bank: 0, vx: 0, vy: 0, vz: 0 };
  const closest = LOW_PASS_HALF / pass.speed;
  // Level before and after, one full roll through the middle.
  lowPassPose(pass, closest - 6, pose);
  assert.ok(Math.abs(pose.bank) < 0.01 && Math.abs(pose.y - pass.altitude) < 0.5);
  lowPassPose(pass, closest, pose);
  assert.ok(Math.abs(Math.abs(pose.bank) - Math.PI) < 0.05, "inverted at the top of the roll");
  assert.ok(pose.y > pass.altitude + STUNT_ROLL.radius * 1.9, "the corkscrew carries it up and over");
  lowPassPose(pass, closest + 6, pose);
  assert.ok(Math.abs(Math.abs(pose.bank) - Math.PI * 2) < 0.01, "a full turn when it levels out");
  assert.ok(Math.abs(stuntRollAngle(pass, -1e4)) < 1e-9 && Math.abs(stuntRollAngle(pass, 1e4) - Math.PI * 2) < 1e-9);
  // Its distance from the yacht at the roll: close enough to see.
  lowPassPose(pass, closest, pose);
  const distance = Math.hypot(pose.x, pose.z);
  assert.ok(distance > 100 && distance < 300, `${distance.toFixed(0)} m off`);
  // Smoke on round the roll, off at the ends of the pass.
  assert.ok(stuntSmokeOn(pass, closest) && !stuntSmokeOn(pass, 1));
  // Speed along the corkscrew stays continuous (no jumps in the velocity).
  let previous = Number.NaN;
  for (let t = closest - 4; t < closest + 4; t += 0.05) {
    lowPassPose(pass, t, pose);
    const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
    if (Number.isFinite(previous)) assert.ok(Math.abs(speed - previous) < 3, "smooth speed through the roll");
    previous = speed;
  }
});
