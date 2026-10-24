import { OPEN_WATER_DEPTH, SHELF_SLOPE, SHORE_DEPTH } from "../IslandMath";
import { OCEAN_DETAIL_WAVES, OCEAN_WAVES, SURFACE_INVERSION_ITERATIONS } from "../OceanMath";
import { SURFACE_IMPACT_GLSL } from "../SurfaceImpacts";
import { BREAK_START, SURF_GLSL } from "../SurfMath";
import { SHIP_WAKE_GLSL } from "../../ships/ShipMath";
import { SHIP_SHADOW_GLSL } from "../../ships/ShipShadowMath";
import { SKY_FUNCTIONS, SKY_UNIFORM_DECLARATIONS } from "./skyShader";

/**
 * Ocean surface shaders.
 *
 * Vertex stage: displaces a camera-focused grid with the shared Gerstner
 * spectrum from OceanMath, so the rendered surface is the surface physics
 * samples.
 *
 * Fragment stage: rebuilds the surface slope analytically per pixel from the
 * same spectrum plus a capillary detail spectrum, then shades it as water:
 * Fresnel reflection of the shared analytic sky, a GGX sun/moon glitter path
 * whose width follows the unresolved wave energy, depth-dependent body colour
 * from the island bathymetry, forward scattering through wave crests,
 * whitecaps, shore wash, and an exact fade into the sky's horizon.
 */

/**
 * A wave is displaced only where the local grid cell is smaller than these
 * fractions of its wavelength; between them it fades out.
 */
export const RESOLVED_CELL_FRACTION = 0.18;
export const UNRESOLVED_CELL_FRACTION = 0.42;
/** Waterplane of each hull in vessel space, matched to the yacht model. */
export const HULL_OFFSET_X = 1.71;
export const HULL_CENTER_Z = 0.34;
export const HULL_HALF_LENGTH = 4.32;
export const HULL_HALF_BEAM = 0.46;

/** Distance from the camera at which the surface has fully become horizon. */
export const HORIZON_FADE_START = 640;
export const HORIZON_FADE_END = 1250;

function glsl(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : value.toFixed(6);
}

const STORM_INDEX = OCEAN_WAVES.findIndex((wave) => wave.storm);

/** The shoal factor, evaluated only while the storm swell is up. */
function STORM_SHOAL_EXPRESSION(position: string): string {
  return STORM_INDEX < 0 ? "1.0" : `(uSeaFactors[${STORM_INDEX}] > 0.0 ? stormShoalFactor(${position}) : 1.0)`;
}

function unit(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

/**
 * Per-component amplitude factors of the sea state (see `seaWaveFactors`),
 * shared by reference with every material that evaluates the waves.
 */
export const SEA_FACTORS_UNIFORM = `
  #ifndef SEA_FACTORS_DECLARED
  #define SEA_FACTORS_DECLARED
  uniform float uSeaFactors[${OCEAN_WAVES.length}];
  #endif`;

/** A component's amplitude in GLSL; storm swell is scaled by the local `stormShoal`. */
function amplitude(wave: (typeof OCEAN_WAVES)[number], index: number): string {
  return `${glsl(wave.amplitude)} * uSeaFactors[${index}]${wave.storm ? " * stormShoal" : ""}`;
}

const displacementCalls = OCEAN_WAVES.map((wave, index) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  return `    offset += gerstnerOffset(vec2(${glsl(dx)}, ${glsl(dz)}), ${amplitude(wave, index)}, ${glsl(
    wave.wavelength,
  )}, ${glsl(wave.speed)}, ${glsl(wave.steepness)}, worldBase.xz, cellSize);`;
}).join("\n");


// The long storm swell is too gentle to break: its crests are kept out of
// `fold`, which decides the whitecaps (and `uMaxFold` leaves it out too).
const swellCalls = OCEAN_WAVES.map((wave, index) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  return `    swellWave(vec2(${glsl(dx)}, ${glsl(dz)}), ${amplitude(wave, index)}, ${glsl(wave.wavelength)}, ${glsl(
    wave.speed,
  )}, ${glsl(wave.steepness)}, base, footprint, slope, ${wave.storm ? "stormFold" : "fold"}, lostVariance);`;
}).join("\n");

const detailCalls = OCEAN_DETAIL_WAVES.map((wave, index) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  return `    detailWave(vec2(${glsl(dx)}, ${glsl(dz)}), ${glsl(wave.slope)}, ${glsl(wave.wavelength)}, ${glsl(
    wave.speed,
  )}, ${glsl(index * 1.7)}, base, footprint, gust, warp, slope, lostVariance);`;
}).join("\n");

const heightTerms = OCEAN_WAVES.map((wave, index) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  const k = (Math.PI * 2) / wave.wavelength;
  return `    height += ${amplitude(wave, index)} * sin(${glsl(k)} * dot(vec2(${glsl(dx)}, ${glsl(dz)}), base) - ${glsl(
    Math.sqrt(9.81 * k) * wave.speed,
  )} * time);`;
}).join("\n");

const excursionTerms = OCEAN_WAVES.map((wave, index) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  const k = (Math.PI * 2) / wave.wavelength;
  return `      offset += vec2(${glsl(dx)}, ${glsl(dz)}) * ${glsl(wave.steepness * wave.amplitude)} * uSeaFactors[${index}]${
    wave.storm ? " * stormShoal" : ""
  } * cos(${glsl(
    k,
  )} * dot(vec2(${glsl(dx)}, ${glsl(dz)}), base) - ${glsl(Math.sqrt(9.81 * k) * wave.speed)} * time);`;
}).join("\n");

/**
 * GLSL twin of `sampleOcean(...).height`, for materials that need to know
 * where the water meets them (the wet band on the hulls, the waterline on
 * swimming animals). Like the CPU sampler it first finds which undisplaced
 * grid point the Gerstner waves carry over `position`.
 */
export const OCEAN_SURFACE_HEIGHT_GLSL = /* glsl */ `
  #ifndef OCEAN_SURFACE_HEIGHT
  #define OCEAN_SURFACE_HEIGHT
  ${SEA_FACTORS_UNIFORM}
  float oceanSurfaceHeight(vec2 position, float time) {
    // Materials using this twin do not know the islands: the storm swell is
    // taken at full height (a difference only on the shelves, in a gale).
    float stormShoal = 1.0;
    vec2 base = position;
    for (int iteration = 0; iteration < ${SURFACE_INVERSION_ITERATIONS}; iteration++) {
      vec2 offset = vec2(0.0);
${excursionTerms}
      base = position - offset;
    }
    float height = 0.0;
${heightTerms}
    return height;
  }
  #endif
`;

/**
 * Per-vertex approximation of {@link OCEAN_SURFACE_HEIGHT_GLSL} that skips
 * the horizontal inversion (an error of a few centimetres). Used where every
 * vertex of large or instanced meshes needs the local waterline.
 */
export const OCEAN_SURFACE_HEIGHT_FAST_GLSL = /* glsl */ `
  #ifndef OCEAN_SURFACE_HEIGHT_FAST
  #define OCEAN_SURFACE_HEIGHT_FAST
  ${SEA_FACTORS_UNIFORM}
  float oceanSurfaceHeightFast(vec2 base, float time) {
    float stormShoal = 1.0;
    float height = 0.0;
${heightTerms}
    return height;
  }
  #endif
`;

export const oceanVertexShader = /* glsl */ `
  ${SEA_FACTORS_UNIFORM}
  ${SHIP_WAKE_GLSL}
  ${SURF_GLSL}
  uniform float uTime;
  uniform mat4 uReflectionMatrix;
  attribute float cellSpacing;
  varying vec3 vWorldPosition;
  varying vec2 vBase;
  varying vec4 vReflectionCoord;

  const float OCEAN_PI = 3.141592653589793;

  vec3 gerstnerOffset(
    vec2 direction, float amplitude, float wavelength, float speed, float steepness, vec2 base, float cellSize
  ) {
    float k = 2.0 * OCEAN_PI / wavelength;
    float omega = sqrt(9.81 * k) * speed;
    float phase = k * dot(direction, base) - omega * uTime;
    float cosine = cos(phase);
    // Cells too coarse for this wavelength would alias it, so it flattens
    // there and the fragment stage keeps shading it.
    float resolved = 1.0 - smoothstep(
      wavelength * ${glsl(RESOLVED_CELL_FRACTION)}, wavelength * ${glsl(UNRESOLVED_CELL_FRACTION)}, cellSize
    );
    return resolved * vec3(
      direction.x * steepness * amplitude * cosine,
      amplitude * sin(phase),
      direction.y * steepness * amplitude * cosine
    );
  }

  void main() {
    vec3 worldBase = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 offset = vec3(0.0);
    float cellSize = cellSpacing;
    float stormShoal = ${STORM_SHOAL_EXPRESSION("worldBase.xz")};
${displacementCalls}
    vec3 world = worldBase + offset;
    // Ships' wakes: the same height the CPU sampler adds, where the grid can carry it.
    float shipHeight = 0.0;
    vec2 shipSlope = vec2(0.0);
    shipWakes(worldBase.xz, shipHeight, shipSlope);
    world.y += shipHeight * (1.0 - smoothstep(4.0, 10.0, cellSize));
    vWorldPosition = world;
    vBase = worldBase.xz;
    // Sampled at the mean surface, so the swell does not slide the mirror image.
    vReflectionCoord = uReflectionMatrix * vec4(world.x, 0.0, world.z, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

export const oceanFragmentShader = /* glsl */ `
  ${SKY_UNIFORM_DECLARATIONS}
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSandColor;
  uniform vec3 uScatterColor;
  uniform vec3 uLightColor;
  uniform vec3 uAmbientColor;
  uniform float uTime;
  uniform float uFoamDensity;
  uniform float uDetail;
  uniform vec3 uVesselPosition;
  uniform vec2 uVesselForward;
  uniform float uVesselSpeed;
  uniform sampler2D uReflectionMap;
  uniform float uReflectionStrength;
  uniform vec2 uReflectionTexel;
  ${SEA_FACTORS_UNIFORM}
  // Weather: the largest crest fold of the present sea state (so a rising sea
  // is not instantly all whitecaps), rain intensity, how much sooner crests
  // break, how much harder the wind roughens the water, and the haze.
  uniform float uMaxFold;
  uniform float uRain;
  uniform float uBreaking;
  uniform float uWindRipple;
  uniform vec4 uGustPatch;
  uniform vec4 uFlare;
  uniform vec3 uFlareColor;
  uniform float uHaze;
  // Wake field (see WakeField): R foam, G aerated slick, B − A height in metres.
  uniform sampler2D uWakeMap;
  uniform vec3 uWakeArea;
  uniform float uWakeTexel;
  varying vec3 vWorldPosition;
  varying vec2 vBase;
  varying vec4 vReflectionCoord;

  const float OCEAN_PI = 3.141592653589793;
  const float HULL_OFFSET_X = ${glsl(HULL_OFFSET_X)};
  const float HULL_CENTER_Z = ${glsl(HULL_CENTER_Z)};
  const float HULL_HALF_LENGTH = ${glsl(HULL_HALF_LENGTH)};
  const float HULL_HALF_BEAM = ${glsl(HULL_HALF_BEAM)};

  ${SKY_FUNCTIONS}
  ${SURFACE_IMPACT_GLSL}
  ${SURF_GLSL}
  ${SHIP_WAKE_GLSL}
  ${SHIP_SHADOW_GLSL}

  // Shared displacement spectrum, evaluated per pixel for a crisp normal.
  void swellWave(
    vec2 direction, float amplitude, float wavelength, float speed, float steepness,
    vec2 base, float footprint, inout vec2 slope, inout float fold, inout float lostVariance
  ) {
    float k = 2.0 * OCEAN_PI / wavelength;
    float omega = sqrt(9.81 * k) * speed;
    float phase = k * dot(direction, base) - omega * uTime;
    float resolved = 1.0 - smoothstep(wavelength * 0.12, wavelength * 0.36, footprint);
    float peakSlope = amplitude * k;
    slope += direction * peakSlope * cos(phase) * resolved;
    fold += steepness * peakSlope * sin(phase) * resolved;
    lostVariance += 0.5 * peakSlope * peakSlope * (1.0 - resolved * resolved);
  }

  // Capillary detail: shading only. Energy that falls below the pixel
  // footprint is not dropped; it widens the specular lobe instead.
  void detailWave(
    vec2 direction, float peakSlope, float wavelength, float speed, float seed,
    vec2 base, float footprint, float gust, float warp, inout vec2 slope, inout float lostVariance
  ) {
    float k = 2.0 * OCEAN_PI / wavelength;
    float omega = sqrt(9.81 * k) * speed;
    // A slow phase warp bends the crest lines so short waves never read as
    // ruled, parallel stripes.
    float phase = k * dot(direction, base) - omega * uTime + seed + warp * (1.0 + seed * 0.21);
    float resolved = 1.0 - smoothstep(wavelength * 0.12, wavelength * 0.36, footprint);
    float strength = peakSlope * gust;
    slope += direction * strength * cos(phase) * resolved;
    lostVariance += 0.5 * strength * strength * (1.0 - resolved * resolved);
  }

  // Wind ripples run in crests across the wind: the noise is stretched along
  // the crest direction (perpendicular to the mean wind) so the glints form
  // short bright dashes, as on a real breezy sea, not round speckles.
  const vec2 RIPPLE_ACROSS = vec2(0.851, 0.526);
  const vec2 RIPPLE_CREST = vec2(-0.526, 0.851);
  const float RIPPLE_STRETCH = 0.42;

  // Capillary ripples: the gradient of drifting value noise. featureSize is
  // the approximate ripple spacing in metres; stretch < 1 draws crests.
  void rippleLayer(
    vec2 position, float featureSize, float peakSlope, float footprint, float gust, float stretch,
    inout vec2 slope, inout float lostVariance
  ) {
    float resolved = 1.0 - smoothstep(featureSize * 0.2, featureSize * 0.6, footprint);
    float strength = peakSlope * gust;
    if (resolved > 0.001) {
      const float STEP = 0.3;
      vec2 q = vec2(dot(position, RIPPLE_ACROSS), dot(position, RIPPLE_CREST) * stretch);
      float centre = skyNoise(q);
      vec2 gradient = vec2(skyNoise(q + vec2(STEP, 0.0)) - centre, skyNoise(q + vec2(0.0, STEP)) - centre);
      slope += (RIPPLE_ACROSS * gradient.x + RIPPLE_CREST * gradient.y * stretch) * (strength * resolved / STEP);
    }
    lostVariance += 0.25 * strength * strength * (1.0 - resolved * resolved);
  }

  // Wind-sea chop with sharp crests: the height is the square of a ridged
  // noise (1 − |2n − 1|), so crests are narrow lines and troughs broad, and
  // the crest lines run long across the wind (stretch). Shading only.
  void chopLayer(
    vec2 position, float featureSize, float peakSlope, float footprint, float gust, float stretch,
    inout vec2 slope, inout float lostVariance
  ) {
    float resolved = 1.0 - smoothstep(featureSize * 0.18, featureSize * 0.55, footprint);
    float strength = peakSlope * gust;
    if (resolved > 0.001) {
      const float STEP = 0.18;
      vec2 q = vec2(dot(position, RIPPLE_ACROSS), dot(position, RIPPLE_CREST) * stretch);
      float r0 = 1.0 - abs(skyNoise(q) * 2.0 - 1.0);
      float rx = 1.0 - abs(skyNoise(q + vec2(STEP, 0.0)) * 2.0 - 1.0);
      float rz = 1.0 - abs(skyNoise(q + vec2(0.0, STEP)) * 2.0 - 1.0);
      vec2 gradient = vec2(rx * rx - r0 * r0, rz * rz - r0 * r0);
      slope += (RIPPLE_ACROSS * gradient.x + RIPPLE_CREST * gradient.y * stretch) * (strength * resolved / STEP);
    }
    lostVariance += 0.3 * strength * strength * (1.0 - resolved * resolved);
  }

  // Marbled foam: the filaments white water is drawn out into as it churns
  // and drains. Ridges of domain-warped value noise give bubble streaks that
  // branch, thin and merge organically (never a regular cell pattern), and
  // the warp drifts with time, so the pattern slowly writhes. 0…1, 1 on a
  // filament.
  float foamMarble(vec2 p, float t) {
    vec2 warp = vec2(skyNoise(p * 0.37 + vec2(t * 0.045, 3.1)), skyNoise(p * 0.37 + vec2(-1.7, t * 0.04))) - 0.5;
    p += warp * 2.6;
    float a = 1.0 - abs(skyNoise(p + vec2(t * 0.07, -t * 0.05)) * 2.0 - 1.0);
    float b = 1.0 - abs(skyNoise(p * 2.3 + vec2(-t * 0.1, t * 0.06) + 5.3) * 2.0 - 1.0);
    float c = skyNoise(p * 5.1 + vec2(t * 0.13, 1.9));
    return clamp(a * a * 0.55 + b * b * 0.33 + c * 0.12, 0.0, 1.0);
  }

  // Foam of a given cover (0 none … 1 solid) on a marbled texture: thick
  // foam is a sheet, thinning foam breaks into filaments, then into flecks.
  float foamCover(float cover, float texture, float softness) {
    float threshold = 1.0 - cover * 1.2;
    return smoothstep(threshold, threshold + softness, texture);
  }

  // Waterplane of one hull: a fine entry at the bow, a transom at the stern.
  // local.x is across the hull, local.y along it (bow positive). Negative
  // inside the hull.
  float hullDistance(vec2 local) {
    float along = clamp(local.y / HULL_HALF_LENGTH, -1.0, 1.0);
    float entry = sqrt(max(0.0, 1.0 - pow(max(along, 0.0), 2.4)));
    float run = along < 0.0 ? mix(1.0, 0.78, -along) : 1.0;
    float halfWidth = HULL_HALF_BEAM * entry * run;
    return max(abs(local.x) - halfWidth, abs(local.y) - HULL_HALF_LENGTH);
  }

  // Raindrops on the sea: expanding rings, one drop per jittered cell, two
  // layers of cells. Shading only (they are far too small to move anything),
  // faded out as they shrink below the pixel footprint.
  vec2 rainRings(vec2 position, float footprint) {
    vec2 total = vec2(0.0);
    float resolved = 1.0 - smoothstep(0.06, 0.5, footprint);
    if (resolved <= 0.001) return total;
    for (int layer = 0; layer < 2; layer++) {
      float cellSize = layer == 0 ? 0.55 : 0.93;
      float density = layer == 0 ? 1.0 : 0.7;
      vec2 p = position / cellSize + float(layer) * 31.7;
      vec2 cell = floor(p);
      vec2 local = fract(p);
      float h0 = skyHash(cell + 7.1);
      float h1 = skyHash(cell + 19.3);
      float h2 = skyHash(cell + 3.7);
      float h3 = skyHash(cell + 41.9);
      vec2 centre = vec2(0.3 + 0.4 * h0, 0.3 + 0.4 * h1);
      float age = fract(uTime * (0.8 + 0.6 * h2) + h2 * 7.0 + h0);
      float alive = step(h3, uRain * 0.85 * density);
      vec2 offset = (local - centre) * cellSize;
      float distance = length(offset);
      float delta = distance - age * 0.3 * cellSize;
      float width = 0.03 + 0.03 * age;
      float profile = sin(delta / width * 2.6) * exp(-delta * delta / (width * width * 3.0));
      total += offset / max(distance, 1.0e-3) * profile * (1.0 - age) * (1.0 - age) * 0.5 * alive;
    }
    return total * resolved;
  }

  vec4 mirrorFetch(vec2 uv, float lod) {
    return textureLod(uReflectionMap, clamp(uv, vec2(0.003), vec2(0.997)), lod);
  }

  // The yacht, the islands and the birds, mirrored in the sea.
  //
  // Ripples tilt each facet of the surface. That slides the mirror image
  // sideways and, far more, along the line of sight, so upright things are
  // broken into wavering vertical streaks. The axes come from the camera, not
  // from the world, so the streaking follows the view as it does on real water.
  //
  // A reflection is sharpest where the object meets the water and blurs and
  // fades the higher the reflected point is. The mirror image is walked up
  // toward the horizon until the object ends to find that height.
  // Returns colour in rgb and weight in a; height (0 at the waterline) in the out value.
  vec4 mirroredWorld(vec2 slope, float roughness, float viewDistance, out float height) {
    vec2 uv = vReflectionCoord.xy / max(vReflectionCoord.w, 1.0e-4);
    vec2 right = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]) + 1.0e-5);
    vec2 forward = normalize(-vec2(viewMatrix[0][2], viewMatrix[2][2]) + 1.0e-5);
    float reach = 1.0 / (1.0 + viewDistance * 0.01);
    vec2 shift = vec2(dot(slope, right) * 0.3, dot(slope, forward) * 0.72) * reach;
    shift = clamp(shift, vec2(-0.045, -0.085), vec2(0.045, 0.085));
    uv += shift;

    // Most of the sea has nothing mirrored anywhere near it: one tap of a very
    // coarse mip says so, and the rest of this function is skipped.
    height = 0.5;
    if (mirrorFetch(uv, 5.0).a < 0.002) return vec4(0.0);

    if (uDetail > 0.6) {
      float travelled = 0.0;
      float alive = 1.0;
      float stepLength = 0.01;
      for (int i = 0; i < 4; i++) {
        alive *= step(0.35, mirrorFetch(uv + vec2(0.0, travelled + stepLength), 1.5).a);
        travelled += stepLength * alive;
        stepLength *= 2.3;
      }
      height = smoothstep(0.0, 0.2, travelled);
    }

    float blur = (0.003 + roughness * 0.045) * (0.35 + height * 1.6) * (1.0 + abs(shift.y) * 14.0);
    float lod = log2(1.0 + blur / max(uReflectionTexel.y, 1.0e-4) * 0.3);
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = 0; i < 5; i++) {
      float t = float(i) - 2.0;
      float w = exp(-t * t * 0.3);
      sum += mirrorFetch(uv + vec2(t * blur * 0.16, t * blur), lod) * w;
      total += w;
    }
    sum /= total;
    float weight = sum.a * (1.0 - height * 0.4);
    return vec4(sum.rgb / max(sum.a, 1.0e-3), weight);
  }

  void main() {
    vec2 base = vBase;
    vec3 toCamera = cameraPosition - vWorldPosition;
    float viewDistance = length(toCamera);
    vec3 viewDirection = toCamera / max(viewDistance, 0.001);
    float footprint = max(length(dFdx(base)), length(dFdy(base)));

    // Wind gusts travel across the water as darker, rougher patches.
    float gustNoise = skyNoise(base * 0.011 + vec2(uTime * 0.035, uTime * 0.021));
    float gust = (0.68 + 0.74 * gustNoise) * uWindRipple;
    // A gust event darkens and roughens its patch of sea as it sweeps down
    // on the yacht (a "cat's paw"), before she feels it.
    float gustPatch = 1.0 - smoothstep(uGustPatch.z * 0.45, uGustPatch.z, distance(vWorldPosition.xz, uGustPatch.xy));
    gust *= 1.0 + uGustPatch.w * gustPatch * (0.75 + 0.5 * skyNoise(base * 0.05 + uTime * 0.1));

    vec2 slope = vec2(0.0);
    float fold = 0.0;
    float lostVariance = 0.0;
    float stormShoal = ${STORM_SHOAL_EXPRESSION("base")};
    float stormFold = 0.0;
${swellCalls}
    // Everything below is wind ripple; an impact's slick smooths it away.
    vec2 swellSlope = slope;
    float swellVariance = lostVariance;
    if (uDetail > 0.2) {
      float warp = skyNoise(base * 0.085 + vec2(uTime * 0.02, 3.7)) * 5.5;
${detailCalls}
      rippleLayer(base * 2.1 + uTime * vec2(0.52, 0.29), 0.48, 0.23, footprint, gust, RIPPLE_STRETCH, slope, lostVariance);
      if (uDetail > 0.5) {
        rippleLayer(base * 5.7 - uTime * vec2(0.38, 0.71), 0.18, 0.16, footprint, gust, RIPPLE_STRETCH, slope, lostVariance);
        // Chop a metre across, from no particular direction, so the swell's
        // straight crest lines never read as ruled bands in the glitter.
        rippleLayer(base * 0.85 + uTime * vec2(-0.21, 0.33), 1.25, 0.12, footprint, gust, 1.0, slope, lostVariance);
      }
      // The wind sea: short steep waves a few metres long, in no single
      // direction, with sharp crests. From a height they are what makes the
      // sea a mosaic of bright facets catching the sky and dark ones facing
      // away, the texture of a real fresh-breeze sea.
      chopLayer(mat2(0.94, 0.34, -0.34, 0.94) * base * 0.085 + uTime * vec2(0.07, 0.12), 11.0, 0.06, footprint, gust, 2.2, slope, lostVariance);
      chopLayer(base * 0.19 + uTime * vec2(0.13, 0.21), 5.2, 0.07, footprint, gust, 2.1, slope, lostVariance);
      chopLayer(mat2(0.8, -0.6, 0.6, 0.8) * base * 0.42 + uTime * vec2(0.22, 0.31), 2.4, 0.075, footprint, gust, 2.3, slope, lostVariance);
      chopLayer(mat2(0.6, 0.8, -0.8, 0.6) * base * 0.95 - uTime * vec2(0.31, 0.4), 1.05, 0.06, footprint, gust, 2.0, slope, lostVariance);
    } else {
      lostVariance += 0.006;
    }
    vec2 rippleSlope = slope - swellSlope;
    // Wind ripples are not sine waves: their crests are sharp and their troughs
    // broad, so the slope distribution has heavy tails. Steepening the steep
    // facets gives the crisp bright crest lines a real sea shows from above.
    rippleSlope *= 1.0 + 2.2 * length(rippleSlope);
    float rippleVariance = lostVariance - swellVariance;
    if (uRain > 0.01) {
      rippleSlope += rainRings(base, footprint);
      rippleVariance += 0.012 * uRain;
    }
    float calm = surfaceImpacts(vWorldPosition.xz, footprint, swellSlope);

    // --- Wake -------------------------------------------------------------
    // The yacht's wake is part of this surface: its waves bend the normal and
    // are lit like the swell, its aerated band damps the ripples, and its foam
    // is broken into lace below. Sampled unconditionally (no derivatives in
    // branches); outside the field everything fades to zero.
    vec2 wakeUv = (vWorldPosition.xz - uWakeArea.xy) / max(uWakeArea.z, 1.0) + 0.5;
    vec2 wakeEdge = smoothstep(vec2(0.0), vec2(0.06), wakeUv) * (1.0 - smoothstep(vec2(0.94), vec2(1.0), wakeUv));
    float wakeFade = uWakeTexel > 0.0 ? wakeEdge.x * wakeEdge.y : 0.0;
    // Differences over two texels: a one-texel difference of a bilinear field
    // has visible facets in a mirror-like reflection.
    float wakeStep = 2.0 * uWakeTexel / max(uWakeArea.z, 1.0);
    vec4 wake = texture2D(uWakeMap, wakeUv);
    vec4 wakeX0 = texture2D(uWakeMap, wakeUv - vec2(wakeStep, 0.0));
    vec4 wakeX1 = texture2D(uWakeMap, wakeUv + vec2(wakeStep, 0.0));
    vec4 wakeZ0 = texture2D(uWakeMap, wakeUv - vec2(0.0, wakeStep));
    vec4 wakeZ1 = texture2D(uWakeMap, wakeUv + vec2(0.0, wakeStep));
    vec2 wakeSlope = vec2(
      (wakeX1.b - wakeX1.a) - (wakeX0.b - wakeX0.a),
      (wakeZ1.b - wakeZ1.a) - (wakeZ0.b - wakeZ0.a)
    ) / max(4.0 * uWakeTexel, 1.0e-3);
    wakeSlope = clamp(wakeSlope * 1.6, vec2(-0.45), vec2(0.45)) * wakeFade;
    float wakeFoam = max(wake.r, 0.0) * wakeFade;
    float wakeSlick = clamp(wake.g, 0.0, 1.0) * wakeFade;
    // The yacht's own aerated plume (the ships' is added below).
    float yachtSlick = wakeSlick;
    // Passing ships: Kelvin waves lit like the swell, white water along the
    // arms and astern, and the long smooth slick they leave.
    float shipHeight = 0.0;
    vec2 shipSlope = vec2(0.0);
    vec2 shipWater = shipWakes(base, shipHeight, shipSlope);
    swellSlope += shipSlope;
    wakeFoam = max(wakeFoam, shipWater.x);
    wakeSlick = max(wakeSlick, shipWater.y);

    float smoothing = max(calm * 0.82, wakeSlick * 0.7);
    slope = swellSlope + rippleSlope * (1.0 - smoothing) + wakeSlope;

    // --- Surf ---------------------------------------------------------------
    // Waves steepen and break on the shelf; the crest's face tilts the normal
    // along the shore normal, the white water is drawn with the foam below.
    vec3 shoreHere = shoreInfo(base);
    float surfFoam = 0.0;
    float surfTrailFoam = 0.0;
    if (shoreHere.x < ${glsl(BREAK_START + 2)}) {
      float surfEdgeOut;
      // A breaking crest is never a clean contour: it breaks earlier here and
      // later there. The jitter fades out toward the beach, where the swash
      // must meet the wet sand drawn by the island material exactly.
      float ragged = ((skyNoise(base * 0.42 + 13.1) - 0.5) * 1.8 + (skyNoise(base * 1.6 - 4.7) - 0.5) * 0.6)
        * smoothstep(1.0, 3.5, shoreHere.x);
      float surfDistance = shoreHere.x + ragged;
      vec4 surf = surfSample(surfDistance, shoreHere.y, shoreHere.z, uTime, surfEdgeOut);
      vec2 shoreGradient = vec2(shoreInfo(base + vec2(0.4, 0.0)).x, shoreInfo(base + vec2(0.0, 0.4)).x) - shoreHere.x;
      slope += shoreGradient / max(length(shoreGradient), 1.0e-4) * surf.w;
      surfFoam = surf.x;
      surfTrailFoam = surfTrail(surfDistance, shoreHere.y, shoreHere.z, uTime);
    }
    lostVariance = swellVariance + rippleVariance * (1.0 - smoothing);

    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
    float nDotV = clamp(dot(normal, viewDirection), 0.02, 1.0);
    float roughness = clamp(sqrt(0.0014 + lostVariance * 2.0), 0.035, 0.42);

    // --- Reflection -------------------------------------------------------
    float fresnel = 0.02 + 0.98 * pow(1.0 - nDotV, 5.0);
    // Rough distant water reflects a blur of sky from higher up than a mirror
    // would, which is why a real sea horizon is darker than the sky above it.
    fresnel *= 1.0 - roughness * 0.55;
    vec3 reflected = reflect(-viewDirection, normal);
    reflected.y = abs(reflected.y) + roughness * 0.55;
    reflected = normalize(reflected);
    vec3 reflection = skyAtmosphere(reflected);
    // Seen in the water the sky is paler than overhead: the light is mixed by
    // the many facets of each pixel and the spray above them.
    reflection = mix(reflection, vec3(dot(reflection, vec3(0.3, 0.5, 0.2))), 0.14);
    if (uDetail > 0.6) {
      // Clouds are mirrored through a partly calmed normal: the full ripple
      // field would smear them into streaks, where the eye expects shapes.
      vec3 calmNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.5));
      vec3 calmReflected = reflect(-viewDirection, calmNormal);
      calmReflected.y = abs(calmReflected.y) + 0.02;
      vec4 clouds = skyClouds(normalize(calmReflected), -1.0);
      reflection = mix(reflection, clouds.rgb, clouds.a * 0.85);
    }
    // The yacht, the islands and the birds, mirrored and bent by the waves.
    if (uReflectionStrength > 0.0) {
      float mirrorHeight;
      vec4 mirrored = mirroredWorld(slope, roughness, viewDistance, mirrorHeight);
      // Rough water scatters the image: fainter, a little greyer.
      float mirrorWeight = mirrored.a * uReflectionStrength * (1.0 - smoothstep(0.2, 0.5, roughness) * 0.5);
      vec3 mirrorColour = mirrored.rgb * mix(vec3(0.95, 0.98, 1.0), vec3(0.82, 0.91, 1.0), mirrorHeight);
      reflection = mix(reflection, mirrorColour, clamp(mirrorWeight, 0.0, 1.0));
      // Dark objects against a bright sky read through the water's own tint at
      // low Fresnel: lift the reflectance where an image really is mirrored.
      fresnel = max(fresnel, clamp(mirrorWeight, 0.0, 1.0) * 0.34);
    }

    // --- Water body -------------------------------------------------------
    // A big ship's shadow on the water takes the direct light off it: no
    // glitter, a duller body, greyer foam (see ShipShadows).
    float shipShade = uShipShadowCount > 0 ? shipShadowAt(vWorldPosition) : 1.0;
    vec3 sunLit = uLightColor * shipShade;
    float shore = shoreHere.x;
    float depth = min(${glsl(OPEN_WATER_DEPTH)}, ${glsl(SHORE_DEPTH)} + max(shore, 0.0) * ${glsl(SHELF_SLOPE)});
    float shallow = exp(-depth * 0.2);
    float bottom = exp(-depth * 0.85);
    float broad = skyNoise(base * 0.045 + vec2(uTime * 0.012, -uTime * 0.009));
    vec3 body = mix(uDeepColor, uShallowColor, clamp(shallow + (broad - 0.5) * 0.06, 0.0, 1.0));
    body = mix(body, uSandColor, bottom * 0.62);
    float lightFacing = max(dot(normal, uLightDirection), 0.0);
    vec3 irradiance = uAmbientColor + sunLit * (0.35 + 0.65 * lightFacing) * 0.2;
    // Deep water sends back only a few percent of the light: from above, the
    // sky mirrored in the wavelets is several times brighter than the water
    // body, which is what draws the bright streaks over dark navy.
    body *= irradiance * 0.55;
    // Most of the light deep water sends back is sunlight scattered inside
    // it: in a ship's shadow the water is visibly darker, by day.
    body *= mix(1.0, 0.5 + 0.5 * shipShade, clamp(dot(uLightColor, vec3(0.333)) * 1.2, 0.0, 1.0));
    // A gale's water is dark grey-green and opaque with churned air; thin
    // crests let the little light there is through as a bottle green.
    float gale = smoothstep(0.09, 0.3, uBreaking);
    float skyLight = dot(uAmbientColor, vec3(0.333));
    body = mix(body, vec3(0.05, 0.085, 0.08) * (skyLight * 1.8 + 0.02), gale * 0.55);
    // Bubbles in the wake scatter light back up: a paler, turquoise band.
    // Air churned into the water scatters the sunlight back up: wakes and the
    // water along a ship's side glow turquoise under and around their foam.
    float bubbles = clamp(max(wakeSlick * 0.3, yachtSlick * 0.75) + wakeFoam * 0.85, 0.0, 1.0) * (0.55 + 0.45 * skyNoise(vWorldPosition.xz * 0.35 + 7.3));
    body = mix(body, uScatterColor * irradiance * 0.55 + body * 0.6, bubbles * 0.55);

    // Sunlight entering the back of a crest scatters toward the viewer.
    float crest = clamp(fold / max(uMaxFold, 1.0e-3), -1.0, 1.0);
    float throughWave = pow(max(dot(viewDirection, -normalize(uLightDirection + normal * 0.45)), 0.0), 3.0);
    float scatter = throughWave * smoothstep(-0.15, 0.85, crest) * (1.0 - nDotV * 0.6);
    body += uScatterColor * sunLit * scatter * 0.085;
    body += vec3(0.05, 0.13, 0.105) * skyLight * 1.6 * gale * smoothstep(0.3, 0.95, crest) * (0.4 + 0.6 * nDotV);

    // Shallow-water caustic shimmer on the sand.
    if (bottom > 0.02) {
      float causticA = skyNoise(base * 0.9 + vec2(uTime * 0.31, uTime * 0.17));
      float causticB = skyNoise(base * 1.3 - vec2(uTime * 0.23, uTime * 0.29));
      float caustic = pow(1.0 - abs(causticA - causticB), 8.0);
      body += uSandColor * sunLit * caustic * bottom * 0.05;
    }

    vec3 color = mix(body, reflection, clamp(fresnel, 0.0, 1.0));

    // --- Sun and moon glitter ---------------------------------------------
    vec3 halfVector = normalize(viewDirection + uLightDirection);
    float nDotH = max(dot(normal, halfVector), 0.0);
    float nDotL = max(dot(normal, uLightDirection), 0.0);
    float alpha2 = roughness * roughness;
    alpha2 *= alpha2;
    float ggxDenominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
    float distribution = alpha2 / (OCEAN_PI * ggxDenominator * ggxDenominator);
    float specularFresnel = 0.02 + 0.98 * pow(1.0 - max(dot(viewDirection, halfVector), 0.0), 5.0);
    float visibility = 0.25 / max(mix(nDotL * nDotV, 1.0, 0.25), 0.05);
    float specular = min(distribution * specularFresnel * visibility * nDotL, 48.0);
    // A broader sheen lobe stretches the glitter path toward the viewer.
    float sheenAlpha2 = pow(max(roughness * 2.4, 0.16), 4.0);
    float sheenDenominator = nDotH * nDotH * (sheenAlpha2 - 1.0) + 1.0;
    float sheen = sheenAlpha2 / (OCEAN_PI * sheenDenominator * sheenDenominator) * specularFresnel * visibility * nDotL;
    // Under a storm's cloud the sun is only a pale patch: the glitter path fades.
    float sunVeil = 1.0 - 0.88 * gale;
    // The glitter path: where calm water would mirror the sun. Away from it
    // only the steepest facets can catch the sun, so the high-noon sea does
    // not sparkle evenly from the bow to the horizon like wet plastic.
    float pathAlign = max(dot(reflect(-viewDirection, vec3(0.0, 1.0, 0.0)), uLightDirection), 0.0);
    float sunPath = smoothstep(0.42, 0.94, pathAlign);
    color += sunLit * (specular * mix(0.28, 1.0, sunPath) + min(sheen, 5.0) * 0.1 * mix(0.5, 1.0, sunPath)) * sunVeil;

    // --- A signal flare overhead -------------------------------------------
    // A point of light a hundred and more metres up: it lays its own glitter
    // path over the waves toward the viewer and tints the water under it.
    // (Inverse square, softened so the water right under it never clips.)
    vec3 flareLight = vec3(0.0);
    float flareFacing = 0.0;
    if (uFlare.w > 0.0) {
      vec3 toFlare = uFlare.xyz - vWorldPosition;
      float flareDistance2 = dot(toFlare, toFlare);
      vec3 flareDirection = toFlare * inversesqrt(max(flareDistance2, 1.0));
      flareLight = uFlareColor * (uFlare.w * 28100.0 / (flareDistance2 + 2500.0));
      flareFacing = max(dot(normal, flareDirection), 0.0);
      vec3 flareHalf = normalize(viewDirection + flareDirection);
      float flareNH = max(dot(normal, flareHalf), 0.0);
      float flareAlpha2 = pow(max(roughness * 1.25, 0.05), 4.0);
      float flareDen = flareNH * flareNH * (flareAlpha2 - 1.0) + 1.0;
      float flareD = flareAlpha2 / (OCEAN_PI * flareDen * flareDen);
      float flareF = 0.02 + 0.98 * pow(1.0 - max(dot(viewDirection, flareHalf), 0.0), 5.0);
      float flareVis = 0.25 / max(mix(flareFacing * nDotV, 1.0, 0.25), 0.05);
      float flareSheenA2 = pow(max(roughness * 2.6, 0.18), 4.0);
      float flareSheenDen = flareNH * flareNH * (flareSheenA2 - 1.0) + 1.0;
      float flareSheen = flareSheenA2 / (OCEAN_PI * flareSheenDen * flareSheenDen) * flareF * flareVis * flareFacing;
      color += flareLight * (min(flareD * flareF * flareVis * flareFacing, 40.0) + min(flareSheen, 6.0) * 0.12);
      // The water body and the crests take a little of its colour.
      color += flareLight * uScatterColor * (0.012 + 0.05 * scatter) * (0.4 + 0.6 * flareFacing);
    }

    // Sparkles: single capillary facets tilted just right flash brighter
    // than white, so bloom turns them into points of light.
    if (uDetail > 0.2) {
      vec2 sparkleCell = base * 3.1 + vec2(uTime * 0.47, -uTime * 0.31);
      float sparkleA = skyNoise(sparkleCell);
      float sparkleB = skyNoise(sparkleCell * 2.3 + vec2(-uTime * 0.83, uTime * 0.59) + 17.0);
      vec3 facet = normalize(normal + vec3(sparkleA - 0.5, 0.0, sparkleB - 0.5) * 0.36);
      float facetAlign = max(dot(reflect(-viewDirection, facet), uLightDirection), 0.0);
      float glint = smoothstep(0.9965, 0.9993, facetAlign) * smoothstep(0.52, 0.72, sparkleA * sparkleB * 1.9);
      // Below a pixel the flashes would only shimmer; let the GGX lobe carry them.
      glint *= (1.0 - smoothstep(0.12, 0.45, footprint)) * smoothstep(0.0, 0.08, nDotL);
      // Points of light belong to the glitter path; elsewhere a rare few.
      glint *= mix(0.1, 1.0, sunPath * sunPath);
      color += sunLit * glint * 7.0 * sunVeil;
    }

    // --- Hulls -------------------------------------------------------------
    vec2 vesselForward = normalize(uVesselForward);
    vec2 vesselRight = vec2(vesselForward.y, -vesselForward.x);
    vec2 relativeToVessel = vWorldPosition.xz - uVesselPosition.xz;
    vec2 vesselSpace = vec2(dot(relativeToVessel, vesselRight), dot(relativeToVessel, vesselForward));
    float hullAlong = (vesselSpace.y - HULL_CENTER_Z) / HULL_HALF_LENGTH;
    float hullGap = min(
      hullDistance(vec2(vesselSpace.x + HULL_OFFSET_X, vesselSpace.y - HULL_CENTER_Z)),
      hullDistance(vec2(vesselSpace.x - HULL_OFFSET_X, vesselSpace.y - HULL_CENTER_Z))
    );
    // Under the hulls (hidden by them from any normal view): a soft shade
    // well inside the outline, never a visible edge around it.
    float hullShadow = (1.0 - smoothstep(-0.9, -0.3, hullGap)) * (1.0 - smoothstep(0.75, 0.95, abs(hullAlong)));

    // --- Foam --------------------------------------------------------------
    // Foam is sampled in a wind-aligned frame and stretched along the wind,
    // the way real foam is drawn out into streaks.
    vec2 windFrame = vec2(dot(base, vec2(0.851, 0.526)), dot(base, vec2(-0.526, 0.851)));
    float foamFine = skyNoise(windFrame * vec2(3.4, 7.2) + vec2(uTime * 0.06, -uTime * 0.04));
    float foamMedium = skyNoise(windFrame * vec2(0.9, 2.0) - vec2(uTime * 0.03, uTime * 0.02));
    float foamTexture = foamFine * 0.55 + foamMedium * 0.45;
    // Whitecaps break only on the steepest crests, mostly inside gusts: a
    // 15-knot breeze leaves the sea flecked with white, not covered in it.
    float breaking = crest * 0.86 + (gust - 1.0) * 0.2 + uBreaking;
    float whitecap = smoothstep(0.66, 1.0, breaking);
    float foam = whitecap * whitecap * (0.5 + 0.5 * foamTexture) * 1.5;
    // A frayed, speckled fringe dissolves around each patch.
    foam += smoothstep(0.02, 0.5, whitecap) * smoothstep(0.58, 0.86, foamTexture) * 0.45;
    foam += smoothstep(0.36, 0.8, breaking) * smoothstep(0.66, 0.9, foamTexture) * 0.16;
    // The short wind sea breaks too: here and there a steep chop crest
    // spills into a small white horse, the flecks a fresh breeze scatters
    // over the whole sea (none in a calm, more as the wind rises).
    float chopSteep = length(rippleSlope);
    float horseNoise = skyNoise(base * 0.21 + vec2(uTime * 0.11, -uTime * 0.07));
    float whiteHorse = smoothstep(0.42, 0.66, chopSteep) * smoothstep(0.8, 0.95, horseNoise + (gust - 1.0) * 0.2)
      * smoothstep(0.02, 0.09, uBreaking + (gust - 1.0) * 0.05);
    foam = max(foam, whiteHorse * smoothstep(0.5, 0.7, foamTexture) * 0.85);
    foam = min(foam, 0.88) * uFoamDensity * (1.0 - calm * 0.6);
    // In a gale the foam is blown into long streaks along the wind, with dark
    // water between them, rather than lying as a sheet.
    float streaks = skyNoise(windFrame * vec2(0.16, 2.6) + vec2(uTime * 0.05, 0.0));
    streaks = smoothstep(0.3, 0.72, streaks * 0.75 + foamFine * 0.25);
    foam *= mix(1.0, 0.25 + 0.95 * streaks, clamp(uBreaking * 2.2, 0.0, 1.0));
    foam = min(foam * (1.0 + uBreaking * 0.9), 0.92);
    // Breaking crests leave a net of bubbles down their backs, drawn out
    // along the wind, and the sea between them stays streaked with old foam.
    if (gale > 0.01) {
      float galeLace = foamMarble(windFrame * vec2(0.45, 1.7) + vec2(uTime * 0.06, 0.0), uTime);
      float galeFine = foamMarble(windFrame * vec2(1.2, 4.4) - vec2(uTime * 0.1, 0.0), uTime * 1.3);
      float slopeFoam = smoothstep(0.3, 0.85, breaking + crest * 0.3);
      // Fine lace fades into a smooth sheet with distance, so it never moirés.
      float laceFade = 1.0 - smoothstep(60.0, 260.0, distance(vWorldPosition.xz, cameraPosition.xz));
      float lacework = mix(0.55, max(galeLace * 0.9, galeFine * 0.8), laceFade) * (0.5 + 0.5 * foamTexture);
      foam = max(foam, min(gale * slopeFoam * lacework * 0.8, 0.85));
      foam = max(foam, gale * 0.14 * streaks * (0.4 + 0.6 * foamFine));
    }


    // Water piling against the hulls: a lapping line at rest, a bow wave and
    // a ribbon of aerated water along each side once the yacht is moving.
    float hullSpeed = smoothstep(0.4, 4.5, uVesselSpeed);
    float bowZone = smoothstep(0.3, 0.95, hullAlong);
    // The bow wave and its foam come from the wake field; this is only the
    // thin line where water meets the hull.
    // The analytic waterplane is only an approximation of the model's hulls
    // (and does not pitch or roll with them), so the line is kept thin,
    // broken into flecks, and to the forward part of each hull, where the
    // bow pushes water up; a clean band would show as a hull-shaped outline.
    float contactWidth = 0.05 + hullSpeed * (0.05 + bowZone * 0.2);
    float contact = (1.0 - smoothstep(0.0, contactWidth, hullGap)) * step(-0.05, hullGap)
      * smoothstep(-0.6, 0.1, hullAlong);
    float fleck = skyNoise(vWorldPosition.xz * 3.1 + vec2(uTime * 0.9, -uTime * 0.7));
    float hullFoam = contact * smoothstep(0.45, 0.8, fleck * 0.7 + foamTexture * 0.3 + bowZone * 0.25)
      * (0.18 + hullSpeed * bowZone * 0.4);
    foam = max(foam, min(hullFoam, 0.8));

    // Wake foam: thick foam is solid white, thin foam a lace of bubbles that
    // opens up as it decays. The lace is world-space noise at pixel scale,
    // far finer than the wake field itself.
    // Rotated lattices so the value noise never lines up into squares.
    vec2 lacePosition = mat2(0.8, 0.6, -0.6, 0.8) * vWorldPosition.xz;
    float laceA = skyFbm3(lacePosition * 1.9 + vec2(uTime * 0.05, -uTime * 0.04));
    float laceB = skyNoise(mat2(0.47, -0.88, 0.88, 0.47) * vWorldPosition.xz * 6.3 - vec2(uTime * 0.09, uTime * 0.06));
    // Patches and streaks a few metres across break the foam up first, the
    // bubble lace finer still.
    float patches = skyNoise(vWorldPosition.xz * 0.55 + vec2(3.1, -uTime * 0.02));
    float lace = laceA * 0.6 + laceB * 0.4;
    float laceResolved = 1.0 - smoothstep(0.08, 0.5, footprint);
    lace = mix(0.5, lace, laceResolved);
    // Churned white water: solid where it is thick, then bubble streaks that
    // branch and drift apart (the same marbling as the surf), never blobs.
    float wakeCover = 0.0;
    if (wakeFoam > 0.004) {
      float wakeMarble = mix(0.5, foamMarble(vWorldPosition.xz * 0.9, uTime) * 0.6
        + foamMarble(mat2(0.6, 0.8, -0.8, 0.6) * vWorldPosition.xz * 2.6 + 7.0, uTime * 1.3) * 0.4, laceResolved);
      wakeCover = foamCover(wakeFoam * (0.5 + patches * 0.65), wakeMarble, 0.14) * mix(1.0, 0.86 + laceB * 0.14, laceResolved);
    }
    foam = max(foam, min(wakeCover, 0.96));
    // Breakers. White water is not a flat sheet: the bore is solid and
    // bright, its frayed edges and the foam it leaves behind are bubble
    // streaks that branch and thin as the backwash drains them, and the last
    // of it is a scatter of flecks. The streaks writhe slowly with the water.
    if (surfFoam + surfTrailFoam > 0.01) {
      float marble = foamMarble(vWorldPosition.xz * 0.75, uTime);
      float fineMarble = foamMarble(mat2(0.6, 0.8, -0.8, 0.6) * vWorldPosition.xz * 2.2 + 11.0, uTime * 1.4);
      float streaky = mix(0.5, marble * 0.62 + fineMarble * 0.38, laceResolved);
      float body = surfFoam * (0.62 + patches * 0.5);
      float bore = foamCover(body, streaky, 0.16);
      float trail = foamCover(surfTrailFoam * (0.45 + patches * 0.7) * 0.85, streaky, 0.12) * 0.9;
      // Bubbles: the white is never perfectly even.
      float speck = skyNoise(vWorldPosition.xz * 9.0 + vec2(uTime * 0.3, -uTime * 0.2));
      float surfWhite = max(bore, trail) * mix(1.0, 0.86 + speck * 0.14, laceResolved);
      foam = max(foam, min(surfWhite, 0.97));
    }
    // Shallow water over sand is clearer, and churned by the surf.
    float shallowFoam = (1.0 - smoothstep(0.0, 1.2, shore)) * smoothstep(0.45, 0.8, lace) * 0.25;
    foam = max(foam, shallowFoam);

    vec3 foamColor = (uAmbientColor * 1.15 + sunLit * (0.2 + 0.8 * nDotL) * 0.3) * vec3(0.94, 0.98, 1.0);
    // Heaps of foam catch the light on their tops and are shaded in their
    // folds: never a flat painted white.
    float foamRelief = skyNoise(vWorldPosition.xz * 1.6 + vec2(uTime * 0.22, -uTime * 0.17)) * 0.6
      + skyNoise(vWorldPosition.xz * 4.3 - vec2(uTime * 0.31, uTime * 0.12)) * 0.4;
    foamColor *= mix(1.0, 0.74 + foamRelief * 0.36, laceResolved);
    // Foam is the whitest thing on the sea: it glows in the flare's colour.
    foamColor += flareLight * (0.25 + 0.75 * flareFacing) * 0.42;
    color = mix(color, foamColor, foam);
    // Spray torn off the crests hangs as a pale veil over them.
    color = mix(color, foamColor * 0.92, gale * smoothstep(0.55, 1.0, crest) * 0.3 * (0.6 + 0.4 * foamTexture));

    color *= 1.0 - hullShadow * 0.34;

    // --- Transparency -------------------------------------------------------
    // Looking down into clear tropical water shows what swims beneath it;
    // grazing views and deep water close up.
    // Tropical water is clear: looking down, most of what is seen is what
    // lies beneath (already veiled by the water in its own material).
    // Looking down, more than half of what is seen comes from below; over
    // the shelf the sand shows through almost as if there were no water.
    float clarity = mix(0.56, 0.08, smoothstep(0.02, 0.42, fresnel));
    clarity = mix(clarity, 0.8, bottom * (1.0 - smoothstep(0.02, 0.34, fresnel)));
    float alpha = clamp(1.0 - clarity + foam * 0.5 + hullShadow * 0.12, 0.3, 1.0);

    // --- Aerial perspective -------------------------------------------------
    vec3 horizonDirection = normalize(vec3(-viewDirection.x, 0.0, -viewDirection.z) + vec3(0.0, 1.0e-4, 0.0));
    vec3 horizon = skyAtmosphere(horizonDirection);
    float hazeReach = 1.0 - 0.5 * uHaze;
    float haze = 1.0 - exp(-pow(viewDistance * 0.00085 * (1.0 + uHaze * 5.0), 1.6));
    haze = max(haze * 0.9, smoothstep(${glsl(HORIZON_FADE_START)} * hazeReach, ${glsl(HORIZON_FADE_END)} * hazeReach, viewDistance));
    color = mix(color, horizon, haze);
    alpha = mix(alpha, 1.0, smoothstep(90.0, 340.0, viewDistance));

    gl_FragColor = vec4(max(color, 0.0), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
