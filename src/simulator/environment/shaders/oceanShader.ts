import {
  ISLAND_DEFINITIONS,
  OPEN_WATER_DEPTH,
  SHELF_SLOPE,
  SHORE_DEPTH,
  WATERLINE_RADIAL,
} from "../IslandMath";
import { OCEAN_DETAIL_WAVES, OCEAN_WAVES, SURFACE_INVERSION_ITERATIONS } from "../OceanMath";
import { SURFACE_IMPACT_GLSL } from "../SurfaceImpacts";
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
export const HORIZON_FADE_START = 520;
export const HORIZON_FADE_END = 860;

function glsl(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : value.toFixed(6);
}

function unit(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

const displacementCalls = OCEAN_WAVES.map((wave) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  return `    offset += gerstnerOffset(vec2(${glsl(dx)}, ${glsl(dz)}), ${glsl(wave.amplitude)}, ${glsl(
    wave.wavelength,
  )}, ${glsl(wave.speed)}, ${glsl(wave.steepness)}, worldBase.xz, cellSize);`;
}).join("\n");

const maximumFold = OCEAN_WAVES.reduce(
  (total, wave) => total + wave.steepness * wave.amplitude * ((Math.PI * 2) / wave.wavelength),
  0,
);

const swellCalls = OCEAN_WAVES.map((wave) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  return `    swellWave(vec2(${glsl(dx)}, ${glsl(dz)}), ${glsl(wave.amplitude)}, ${glsl(wave.wavelength)}, ${glsl(
    wave.speed,
  )}, ${glsl(wave.steepness)}, base, footprint, slope, fold, lostVariance);`;
}).join("\n");

const detailCalls = OCEAN_DETAIL_WAVES.map((wave, index) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  return `    detailWave(vec2(${glsl(dx)}, ${glsl(dz)}), ${glsl(wave.slope)}, ${glsl(wave.wavelength)}, ${glsl(
    wave.speed,
  )}, ${glsl(index * 1.7)}, base, footprint, gust, warp, slope, lostVariance);`;
}).join("\n");

const islandDistanceCalls = ISLAND_DEFINITIONS.map(
  (island, index) =>
    `    nearest = min(nearest, islandDistance(position, vec2(${glsl(island.centerX)}, ${glsl(
      island.centerZ,
    )}), ${glsl(island.beachRadius)}, ${glsl(island.scaleZ)}, ${glsl(index)}));`,
).join("\n");

const heightTerms = OCEAN_WAVES.map((wave) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  const k = (Math.PI * 2) / wave.wavelength;
  return `    height += ${glsl(wave.amplitude)} * sin(${glsl(k)} * dot(vec2(${glsl(dx)}, ${glsl(dz)}), base) - ${glsl(
    Math.sqrt(9.81 * k) * wave.speed,
  )} * time);`;
}).join("\n");

const excursionTerms = OCEAN_WAVES.map((wave) => {
  const [dx, dz] = unit(wave.directionX, wave.directionZ);
  const k = (Math.PI * 2) / wave.wavelength;
  return `      offset += vec2(${glsl(dx)}, ${glsl(dz)}) * ${glsl(wave.steepness * wave.amplitude)} * cos(${glsl(
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
  float oceanSurfaceHeight(vec2 position, float time) {
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
  float oceanSurfaceHeightFast(vec2 base, float time) {
    float height = 0.0;
${heightTerms}
    return height;
  }
  #endif
`;

export const oceanVertexShader = /* glsl */ `
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
${displacementCalls}
    vec3 world = worldBase + offset;
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
  varying vec3 vWorldPosition;
  varying vec2 vBase;
  varying vec4 vReflectionCoord;

  const float OCEAN_PI = 3.141592653589793;
  const float MAX_FOLD = ${glsl(maximumFold)};
  const float HULL_OFFSET_X = ${glsl(HULL_OFFSET_X)};
  const float HULL_CENTER_Z = ${glsl(HULL_CENTER_Z)};
  const float HULL_HALF_LENGTH = ${glsl(HULL_HALF_LENGTH)};
  const float HULL_HALF_BEAM = ${glsl(HULL_HALF_BEAM)};

  ${SKY_FUNCTIONS}
  ${SURFACE_IMPACT_GLSL}

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

  float islandDistance(vec2 position, vec2 center, float beachRadius, float scaleZ, float index) {
    vec2 local = vec2(position.x - center.x, (position.y - center.y) / scaleZ);
    float angle = atan(local.y, local.x);
    float edge = 1.0
      + sin(angle * 3.0 + index * 1.7) * 0.038
      + sin(angle * 7.0 - index * 0.9) * 0.023
      + cos(angle * 11.0 + index * 0.6) * 0.012;
    return length(local) - beachRadius * edge * ${glsl(WATERLINE_RADIAL)};
  }

  // Metres from the rendered waterline of the nearest island.
  float shoreDistance(vec2 position) {
    float nearest = 1.0e5;
${islandDistanceCalls}
    return nearest;
  }

  void main() {
    vec2 base = vBase;
    vec3 toCamera = cameraPosition - vWorldPosition;
    float viewDistance = length(toCamera);
    vec3 viewDirection = toCamera / max(viewDistance, 0.001);
    float footprint = max(length(dFdx(base)), length(dFdy(base)));

    // Wind gusts travel across the water as darker, rougher patches.
    float gustNoise = skyNoise(base * 0.011 + vec2(uTime * 0.035, uTime * 0.021));
    float gust = 0.68 + 0.74 * gustNoise;

    vec2 slope = vec2(0.0);
    float fold = 0.0;
    float lostVariance = 0.0;
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
      }
    } else {
      lostVariance += 0.006;
    }
    vec2 rippleSlope = slope - swellSlope;
    float rippleVariance = lostVariance - swellVariance;
    float calm = surfaceImpacts(vWorldPosition.xz, footprint, swellSlope);
    slope = swellSlope + rippleSlope * (1.0 - calm * 0.82);
    lostVariance = swellVariance + rippleVariance * (1.0 - calm * 0.82);

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
      vec4 clouds = skyClouds(normalize(calmReflected), 0.0);
      reflection = mix(reflection, clouds.rgb, clouds.a * 0.85);
    }
    // The yacht, the islands and the birds, mirrored and bent by the waves:
    // swell sways the image, ripples break its edges into streaks.
    if (uReflectionStrength > 0.0) {
      vec2 mirrorUv = vReflectionCoord.xy / max(vReflectionCoord.w, 1.0e-4);
      float sway = 1.0 / (1.0 + viewDistance * 0.03);
      mirrorUv += vec2(swellSlope.x, swellSlope.y) * 0.05 * sway + vec2(slope.x - swellSlope.x, slope.y - swellSlope.y) * 0.11 * sway;
      vec4 mirrored = texture2D(uReflectionMap, clamp(mirrorUv, vec2(0.001), vec2(0.999)));
      // Rough, distant water scatters the image into a soft smudge.
      float mirrorWeight = mirrored.a * uReflectionStrength * (1.0 - smoothstep(0.18, 0.42, roughness) * 0.6);
      reflection = mix(reflection, mirrored.rgb, clamp(mirrorWeight, 0.0, 1.0));
    }

    // --- Water body -------------------------------------------------------
    float shore = shoreDistance(base);
    float depth = min(${glsl(OPEN_WATER_DEPTH)}, ${glsl(SHORE_DEPTH)} + max(shore, 0.0) * ${glsl(SHELF_SLOPE)});
    float shallow = exp(-depth * 0.2);
    float bottom = exp(-depth * 0.85);
    float broad = skyNoise(base * 0.045 + vec2(uTime * 0.012, -uTime * 0.009));
    vec3 body = mix(uDeepColor, uShallowColor, clamp(shallow + (broad - 0.5) * 0.06, 0.0, 1.0));
    body = mix(body, uSandColor, bottom * 0.62);
    float lightFacing = max(dot(normal, uLightDirection), 0.0);
    vec3 irradiance = uAmbientColor + uLightColor * (0.35 + 0.65 * lightFacing) * 0.2;
    body *= irradiance;

    // Sunlight entering the back of a crest scatters toward the viewer.
    float crest = clamp(fold / MAX_FOLD, -1.0, 1.0);
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
    color += uLightColor * (specular + min(sheen, 6.0) * 0.18);

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
      color += uLightColor * glint * 9.0;
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
    float breaking = crest * 0.86 + (gust - 1.0) * 0.2;
    float whitecap = smoothstep(0.66, 1.0, breaking);
    float foam = whitecap * whitecap * (0.5 + 0.5 * foamTexture) * 1.5;
    // A frayed, speckled fringe dissolves around each patch.
    foam += smoothstep(0.02, 0.5, whitecap) * smoothstep(0.58, 0.86, foamTexture) * 0.45;
    foam += smoothstep(0.36, 0.8, breaking) * smoothstep(0.66, 0.9, foamTexture) * 0.16;
    foam = min(foam, 0.88) * uFoamDensity * (1.0 - calm * 0.6);

    // Shore wash: bands of foam running up the sand, then a wet swash line.
    float washPhase = shore * 1.15 + uTime * 0.85 + foamMedium * 2.6;
    float washBand = smoothstep(0.55, 0.98, sin(washPhase) * 0.5 + 0.5);
    float surfZone = 1.0 - smoothstep(0.4, 5.5, shore);
    float shoreFoam = washBand * surfZone * smoothstep(0.3, 0.75, foamTexture + surfZone * 0.35);
    shoreFoam += (1.0 - smoothstep(0.0, 0.9, shore)) * smoothstep(0.25, 0.7, foamTexture) * 0.85;
    foam = clamp(foam + shoreFoam * step(-1.5, shore), 0.0, 1.0);

    // Water piling against the hulls: a lapping line at rest, a bow wave and
    // a ribbon of aerated water along each side once the yacht is moving.
    float hullSpeed = smoothstep(0.4, 4.5, uVesselSpeed);
    float bowZone = smoothstep(0.3, 0.95, hullAlong);
    float contactWidth = 0.1 + hullSpeed * (0.22 + bowZone * 0.55);
    float contact = (1.0 - smoothstep(0.0, contactWidth, hullGap)) * step(-0.25, hullGap);
    float hullFoam = contact * smoothstep(0.22, 0.62, foamTexture + 0.18 + hullSpeed * 0.2)
      * (0.3 + hullSpeed * (0.45 + bowZone * 0.4));
    foam = max(foam, min(hullFoam, 0.92));

    vec3 foamColor = (uAmbientColor * 1.15 + uLightColor * (0.2 + 0.8 * nDotL) * 0.3) * vec3(0.94, 0.98, 1.0);
    color = mix(color, foamColor, foam);

    color *= 1.0 - hullShadow * 0.34;

    // --- Transparency -------------------------------------------------------
    // Looking down into clear tropical water shows what swims beneath it;
    // grazing views and deep water close up.
    float clarity = mix(0.24, 0.05, smoothstep(0.025, 0.4, fresnel));
    clarity = mix(clarity, 0.6, bottom * (1.0 - smoothstep(0.02, 0.3, fresnel)));
    float alpha = clamp(1.0 - clarity + foam * 0.5 + hullShadow * 0.12, 0.3, 1.0);

    // --- Aerial perspective -------------------------------------------------
    vec3 horizonDirection = normalize(vec3(-viewDirection.x, 0.0, -viewDirection.z) + vec3(0.0, 1.0e-4, 0.0));
    vec3 horizon = skyAtmosphere(horizonDirection);
    float haze = 1.0 - exp(-pow(viewDistance * 0.0011, 1.6));
    haze = max(haze * 0.9, smoothstep(${glsl(HORIZON_FADE_START)}, ${glsl(HORIZON_FADE_END)}, viewDistance));
    color = mix(color, horizon, haze);
    alpha = mix(alpha, 1.0, smoothstep(60.0, 260.0, viewDistance));

    gl_FragColor = vec4(max(color, 0.0), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
