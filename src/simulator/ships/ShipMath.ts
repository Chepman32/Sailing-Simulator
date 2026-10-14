import { clamp, smoothstep } from "../math";

/**
 * Merchant ships and liners on passage far from the yacht.
 *
 * Everything here is pure: the ship types and their dimensions, where a ship
 * is planned to pass (a lane clear of the islands that brings her within a
 * few hundred metres to a kilometre of the yacht), how she steers (turning
 * slowly, giving way to starboard, keeping clear of shoal water), the hull
 * waterplane used both for collisions and for the foam along her sides, and
 * her wake: a Kelvin pattern of divergent and transverse waves, a turbulent
 * centreline of foam and a long smooth slick.
 *
 * The wake height is shared by the ocean's vertex stage, the CPU sampler the
 * yacht floats on (so a passing ship's wake really rocks her), and the
 * fragment stage that shades it; {@link SHIP_WAKE_GLSL} is generated from the
 * same constants as {@link sampleShipWake}.
 */

export type ShipKind = "container" | "tanker" | "cruise" | "bulk" | "carrier";

export type ShipSpec = {
  /** Length overall and beam, metres. */
  length: number;
  beam: number;
  /** Draught and freeboard to the main deck, metres. */
  draft: number;
  freeboard: number;
  /** Service speed through the water, m/s. */
  cruiseSpeed: number;
};

export const SHIP_SPECS: Record<ShipKind, ShipSpec> = {
  container: { length: 236, beam: 34, draft: 10.5, freeboard: 11, cruiseSpeed: 8.2 },
  tanker: { length: 222, beam: 38, draft: 12, freeboard: 7.5, cruiseSpeed: 6.6 },
  cruise: { length: 252, beam: 32, draft: 8.2, freeboard: 9, cruiseSpeed: 8.6 },
  bulk: { length: 188, beam: 30, draft: 10, freeboard: 8.5, cruiseSpeed: 6.8 },
  carrier: { length: 198, beam: 32, draft: 9, freeboard: 27, cruiseSpeed: 8 },
};

export const SHIP_KINDS = Object.keys(SHIP_SPECS) as ShipKind[];

/** Ships near the yacht at once: the slots of the ocean shader's wake. */
export const MAX_SHIPS = 4;
/** Of those, how many are under way; the rest lie at anchor. */
export const MOVING_SHIPS = 3;

/** Closest approach of a planned lane to the yacht, metres. */
export const LANE_MIN_PASSING = 340;
export const LANE_MAX_PASSING = 1000;
/** A new ship appears this far up her lane before the closest approach (in the haze). */
export const SPAWN_MIN_RUN = 1900;
export const SPAWN_MAX_RUN = 2400;
/** A ship this far from the yacht, and moving away, is replaced. */
export const RECYCLE_DISTANCE = 2700;
/** An anchored ship this far from the yacht is moved to a new anchorage. */
export const ANCHOR_RECYCLE_DISTANCE = 3200;
/** Deep water a lane keeps between itself and any coast, metres. */
export const LANE_SHORE_CLEARANCE = 150;
/** Fastest a ship's heading changes, rad/s (a large ship turns slowly). */
export const SHIP_MAX_TURN_RATE = 0.014;
/** Acceleration toward a new speed, m/s². */
export const SHIP_ACCELERATION = 0.03;

/** Kelvin half-angle tangent, tan 19.47°. */
export const KELVIN_TANGENT = 0.3536;
/** Divergent waves are shorter than the transverse ones (cos² of their angle to the track). */
export const DIVERGENT_WAVELENGTH_FACTOR = 0.67;
/** Wave amplitudes at the ship, metres, before decay along the wake. */
export const DIVERGENT_AMPLITUDE = 0.42;
export const TRANSVERSE_AMPLITUDE = 0.24;
/** Distance behind the bow over which the wake waves decay by e, metres. */
export const DIVERGENT_DECAY = 1100;
export const TRANSVERSE_DECAY = 800;
/** Seconds the white water of the wake lasts; the smooth slick lasts much longer. */
export const WAKE_FOAM_SECONDS = 48;
export const WAKE_SLICK_SECONDS = 280;
/** Where the parallel body of the planform ends toward the bow and stern (fractions of half the length). */
export const BOW_SHOULDER = 0.45;
export const STERN_SHOULDER = -0.62;

const GRAVITY = 9.81;

export type Ship = {
  kind: ShipKind;
  /** Half of the length and beam, metres. */
  halfLength: number;
  halfBeam: number;
  draft: number;
  x: number;
  z: number;
  /** Heading: 0 along +Z, increasing toward +X (as the yacht). */
  heading: number;
  /** Heading of the lane the ship is keeping to. */
  laneHeading: number;
  /** Speed through the water and the speed she is making for, m/s. */
  speed: number;
  targetSpeed: number;
  anchored: boolean;
  active: boolean;
  /** Seconds left of an avoiding turn, and its direction (+1 starboard). */
  avoidTime: number;
  avoidSide: number;
  /** Seconds before the next sound signal may be given. */
  hornCooldown: number;
  seed: number;
  /** Which colour scheme the hull is painted in. */
  scheme: number;
  /**
   * How much higher than her marks she floats, metres: a tanker or bulk
   * carrier in ballast shows a broad band of red antifouling.
   */
  ballast: number;
};

export type ShipWorld = {
  /** Metres from the nearest coast (negative on land). */
  shoreDistance(x: number, z: number): number;
  /** Direction the wind blows from, as a heading. */
  windFrom: number;
  time: number;
};

export type RandomSource = () => number;

const between = (random: RandomSource, min: number, max: number): number => min + (max - min) * random();

export function createShip(kind: ShipKind, random: RandomSource): Ship {
  const spec = SHIP_SPECS[kind];
  return {
    kind,
    halfLength: spec.length / 2,
    halfBeam: spec.beam / 2,
    draft: spec.draft,
    x: 0,
    z: 0,
    heading: 0,
    laneHeading: 0,
    speed: 0,
    targetSpeed: 0,
    anchored: false,
    active: false,
    avoidTime: 0,
    avoidSide: 1,
    hornCooldown: 30 + random() * 60,
    seed: random() * 1000,
    scheme: Math.floor(random() * 3),
    ballast: kind === "tanker" || kind === "bulk" ? (random() < 0.5 ? 3.2 + random() * 1.6 : 0.3) : kind === "container" ? random() * 1.4 : 0.2,
  };
}

/**
 * Half the waterplane's width at `along` metres forward of midships: a fine
 * entry at the bow, a long parallel body, a transom at the stern. Zero
 * beyond the ends.
 */
export function hullHalfWidth(halfLength: number, halfBeam: number, along: number): number {
  const t = along / halfLength;
  if (t >= 1 || t <= -1) return 0;
  if (t > BOW_SHOULDER) {
    const entry = (t - BOW_SHOULDER) / (1 - BOW_SHOULDER);
    return halfBeam * Math.sqrt(Math.max(0, 1 - Math.pow(entry, 1.8)));
  }
  if (t < STERN_SHOULDER) {
    const run = (STERN_SHOULDER - t) / (1 + STERN_SHOULDER);
    return halfBeam * (1 - 0.32 * run * run);
  }
  return halfBeam;
}

/** Ship-frame coordinates of a world point: along (+ toward the bow) and across (+ to starboard). */
export function shipLocal(ship: Pick<Ship, "x" | "z" | "heading">, x: number, z: number, out: { along: number; across: number }): void {
  const dx = x - ship.x;
  const dz = z - ship.z;
  const sine = Math.sin(ship.heading);
  const cosine = Math.cos(ship.heading);
  out.along = dx * sine + dz * cosine;
  out.across = dx * cosine - dz * sine;
}

const scratchLocal = { along: 0, across: 0 };

/** Approximate signed distance in metres from the hull's waterplane; negative inside. */
export function shipHullDistance(ship: Ship, x: number, z: number): number {
  shipLocal(ship, x, z, scratchLocal);
  const width = hullHalfWidth(ship.halfLength, ship.halfBeam, scratchLocal.along);
  return Math.max(Math.abs(scratchLocal.across) - width, Math.abs(scratchLocal.along) - ship.halfLength);
}

/**
 * Plans a lane: a straight course clear of every coast whose closest
 * approach to (yachtX, yachtZ) lies between {@link LANE_MIN_PASSING} and
 * {@link LANE_MAX_PASSING}. With `initial`, the ship is already near that
 * point (in view at the start); otherwise she appears far up the lane, in
 * the haze. Returns false if no clear lane was found.
 */
export function planLane(
  ship: Ship,
  world: ShipWorld,
  yachtX: number,
  yachtZ: number,
  others: readonly Ship[],
  random: RandomSource,
  initial = false,
  /** If given, the lane crosses ahead of the yacht on this bearing (so the ship is in view). */
  across?: number,
): boolean {
  const spec = SHIP_SPECS[ship.kind];
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const heading =
      across === undefined ? random() * Math.PI * 2 : across + (random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (random() - 0.5) * 0.9);
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    let side = random() < 0.5 ? 1 : -1;
    if (across !== undefined) side = forwardZ * Math.sin(across) - forwardX * Math.cos(across) >= 0 ? 1 : -1;
    const passing = across !== undefined ? between(random, 500, 900) : between(random, LANE_MIN_PASSING, LANE_MAX_PASSING);
    // Closest point of approach, abeam of the yacht.
    const cpaX = yachtX + forwardZ * passing * side;
    const cpaZ = yachtZ - forwardX * passing * side;
    const run =
      across !== undefined ? between(random, -250, 250) : initial ? between(random, -700, 900) : between(random, SPAWN_MIN_RUN, SPAWN_MAX_RUN);
    const startX = cpaX - forwardX * run;
    const startZ = cpaZ - forwardZ * run;
    // The whole passage must be in deep water, well off every island.
    let clear = true;
    // (Beyond that she keeps clear of shoals by herself; see `stepShip`.)
    for (let travelled = -200; travelled <= run + 1800 && clear; travelled += 60) {
      const px = startX + forwardX * travelled;
      const pz = startZ + forwardZ * travelled;
      if (world.shoreDistance(px, pz) < LANE_SHORE_CLEARANCE + ship.halfBeam) clear = false;
    }
    if (!clear) continue;
    // Keep away from the other ships' positions and tracks.
    const crowded = others.some((other) => {
      if (other === ship || !other.active) return false;
      if (Math.hypot(other.x - startX, other.z - startZ) < 700) return true;
      // Converging courses that would meet near the yacht are avoided too.
      const relativeHeading = Math.abs(Math.atan2(Math.sin(other.heading - heading), Math.cos(other.heading - heading)));
      return !other.anchored && relativeHeading < 0.35 && Math.hypot(other.x - cpaX, other.z - cpaZ) < 900;
    });
    if (crowded) continue;
    ship.x = startX;
    ship.z = startZ;
    ship.heading = heading;
    ship.laneHeading = heading;
    ship.targetSpeed = spec.cruiseSpeed * between(random, 0.88, 1.06);
    ship.speed = ship.targetSpeed;
    ship.anchored = false;
    ship.active = true;
    ship.avoidTime = 0;
    return true;
  }
  return false;
}

/**
 * Anchors the ship in open water `distance` metres from the yacht, roughly
 * along `bearing`, lying head to wind. Returns false if no anchorage fits.
 */
export function planAnchorage(
  ship: Ship,
  world: ShipWorld,
  yachtX: number,
  yachtZ: number,
  bearing: number,
  others: readonly Ship[],
  random: RandomSource,
  minDistance = 650,
  maxDistance = 1350,
): boolean {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const direction = bearing + between(random, -0.9, 0.9);
    const distance = between(random, minDistance, maxDistance);
    const x = yachtX + Math.sin(direction) * distance;
    const z = yachtZ + Math.cos(direction) * distance;
    if (world.shoreDistance(x, z) < 260) continue;
    if (others.some((other) => other !== ship && other.active && Math.hypot(other.x - x, other.z - z) < 600)) continue;
    ship.x = x;
    ship.z = z;
    ship.heading = world.windFrom;
    ship.laneHeading = world.windFrom;
    ship.speed = 0;
    ship.targetSpeed = 0;
    ship.anchored = true;
    ship.active = true;
    ship.avoidTime = 0;
    return true;
  }
  return false;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Whether a ship on `heading` from (x, z) would run toward shoal water within `reach`. */
function courseBlocked(world: ShipWorld, ship: Ship, heading: number, reach: number): boolean {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  for (let travelled = ship.halfLength; travelled <= reach; travelled += 50) {
    if (world.shoreDistance(ship.x + forwardX * travelled, ship.z + forwardZ * travelled) < ship.halfBeam + 90) return true;
  }
  return false;
}

/**
 * One step of a ship: keep to the lane, turn away from shoal water and, as
 * the give-way vessel in a crossing (another ship on her starboard side on
 * a collision course), alter course to starboard. An anchored ship swings
 * slowly to her anchor, head to wind.
 */
export function stepShip(ship: Ship, others: readonly Ship[], world: ShipWorld, delta: number): void {
  if (!ship.active) return;
  const dt = clamp(delta, 0, 0.1);
  ship.hornCooldown = Math.max(0, ship.hornCooldown - dt);
  if (ship.anchored) {
    const swing = world.windFrom + Math.sin(world.time * 0.021 + ship.seed) * 0.16;
    const error = wrapAngle(swing - ship.heading);
    ship.heading = wrapAngle(ship.heading + clamp(error * 0.05, -0.002, 0.002) * dt * 60);
    ship.speed = Math.max(0, ship.speed - SHIP_ACCELERATION * dt);
    return;
  }

  let desired = ship.laneHeading;
  ship.avoidTime = Math.max(0, ship.avoidTime - dt);
  const lookAhead = ship.halfLength * 2 + ship.speed * 70;
  if (courseBlocked(world, ship, ship.heading, lookAhead)) {
    // Pick the side that opens up first and hold it for a while.
    if (ship.avoidTime <= 0) {
      ship.avoidSide = 1;
      for (const offset of [0.4, 0.8, 1.2]) {
        if (!courseBlocked(world, ship, ship.heading + offset, lookAhead)) {
          ship.avoidSide = 1;
          break;
        }
        if (!courseBlocked(world, ship, ship.heading - offset, lookAhead)) {
          ship.avoidSide = -1;
          break;
        }
      }
    }
    ship.avoidTime = 40;
  }
  // Crossing situations: give way to a ship on the starboard side.
  for (const other of others) {
    if (other === ship || !other.active) continue;
    const dx = other.x - ship.x;
    const dz = other.z - ship.z;
    const range = Math.hypot(dx, dz);
    if (range > 2200) continue;
    const relativeVX = Math.sin(other.heading) * other.speed - Math.sin(ship.heading) * ship.speed;
    const relativeVZ = Math.cos(other.heading) * other.speed - Math.cos(ship.heading) * ship.speed;
    const closing = relativeVX * relativeVX + relativeVZ * relativeVZ;
    if (closing < 1e-4) continue;
    const timeToClosest = -(dx * relativeVX + dz * relativeVZ) / closing;
    if (timeToClosest < 0 || timeToClosest > 420) continue;
    const missX = dx + relativeVX * timeToClosest;
    const missZ = dz + relativeVZ * timeToClosest;
    const safe = ship.halfLength + other.halfLength + 220;
    if (Math.hypot(missX, missZ) > safe) continue;
    const bearing = wrapAngle(Math.atan2(dx, dz) - ship.heading);
    if (other.anchored || (bearing > -0.2 && bearing < 1.96)) {
      ship.avoidSide = 1;
      ship.avoidTime = Math.max(ship.avoidTime, 30);
    }
  }
  if (ship.avoidTime > 0) desired = ship.heading + ship.avoidSide * 0.6;
  const error = wrapAngle(desired - ship.heading);
  ship.heading = wrapAngle(ship.heading + clamp(error * 0.08, -SHIP_MAX_TURN_RATE, SHIP_MAX_TURN_RATE) * dt);
  // A large ship slows a little while turning hard.
  const turning = Math.abs(error) > 0.3 ? 0.85 : 1;
  const target = ship.targetSpeed * turning;
  ship.speed += clamp(target - ship.speed, -SHIP_ACCELERATION * dt, SHIP_ACCELERATION * dt);
  ship.x += Math.sin(ship.heading) * ship.speed * dt;
  ship.z += Math.cos(ship.heading) * ship.speed * dt;
}

/** Whether the ship should be replaced: far from the yacht and not coming back. */
export function shipOutOfRange(ship: Ship, yachtX: number, yachtZ: number): boolean {
  if (!ship.active) return true;
  const dx = ship.x - yachtX;
  const dz = ship.z - yachtZ;
  const distance = Math.hypot(dx, dz);
  if (ship.anchored) return distance > ANCHOR_RECYCLE_DISTANCE;
  const receding = dx * Math.sin(ship.heading) + dz * Math.cos(ship.heading) > 0;
  return distance > RECYCLE_DISTANCE && receding;
}

export type HornSignal = "danger" | "prolonged" | null;

/**
 * Sound signals: five short blasts when the yacht stands into the ship's
 * path close ahead; now and then one prolonged blast as she passes.
 */
export function shipHornSignal(ship: Ship, yachtX: number, yachtZ: number, random: RandomSource): HornSignal {
  if (!ship.active || ship.hornCooldown > 0 || ship.anchored) return null;
  shipLocal(ship, yachtX, yachtZ, scratchLocal);
  const ahead = scratchLocal.along - ship.halfLength;
  if (ahead > 0 && ahead < 650 && Math.abs(scratchLocal.across) < ship.halfBeam + 70) {
    ship.hornCooldown = 40;
    return "danger";
  }
  const distance = Math.hypot(scratchLocal.along, scratchLocal.across);
  if (distance < 1400 && random() < 0.004) {
    ship.hornCooldown = 240;
    return "prolonged";
  }
  return null;
}

/**
 * Pushes a body of radius `radius` at (x, z) out of the hull. Returns how far
 * it was inside (0 if clear) and the outward normal in `normal`.
 */
export function shipContact(ship: Ship, x: number, z: number, radius: number, normal: { x: number; z: number }): number {
  const distance = shipHullDistance(ship, x, z) - radius;
  if (distance >= 0) return 0;
  const step = 0.5;
  const gx = shipHullDistance(ship, x + step, z) - shipHullDistance(ship, x - step, z);
  const gz = shipHullDistance(ship, x, z + step) - shipHullDistance(ship, x, z - step);
  const length = Math.hypot(gx, gz);
  if (length < 1e-6) {
    normal.x = Math.cos(ship.heading);
    normal.z = -Math.sin(ship.heading);
  } else {
    normal.x = gx / length;
    normal.z = gz / length;
  }
  return -distance;
}

export type ShipWakeSample = {
  height: number;
  slopeX: number;
  slopeZ: number;
  foam: number;
  slick: number;
};

/** How much of a wake a ship at `speed` m/s makes (0 at rest, 1 at service speed). */
export function wakeStrength(speed: number): number {
  return smoothstep(2.5, 6.5, speed);
}

/**
 * Adds one ship's wake at (x, z) to `out`: wave height and slope, white
 * water and slick. The transverse waves follow the ship at her own speed
 * (wavenumber g/V²); the divergent waves lie along the Kelvin arms.
 */
export function sampleShipWake(ship: Ship, x: number, z: number, out: ShipWakeSample): ShipWakeSample {
  if (!ship.active) return out;
  shipLocal(ship, x, z, scratchLocal);
  const along = scratchLocal.along;
  const across = scratchLocal.across;
  const halfLength = ship.halfLength;
  const halfBeam = ship.halfBeam;
  const speed = Math.max(ship.speed, 0);
  const strength = wakeStrength(speed);
  const fromBow = halfLength - along;
  const side = Math.abs(across);
  if (fromBow < -14 || side > KELVIN_TANGENT * Math.max(fromBow, 0) + halfBeam + 60 || fromBow > speed * 600 + 500) return out;
  const sine = Math.sin(ship.heading);
  const cosine = Math.cos(ship.heading);
  const sign = across >= 0 ? 1 : -1;

  if (strength > 0 && fromBow > 0) {
    const transverseK = GRAVITY / Math.max(speed * speed, 1);
    const divergentK = transverseK / DIVERGENT_WAVELENGTH_FACTOR;
    // Divergent waves: crests along each arm, inside the wedge.
    const arm = side - KELVIN_TANGENT * fromBow - halfBeam * 0.5;
    const divergentEnvelope = smoothstep(-(0.2 * fromBow + 15), 0, arm) * (1 - smoothstep(0, 8, arm));
    const divergentAmplitude = DIVERGENT_AMPLITUDE * strength * Math.exp(-fromBow / DIVERGENT_DECAY) * divergentEnvelope;
    const divergentPhase = divergentK * arm;
    out.height += divergentAmplitude * Math.sin(divergentPhase);
    // ∂arm/∂along = +tan, ∂arm/∂across = sign.
    const divergentSlope = divergentAmplitude * divergentK * Math.cos(divergentPhase);
    const slopeAlong = divergentSlope * KELVIN_TANGENT;
    const slopeAcross = divergentSlope * sign;
    // Transverse waves: crests across the track, following the ship.
    const ratio = side / (KELVIN_TANGENT * fromBow + 1);
    const transverseEnvelope = (1 - smoothstep(0.6, 1, ratio)) * smoothstep(0, 30, fromBow);
    const transverseAmplitude =
      TRANSVERSE_AMPLITUDE * strength * Math.exp(-fromBow / TRANSVERSE_DECAY) * transverseEnvelope;
    const transversePhase = transverseK * fromBow;
    out.height += transverseAmplitude * Math.sin(transversePhase);
    const transverseSlopeAlong = -transverseAmplitude * transverseK * Math.cos(transversePhase);
    const totalAlong = slopeAlong + transverseSlopeAlong;
    // Ship frame → world: along is (sin h, cos h), across is (cos h, −sin h).
    out.slopeX += totalAlong * sine + slopeAcross * cosine;
    out.slopeZ += totalAlong * cosine - slopeAcross * sine;
    // White water breaking along the arms close to the ship.
    const armWidth = 2 + fromBow * 0.015;
    // The bow wave itself ("a bone in her teeth") is whitest at the stem.
    const bowWave = 1 + 0.8 * Math.exp(-fromBow / (0.25 * halfLength));
    const armFoam = Math.exp(-((arm / armWidth) ** 2)) * strength * Math.exp(-fromBow / (22 * speed + 1)) * 0.8 * bowWave;
    out.foam = Math.max(out.foam, armFoam);
  }

  // Turbulent wake astern: propeller wash and the hull's boundary layer.
  const behind = -along - halfLength;
  const spread = halfBeam * (1 + 0.45 * Math.sqrt(Math.max(behind, 0) / halfBeam));
  const core = Math.exp(-2 * (across / spread) ** 2) * smoothstep(-0.3 * halfLength, 0, behind);
  const age = Math.max(behind, 0) / Math.max(speed, 0.5);
  out.foam = Math.max(out.foam, core * strength * Math.exp(-age / WAKE_FOAM_SECONDS));
  out.slick = Math.max(out.slick, core * strength * Math.exp(-age / WAKE_SLICK_SECONDS));

  // Water piled against the hull: a lapping line at anchor, a bow wave under way.
  const hull = Math.max(side - hullHalfWidth(halfLength, halfBeam, along), Math.abs(along) - halfLength);
  const bow = smoothstep(0.2 * halfLength, halfLength, along);
  const contactWidth = 1.5 + speed * 0.6 * (0.4 + bow);
  const contact = (1 - smoothstep(0, contactWidth, hull)) * (hull > -0.5 ? 1 : 0);
  out.foam = Math.max(out.foam, contact * (0.25 + strength * (0.3 + 0.6 * bow)));
  return out;
}

export function emptyWakeSample(): ShipWakeSample {
  return { height: 0, slopeX: 0, slopeZ: 0, foam: 0, slick: 0 };
}

const glsl = (value: number): string => (Number.isInteger(value) ? `${value}.0` : value.toFixed(6));

/**
 * GLSL twin of {@link sampleShipWake}, summed over the ship slots. Declares
 * `uShipPose[i]` = (x, z, sin heading, cos heading) and `uShipShape[i]` =
 * (speed, half length, half beam, active). `shipWakes` returns (foam, slick)
 * and adds height and slope through its out parameters.
 */
export const SHIP_WAKE_GLSL = /* glsl */ `
  #ifndef SHIP_WAKE_GLSL
  #define SHIP_WAKE_GLSL
  uniform vec4 uShipPose[${MAX_SHIPS}];
  uniform vec4 uShipShape[${MAX_SHIPS}];

  float shipHalfWidth(float halfLength, float halfBeam, float along) {
    float t = along / halfLength;
    if (abs(t) >= 1.0) return 0.0;
    if (t > ${glsl(BOW_SHOULDER)}) {
      float entry = (t - ${glsl(BOW_SHOULDER)}) / ${glsl(1 - BOW_SHOULDER)};
      return halfBeam * sqrt(max(0.0, 1.0 - pow(entry, 1.8)));
    }
    if (t < ${glsl(STERN_SHOULDER)}) {
      float run = (${glsl(STERN_SHOULDER)} - t) / ${glsl(1 + STERN_SHOULDER)};
      return halfBeam * (1.0 - 0.32 * run * run);
    }
    return halfBeam;
  }

  vec2 shipWake(vec4 pose, vec4 shape, vec2 position, inout float height, inout vec2 slope) {
    if (shape.w < 0.5) return vec2(0.0);
    vec2 relative = position - pose.xy;
    float along = relative.x * pose.z + relative.y * pose.w;
    float across = relative.x * pose.w - relative.y * pose.z;
    float speed = max(shape.x, 0.0);
    float halfLength = shape.y;
    float halfBeam = shape.z;
    float fromBow = halfLength - along;
    float side = abs(across);
    if (fromBow < -14.0 || side > ${glsl(KELVIN_TANGENT)} * max(fromBow, 0.0) + halfBeam + 60.0 || fromBow > speed * 600.0 + 500.0) {
      return vec2(0.0);
    }
    float strength = smoothstep(2.5, 6.5, speed);
    float signAcross = across >= 0.0 ? 1.0 : -1.0;
    float foam = 0.0;
    if (strength > 0.0 && fromBow > 0.0) {
      float transverseK = ${glsl(GRAVITY)} / max(speed * speed, 1.0);
      float divergentK = transverseK / ${glsl(DIVERGENT_WAVELENGTH_FACTOR)};
      float arm = side - ${glsl(KELVIN_TANGENT)} * fromBow - halfBeam * 0.5;
      float divergentEnvelope = smoothstep(-(0.2 * fromBow + 15.0), 0.0, arm) * (1.0 - smoothstep(0.0, 8.0, arm));
      float divergentAmplitude = ${glsl(DIVERGENT_AMPLITUDE)} * strength * exp(-fromBow / ${glsl(DIVERGENT_DECAY)}) * divergentEnvelope;
      float divergentPhase = divergentK * arm;
      height += divergentAmplitude * sin(divergentPhase);
      float divergentSlope = divergentAmplitude * divergentK * cos(divergentPhase);
      float slopeAlong = divergentSlope * ${glsl(KELVIN_TANGENT)};
      float slopeAcross = divergentSlope * signAcross;
      float ratio = side / (${glsl(KELVIN_TANGENT)} * fromBow + 1.0);
      float transverseEnvelope = (1.0 - smoothstep(0.6, 1.0, ratio)) * smoothstep(0.0, 30.0, fromBow);
      float transverseAmplitude = ${glsl(TRANSVERSE_AMPLITUDE)} * strength * exp(-fromBow / ${glsl(TRANSVERSE_DECAY)}) * transverseEnvelope;
      float transversePhase = transverseK * fromBow;
      height += transverseAmplitude * sin(transversePhase);
      float totalAlong = slopeAlong - transverseAmplitude * transverseK * cos(transversePhase);
      slope += vec2(totalAlong * pose.z + slopeAcross * pose.w, totalAlong * pose.w - slopeAcross * pose.z);
      float armWidth = 2.0 + fromBow * 0.015;
      float bowWave = 1.0 + 0.8 * exp(-fromBow / (0.25 * halfLength));
      foam = exp(-(arm / armWidth) * (arm / armWidth)) * strength * exp(-fromBow / (22.0 * speed + 1.0)) * 0.8 * bowWave;
    }
    float behind = -along - halfLength;
    float spread = halfBeam * (1.0 + 0.45 * sqrt(max(behind, 0.0) / halfBeam));
    float core = exp(-2.0 * (across / spread) * (across / spread)) * smoothstep(-0.3 * halfLength, 0.0, behind);
    float age = max(behind, 0.0) / max(speed, 0.5);
    foam = max(foam, core * strength * exp(-age / ${glsl(WAKE_FOAM_SECONDS)}));
    float slick = core * strength * exp(-age / ${glsl(WAKE_SLICK_SECONDS)});
    float hull = max(side - shipHalfWidth(halfLength, halfBeam, along), abs(along) - halfLength);
    float bow = smoothstep(0.2 * halfLength, halfLength, along);
    float contactWidth = 1.5 + speed * 0.6 * (0.4 + bow);
    float contact = (1.0 - smoothstep(0.0, contactWidth, hull)) * step(-0.5, hull);
    foam = max(foam, contact * (0.25 + strength * (0.3 + 0.6 * bow)));
    return vec2(foam, slick);
  }

  vec2 shipWakes(vec2 position, inout float height, inout vec2 slope) {
    vec2 result = vec2(0.0);
    for (int slot = 0; slot < ${MAX_SHIPS}; slot++) {
      result = max(result, shipWake(uShipPose[slot], uShipShape[slot], position, height, slope));
    }
    return result;
  }
  #endif
`;

/**
 * Wake uniforms shared by reference with the ocean material: per slot
 * (x, z, sin heading, cos heading) and (speed, half length, half beam, active).
 */
export const SHIP_WAKE_UNIFORMS = {
  uShipPose: { value: new Float32Array(MAX_SHIPS * 4) },
  uShipShape: { value: new Float32Array(MAX_SHIPS * 4) },
};

/** Copies the ships' state into {@link SHIP_WAKE_UNIFORMS}. */
export function writeShipUniforms(ships: readonly Ship[]): void {
  const pose = SHIP_WAKE_UNIFORMS.uShipPose.value;
  const shape = SHIP_WAKE_UNIFORMS.uShipShape.value;
  for (let slot = 0; slot < MAX_SHIPS; slot += 1) {
    const ship = ships[slot];
    const active = ship?.active ?? false;
    pose[slot * 4] = active ? ship!.x : 0;
    pose[slot * 4 + 1] = active ? ship!.z : 0;
    pose[slot * 4 + 2] = active ? Math.sin(ship!.heading) : 0;
    pose[slot * 4 + 3] = active ? Math.cos(ship!.heading) : 1;
    shape[slot * 4] = active ? ship!.speed : 0;
    shape[slot * 4 + 1] = active ? ship!.halfLength : 1;
    shape[slot * 4 + 2] = active ? ship!.halfBeam : 1;
    shape[slot * 4 + 3] = active ? 1 : 0;
  }
}

/** Sum of every ship's wake at (x, z). */
export function sampleShipWakes(ships: readonly Ship[], x: number, z: number, out: ShipWakeSample): ShipWakeSample {
  out.height = 0;
  out.slopeX = 0;
  out.slopeZ = 0;
  out.foam = 0;
  out.slick = 0;
  for (const ship of ships) sampleShipWake(ship, x, z, out);
  return out;
}
