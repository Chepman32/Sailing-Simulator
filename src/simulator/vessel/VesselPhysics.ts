import * as THREE from "three";
import { clamp, smoothstep } from "../math";
import type { OceanSample } from "../environment/OceanMath";
import { sampleWind, type WindSample } from "../environment/WindMath";
import type { SimulatorControls } from "../types";
import { AIR_DENSITY, createSailState, solveSail, type SailState } from "./SailAerodynamics";
import { resolveShoreContact } from "./ShoreContact";

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
const AHEAD_BOLLARD_THRUST = 6800;
const ASTERN_BOLLARD_THRUST = 4200;
const IDLE_SHAFT_FRACTION = 0.3;
const SHAFT_SPOOL_UP = 1.5;
const SHAFT_SPOOL_DOWN = 2.3;
const THRUST_FADE_SPEED = 9.5;
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

export class VesselPhysics {
  readonly position = new THREE.Vector3(0, FLOAT_HEIGHT, 0);
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
  /** Signed propeller shaft speed as a fraction of maximum. */
  engineShaft = 0;
  telemetry: VesselTelemetry = {
    forwardSpeed: 0,
    speedKnots: 0,
    apparentWindSpeed: 8,
    apparentWindAngle: 1,
    depth: 18,
    heel: 0,
    leewardSide: 1,
    trueWindSpeed: 8,
    leeway: 0,
    sailLuff: 0,
    sheetAngle: 0.6,
    engineShaft: 0,
    grounding: 0,
    shoreImpact: 0,
  };

  private readonly windSample: WindSample = { x: 6.8, z: 4.2, speed: 8, gust: 1 };
  private readonly sail: SailState = createSailState();
  private time = 0;
  private waveRollTarget = 0;
  private wavePitchTarget = 0;
  private waveSlopeForward = 0;
  private waveSlopeRight = 0;
  private previousSurfaceTarget = FLOAT_HEIGHT;
  private surfaceTargetReady = false;

  constructor(
    private readonly ocean: OceanSampler,
    private readonly islands: IslandPhysics,
  ) {}

  fixedUpdate(delta: number, controls: SimulatorControls): void {
    this.time += delta;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));

    const forwardSpeed = this.velocity.dot(this.forward);
    const lateralSpeed = this.velocity.dot(this.right);
    const waterSpeedSquared = forwardSpeed * forwardSpeed + lateralSpeed * lateralSpeed;
    const depth = this.islands.depthAt(this.position.x, this.position.z);

    // --- Wind --------------------------------------------------------------
    sampleWind(this.time, this.windSample);
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

  reset(): void {
    this.position.set(0, FLOAT_HEIGHT, 0);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.heaveVelocity = 0;
    this.engineShaft = 0;
    this.waveRollTarget = 0;
    this.wavePitchTarget = 0;
    this.waveSlopeForward = 0;
    this.waveSlopeRight = 0;
    this.previousSurfaceTarget = FLOAT_HEIGHT;
    this.surfaceTargetReady = false;
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
    if (!this.surfaceTargetReady) {
      this.previousSurfaceTarget = targetY;
      this.surfaceTargetReady = true;
    }
    const surfaceVelocity = clamp((targetY - this.previousSurfaceTarget) / Math.max(delta, 1e-4), -2.4, 2.4);
    this.previousSurfaceTarget = targetY;
    const heaveAcceleration =
      (targetY - this.position.y) * HEAVE_FREQUENCY * HEAVE_FREQUENCY +
      (surfaceVelocity - this.heaveVelocity) * 2 * HEAVE_DAMPING * HEAVE_FREQUENCY;
    this.heaveVelocity = clamp(this.heaveVelocity + heaveAcceleration * delta, -3, 3);
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
