import { clamp } from "../math";

/**
 * The skipper on his own feet and in the water: pure numbers.
 *
 * He can leave the helm, walk the deck (`DeckField` gives the floor), jump
 * or step off into the sea, swim on the surface with his head out of the
 * water riding the waves, and dive with a scuba set: neutral buoyancy, fins,
 * a tank that drains faster the deeper he is (the air he breathes is at the
 * pressure of the water round him) and is topped up aboard. An empty tank
 * sends him straight back up; he never drowns.
 *
 * Everything here is in world metres and seconds; yaw is the heading of the
 * view (0 looks along +Z, as the yacht's heading does) and pitch is positive
 * looking up.
 */

/**
 * Where the skipper is: at the wheel, leaping over the side (a short scripted
 * first-person animation), on deck, in the water, or on his feet ashore (on a
 * beach, wading in the shallows, anywhere on an island).
 */
export type DiverMode = "helm" | "leap" | "deck" | "swim" | "land";

/** Eye height over the deck or the sand, standing. */
export const EYE_HEIGHT = 1.62;
/** Walking and running on deck, m/s. */
export const WALK_SPEED = 1.45;
export const RUN_SPEED = 2.9;
export const JUMP_SPEED = 3.7;
export const GRAVITY = 9.81;
/** The highest step taken without a jump (a coaming, a cockpit step). */
export const STEP_UP = 0.42;
/** Eyes above the water while floating at the surface, head out. */
export const SURFACE_EYE = 0.13;
/** Swimming at the surface (no fins needed for the crawl), and with fins below it, m/s. */
export const SURFACE_SWIM_SPEED = 1.15;
export const SURFACE_SPRINT_SPEED = 1.9;
export const DIVE_SPEED = 1.75;
export const DIVE_SPRINT_SPEED = 3.1;
/** Rising or sinking on purpose, m/s. */
export const VERTICAL_SPEED = 1.35;
/** How quickly the water lets him reach the speed he swims for, and how it slows him when he stops (1/s). */
export const SWIM_RESPONSE = 2.4;
export const GLIDE_DRAG = 1.1;
/** Below this depth (eyes under the surface, m) he is diving, not floating. */
export const DIVE_DEPTH = 0.55;
/** Closest the eyes come to the sand, m. */
export const SEABED_CLEARANCE = 0.55;

/** Upward speed of a kick out of the water at the surface (a swimmer's lunge), m/s. */
export const HOP_SPEED = 2.6;
/** Water shallower than this under a swimmer and he stands up (m, surface to ground). */
export const WADE_START = 1.05;
/** Water deeper than this under a wader and he swims again. */
export const SWIM_START = 1.3;
/** Walking pace through water as deep as the hips is this share of the dry pace. */
export const WADE_SLOWDOWN = 0.55;
/** Steepest ground he walks up without a jump (rise over run). */
export const MAX_WALK_SLOPE = 1.6;

/** Seconds of air in a full tank breathed at the surface (12 l at 200 bar, a relaxed breath). */
export const TANK_SECONDS = 50 * 60;
/** Air below this share of a tank: the gauge warns. */
export const LOW_AIR = 0.15;
/** Seconds to swap the tank for a full one aboard. */
export const REFILL_SECONDS = 4;

export type SwimInput = {
  /** Strafe (−1 left … 1 right) and forward (−1 back … 1 ahead). */
  moveX: number;
  moveY: number;
  /** Up (+1) or down (−1) on purpose. */
  vertical: number;
  sprint: boolean;
  yaw: number;
  pitch: number;
};

export type SwimWorld = {
  /** Height of the water surface at (x, z), m. */
  surface: (x: number, z: number) => number;
  /** Depth of water at (x, z), m (positive). */
  seabedDepth: (x: number, z: number) => number;
  /**
   * Height the floating eyes keep clear of at (x, z), m. The drawn sea is a
   * mesh of triangles a metre or two across: between its vertices it can lie
   * a hand's breadth above the exact surface, and eyes that dipped into it
   * would see the water from inside. Defaults to `surface`.
   */
  floatLine?: (x: number, z: number) => number;
};

export type SwimState = {
  /** Eye position, m. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Air left, 0…1 of a tank. */
  air: number;
  /** Seconds since the last breath began (the regulator's cycle). */
  breath: number;
  /** He is heading for the surface whatever the input (an empty tank). */
  ascending: boolean;
  /** The water surface over him at the last step (for its rise and fall). */
  surface: number;
  /** Out of the water in a kick from the surface: falling freely until he is back. */
  airborne: boolean;
  /** Set by the step in which an airborne swimmer fell back in (his speed down, m/s); cleared by the caller. */
  splashed: number;
};

export function createSwimState(x: number, y: number, z: number, air = 1): SwimState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, air, breath: 0, ascending: false, surface: Number.NaN, airborne: false, splashed: 0 };
}

/**
 * A kick up out of the water from the surface (the jump key while floating):
 * head and shoulders clear the water for a moment, then he drops back in.
 * Returns whether he kicked (not while diving, nor already in the air).
 */
export function hop(state: SwimState, world: SwimWorld): boolean {
  if (state.airborne) return false;
  const depth = eyeDepth(state, world);
  if (depth > DIVE_DEPTH * 0.8) return false;
  state.airborne = true;
  state.vy = HOP_SPEED;
  return true;
}

/** Pressure of the water at `depth` metres, in atmospheres. */
export function ambientPressure(depth: number): number {
  return 1 + Math.max(0, depth) / 10;
}

/**
 * Share of a tank breathed per second at `depth`, a little more when
 * swimming hard. At the surface with his head out he breathes the air.
 */
export function airUse(depth: number, sprinting: boolean): number {
  if (depth < DIVE_DEPTH * 0.6) return 0;
  return (ambientPressure(depth) * (sprinting ? 1.6 : 1)) / TANK_SECONDS;
}

/** Seconds of one breath at `depth`: slower and deeper when relaxed, quicker when working. */
export function breathPeriod(sprinting: boolean): number {
  return sprinting ? 3.1 : 4.6;
}

/** View direction for a yaw and pitch (unit vector). */
export function lookDirection(yaw: number, pitch: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const c = Math.cos(pitch);
  out.x = Math.sin(yaw) * c;
  out.y = Math.sin(pitch);
  out.z = Math.cos(yaw) * c;
  return out;
}

/** Depth of the eyes under the local surface (negative above it). */
export function eyeDepth(state: SwimState, world: SwimWorld): number {
  return world.surface(state.x, state.z) - state.y;
}

/**
 * Whether he floats at the surface: near it, and not swimming down (asking
 * for it, or swimming ahead while looking well down: a duck dive).
 */
export function isFloating(depth: number, input: SwimInput, ascending: boolean): boolean {
  if (ascending) return depth < DIVE_DEPTH;
  const duckDive = input.moveY > 0.3 && input.pitch < -0.45;
  return depth < DIVE_DEPTH && input.vertical >= 0 && !duckDive;
}

/**
 * One step of swimming. Returns how far under the surface the eyes are
 * afterwards (negative above it).
 */
export function stepSwim(state: SwimState, input: SwimInput, world: SwimWorld, dt: number): number {
  const step = clamp(dt, 0, 0.05);
  if (step <= 0) return eyeDepth(state, world);
  const depthBefore = eyeDepth(state, world);
  if (state.air <= 0) state.ascending = true;
  if (state.ascending && depthBefore < DIVE_DEPTH * 0.5) state.ascending = false;
  const floating = isFloating(depthBefore, input, state.ascending);

  // What he swims for.
  let wishX = 0;
  let wishY = 0;
  let wishZ = 0;
  const sinYaw = Math.sin(input.yaw);
  const cosYaw = Math.cos(input.yaw);
  const moveX = clamp(input.moveX, -1, 1);
  const moveY = clamp(input.moveY, -1, 1);
  if (floating) {
    // On the surface the crawl goes where he faces, level.
    wishX = sinYaw * moveY - cosYaw * moveX;
    wishZ = cosYaw * moveY + sinYaw * moveX;
  } else {
    // Under it, fins drive him along his line of sight.
    const look = lookDirection(input.yaw, input.pitch);
    wishX = look.x * moveY - cosYaw * moveX;
    wishY = look.y * moveY;
    wishZ = look.z * moveY + sinYaw * moveX;
  }
  const length = Math.hypot(wishX, wishY, wishZ);
  if (length > 1) {
    wishX /= length;
    wishY /= length;
    wishZ /= length;
  }
  const speed = floating
    ? input.sprint ? SURFACE_SPRINT_SPEED : SURFACE_SWIM_SPEED
    : input.sprint ? DIVE_SPRINT_SPEED : DIVE_SPEED;
  const targetVx = wishX * speed;
  const targetVz = wishZ * speed;
  let targetVy = wishY * speed + clamp(input.vertical, -1, 1) * VERTICAL_SPEED;
  if (state.ascending) targetVy = Math.max(targetVy, VERTICAL_SPEED * 0.8);

  const effort = Math.hypot(moveX, moveY) + Math.abs(input.vertical);
  const response = 1 - Math.exp(-(effort > 0.05 ? SWIM_RESPONSE : GLIDE_DRAG) * step);
  const floatLine = world.floatLine ?? world.surface;
  if (state.airborne) {
    // Out of the water for a moment: gravity alone, the way he was going.
    state.vy -= GRAVITY * step;
  } else {
    state.vx += (targetVx - state.vx) * response;
    state.vz += (targetVz - state.vz) * response;
  }
  if (state.airborne) {
    // Falling: nothing to add.
  } else if (floating) {
    // Head out of the water, carried up and down by the waves: a stiff,
    // well damped spring to the float line.
    const surface = floatLine(state.x, state.z);
    const rise = Number.isFinite(state.surface) ? clamp((surface - state.surface) / step, -4, 4) : 0;
    const goal = surface + SURFACE_EYE;
    state.vy += ((goal - state.y) * 30 + (rise - state.vy) * 9) * step;
  } else {
    state.vy += (targetVy - state.vy) * (1 - Math.exp(-(Math.abs(targetVy) > 0.05 ? SWIM_RESPONSE : GLIDE_DRAG) * step));
  }

  state.x += state.vx * step;
  state.y += state.vy * step;
  state.z += state.vz * step;

  // Never out of the water (but for a kick), never into the sand.
  const surfaceNow = world.surface(state.x, state.z);
  const lineNow = floatLine(state.x, state.z);
  if (state.airborne) {
    if (state.vy < 0 && state.y <= lineNow + SURFACE_EYE) {
      state.airborne = false;
      state.splashed = -state.vy;
      // The water takes most of the fall.
      state.vy *= 0.35;
    }
  } else if (state.y > lineNow + SURFACE_EYE + 0.08) {
    state.y = lineNow + SURFACE_EYE + 0.08;
    state.vy = Math.min(state.vy, 0);
  }
  const floor = -world.seabedDepth(state.x, state.z) + SEABED_CLEARANCE;
  if (state.y < floor) {
    state.y = floor;
    state.vy = Math.max(state.vy, 0);
  }

  state.surface = lineNow;
  const depth = surfaceNow - state.y;
  state.air = clamp(state.air - airUse(depth, input.sprint) * step, 0, 1);
  state.breath += step;
  return depth;
}

// --- On his feet ashore -------------------------------------------------------

/** Half the width of his body: how close he comes to a trunk or a wall, m. */
export const BODY_RADIUS = 0.3;

export type GroundWorld = {
  /** Height of whatever he stands on at (x, z): a beach, a hillside, the sand under the shallows, m. */
  ground: (x: number, z: number) => number;
  /** Height of the water surface at (x, z), m. */
  surface: (x: number, z: number) => number;
  /**
   * Distance from (x, z) to the nearest solid thing standing on the ground
   * (a palm trunk, a lighthouse, a hut; negative inside) and its outward
   * direction in `normal`; Infinity where there is none.
   */
  obstacle?: (x: number, z: number, normal: { x: number; z: number }) => number;
};

export type WalkInput = {
  /** Strafe (−1 left … 1 right) and forward (−1 back … 1 ahead). */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** View heading (0 looks along +Z). */
  yaw: number;
  /** The jump key went down this step. */
  jump: boolean;
};

export type WalkState = {
  /** Feet, m (world). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** Set by the step in which he came down from a jump or a fall (his speed down, m/s); cleared by the caller. */
  landed: number;
};

export function createWalkState(x: number, y: number, z: number): WalkState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, landed: 0 };
}

/** Water over the ground at (x, z), m (0 on dry land). */
export function wadingDepth(x: number, z: number, world: GroundWorld): number {
  return Math.max(0, world.surface(x, z) - world.ground(x, z));
}

/**
 * One step on his own feet in the world: walking or running where he faces,
 * slowed by water as deep as his knees or hips, up any slope a person
 * climbs (steeper ground stops him like a wall, so a cliff wants a jump),
 * round trunks and towers, jumping, falling and landing.
 */
export function stepWalk(state: WalkState, input: WalkInput, world: GroundWorld, dt: number, normal = { x: 0, z: 0 }): void {
  const step = clamp(dt, 0, 0.05);
  if (step <= 0) return;
  const water = wadingDepth(state.x, state.z, world);
  // Up to the knees he hardly notices; up to the hips it is a slog.
  const wade = 1 - (1 - WADE_SLOWDOWN) * clamp((water - 0.15) / 0.75, 0, 1);
  const speed = (input.sprint ? RUN_SPEED * 1.25 : WALK_SPEED * 1.1) * wade;
  const sinYaw = Math.sin(input.yaw);
  const cosYaw = Math.cos(input.yaw);
  const moveX = clamp(input.moveX, -1, 1);
  const moveY = clamp(input.moveY, -1, 1);
  let wishX = sinYaw * moveY - cosYaw * moveX;
  let wishZ = cosYaw * moveY + sinYaw * moveX;
  const length = Math.hypot(wishX, wishZ);
  if (length > 1) {
    wishX /= length;
    wishZ /= length;
  }
  const control = state.grounded ? 12 : 1.5;
  const response = 1 - Math.exp(-control * step);
  state.vx += (wishX * speed - state.vx) * response;
  state.vz += (wishZ * speed - state.vz) * response;

  // Across the ground one axis at a time, so a slope too steep or a wall
  // stops that axis only and he slides along it.
  for (let axis = 0; axis < 2; axis += 1) {
    const move = (axis === 0 ? state.vx : state.vz) * step;
    if (Math.abs(move) < 1e-7) continue;
    const nextX = axis === 0 ? state.x + move : state.x;
    const nextZ = axis === 0 ? state.z : state.z + move;
    const ground = world.ground(nextX, nextZ);
    const rise = ground - state.y;
    const blocked = state.grounded ? rise > Math.max(0.05, Math.abs(move) * MAX_WALK_SLOPE) : rise > 0.05;
    if (blocked) {
      if (axis === 0) state.vx = 0;
      else state.vz = 0;
      continue;
    }
    state.x = nextX;
    state.z = nextZ;
  }

  // Trunks, towers and walls: pushed back out, the speed into them lost.
  if (world.obstacle) {
    const clearance = world.obstacle(state.x, state.z, normal) - BODY_RADIUS;
    if (clearance < 0) {
      state.x -= normal.x * clearance;
      state.z -= normal.z * clearance;
      const inward = state.vx * normal.x + state.vz * normal.z;
      if (inward < 0) {
        state.vx -= inward * normal.x;
        state.vz -= inward * normal.z;
      }
    }
  }

  const ground = world.ground(state.x, state.z);
  if (input.jump && state.grounded) {
    // Water round the legs takes some of the spring out of a jump.
    state.vy = JUMP_SPEED * (1 - 0.45 * clamp((water - 0.3) / 0.7, 0, 1));
    state.grounded = false;
  }
  if (state.grounded) {
    if (ground >= state.y - 0.45) {
      // Down a slope or up one: the feet follow the ground.
      state.y = ground;
      state.vy = 0;
    } else {
      // Off a ledge.
      state.grounded = false;
    }
  }
  if (!state.grounded) {
    state.vy -= GRAVITY * step;
    state.y += state.vy * step;
    if (state.y <= ground && state.vy <= 0) {
      state.landed = -state.vy;
      state.y = ground;
      state.vy = 0;
      state.grounded = true;
    }
  }
}

/** Tops the tank up while he is aboard. */
export function refillAir(air: number, dt: number): number {
  return clamp(air + Math.max(0, dt) / REFILL_SECONDS, 0, 1);
}

/** Minutes of air left at `depth` (for the gauge). */
export function minutesLeft(air: number, depth: number): number {
  const use = airUse(Math.max(depth, DIVE_DEPTH), false);
  return use > 0 ? air / use / 60 : Infinity;
}

/**
 * How far a point (x, z, in the yacht's frame) is outside the two hulls
 * seen from the side, with the outward direction: the swimmer is kept off
 * them. Each hull is a capsule `halfLength` long, `halfBeam` wide, its
 * centre `offsetX` to either side.
 */
export function hullDistance(
  x: number,
  z: number,
  offsetX: number,
  centreZ: number,
  halfLength: number,
  halfBeam: number,
  normal: { x: number; z: number },
): number {
  let best = Infinity;
  for (const side of [-1, 1]) {
    const dx = x - side * offsetX;
    const along = clamp(z - centreZ, -(halfLength - halfBeam), halfLength - halfBeam);
    const dz = z - centreZ - along;
    const distance = Math.hypot(dx, dz) - halfBeam;
    if (distance < best) {
      best = distance;
      const length = Math.hypot(dx, dz) || 1;
      normal.x = dx / length;
      normal.z = dz / length;
    }
  }
  return best;
}
