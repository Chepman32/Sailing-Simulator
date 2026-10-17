import { OPEN_WATER_DEPTH, SHELF_SLOPE, SHORE_DEPTH } from "../IslandMath";
import { OCEAN_DETAIL_WAVES, OCEAN_WAVES, SURFACE_INVERSION_ITERATIONS } from "../OceanMath";
import { SURFACE_IMPACT_GLSL } from "../SurfaceImpacts";
import { BREAK_START, SURF_GLSL } from "../SurfMath";
import { SHIP_WAKE_GLSL } from "../../ships/ShipMath";
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

  // Capillary ripples: the gradient of drifting value noise. featureSize is
  // the approximate ripple spacing in metres.
  void rippleLayer(
    vec2 position, float featureSize, float peakSlope, float footprint, float gust,
    inout vec2 slope, inout float lostVariance
  ) {
    float resolved = 1.0 - smoothstep(featureSize * 0.2, featureSize * 0.6, footprint);
    float strength = peakSlope * gust;
    if (resolved > 0.001) {
      const float STEP = 0.3;
      float centre = skyNoise(position);
      vec2 gradient = vec2(skyNoise(position + vec2(STEP, 0.0)) - centre, skyNoise(position + vec2(0.0, STEP)) - centre);
      slope += gradient * (strength * resolved / STEP);
    }
    lostVariance += 0.25 * strength * strength * (1.0 - resolved * resolved);
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
      rippleLayer(base * 2.1 + uTime * vec2(0.52, 0.29), 0.48, 0.085, footprint, gust, slope, lostVariance);
      if (uDetail > 0.6) {
        rippleLayer(base * 5.7 - uTime * vec2(0.38, 0.71), 0.18, 0.06, footprint, gust, slope, lostVariance);
        // Chop a metre across, from no particular direction, so the swell's
        // straight crest lines never read as ruled bands in the glitter.
        rippleLayer(base * 0.85 + uTime * vec2(-0.21, 0.33), 1.25, 0.05, footprint, gust, slope, lostVariance);
      }
    } else {
      lostVariance += 0.006;
    }
    vec2 rippleSlope = slope - swellSlope;
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
    if (shoreHere.x < ${glsl(BREAK_START + 2)}) {
      float surfEdgeOut;
      vec4 surf = surfSample(shoreHere.x, shoreHere.y, shoreHere.z, uTime, surfEdgeOut);
      vec2 shoreGradient = vec2(shoreInfo(base + vec2(0.4, 0.0)).x, shoreInfo(base + vec2(0.0, 0.4)).x) - shoreHere.x;
      slope += shoreGradient / max(length(shoreGradient), 1.0e-4) * surf.w;
      surfFoam = surf.x;
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
    float shore = shoreHere.x;
    float depth = min(${glsl(OPEN_WATER_DEPTH)}, ${glsl(SHORE_DEPTH)} + max(shore, 0.0) * ${glsl(SHELF_SLOPE)});
    float shallow = exp(-depth * 0.2);
    float bottom = exp(-depth * 0.85);
    float broad = skyNoise(base * 0.045 + vec2(uTime * 0.012, -uTime * 0.009));
    vec3 body = mix(uDeepColor, uShallowColor, clamp(shallow + (broad - 0.5) * 0.06, 0.0, 1.0));
    body = mix(body, uSandColor, bottom * 0.62);
    float lightFacing = max(dot(normal, uLightDirection), 0.0);
    vec3 irradiance = uAmbientColor + uLightColor * (0.35 + 0.65 * lightFacing) * 0.2;
    body *= irradiance;
    // Bubbles in the wake scatter light back up: a paler, turquoise band.
    float bubbles = wakeSlick * (0.55 + 0.45 * skyNoise(vWorldPosition.xz * 0.35 + 7.3));
    body = mix(body, uScatterColor * irradiance * 0.3 + body * 0.75, bubbles * 0.3);

    // Sunlight entering the back of a crest scatters toward the viewer.
    float crest = clamp(fold / max(uMaxFold, 1.0e-3), -1.0, 1.0);
    float throughWave = pow(max(dot(viewDirection, -normalize(uLightDirection + normal * 0.45)), 0.0), 3.0);
    float scatter = throughWave * smoothstep(-0.15, 0.85, crest) * (1.0 - nDotV * 0.6);
    body += uScatterColor * uLightColor * scatter * 0.085;

    // Shallow-water caustic shimmer on the sand.
    if (bottom > 0.02) {
      float causticA = skyNoise(base * 0.9 + vec2(uTime * 0.31, uTime * 0.17));
      float causticB = skyNoise(base * 1.3 - vec2(uTime * 0.23, uTime * 0.29));
      float caustic = pow(1.0 - abs(causticA - causticB), 8.0);
      body += uSandColor * uLightColor * caustic * bottom * 0.05;
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
    color += uLightColor * (specular + min(sheen, 5.0) * 0.1);

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
      color += uLightColor * glint * 7.0;
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
    float hullShadow = 1.0 - smoothstep(-0.3, 0.2, hullGap);

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
    foam = min(foam, 0.88) * uFoamDensity * (1.0 - calm * 0.6);
    // In a gale the foam is blown into long streaks along the wind, with dark
    // water between them, rather than lying as a sheet.
    float streaks = skyNoise(windFrame * vec2(0.16, 2.6) + vec2(uTime * 0.05, 0.0));
    streaks = smoothstep(0.3, 0.72, streaks * 0.75 + foamFine * 0.25);
    foam *= mix(1.0, 0.25 + 0.95 * streaks, clamp(uBreaking * 2.2, 0.0, 1.0));
    foam = min(foam * (1.0 + uBreaking * 0.9), 0.92);


    // Water piling against the hulls: a lapping line at rest, a bow wave and
    // a ribbon of aerated water along each side once the yacht is moving.
    float hullSpeed = smoothstep(0.4, 4.5, uVesselSpeed);
    float bowZone = smoothstep(0.3, 0.95, hullAlong);
    // The bow wave and its foam come from the wake field; this is only the
    // thin line where water meets the hull.
    float contactWidth = 0.08 + hullSpeed * (0.12 + bowZone * 0.18);
    float contact = (1.0 - smoothstep(0.0, contactWidth, hullGap)) * step(-0.25, hullGap);
    float hullFoam = contact * smoothstep(0.3, 0.7, foamTexture + 0.12 + hullSpeed * 0.15)
      * (0.28 + hullSpeed * (0.25 + bowZone * 0.2));
    foam = max(foam, min(hullFoam, 0.92));

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
    float wakeCover = smoothstep(0.22, 1.0, wakeFoam * (0.1 + lace * 1.2) * (0.4 + patches * 1.2));
    foam = max(foam, min(wakeCover, 0.96));
    // Breakers: a dense roller at the crest, a frayed bore behind it.
    float surfCover = smoothstep(0.12, 0.8, surfFoam * (0.25 + lace * 1.0) * (0.55 + patches * 0.9));
    foam = max(foam, min(surfCover, 0.97));
    // Shallow water over sand is clearer, and churned by the surf.
    float shallowFoam = (1.0 - smoothstep(0.0, 1.2, shore)) * smoothstep(0.45, 0.8, lace) * 0.25;
    foam = max(foam, shallowFoam);

    vec3 foamColor = (uAmbientColor * 1.15 + uLightColor * (0.2 + 0.8 * nDotL) * 0.3) * vec3(0.94, 0.98, 1.0);
    color = mix(color, foamColor, foam);

    color *= 1.0 - hullShadow * 0.34;

    // --- Transparency -------------------------------------------------------
    // Looking down into clear tropical water shows what swims beneath it;
    // grazing views and deep water close up.
    // Tropical water is clear: looking down, most of what is seen is what
    // lies beneath (already veiled by the water in its own material).
    float clarity = mix(0.58, 0.06, smoothstep(0.02, 0.36, fresnel));
    clarity = mix(clarity, 0.6, bottom * (1.0 - smoothstep(0.02, 0.3, fresnel)));
    float alpha = clamp(1.0 - clarity + foam * 0.5 + hullShadow * 0.12, 0.3, 1.0);

    // --- Aerial perspective -------------------------------------------------
    vec3 horizonDirection = normalize(vec3(-viewDirection.x, 0.0, -viewDirection.z) + vec3(0.0, 1.0e-4, 0.0));
    vec3 horizon = skyAtmosphere(horizonDirection);
    float hazeReach = 1.0 - 0.5 * uHaze;
    float haze = 1.0 - exp(-pow(viewDistance * 0.00085 * (1.0 + uHaze * 5.0), 1.6));
    haze = max(haze * 0.9, smoothstep(${glsl(HORIZON_FADE_START)} * hazeReach, ${glsl(HORIZON_FADE_END)} * hazeReach, viewDistance));
    color = mix(color, horizon, haze);
    alpha = mix(alpha, 1.0, smoothstep(60.0, 260.0, viewDistance));

    gl_FragColor = vec4(max(color, 0.0), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
