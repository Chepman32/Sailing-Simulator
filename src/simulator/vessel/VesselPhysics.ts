import * as THREE from "three";
import { clamp, smoothstep } from "../math";
import type { OceanSample } from "../environment/OceanMath";
import { sampleWind, type WindSample } from "../environment/WindMath";
import type { SimulatorControls } from "../types";
import { AIR_DENSITY, createSailState, solveSail, type SailState } from "./SailAerodynamics";
import { resolveShoreContact, SHIP_CONTACT } from "./ShoreContact";
import { createShoreGuard, updateShipGuard, updateShoreGuard, type ShoreGuardState } from "./ShoreGuard";

export type OceanSampler = {
  sample: (x: number, z: number) => OceanSample;
};

export type IslandPhysics = {
  depthAt: (x: number, z: number) => number;
  avoidanceForce: (position: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3) => THREE.Vector3;
  constrainToWater: (position: THREE.Vector3, velocity: THREE.Vector3) => boolean;
  nearestShoreDirection: (position: THREE.Vector3, target: THREE.Vector3) => THREE.Vector3;
  /** Metres from the rendered waterline (negative on land), outward normal in `normal`. */
  shoreClearance: (x: number, z: number, normal: { x: number; z: number }) => number;
};

export type VesselTelemetry = {
  forwardSpeed: number;
  speedKnots: number;
  apparentWindSpeed: number;
  /**
   * Signed angle the apparent wind comes from, relative to the bow:
   * 0 = head to wind, ±π = dead astern, positive = over the starboard side.
   */
  apparentWindAngle: number;
  depth: number;
  heel: number;
  /** +1 when the wind pushes the sails toward starboard, −1 toward port. */
  leewardSide: number;
  trueWindSpeed: number;
  /** A gust event under way, 0…1 (sound, sail and water follow it). */
  gust: number;
  /** A gust about to arrive, 0…1. */
  gustApproaching: number;
  /** Sideways slip through the water in m/s; positive toward starboard. */
  leeway: number;
  /** 0 drawing … 1 flogging head to wind. */
  sailLuff: number;
  /** Boom angle off the centreline in radians. */
  sheetAngle: number;
  /** Signed propeller shaft speed as a fraction of maximum. */
  engineShaft: number;
  /** 0 deep water … 1 the keels nearly touching the sand (extra drag only). */
  grounding: number;
  /** Impact speed in m/s of a hull striking the shore this step, else 0. */
  shoreImpact: number;
};

/** Twin-hull buoyancy samples: [starboard offset, forward offset] in metres. */
const BUOYANCY_POINTS = [
  [-1.55, 4.15],
  [1.55, 4.15],
  [-1.55, 2.05],
  [1.55, 2.05],
  [-1.55, 0],
  [1.55, 0],
  [-1.55, -2.1],
  [1.55, -2.1],
  [-1.55, -4.05],
  [1.55, -4.05],
] as const;

const GRAVITY = 9.81;
const WATER_DENSITY = 1025;
const FLOAT_HEIGHT = 0.46;

// --- Mass properties -------------------------------------------------------
const MASS = 6200;
/** Water dragged along with the hulls makes them harder to accelerate. */
const SURGE_MASS = MASS * 1.08;
const SWAY_MASS = MASS * 1.75;
const YAW_INERTIA = 78000;

// --- Propulsion ------------------------------------------------------------
const AHEAD_BOLLARD_THRUST = 15600;
const ASTERN_BOLLARD_THRUST = 9700;
const IDLE_SHAFT_FRACTION = 0.3;
const SHAFT_SPOOL_UP = 1.5;
const SHAFT_SPOOL_DOWN = 2.3;
const THRUST_FADE_SPEED = 15;
const PROPELLER_DISC_AREA = 0.32;

// --- Hull hydrodynamics ----------------------------------------------------
const SURGE_DRAG_QUADRATIC = 235;
const SURGE_DRAG_LINEAR = 45;
const KEEL_AREA = 5.5;
const KEEL_LIFT_SLOPE = 2.8;
const KEEL_MAX_LIFT_COEFFICIENT = 1.0;
const KEEL_LIFT = 0.5 * WATER_DENSITY * KEEL_AREA * KEEL_LIFT_SLOPE;
const KEEL_STALL = 0.5 * WATER_DENSITY * KEEL_AREA * KEEL_MAX_LIFT_COEFFICIENT;
const KEEL_INDUCED = 0.5 * WATER_DENSITY * KEEL_AREA * Math.PI * 1.1 * 0.8;
const CROSSFLOW_DRAG = 0.5 * WATER_DENSITY * 1.1 * 11;
const SWAY_DRAG_LINEAR = 600;
const YAW_DAMPING_QUADRATIC = 130000;
const YAW_DAMPING_LINEAR = 9000;

// --- Rudders ---------------------------------------------------------------
const MAX_RUDDER_ANGLE = 0.61;
const RUDDER_ARM = 4.2;
const RUDDER_FORCE = 720;
const RUDDER_FIN = 0.9;
const PROP_WASH_ON_RUDDER = 0.4;

// --- Aerodynamics ----------------------------------------------------------
const SAIL_CENTRE_HEIGHT = 6.5;
/** Centre of effort sits slightly aft of the keels: gentle weather helm. */
const SAIL_CENTRE_LEAD = -0.22;
const WINDAGE_FRONTAL = 0.5 * AIR_DENSITY * 0.9 * 7;
const WINDAGE_LATERAL = 0.5 * AIR_DENSITY * 0.9 * 16;
const WINDAGE_CENTRE_LEAD = 0.5;
const WINDAGE_CENTRE_HEIGHT = 1.5;

// --- Seakeeping ------------------------------------------------------------
const TRANSVERSE_STIFFNESS = MASS * GRAVITY * 8.5;
const LONGITUDINAL_STIFFNESS = MASS * GRAVITY * 13;
const CENTRE_OF_GRAVITY_HEIGHT = 0.9;
const HEAVE_FREQUENCY = 3.6;
const HEAVE_DAMPING = 0.55;
/** Share of the water's own vertical acceleration passed straight to the hulls. */
const HEAVE_FOLLOW = 0.85;
const PITCH_FREQUENCY = 3.1;
const PITCH_DAMPING = 0.5;
const ROLL_FREQUENCY = 3.4;
const ROLL_DAMPING = 0.42;
/**
 * Fraction of the local water-plane slope the hulls actually take up. Two
 * buoyant hulls bridge short chop instead of tilting to every wavelet.
 */
const WAVE_PITCH_RESPONSE = 0.72;
const WAVE_ROLL_RESPONSE = 0.6;
const WAVE_SURGE_COUPLING = 0.3;
const WAVE_SWAY_COUPLING = 0.12;

// --- Shoal water -----------------------------------------------------------
const SHOAL_DRAG_DEPTH = 4;
const GROUNDING_START_DEPTH = 2.4;
const GROUNDING_FULL_DEPTH = 1.3;

function moveToward(current: number, target: number, maximumStep: number): number {
  const difference = target - current;
  if (Math.abs(difference) <= maximumStep) return target;
  return current + Math.sign(difference) * maximumStep;
}

/** Shaft speed the helm is asking for, as a signed fraction of maximum. */
export function shaftTargetForThrottle(throttle: number): number {
  const magnitude = clamp(Math.abs(throttle), 0, 1);
  if (magnitude < 0.001) return 0;
  return Math.sign(throttle) * (IDLE_SHAFT_FRACTION + (1 - IDLE_SHAFT_FRACTION) * magnitude);
}

/**
 * Propeller thrust in newtons. Thrust follows shaft speed squared and fades as
 * the hull catches up with the water the propellers are throwing aft.
 */
export function propellerThrust(shaft: number, forwardSpeed: number): number {
  const direction = Math.sign(shaft);
  if (direction === 0) return 0;
  const bollard = direction > 0 ? AHEAD_BOLLARD_THRUST : ASTERN_BOLLARD_THRUST;
  const advance = clamp((forwardSpeed * direction) / THRUST_FADE_SPEED, -0.4, 1);
  return direction * bollard * shaft * shaft * (1 - 0.6 * advance);
}

/**
 * Where the yacht starts (and returns to on reset): open water south of the
 * home islands, about 250 m off the nearest beach, with the archipelago ahead.
 */
export const START_POSITION = { x: 0, z: -330 } as const;

export class VesselPhysics {
  readonly position = new THREE.Vector3(START_POSITION.x, FLOAT_HEIGHT, START_POSITION.z);
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  readonly right = new THREE.Vector3(1, 0, 0);
  /** True wind: the direction the air is moving toward, in m/s. */
  readonly wind = new THREE.Vector3(6.8, 0, 4.2);
  heading = 0;
  yawRate = 0;
  pitch = 0;
  roll = 0;
  pitchRate = 0;
  rollRate = 0;
  heaveVelocity = 0;
  /** Recent water levels under the hulls, newest first (see `updateSeakeeping`). */
  private previousSurfaceVelocity = 0;
  private readonly surfaceHistory: number[] = [];
  /** The pose one fixed step ago, so a frame can be drawn between two steps (see `blendPose`). */
  private readonly previousPose = { x: 0, y: FLOAT_HEIGHT, z: 0, heading: 0, pitch: 0, roll: 0 };
  private readonly truePose = { x: 0, y: FLOAT_HEIGHT, z: 0, heading: 0, pitch: 0, roll: 0 };
  private blended = false;
  /** Signed propeller shaft speed as a fraction of maximum. */
  engineShaft = 0;
  /** Collision avoidance near islands and ships; `guard.output` is what the helm actually does. */
  readonly guard: ShoreGuardState = createShoreGuard();
  /** Distance to the nearest ship's hull, if ships exist; the guard avoids it like a shore. */
  hullClearance: ((x: number, z: number, normal: { x: number; z: number }) => number) | null = null;
  private readonly hullNormal = { x: 0, z: 1 };
  /** Island shore or ship hull, whichever is nearer, for the guard. */
  private readonly guardClearance = (x: number, z: number, normal: { x: number; z: number }): number => {
    const shore = this.islands.shoreClearance(x, z, normal);
    if (!this.hullClearance) return shore;
    const hull = this.hullClearance(x, z, this.hullNormal);
    if (hull >= shore) return shore;
    normal.x = this.hullNormal.x;
    normal.z = this.hullNormal.z;
    return hull;
  };
  private readonly profileNormal = { x: 0, z: 1 };
  private readonly hullContact = (x: number, z: number, normal: { x: number; z: number }): number =>
    this.hullClearance ? this.hullClearance(x, z, normal) : 1e6;
  /** Whether the obstacle nearest the yacht is a ship's hull rather than a coast. */
  private nearestIsShip(): boolean {
    if (!this.hullClearance) return false;
    const hull = this.hullClearance(this.position.x, this.position.z, this.profileNormal);
    if (hull > 80) return false;
    return hull < this.islands.shoreClearance(this.position.x, this.position.z, this.profileNormal);
  }

  telemetry: VesselTelemetry = {
    forwardSpeed: 0,
    speedKnots: 0,
    apparentWindSpeed: 8,
    apparentWindAngle: 1,
    depth: 18,
    heel: 0,
    leewardSide: 1,
    trueWindSpeed: 8,
    gust: 0,
    gustApproaching: 0,
    leeway: 0,
    sailLuff: 0,
    sheetAngle: 0.6,
    engineShaft: 0,
    grounding: 0,
    shoreImpact: 0,
  };

  private readonly windSample: WindSample = { x: 6.8, z: 4.2, speed: 8, gust: 1 };
  /** Weather's multiplier on the true wind; set by the simulator each frame. */
  windScale = 1;
  private readonly sail: SailState = createSailState();
  private time = 0;
  private waveRollTarget = 0;
  private wavePitchTarget = 0;
  private waveSlopeForward = 0;
  private waveSlopeRight = 0;

  constructor(
    private readonly ocean: OceanSampler,
    private readonly islands: IslandPhysics,
  ) {}

  /**
   * One fixed step. `controls` are the helmsman's; near an island the shore
   * guard may override them for a while (see `ShoreGuard`).
   */
  fixedUpdate(delta: number, helm: SimulatorControls, engineRunning = true): void {
    this.restorePose();
    this.rememberPose();
    this.time += delta;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    // Near a ship's side the guard lets her come within a couple of metres
    // (`updateShipGuard`); near a coast it keeps well off.
    const controls = this.nearestIsShip()
      ? updateShipGuard(this.guard, this, helm, engineRunning, this.guardClearance, delta)
      : updateShoreGuard(this.guard, this, helm, engineRunning, this.guardClearance, delta);

    const forwardSpeed = this.velocity.dot(this.forward);
    const lateralSpeed = this.velocity.dot(this.right);
    const waterSpeedSquared = forwardSpeed * forwardSpeed + lateralSpeed * lateralSpeed;
    const depth = this.islands.depthAt(this.position.x, this.position.z);

    // --- Wind --------------------------------------------------------------
    sampleWind(this.time, this.windSample, this.windScale);
    this.wind.set(this.windSample.x, 0, this.windSample.z);
    const airForward = this.wind.dot(this.forward) - forwardSpeed;
    const airRight = this.wind.dot(this.right) - lateralSpeed;
    const apparentWindSpeed = Math.hypot(airForward, airRight);
    const apparentWindAngle = Math.atan2(-airRight, -airForward);
    const leewardSide = airRight >= 0 ? 1 : -1;

    // --- Sails -------------------------------------------------------------
    solveSail(apparentWindAngle, apparentWindSpeed, controls.sailTrim, this.sail);
    const inverseWind = apparentWindSpeed > 1e-4 ? 1 / apparentWindSpeed : 0;
    const dragForward = airForward * inverseWind;
    const dragRight = airRight * inverseWind;
    // Lift acts square to the apparent wind, on the side that drives the bow.
    const liftForward = Math.abs(dragRight);
    const liftRight = -leewardSide * dragForward;
    const sailDrive = this.sail.lift * liftForward + this.sail.drag * dragForward;
    const sailSide = this.sail.lift * liftRight + this.sail.drag * dragRight;
    const windageForward = WINDAGE_FRONTAL * apparentWindSpeed * airForward;
    const windageRight = WINDAGE_LATERAL * apparentWindSpeed * airRight;

    // --- Engines -----------------------------------------------------------
    const shaftTarget = shaftTargetForThrottle(controls.throttle);
    const spoolingUp = Math.abs(shaftTarget) > Math.abs(this.engineShaft) && shaftTarget * this.engineShaft >= 0;
    this.engineShaft = moveToward(
      this.engineShaft,
      shaftTarget,
      (spoolingUp ? SHAFT_SPOOL_UP : SHAFT_SPOOL_DOWN) * delta,
    );
    const thrust = propellerThrust(this.engineShaft, forwardSpeed);

    // --- Hull --------------------------------------------------------------
    const shoal = 1 + 1.2 * smoothstep(SHOAL_DRAG_DEPTH, GROUNDING_FULL_DEPTH, depth);
    const grounding = smoothstep(GROUNDING_START_DEPTH, GROUNDING_FULL_DEPTH, depth);
    const hullDrag =
      -(SURGE_DRAG_QUADRATIC * forwardSpeed * Math.abs(forwardSpeed) + SURGE_DRAG_LINEAR * forwardSpeed) * shoal;
    // The keels are lifting foils: they only resist leeway once water flows
    // along them, and they stall if asked for too much.
    const keelLimit = KEEL_STALL * waterSpeedSquared;
    const keelLift = clamp(-KEEL_LIFT * Math.abs(forwardSpeed) * lateralSpeed, -keelLimit, keelLimit);
    const crossflow = -CROSSFLOW_DRAG * lateralSpeed * Math.abs(lateralSpeed) - SWAY_DRAG_LINEAR * lateralSpeed;
    const inducedDrag =
      -Math.sign(forwardSpeed) *
      Math.min((keelLift * keelLift) / (KEEL_INDUCED * Math.max(waterSpeedSquared, 0.25)), Math.abs(keelLift) * 0.5);

    // --- Rudders -----------------------------------------------------------
    const propellerRace = Math.sqrt((2 * Math.abs(thrust)) / (WATER_DENSITY * PROPELLER_DISC_AREA));
    const rudderFlow = forwardSpeed + (thrust > 0 ? PROP_WASH_ON_RUDDER * propellerRace : 0);
    const rudderAngle = clamp(controls.rudder, -1, 1) * MAX_RUDDER_ANGLE;
    const sternSway = lateralSpeed - this.yawRate * RUDDER_ARM;
    const rudderSide =
      -RUDDER_FORCE * Math.sin(rudderAngle) * Math.cos(rudderAngle) * rudderFlow * Math.abs(rudderFlow) -
      RUDDER_FORCE * RUDDER_FIN * sternSway * Math.abs(rudderFlow);
    const rudderDrag = -Math.sign(forwardSpeed) * Math.abs(rudderSide) * Math.abs(Math.sin(rudderAngle)) * 0.9;

    // --- Seaway and seabed ---------------------------------------------------
    const waveForward = -MASS * GRAVITY * this.waveSlopeForward * WAVE_SURGE_COUPLING;
    const waveRight = -MASS * GRAVITY * this.waveSlopeRight * WAVE_SWAY_COUPLING;
    const forceForward =
      thrust + sailDrive + windageForward + hullDrag + inducedDrag + rudderDrag + waveForward;
    const forceRight = sailSide + windageRight + keelLift + crossflow + rudderSide + waveRight;

    this.velocity.addScaledVector(this.forward, (forceForward / SURGE_MASS) * delta);
    this.velocity.addScaledVector(this.right, (forceRight / SWAY_MASS) * delta);
    this.velocity.y = 0;

    const yawMoment =
      -rudderSide * RUDDER_ARM +
      sailSide * SAIL_CENTRE_LEAD +
      windageRight * WINDAGE_CENTRE_LEAD -
      YAW_DAMPING_QUADRATIC * this.yawRate * Math.abs(this.yawRate) -
      YAW_DAMPING_LINEAR * (1 + Math.abs(forwardSpeed) + grounding * 3) * this.yawRate;
    this.yawRate = clamp(this.yawRate + (yawMoment / YAW_INERTIA) * delta, -1.2, 1.2);
    this.heading += this.yawRate * delta;
    this.position.addScaledVector(this.velocity, delta);

    // The hull outline meets the rendered shore: cushion, rebound and a swing
    // of the bow away from the beach. The centre guard below is a last resort.
    this.telemetry.shoreImpact = resolveShoreContact(this, this.islands.shoreClearance, SWAY_MASS, YAW_INERTIA, delta);
    // A ship's side holds her off on its fenders (see SHIP_CONTACT).
    // (Splash and sound for a ship come from ShipSystem.resolveContact.)
    if (this.hullClearance) resolveShoreContact(this, this.hullContact, SWAY_MASS, YAW_INERTIA, delta, SHIP_CONTACT);
    this.yawRate = clamp(this.yawRate, -1.2, 1.2);
    if (this.islands.constrainToWater(this.position, this.velocity)) {
      this.velocity.y = 0;
    }

    this.updateSeakeeping(
      delta,
      forwardSpeed,
      (sailSide * SAIL_CENTRE_HEIGHT + windageRight * WINDAGE_CENTRE_HEIGHT -
        MASS * forwardSpeed * this.yawRate * CENTRE_OF_GRAVITY_HEIGHT) / TRANSVERSE_STIFFNESS,
      (sailDrive * SAIL_CENTRE_HEIGHT - thrust * 0.9) / LONGITUDINAL_STIFFNESS,
    );

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.telemetry.forwardSpeed = this.velocity.dot(this.forward);
    this.telemetry.speedKnots = speed * 1.943844;
    this.telemetry.apparentWindSpeed = apparentWindSpeed;
    this.telemetry.apparentWindAngle = apparentWindAngle;
    this.telemetry.depth = depth;
    this.telemetry.heel = this.roll;
    this.telemetry.leewardSide = leewardSide;
    this.telemetry.trueWindSpeed = this.windSample.speed;
    this.telemetry.gust = this.windSample.squall ?? 0;
    this.telemetry.gustApproaching = this.windSample.approaching ?? 0;
    this.telemetry.leeway = lateralSpeed;
    this.telemetry.sailLuff = this.sail.luff;
    this.telemetry.sheetAngle = this.sail.sheetAngle;
    this.telemetry.engineShaft = this.engineShaft;
    this.telemetry.grounding = grounding;

    if (
      !Number.isFinite(
        this.position.x + this.position.y + this.position.z + this.heading + this.roll + this.pitch +
          this.velocity.x + this.velocity.z,
      )
    ) {
      this.reset();
    }
  }

  /** Remembers the pose before a step, the earlier end of the span a frame is drawn in. */
  private rememberPose(): void {
    const previous = this.previousPose;
    previous.x = this.position.x;
    previous.y = this.position.y;
    previous.z = this.position.z;
    previous.heading = this.heading;
    previous.pitch = this.pitch;
    previous.roll = this.roll;
  }

  /**
   * Puts the yacht where she is `alpha` of the way from the previous step to
   * the latest one, for everything drawn this frame. Physics runs at a fixed
   * 60 Hz while frames arrive at the display's pace, so a frame is
   * sometimes drawn with no new step and sometimes with two; shown as they
   * are, steps of a quick yacht make her judder. Call `restorePose`
   * afterwards (the next step does too).
   */
  blendPose(alpha: number): void {
    if (this.blended) return;
    const amount = clamp(alpha, 0, 1);
    const previous = this.previousPose;
    const truth = this.truePose;
    truth.x = this.position.x;
    truth.y = this.position.y;
    truth.z = this.position.z;
    truth.heading = this.heading;
    truth.pitch = this.pitch;
    truth.roll = this.roll;
    this.blended = true;
    this.position.set(
      previous.x + (truth.x - previous.x) * amount,
      previous.y + (truth.y - previous.y) * amount,
      previous.z + (truth.z - previous.z) * amount,
    );
    const turn = Math.atan2(Math.sin(truth.heading - previous.heading), Math.cos(truth.heading - previous.heading));
    this.heading = previous.heading + turn * amount;
    this.pitch = previous.pitch + (truth.pitch - previous.pitch) * amount;
    this.roll = previous.roll + (truth.roll - previous.roll) * amount;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  restorePose(): void {
    if (!this.blended) return;
    const truth = this.truePose;
    this.position.set(truth.x, truth.y, truth.z);
    this.heading = truth.heading;
    this.pitch = truth.pitch;
    this.roll = truth.roll;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.blended = false;
  }

  /** Puts her at rest at (x, z) heading `heading` (a tow out of trouble). */
  relocate(x: number, z: number, heading: number): void {
    this.reset();
    this.position.set(x, FLOAT_HEIGHT, z);
    this.heading = heading;
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
    this.right.set(Math.cos(heading), 0, -Math.sin(heading));
    // No blend from where she was.
    this.rememberPose();
  }

  reset(): void {
    this.blended = false;
    this.position.set(START_POSITION.x, FLOAT_HEIGHT, START_POSITION.z);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.heaveVelocity = 0;
    this.previousSurfaceVelocity = 0;
    this.engineShaft = 0;
    this.guard.active = false;
    this.guard.urgency = 0;
    this.waveRollTarget = 0;
    this.wavePitchTarget = 0;
    this.waveSlopeForward = 0;
    this.waveSlopeRight = 0;
    this.surfaceHistory.length = 0;
    this.previousSurfaceVelocity = 0;
  }

  /**
   * Heave, pitch and roll are damped oscillators with the natural periods of a
   * cruising catamaran. Each one is driven toward the plane of the water under
   * the hulls plus the steady trim caused by sail, engine and turning loads, so
   * the yacht overshoots and settles instead of being glued to the surface.
   */
  private updateSeakeeping(delta: number, forwardSpeed: number, heelLoad: number, trimLoad: number): void {
    let averageHeight = 0;
    let bowHeight = 0;
    let sternHeight = 0;
    let portHeight = 0;
    let starboardHeight = 0;
    let bowCount = 0;
    let sternCount = 0;
    let portCount = 0;
    let starboardCount = 0;

    for (const [offsetX, offsetZ] of BUOYANCY_POINTS) {
      const worldX = this.position.x + this.right.x * offsetX + this.forward.x * offsetZ;
      const worldZ = this.position.z + this.right.z * offsetX + this.forward.z * offsetZ;
      const height = this.ocean.sample(worldX, worldZ).height;
      averageHeight += height;
      if (offsetZ > 2) { bowHeight += height; bowCount += 1; }
      if (offsetZ < -2) { sternHeight += height; sternCount += 1; }
      if (offsetX < 0) { portHeight += height; portCount += 1; }
      if (offsetX > 0) { starboardHeight += height; starboardCount += 1; }
    }

    averageHeight /= BUOYANCY_POINTS.length;
    bowHeight /= Math.max(1, bowCount);
    sternHeight /= Math.max(1, sternCount);
    portHeight /= Math.max(1, portCount);
    starboardHeight /= Math.max(1, starboardCount);

    // Slope of the water plane under the hulls. Bow and stern sample groups sit
    // 6.2 m apart on average; the hull centrelines are 3.1 m apart.
    this.waveSlopeForward = clamp((bowHeight - sternHeight) / 6.2, -0.3, 0.3);
    this.waveSlopeRight = clamp((starboardHeight - portHeight) / 3.1, -0.3, 0.3);

    const absoluteSpeed = Math.abs(forwardSpeed);
    const dynamicSquat = clamp(absoluteSpeed * absoluteSpeed * 0.004, 0, 0.1);
    const targetY = averageHeight + FLOAT_HEIGHT - dynamicSquat;
    // A storm swell lifts the hulls at several metres a second; the bounds only
    // catch a numerical jump.
    // Moving averages over three steps: they take a one-step flicker out of
    // the level, its rate and its change of rate, and delay a swell by only a
    // few hundredths of a second.
    const history = this.surfaceHistory;
    if (history.length === 0) history.push(targetY, targetY, targetY, targetY, targetY, targetY, targetY);
    history.unshift(targetY);
    history.length = 7;
    const recent = (history[0] + history[1] + history[2]) / 3;
    const earlier = (history[2] + history[3] + history[4]) / 3;
    const earliest = (history[4] + history[5] + history[6]) / 3;
    const step = Math.max(delta, 1e-4);
    const surfaceLevel = recent;
    const surfaceVelocity = clamp((recent - earlier) / (2 * step), -7, 7);
    const surfaceAcceleration = clamp((recent - 2 * earlier + earliest) / (4 * step * step), -12, 12);
    this.previousSurfaceVelocity = surfaceVelocity;
    const heaveAcceleration =
      surfaceAcceleration * HEAVE_FOLLOW +
      (surfaceLevel - this.position.y) * HEAVE_FREQUENCY * HEAVE_FREQUENCY +
      (surfaceVelocity - this.heaveVelocity) * 2 * HEAVE_DAMPING * HEAVE_FREQUENCY;
    this.heaveVelocity = clamp(this.heaveVelocity + heaveAcceleration * delta, -8, 8);
    this.position.y += this.heaveVelocity * delta;

    // Vessel.root uses +Z as the bow and applies rotation.z = -roll, so a
    // positive pitch lowers the bow and a positive roll lowers starboard.
    this.wavePitchTarget = clamp(-Math.atan(this.waveSlopeForward) * WAVE_PITCH_RESPONSE, -0.2, 0.2);
    this.waveRollTarget = clamp(-Math.atan(this.waveSlopeRight) * WAVE_ROLL_RESPONSE, -0.2, 0.2);
    const runningTrim = -clamp(absoluteSpeed * absoluteSpeed * 0.0009, 0, 0.03);
    const pitchTarget = clamp(this.wavePitchTarget + clamp(trimLoad, -0.06, 0.06) + runningTrim, -0.26, 0.26);
    const rollTarget = clamp(this.waveRollTarget + clamp(heelLoad, -0.2, 0.2), -0.34, 0.34);

    this.pitchRate +=
      ((pitchTarget - this.pitch) * PITCH_FREQUENCY * PITCH_FREQUENCY -
        this.pitchRate * 2 * PITCH_DAMPING * PITCH_FREQUENCY) * delta;
    this.pitchRate = clamp(this.pitchRate, -1.2, 1.2);
    this.pitch = clamp(this.pitch + this.pitchRate * delta, -0.32, 0.32);

    this.rollRate +=
      ((rollTarget - this.roll) * ROLL_FREQUENCY * ROLL_FREQUENCY -
        this.rollRate * 2 * ROLL_DAMPING * ROLL_FREQUENCY) * delta;
    this.rollRate = clamp(this.rollRate, -1.4, 1.4);
    this.roll = clamp(this.roll + this.rollRate * delta, -0.4, 0.4);
  }
}
