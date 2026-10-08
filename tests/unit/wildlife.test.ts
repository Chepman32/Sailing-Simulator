import assert from "node:assert/strict";
import test from "node:test";
import { waterDepthAt } from "../../src/simulator/environment/IslandMath";
import { OCEAN_WAVES, sampleOcean, surfaceBasePoint } from "../../src/simulator/environment/OceanMath";
import { surfaceImpactLife, surfaceImpactShape } from "../../src/simulator/environment/SurfaceImpacts";
import { calculateSplashProfile } from "../../src/simulator/vessel/WakeSystem";
import {
  canCommitToLeap,
  createDolphinPod,
  DOLPHIN_FLUKE,
  YACHT_HULL_BOX,
  DOLPHIN_LEAP_ENTRY_SPEED,
  DOLPHIN_LEAP_MIN_SPEED,
  DOLPHIN_PLAY_VESSEL_SPEED,
  DOLPHIN_ROSTRUM,
  dolphinPoint,
  stepDolphinPod,
  type DolphinPhase,
} from "../../src/simulator/wildlife/DolphinBehavior";
import {
  createSharkAgent,
  SHARK_DORSAL_TIP,
  SHARK_LIMITS,
  SHARK_UNDER_KEEL_DEPTH,
  stepShark,
  type SharkPhase,
} from "../../src/simulator/wildlife/SharkBehavior";
import {
  createSwimmer3D,
  stepSwimmerAtDepth,
  turnRateLimit,
  type DepthControl,
} from "../../src/simulator/wildlife/SwimmerDynamics";
import {
  contactIntensity,
  CONTACT_MASS,
  surfaceCrossing,
  SurfacePoint,
  type MarineWorld,
  type VesselState,
} from "../../src/simulator/wildlife/WaterContact";
import {
  createWhaleAgent,
  stepWhale,
  WHALE_DORSAL_HEIGHT,
  WHALE_SHALLOWEST_DEPTH,
  WHALE_SLAP_COOLDOWN,
  whaleDorsalHeight,
  whalePose,
  whaleTailPoints,
  whaleWorldY,
  type WhalePhase,
} from "../../src/simulator/wildlife/WhaleBehavior";

/** Deterministic random numbers for repeatable behaviour runs. */
function seeded(seed: number): () => number {
  let state = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** The real sea and bathymetry, at a clock the test advances. */
function liveWorld(): { world: MarineWorld; clock: { time: number } } {
  const clock = { time: 0 };
  return {
    clock,
    world: {
      surfaceHeight: (x, z) => sampleOcean(x, z, clock.time).height,
      orbitalHeight: (x, z, depth) => sampleOcean(x, z, clock.time, depth).height,
      seabedDepth: waterDepthAt,
    },
  };
}

function advanceVessel(vessel: VesselState, delta: number): void {
  vessel.x += Math.sin(vessel.heading) * vessel.speed * delta;
  vessel.z += Math.cos(vessel.heading) * vessel.speed * delta;
}

// --- Shared water surface ----------------------------------------------------

test("the CPU sampler returns the height of the displaced Gerstner surface actually drawn", () => {
  const time = 37.25;
  for (const [x, z] of [
    [3, -7],
    [41.5, 12],
    [-220, 310],
  ] as const) {
    // Displace a base point exactly as the vertex shader does …
    let offsetX = 0;
    let offsetZ = 0;
    let height = 0;
    for (const wave of OCEAN_WAVES) {
      const length = Math.hypot(wave.directionX, wave.directionZ);
      const dx = wave.directionX / length;
      const dz = wave.directionZ / length;
      const k = (Math.PI * 2) / wave.wavelength;
      const phase = k * (dx * x + dz * z) - Math.sqrt(9.81 * k) * wave.speed * time;
      offsetX += dx * wave.steepness * wave.amplitude * Math.cos(phase);
      offsetZ += dz * wave.steepness * wave.amplitude * Math.cos(phase);
      height += wave.amplitude * Math.sin(phase);
    }
    // … then sample where that vertex ended up.
    const sample = sampleOcean(x + offsetX, z + offsetZ, time);
    assert.ok(Math.abs(sample.height - height) < 0.01, `height mismatch ${sample.height} vs ${height}`);
    const base = { x: 0, z: 0 };
    surfaceBasePoint(x + offsetX, z + offsetZ, time, base);
    assert.ok(Math.hypot(base.x - x, base.z - z) < 0.01);
  }
});

test("wave motion fades with depth, so deep swimmers are not bobbed by the swell", () => {
  let surfaceRange = 0;
  let deepRange = 0;
  for (let time = 0; time < 30; time += 0.25) {
    surfaceRange = Math.max(surfaceRange, Math.abs(sampleOcean(10, 20, time).height));
    deepRange = Math.max(deepRange, Math.abs(sampleOcean(10, 20, time, 10).height));
  }
  assert.ok(surfaceRange > 0.4);
  assert.ok(deepRange < surfaceRange * 0.35, `at 10 m the water still moves ${deepRange} m`);
});

test("impact ring waves travel outward, stay gentle, and leave a slick that fades", () => {
  const strength = 5;
  const early = surfaceImpactShape(3, 1, strength);
  const later = surfaceImpactShape(3, 6, strength);
  assert.ok(later.front > early.front, "the ring expands");
  let steepest = 0;
  for (let radius = 0; radius < 40; radius += 0.2) {
    for (let age = 0.1; age < surfaceImpactLife(strength); age += 0.5) {
      steepest = Math.max(steepest, Math.abs(surfaceImpactShape(radius, age, strength).slope));
    }
  }
  assert.ok(steepest > 0.05 && steepest < 0.6, `ring slope ${steepest}`);
  assert.ok(surfaceImpactShape(0.5, 4, strength).calm > 0.5, "the footprint is glassy");
  assert.equal(surfaceImpactShape(1, surfaceImpactLife(strength) + 0.1, strength).calm, 0);
  assert.ok(surfaceImpactLife(5) > surfaceImpactLife(1), "a whale's rings outlast a dolphin's");
});

// --- Contact with the surface ------------------------------------------------

test("surface crossings are detected once, without flicker at the waterline", () => {
  let state = { submerged: true, crossing: null as ReturnType<typeof surfaceCrossing>["crossing"] };
  let crossings = 0;
  for (let step = 0; step < 200; step += 1) {
    state = surfaceCrossing(state.submerged, Math.sin(step) * 0.02);
    if (state.crossing) crossings += 1;
  }
  assert.equal(crossings, 0, "a fin riding the waterline must not splash every frame");
  const point = new SurfacePoint();
  const events: string[] = [];
  for (let step = 0; step <= 100; step += 1) {
    // A slow rise through the surface and back down, a few millimetres a frame.
    const crossing = point.update(-0.2 + step * 0.006 - Math.max(0, step - 60) * 0.012, 0, 1 / 60);
    if (crossing) events.push(crossing);
  }
  assert.deepEqual(events, ["exit", "entry"]);
});

test("splash energy grows with mass and speed: a fluke slap dwarfs a dolphin re-entry", () => {
  const dolphin = contactIntensity(CONTACT_MASS.dolphin, 9);
  const fluke = contactIntensity(CONTACT_MASS.whaleFluke, 8);
  assert.ok(dolphin > 0.8 && dolphin < 2.5, `dolphin entry ${dolphin}`);
  assert.ok(fluke > 3.5 && fluke <= 6, `fluke slap ${fluke}`);
  assert.ok(contactIntensity(CONTACT_MASS.dolphin, 5) < dolphin);
  assert.equal(contactIntensity(500, 0), 0);

  const entry = calculateSplashProfile(dolphin, "entry");
  const slap = calculateSplashProfile(fluke, "slap");
  const breath = calculateSplashProfile(0.3, "breath");
  const blow = calculateSplashProfile(3, "blow");
  assert.ok(slap.dropletCount >= entry.dropletCount * 2.5);
  assert.ok(slap.ringCount >= 7 && slap.foamPatchCount >= 9);
  assert.ok(slap.radius >= 13 && slap.crownHeight > entry.crownHeight);
  assert.ok(slap.foamLife > 12, "a slap's foam field lingers");
  assert.ok(breath.dropletCount < entry.dropletCount && breath.crownRadius === 0);
  assert.ok(blow.mistCount > 15 && blow.ringCount === 0 && blow.dropletCount === 0);
  assert.ok(calculateSplashProfile(0.25, "blow").mistCount < blow.mistCount, "a dolphin's chuff is small");
});

// --- Shared swimming dynamics ------------------------------------------------

test("heavy swimmers change depth without overshoot and turn on a real radius", () => {
  const swimmer = createSwimmer3D(0, -10, 0, 0, 1.6);
  const control: DepthControl = { frequency: 0.6, maxVerticalSpeed: 0.5, maxVerticalAcceleration: 0.15 };
  let highest = -Infinity;
  let previousHeading = swimmer.heading;
  for (let step = 0; step < 60 * 90; step += 1) {
    stepSwimmerAtDepth(swimmer, Math.PI, -2, 1.6, 1 / 60, SHARK_LIMITS, control);
    highest = Math.max(highest, swimmer.y);
    const turn = Math.abs(Math.atan2(Math.sin(swimmer.heading - previousHeading), Math.cos(swimmer.heading - previousHeading)));
    assert.ok(turn <= turnRateLimit(swimmer.speed, SHARK_LIMITS) / 60 + 1e-9, "turn rate is bounded by the turning radius");
    previousHeading = swimmer.heading;
  }
  assert.ok(highest <= -2 + 0.02, `overshot the target depth to ${highest}`);
  assert.ok(Math.abs(swimmer.y + 2) < 0.05);
  assert.ok(Math.abs(Math.atan2(Math.sin(swimmer.heading - Math.PI), Math.cos(swimmer.heading - Math.PI))) < 0.05);
  assert.ok(turnRateLimit(0.1, SHARK_LIMITS) < 0.05, "a nearly stopped body cannot spin in place");
});

// --- Whale -------------------------------------------------------------------

type WhaleRun = {
  phases: WhalePhase[];
  hiddenFraction: number;
  highestBody: number;
  highestFluke: number;
  shallowest: number;
  slapStarts: number[];
  strikeSpeeds: number[];
  torsoDuringLobtail: number;
};

function runWhale(seed: number, vesselSpeed: number, minutes: number, delta = 1 / 30): WhaleRun {
  const random = seeded(seed);
  const { world, clock } = liveWorld();
  const vessel: VesselState = { x: 0, z: 0, heading: 0.4, speed: vesselSpeed };
  const agent = createWhaleAgent(30, 140, 2.6, random);
  const phases: WhalePhase[] = [agent.phase];
  const slapStarts: number[] = [];
  const strikeSpeeds: number[] = [];
  let hidden = 0;
  let samples = 0;
  let highestBody = -Infinity;
  let highestFluke = -Infinity;
  let shallowest = Infinity;
  let torsoDuringLobtail = -Infinity;
  let previousFluke = Number.NaN;
  for (let step = 0; step < (minutes * 60) / delta; step += 1) {
    clock.time += delta;
    advanceVessel(vessel, delta);
    stepWhale(agent, world, vessel, delta, random);
    if (agent.phase !== phases[phases.length - 1]) {
      phases.push(agent.phase);
      if (agent.phase === "prepare_tail_slap") slapStarts.push(clock.time);
    }
    const motion = agent.motion;
    shallowest = Math.min(shallowest, -motion.y);
    const pose = whalePose(agent);
    const angle = -motion.pitch + pose.bodyAngle;
    const centre = whaleWorldY(agent);
    const surface = world.surfaceHeight(motion.x, motion.z);
    let body = -Infinity;
    let torso = -Infinity;
    // Torso and head: the tail, from the peduncle back, is allowed to rise.
    for (let z = -3; z <= 9; z += 0.5) {
      const y = whaleDorsalHeight(z) * Math.cos(angle) - z * Math.sin(angle) + centre;
      const clearance = y - world.surfaceHeight(motion.x + Math.sin(motion.heading) * z, motion.z + Math.cos(motion.heading) * z);
      body = Math.max(body, clearance);
      torso = Math.max(torso, clearance);
    }
    const tail = whaleTailPoints(angle, pose.bends);
    const fluke = centre + tail.flukeCentre.y - surface;
    if (agent.phase === "tail_slap" && agent.stage === "downstroke" && previousFluke > 0 && fluke <= 0) {
      strikeSpeeds.push((previousFluke - fluke) / delta);
    }
    if (agent.phase === "prepare_tail_slap" || agent.phase === "tail_slap") torsoDuringLobtail = Math.max(torsoDuringLobtail, torso);
    previousFluke = fluke;
    highestBody = Math.max(highestBody, body);
    highestFluke = Math.max(highestFluke, fluke);
    samples += 1;
    if (body < 0 && fluke < 0) hidden += 1;
  }
  return {
    phases,
    hiddenFraction: hidden / samples,
    highestBody,
    highestFluke,
    shallowest,
    slapStarts,
    strikeSpeeds,
    torsoDuringLobtail,
  };
}

test("a whale surfaces, lobtails and sounds through the full state machine", () => {
  const run = runWhale(8, 0, 4);
  const expected: WhalePhase[] = [
    "deep_swim",
    "ascend",
    "surface",
    "prepare_tail_slap",
    "tail_slap",
    "submerge",
    "cooldown",
  ];
  let cursor = 0;
  for (const phase of run.phases) if (phase === expected[cursor]) cursor += 1;
  assert.equal(cursor, expected.length, `visited ${run.phases.join(" → ")}`);
  assert.ok(run.strikeSpeeds.length > 0, "the flukes must come down through the surface");
  assert.ok(Math.max(...run.strikeSpeeds) > 4, `strike speed ${run.strikeSpeeds}`);
  assert.ok(run.highestFluke > 1.5, `flukes only reached ${run.highestFluke} m`);
  assert.ok(run.torsoDuringLobtail < 0, "the torso stays under while the tail is raised");
});

test("whales stay hidden most of the time and never haul their body out", () => {
  for (const [seed, speed] of [
    [3, 0],
    [17, 2],
    [29, 4.2],
    [41, 1],
  ] as const) {
    const run = runWhale(seed, speed, 6);
    assert.ok(run.hiddenFraction > 0.75, `seed ${seed}: visible ${((1 - run.hiddenFraction) * 100).toFixed(0)}% of the time`);
    // Breathing in a trough, the head and blowhole may clear the water by most of a metre; never more.
    assert.ok(run.highestBody < 1, `seed ${seed}: body rose ${run.highestBody.toFixed(2)} m out of the water`);
    assert.ok(run.highestFluke < 5.5, `seed ${seed}: flukes stood ${run.highestFluke.toFixed(2)} m high`);
    assert.ok(run.shallowest >= WHALE_SHALLOWEST_DEPTH - 1e-6, "the body centre never comes higher than its limit");
    for (let index = 1; index < run.slapStarts.length; index += 1) {
      assert.ok(run.slapStarts[index]! - run.slapStarts[index - 1]! >= WHALE_SLAP_COOLDOWN, "displays never repeat back to back");
    }
  }
});

test("the whale tail model matches the rig and only the tail can rise", () => {
  const rest = whaleTailPoints(0, [0, 0, 0]);
  assert.ok(Math.abs(rest.flukeCentre.y + 1.35) < 0.35 && Math.abs(rest.flukeCentre.z + 8.3) < 0.5);
  const raised = whaleTailPoints(0.3, [0.22, 0.3, 0.3]);
  assert.ok(raised.flukeCentre.y > 5, "a lobtail lifts the flukes several metres above the body");
  // The head goes down as the tail comes up: the body pivots, it does not stand up.
  const head = WHALE_DORSAL_HEIGHT * Math.cos(0.3) - 9 * Math.sin(0.3);
  assert.ok(head < 0);
});

// --- Dolphins ----------------------------------------------------------------

type PodRun = {
  phasesSeen: Set<DolphinPhase>;
  leaps: number;
  launchSpeeds: number[];
  maxSpeed: number;
  insideHull: number;
  airborneOutsideLeap: number;
  apexHeights: number[];
  entryPitches: number[];
  maxStep: number;
};

function runPod(seed: number, vesselSpeed: number, minutes: number, count = 4, delta = 1 / 30): PodRun {
  const random = seeded(seed);
  const { world, clock } = liveWorld();
  const vessel: VesselState = { x: 0, z: 0, heading: 1.1, speed: vesselSpeed };
  const pod = createDolphinPod(count, vessel, world, random);
  const phasesSeen = new Set<DolphinPhase>();
  const launchSpeeds: number[] = [];
  const apexHeights: number[] = [];
  const entryPitches: number[] = [];
  const apex = new Map<number, number>();
  const previousPhase = new Map<number, DolphinPhase>();
  const previousPosition = new Map<number, [number, number, number]>();
  let maxSpeed = 0;
  let insideHull = 0;
  let airborneOutsideLeap = 0;
  let maxStep = 0;
  const point = { x: 0, y: 0, z: 0 };
  for (let step = 0; step < (minutes * 60) / delta; step += 1) {
    clock.time += delta;
    advanceVessel(vessel, delta);
    stepDolphinPod(pod, world, vessel, [], delta, random);
    for (const agent of pod.agents) {
      const motion = agent.motion;
      phasesSeen.add(agent.phase);
      maxSpeed = Math.max(maxSpeed, motion.speed);
      const last = previousPhase.get(agent.id);
      if (agent.phase === "leap" && last !== "leap") launchSpeeds.push(agent.lastLaunchSpeed);
      if (agent.phase === "airborne" || agent.phase === "leap") {
        apex.set(agent.id, Math.max(apex.get(agent.id) ?? -Infinity, motion.y - world.surfaceHeight(motion.x, motion.z)));
      }
      if (agent.phase === "reentry" && last === "airborne") {
        apexHeights.push(apex.get(agent.id) ?? 0);
        apex.delete(agent.id);
        entryPitches.push(motion.pitch);
      }
      previousPhase.set(agent.id, agent.phase);
      const before = previousPosition.get(agent.id);
      if (before) {
        const travelled = Math.hypot(motion.x - before[0], motion.y - before[1], motion.z - before[2]);
        maxStep = Math.max(maxStep, travelled / delta);
      }
      previousPosition.set(agent.id, [motion.x, motion.y, motion.z]);
      const leaping = agent.phase === "leap" || agent.phase === "airborne" || agent.phase === "reentry";
      if (!leaping) {
        dolphinPoint(motion, { y: 0, z: 0 }, point);
        if (point.y > world.surfaceHeight(point.x, point.z) + 0.05) airborneOutsideLeap += 1;
      }
      // Inside the yacht's hull and keel box?
      const dx = motion.x - vessel.x;
      const dz = motion.z - vessel.z;
      const lateral = dx * Math.cos(vessel.heading) - dz * Math.sin(vessel.heading);
      const along = dx * Math.sin(vessel.heading) + dz * Math.cos(vessel.heading);
      if (
        Math.abs(lateral) < YACHT_HULL_BOX.halfBeam &&
        along < YACHT_HULL_BOX.bow &&
        along > YACHT_HULL_BOX.stern &&
        -motion.y < YACHT_HULL_BOX.draft
      ) {
        insideHull += 1;
      }
    }
  }
  return {
    phasesSeen,
    leaps: launchSpeeds.length,
    launchSpeeds,
    maxSpeed,
    insideHull,
    airborneOutsideLeap,
    apexHeights,
    entryPitches,
    maxStep,
  };
}

test("calm or slow dolphins never leap", () => {
  for (const speed of [0, 1.2, DOLPHIN_PLAY_VESSEL_SPEED - 0.3]) {
    const run = runPod(5 + speed * 10, speed, 5);
    for (const phase of ["accelerate", "approach_surface", "leap", "airborne", "reentry"] as const) {
      assert.ok(!run.phasesSeen.has(phase), `a dolphin entered ${phase} beside a yacht making ${speed} m/s`);
    }
    assert.equal(run.leaps, 0);
    assert.ok(run.maxSpeed < 4.5, `calm dolphins reached ${run.maxSpeed} m/s`);
    assert.equal(run.airborneOutsideLeap, 0, "a calm dolphin never leaves the water");
    assert.equal(run.insideHull, 0);
  }
  const calm = createDolphinPod(1, { x: 0, z: 0, heading: 0, speed: 0 }, liveWorld().world, seeded(1)).agents[0]!;
  calm.cooldown = 0;
  calm.motion.speed = DOLPHIN_LEAP_ENTRY_SPEED + 1;
  assert.equal(canCommitToLeap(calm, 0.5, 17), false, "no leaping beside a stopped yacht");
  calm.motion.speed = DOLPHIN_LEAP_ENTRY_SPEED - 0.1;
  assert.equal(canCommitToLeap(calm, 4, 17), false, "no leaping from a slow swim");
  calm.motion.speed = DOLPHIN_LEAP_ENTRY_SPEED + 0.1;
  assert.equal(canCommitToLeap(calm, 4, 17), true);
});

test("fast dolphins leap at speed, in one continuous arc, and re-enter head first", () => {
  const run = runPod(11, 4.2, 6);
  assert.ok(run.leaps >= 6, `only ${run.leaps} leaps in six minutes beside a fast yacht`);
  for (const speed of run.launchSpeeds) {
    assert.ok(speed >= DOLPHIN_LEAP_MIN_SPEED, `left the water at ${speed} m/s`);
  }
  // Porpoising leaps come back in almost flat; high arcs dive in steeply. None lands tail first.
  for (const pitch of run.entryPitches) assert.ok(pitch < 0.02, `re-entered tail first, at a pitch of ${pitch}`);
  const meanEntry = run.entryPitches.reduce((sum, pitch) => sum + pitch, 0) / run.entryPitches.length;
  assert.ok(meanEntry < -0.15, `entries average ${meanEntry} rad`);
  assert.ok(Math.min(...run.entryPitches) < -0.4, "high leaps dive back in steeply");
  assert.ok(run.maxStep < 11.5, `a dolphin moved ${run.maxStep} m/s in one step: a teleport`);
  const low = Math.min(...run.apexHeights);
  const high = Math.max(...run.apexHeights);
  assert.ok(high - low > 0.8, `leaps all look alike (apex ${low.toFixed(2)}–${high.toFixed(2)} m)`);
  assert.ok(high < 4.5, "no dolphin is launched like a rocket");
  assert.equal(run.insideHull, 0, "no dolphin may pass through the hulls");
  assert.equal(run.airborneOutsideLeap, 0, "only a leap takes a dolphin out of the water");
});

test("a leaping dolphin's body points follow the arc it flies", () => {
  const random = seeded(3);
  const { world, clock } = liveWorld();
  const vessel: VesselState = { x: 0, z: 0, heading: 0, speed: 4.4 };
  const pod = createDolphinPod(2, vessel, world, random);
  const rostrum = { x: 0, y: 0, z: 0 };
  const fluke = { x: 0, y: 0, z: 0 };
  let checked = 0;
  for (let step = 0; step < 30 * 60 * 4 && checked < 40; step += 1) {
    clock.time += 1 / 30;
    advanceVessel(vessel, 1 / 30);
    stepDolphinPod(pod, world, vessel, [], 1 / 30, random);
    for (const agent of pod.agents) {
      if (agent.phase !== "airborne") continue;
      dolphinPoint(agent.motion, DOLPHIN_ROSTRUM, rostrum);
      dolphinPoint(agent.motion, DOLPHIN_FLUKE, fluke);
      // The body axis points along the velocity: rostrum ahead of the flukes along the path.
      const axisX = rostrum.x - fluke.x;
      const axisY = rostrum.y - fluke.y;
      const axisZ = rostrum.z - fluke.z;
      const velocity = Math.hypot(agent.velocityX, agent.velocityY, agent.velocityZ);
      const alignment =
        (axisX * agent.velocityX + axisY * agent.velocityY + axisZ * agent.velocityZ) /
        (Math.hypot(axisX, axisY, axisZ) * velocity);
      assert.ok(alignment > 0.995, `body axis off the flight path (${alignment})`);
      checked += 1;
    }
  }
  assert.ok(checked > 10, "the run must include a leap");
});

// --- Shark -------------------------------------------------------------------

test("a shark stays mostly deep, shows its fin only briefly, and never leaves the water", () => {
  for (const [seed, speed] of [
    [7, 0],
    [19, 2.5],
    [23, 0.8],
  ] as const) {
    const random = seeded(seed);
    const { world, clock } = liveWorld();
    const vessel: VesselState = { x: 0, z: 0, heading: 2, speed };
    const agent = createSharkAgent(vessel, random);
    const time: Partial<Record<SharkPhase, number>> = {};
    let deep = 0;
    let samples = 0;
    let highestFin = -Infinity;
    let highestBody = -Infinity;
    let shallowUnderYacht = 0;
    let slowest = Infinity;
    const delta = 1 / 30;
    for (let step = 0; step < 30 * 60 * 10; step += 1) {
      clock.time += delta;
      advanceVessel(vessel, delta);
      stepShark(agent, world, vessel, [], delta, random);
      const motion = agent.motion;
      time[agent.phase] = (time[agent.phase] ?? 0) + delta;
      const centre = motion.y + agent.heave;
      const surface = world.surfaceHeight(motion.x, motion.z);
      highestBody = Math.max(highestBody, centre - surface);
      highestFin = Math.max(highestFin, centre + SHARK_DORSAL_TIP.y - surface);
      if (surface - centre > 1.5) deep += 1;
      samples += 1;
      slowest = Math.min(slowest, motion.speed);
      if (Math.hypot(motion.x - vessel.x, motion.z - vessel.z) < 6 && surface - centre < SHARK_UNDER_KEEL_DEPTH - 1.2) {
        shallowUnderYacht += 1;
      }
    }
    assert.ok(deep / samples > 0.85, `seed ${seed}: shallow ${((1 - deep / samples) * 100).toFixed(0)}% of the time`);
    assert.ok((time.fin_show ?? 0) < 600 * 0.15, "the fin is a rare sight");
    assert.ok(highestBody < -0.4, `seed ${seed}: the body rose to ${highestBody.toFixed(2)} m`);
    assert.ok(highestFin < 0.6, `seed ${seed}: the fin stood ${highestFin.toFixed(2)} m out`);
    assert.ok(slowest > 0.8, "a shark never stops swimming");
    assert.equal(shallowUnderYacht, 0, `seed ${seed}: the shark grazed the keels`);
  }
});

test("a shark's tail beats faster and harder when it accelerates", () => {
  const random = seeded(2);
  const { world, clock } = liveWorld();
  const vessel: VesselState = { x: 0, z: 0, heading: 0, speed: 0 };
  const agent = createSharkAgent(vessel, random);
  const measure = (phase: SharkPhase, seconds: number): { rate: number; effort: number } => {
    agent.phase = phase;
    agent.elapsed = 0;
    agent.duration = 1e9;
    agent.depth = 5;
    const start = agent.strokePhase;
    let effort = 0;
    const delta = 1 / 30;
    for (let step = 0; step < seconds * 30; step += 1) {
      clock.time += delta;
      stepShark(agent, world, vessel, [], delta, random);
      effort = Math.max(effort, agent.strokeEffort);
    }
    return { rate: (agent.strokePhase - start) / seconds, effort };
  };
  const cruise = measure("cruise", 12);
  const burst = measure("accelerate", 2.5);
  assert.ok(burst.rate > cruise.rate * 1.3, `tail-beat rate ${cruise.rate} → ${burst.rate}`);
  assert.ok(burst.effort > cruise.effort + 0.15);
});

test("behaviour holds from 20 to 120 frames per second", () => {
  for (const delta of [1 / 20, 1 / 120]) {
    const calm = runPod(31, 1, 3, 3, delta);
    assert.equal(calm.leaps, 0, `calm dolphins leapt at ${Math.round(1 / delta)} fps`);
    const fast = runPod(37, 4.2, 4, 4, delta);
    assert.ok(fast.leaps >= 3, `${fast.leaps} leaps at ${Math.round(1 / delta)} fps`);
    for (const speed of fast.launchSpeeds) assert.ok(speed >= DOLPHIN_LEAP_MIN_SPEED);
    assert.ok(fast.maxStep < 11.5);
    assert.equal(fast.insideHull, 0);
    const whale = runWhale(13, 0, 4, delta);
    assert.ok(whale.highestBody < 1 && whale.shallowest >= WHALE_SHALLOWEST_DEPTH - 1e-6);
    assert.ok(whale.phases.includes("surface"), `no surfacing at ${Math.round(1 / delta)} fps`);
  }
});
