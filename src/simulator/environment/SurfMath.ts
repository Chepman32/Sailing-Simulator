import { clamp, smoothstep } from "../math";
import { ISLAND_DEFINITIONS, WATERLINE_RADIAL } from "./IslandMath";

/**
 * Surf on the island beaches, as one pure function of position and time with
 * an exact GLSL twin. The ocean shader draws the breaking waves and the bore
 * from it; the sand shader draws the swash running up the beach, the foam it
 * leaves and the wet sand that dries after it; tests check its bounds.
 *
 * Waves arrive every `SURF_PERIOD` seconds or so. Each one:
 *
 * 1. approaches from `BREAK_START` metres offshore, slowing as the water
 *    shoals, and steepens into a crest;
 * 2. breaks: a band of white water (the bore) widens behind the crest;
 * 3. runs up the beach as a thin sheet with a lacy foam edge, slower and
 *    slower, to its own run-up height;
 * 4. drains back, leaving foam that dissolves and sand that stays dark and
 *    glossy for a few seconds.
 *
 * Every wave has its own strength and run-up (a hash of its number), and the
 * timing drifts along the coast with the angle around the island, so crests
 * arrive slightly obliquely and bend with the shore instead of marching as
 * parallel stripes.
 */

export const SURF_PERIOD = 8.4;
/** Metres offshore where a wave starts to steepen and its crest is followed. */
export const BREAK_START = 10;
/** Metres offshore where it breaks. */
export const BREAK_DEPTH_DISTANCE = 5.2;
/** Seconds after drying begins until the sand looks dry again (1/e). */
export const SAND_DRYING_TIME = 5.5;
/** Phases (fractions of a cycle) of the wave's life. */
const APPROACH_END = 0.42;
const UPRUSH_END = 0.66;

export type SurfSample = {
  /** White water amount, 0…1 (before the shader's lace). */
  foam: number;
  /** Depth of the swash sheet over the beach in metres (0 when dry or offshore). */
  sheet: number;
  /** 0 dry … 1 soaked, for sand above the still waterline. */
  wetness: number;
  /** Slope of the breaking crest along the outward shore normal. */
  slope: number;
  /** Signed distance of the swash edge from the still waterline (negative = up the beach). */
  edge: number;
};

function hash(value: number): number {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Timing offset (in cycles) along the coast, by angle around island `index`. */
export function surfOffset(angle: number, index: number): number {
  return 0.22 * Math.sin(angle * 3 + index * 1.9) + 0.09 * Math.sin(angle * 7 - index) + index * 0.37;
}

/** Strength 0.6…1 and run-up of wave `n` on island `index`, metres up the beach. */
export function waveRunup(n: number, index: number): { strength: number; runup: number } {
  const strength = 0.6 + 0.4 * hash(n * 1.31 + index * 17.7);
  // Every few waves a set arrives: noticeably bigger.
  const set = hash(Math.floor(n / 4) + index * 5.1) > 0.6 && n % 4 < 2 ? 1.25 : 1;
  return { strength: Math.min(1, strength * set), runup: (1.4 + 2.4 * strength) * set };
}

/** Swash edge (negative = up the beach) at phase `f` of a wave with run-up `runup`. */
export function swashEdge(f: number, runup: number): number {
  if (f < APPROACH_END) return 0.6;
  if (f < UPRUSH_END) {
    const x = (f - APPROACH_END) / (UPRUSH_END - APPROACH_END);
    // Fast at first, slowing to a stop: water running uphill.
    return 0.6 - (runup + 0.6) * (1 - (1 - x) * (1 - x));
  }
  const x = (f - UPRUSH_END) / (1 - UPRUSH_END);
  // Backwash: starts slowly, then drains away.
  return -runup + (runup + 0.6) * x * x;
}

/** Phase at which the backwash uncovers a point `distance` from the waterline (≥ UPRUSH_END). */
function uncoveredAt(distance: number, runup: number): number {
  const x = Math.sqrt(clamp((distance + runup) / (runup + 0.6), 0, 1));
  return UPRUSH_END + x * (1 - UPRUSH_END);
}

export function sampleSurf(
  distance: number,
  angle: number,
  index: number,
  time: number,
  target: SurfSample = { foam: 0, sheet: 0, wetness: 0, slope: 0, edge: 0 },
): SurfSample {
  const cycle = time / SURF_PERIOD + surfOffset(angle, index);
  const n = Math.floor(cycle);
  const f = cycle - n;
  const wave = waveRunup(n, index);
  const previous = waveRunup(n - 1, index);

  // --- Approach and break ---------------------------------------------------
  const approach = clamp(f / APPROACH_END, 0, 1);
  // The crest slows as it shoals: distance falls quickly, then lingers.
  const crest = BREAK_START * (1 - (1 - (1 - approach) * (1 - approach)) * 0.94) - 0.2;
  const broken = smoothstep(BREAK_DEPTH_DISTANCE + 0.6, BREAK_DEPTH_DISTANCE - 0.8, crest) * (f < APPROACH_END ? 1 : 0);
  const behind = distance - crest;
  const boreWidth = 0.7 + (BREAK_START - crest) * 0.55;
  const bore = broken * smoothstep(-0.25, 0.15, behind) * (1 - smoothstep(boreWidth * 0.4, boreWidth, behind));
  // The steep face before the break, and the turbulent roller on the crest.
  const face = Math.exp(-Math.pow(behind / 1.1, 2));
  const rising = (1 - broken * 0.6) * smoothstep(0, 0.35, approach);
  target.slope = distance > -0.2 ? -wave.strength * 0.35 * rising * face * (behind / 1.1) * (f < APPROACH_END ? 1 : 0) : 0;

  // --- Swash ----------------------------------------------------------------
  const edge = swashEdge(f, wave.runup);
  target.edge = edge;
  const covered = distance > edge && distance < 0.6 ? 1 : 0;
  const sheetDepth = covered * clamp((distance - edge) * 0.05, 0, 0.12);
  target.sheet = sheetDepth;
  // A lacy line at the leading edge, foam spread thin over the sheet, then
  // left behind on the sand as the water drains.
  const edgeFoam = Math.exp(-Math.pow((distance - edge) / 0.35, 2)) * (f > APPROACH_END ? 1 : 0);
  const sheetFoam = covered * 0.2 * (1 - smoothstep(0.66, 1, f));
  target.foam = clamp(
    Math.max(bore * wave.strength, (edgeFoam * 0.9 + sheetFoam) * wave.strength) * (distance < BREAK_START + 1 ? 1 : 0),
    0,
    1,
  );

  // --- Wet sand -------------------------------------------------------------
  let wet = 0;
  if (distance < 0.6) {
    if (covered) wet = 1;
    else if (f >= UPRUSH_END && distance >= -wave.runup) {
      wet = Math.exp(-((f - uncoveredAt(distance, wave.runup)) * SURF_PERIOD) / SAND_DRYING_TIME);
    }
    if (distance >= -previous.runup) {
      const since = (f + 1 - uncoveredAt(distance, previous.runup)) * SURF_PERIOD;
      wet = Math.max(wet, Math.exp(-since / SAND_DRYING_TIME));
    }
  }
  target.wetness = clamp(wet, 0, 1);
  return target;
}

/** Nearest island, its angle around the centre, and the distance from its rendered waterline. */
export function nearestShore(x: number, z: number): { index: number; angle: number; distance: number } {
  let best = { index: 0, angle: 0, distance: Number.POSITIVE_INFINITY };
  ISLAND_DEFINITIONS.forEach((island, index) => {
    const dx = x - island.centerX;
    const dz = (z - island.centerZ) / island.scaleZ;
    const angle = Math.atan2(dz, dx);
    const edge =
      1 +
      Math.sin(angle * 3 + index * 1.7) * 0.038 +
      Math.sin(angle * 7 - index * 0.9) * 0.023 +
      Math.cos(angle * 11 + index * 0.6) * 0.012;
    const distance = Math.hypot(dx, dz) - island.beachRadius * edge * WATERLINE_RADIAL;
    if (distance < best.distance) best = { index, angle, distance };
  });
  return best;
}

const glslNumber = (value: number): string => (Number.isInteger(value) ? `${value}.0` : value.toFixed(6));

const islandCalls = ISLAND_DEFINITIONS.map(
  (island, index) => `    shoreCandidate(position, vec2(${glslNumber(island.centerX)}, ${glslNumber(island.centerZ)}), ${glslNumber(
    island.beachRadius,
  )}, ${glslNumber(island.scaleZ)}, ${glslNumber(index)}, best);`,
).join("\n");

/**
 * GLSL twin. `shoreInfo` returns (distance from the rendered waterline, angle
 * around the island, island index); `surfSample` returns
 * (foam, sheet depth, wetness, crest slope) and writes the swash edge.
 */
export const SURF_GLSL = /* glsl */ `
  #ifndef SURF_GLSL
  #define SURF_GLSL
  void shoreCandidate(vec2 position, vec2 center, float beachRadius, float scaleZ, float index, inout vec3 best) {
    vec2 local = vec2(position.x - center.x, (position.y - center.y) / scaleZ);
    float angle = atan(local.y, local.x);
    float edge = 1.0
      + sin(angle * 3.0 + index * 1.7) * 0.038
      + sin(angle * 7.0 - index * 0.9) * 0.023
      + cos(angle * 11.0 + index * 0.6) * 0.012;
    float distance = length(local) - beachRadius * edge * ${glslNumber(WATERLINE_RADIAL)};
    if (distance < best.x) best = vec3(distance, angle, index);
  }

  vec3 shoreInfo(vec2 position) {
    vec3 best = vec3(1.0e5, 0.0, 0.0);
${islandCalls}
    return best;
  }

  float surfHash(float value) {
    return fract(sin(value * 12.9898 + 78.233) * 43758.5453);
  }

  vec2 surfWave(float n, float index) {
    float strength = 0.6 + 0.4 * surfHash(n * 1.31 + index * 17.7);
    float set = (surfHash(floor(n / 4.0) + index * 5.1) > 0.6 && mod(n, 4.0) < 2.0) ? 1.25 : 1.0;
    return vec2(min(1.0, strength * set), (1.4 + 2.4 * strength) * set);
  }

  float surfEdge(float f, float runup) {
    if (f < ${glslNumber(APPROACH_END)}) return 0.6;
    if (f < ${glslNumber(UPRUSH_END)}) {
      float x = (f - ${glslNumber(APPROACH_END)}) / ${glslNumber(UPRUSH_END - APPROACH_END)};
      return 0.6 - (runup + 0.6) * (1.0 - (1.0 - x) * (1.0 - x));
    }
    float x = (f - ${glslNumber(UPRUSH_END)}) / ${glslNumber(1 - UPRUSH_END)};
    return -runup + (runup + 0.6) * x * x;
  }

  float surfUncovered(float distance, float runup) {
    float x = sqrt(clamp((distance + runup) / (runup + 0.6), 0.0, 1.0));
    return ${glslNumber(UPRUSH_END)} + x * ${glslNumber(1 - UPRUSH_END)};
  }

  vec4 surfSample(float distance, float angle, float index, float time, out float edge) {
    float cycle = time / ${glslNumber(SURF_PERIOD)}
      + 0.22 * sin(angle * 3.0 + index * 1.9) + 0.09 * sin(angle * 7.0 - index) + index * 0.37;
    float n = floor(cycle);
    float f = cycle - n;
    vec2 wave = surfWave(n, index);
    vec2 previous = surfWave(n - 1.0, index);
    bool approaching = f < ${glslNumber(APPROACH_END)};

    float approach = clamp(f / ${glslNumber(APPROACH_END)}, 0.0, 1.0);
    float crest = ${glslNumber(BREAK_START)} * (1.0 - (1.0 - (1.0 - approach) * (1.0 - approach)) * 0.94) - 0.2;
    float broken = smoothstep(${glslNumber(BREAK_DEPTH_DISTANCE + 0.6)}, ${glslNumber(BREAK_DEPTH_DISTANCE - 0.8)}, crest)
      * (approaching ? 1.0 : 0.0);
    float behind = distance - crest;
    float boreWidth = 0.7 + (${glslNumber(BREAK_START)} - crest) * 0.55;
    float bore = broken * smoothstep(-0.25, 0.15, behind) * (1.0 - smoothstep(boreWidth * 0.4, boreWidth, behind));
    float face = exp(-pow(behind / 1.1, 2.0));
    float rising = (1.0 - broken * 0.6) * smoothstep(0.0, 0.35, approach);
    float slope = distance > -0.2 && approaching ? -wave.x * 0.35 * rising * face * (behind / 1.1) : 0.0;

    edge = surfEdge(f, wave.y);
    float covered = distance > edge && distance < 0.6 ? 1.0 : 0.0;
    float sheet = covered * clamp((distance - edge) * 0.05, 0.0, 0.12);
    float edgeFoam = exp(-pow((distance - edge) / 0.35, 2.0)) * (approaching ? 0.0 : 1.0);
    float sheetFoam = covered * 0.2 * (1.0 - smoothstep(0.66, 1.0, f));
    float foam = clamp(max(bore * wave.x, (edgeFoam * 0.9 + sheetFoam) * wave.x)
      * (distance < ${glslNumber(BREAK_START + 1)} ? 1.0 : 0.0), 0.0, 1.0);

    float wet = 0.0;
    if (distance < 0.6) {
      if (covered > 0.5) wet = 1.0;
      else if (f >= ${glslNumber(UPRUSH_END)} && distance >= -wave.y) {
        wet = exp(-((f - surfUncovered(distance, wave.y)) * ${glslNumber(SURF_PERIOD)}) / ${glslNumber(SAND_DRYING_TIME)});
      }
      if (distance >= -previous.y) {
        float since = (f + 1.0 - surfUncovered(distance, previous.y)) * ${glslNumber(SURF_PERIOD)};
        wet = max(wet, exp(-since / ${glslNumber(SAND_DRYING_TIME)}));
      }
    }
    return vec4(foam, sheet, clamp(wet, 0.0, 1.0), slope);
  }
  #endif
`;
