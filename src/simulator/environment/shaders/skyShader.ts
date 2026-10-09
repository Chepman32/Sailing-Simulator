/**
 * Analytic sky shared by every consumer of sky radiance:
 *
 * - the visible sky dome;
 * - the image-based-lighting capture that lights the yacht, islands and wildlife;
 * - the ocean, which reflects exactly this function and fades into its horizon.
 *
 * One function means the water can never reflect a sky that is not there, and
 * the sea meets the sky without a visible seam at any time of day.
 *
 * All colours are scene-linear radiance. Nothing here imports the renderer.
 */

export const SKY_UNIFORM_DECLARATIONS = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDirection;
  uniform vec3 uMoonDirection;
  uniform vec3 uLightDirection;
  uniform vec3 uSunColor;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uNight;
  uniform float uCloudTime;
  uniform float uCloudCover;
`;

export const SKY_FUNCTIONS = /* glsl */ `
  // Sine-free hash: stable on mobile GPUs at large world coordinates.
  float skyHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float skyNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    float a = skyHash(cell);
    float b = skyHash(cell + vec2(1.0, 0.0));
    float c = skyHash(cell + vec2(0.0, 1.0));
    float d = skyHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  const mat2 SKY_OCTAVE = mat2(1.6, 1.2, -1.2, 1.6);

  float skyFbm3(vec2 p) {
    float value = 0.5 * skyNoise(p);
    p = SKY_OCTAVE * p;
    value += 0.25 * skyNoise(p);
    p = SKY_OCTAVE * p;
    value += 0.125 * skyNoise(p);
    return value / 0.875;
  }

  float skyFbm5(vec2 p) {
    float value = 0.5 * skyNoise(p);
    p = SKY_OCTAVE * p;
    value += 0.25 * skyNoise(p);
    p = SKY_OCTAVE * p;
    value += 0.125 * skyNoise(p);
    p = SKY_OCTAVE * p;
    value += 0.0625 * skyNoise(p);
    p = SKY_OCTAVE * p;
    value += 0.03125 * skyNoise(p);
    return value / 0.96875;
  }

  // Clear-sky radiance: zenith-to-horizon gradient, low haze, and forward
  // scattering around the sun and moon. Directions below the horizon return
  // the horizon so a camera above the sea never sees a hard edge.
  vec3 skyAtmosphere(vec3 direction) {
    float height = clamp(direction.y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, 1.0 - exp(-height * 3.6));
    sky = mix(sky, uHorizon * 1.04, exp(-height * 18.0) * 0.4);

    float sunAmount = max(dot(direction, uSunDirection), 0.0);
    float sunVisible = smoothstep(-0.1, 0.05, uSunDirection.y) * (1.0 - uNight);
    vec3 sunGlow = uSunColor * (
      pow(sunAmount, 5.0) * 0.07 +
      pow(sunAmount, 40.0) * 0.26 +
      pow(sunAmount, 360.0) * 1.15
    );
    // Low suns redden the haze beneath them.
    float lowSun = (1.0 - smoothstep(0.0, 0.45, uSunDirection.y)) * exp(-height * 6.0);
    sunGlow += uSunColor * vec3(1.0, 0.52, 0.2) * pow(sunAmount, 3.0) * lowSun * 0.42;
    sky += sunGlow * sunVisible;

    float moonAmount = max(dot(direction, uMoonDirection), 0.0);
    sky += vec3(0.36, 0.5, 0.74) * (pow(moonAmount, 22.0) * 0.045 + pow(moonAmount, 300.0) * 0.2) * uNight;
    return sky;
  }

  // Fair-weather cumulus on a flattened dome. rgb = cloud radiance,
  // a = coverage. detail > 0.5 selects the five-octave shape.
  vec4 skyClouds(vec3 direction, float detail) {
    if (direction.y <= 0.012 || uCloudCover <= 0.001) return vec4(0.0);
    vec2 uv = direction.xz / (direction.y + 0.17);
    uv = uv * 1.55 + vec2(uCloudTime * 0.0062, uCloudTime * 0.0038);
    vec2 warp = vec2(skyNoise(uv * 0.6 + 11.3), skyNoise(uv * 0.6 - 7.1)) - 0.5;
    uv += warp * 0.32;

    float shape = detail > 0.5 ? skyFbm5(uv) : skyFbm3(uv);
    float threshold = 1.0 - uCloudCover;
    float density = smoothstep(threshold - 0.02, threshold + 0.2, shape);
    if (density <= 0.001) return vec4(0.0);

    // Self-shadowing: compare against the density one step toward the light.
    vec2 lightStep = uLightDirection.xz / max(length(uLightDirection.xz), 0.001) * 0.14;
    float towardLight = skyFbm3(uv + lightStep);
    float lit = clamp(0.62 + (shape - towardLight) * 4.2 - density * 0.26, 0.0, 1.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit);

    // Thin edges glow when they sit in front of the light source.
    float forward = pow(max(dot(direction, uLightDirection), 0.0), 9.0);
    cloud += uCloudLit * forward * (1.0 - density) * 0.9;

    // Aerial perspective pulls distant clouds toward the horizon colour.
    float nearness = smoothstep(0.02, 0.36, direction.y);
    cloud = mix(uHorizon * 1.04, cloud, nearness);
    float coverage = density * smoothstep(0.012, 0.15, direction.y) * 0.94;
    return vec4(cloud, coverage);
  }

  vec3 skyRadiance(vec3 direction, float detail) {
    vec3 sky = skyAtmosphere(direction);
    vec4 clouds = skyClouds(direction, detail);
    return mix(sky, clouds.rgb, clouds.a);
  }
`;

export const skyVertexShader = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDirection = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * Sun, moon and stars, drawn into the sky itself so the clouds pass in front
 * of them and every piece of geometry (a sail, the mast, an island) hides
 * them simply by being drawn later. HDR: the solar disc is far brighter than
 * white so the bloom pass turns it into a light source.
 */
const CELESTIAL_FUNCTIONS = /* glsl */ `
  uniform vec3 uSunDisc;
  uniform vec3 uMoonDisc;
  uniform float uStars;
  uniform float uCelestial;

  const float SUN_RADIUS = 0.0125;
  const float MOON_RADIUS = 0.0155;

  // Angular position of a direction in a body's own tangent frame, in radians.
  vec2 bodyFrame(vec3 direction, vec3 axis) {
    vec3 side = normalize(cross(abs(axis.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), axis));
    vec3 up = cross(axis, side);
    return vec2(dot(direction, side), dot(direction, up));
  }

  vec3 skyCelestial(vec3 direction) {
    vec3 light = vec3(0.0);
    // Pixel size in radians, for edges that stay crisp but never alias.
    float pixel = max(length(fwidth(direction)), 1.0e-5);
    // Stars on a stereographic grid: one candidate per cell, most cells empty.
    // Derivatives are taken here, outside any branch.
    vec2 grid = direction.xz / (1.0 + max(direction.y, 0.0)) * 230.0;
    float cellPixel = max(max(fwidth(grid.x), fwidth(grid.y)), 1.0e-4);

    if (dot(uSunDisc, uSunDisc) > 0.0) {
      vec2 local = bodyFrame(direction, uSunDirection);
      float radial = length(local) / SUN_RADIUS;
      float edge = 1.0 - smoothstep(1.0 - pixel / SUN_RADIUS, 1.0 + pixel / SUN_RADIUS, radial);
      if (dot(direction, uSunDirection) > 0.0 && edge > 0.0) {
        // Limb darkening: the disc's rim is cooler and dimmer than its centre.
        float mu = sqrt(max(0.0, 1.0 - radial * radial));
        vec3 limb = vec3(1.0 - 0.45 * (1.0 - mu), 1.0 - 0.55 * (1.0 - mu), 1.0 - 0.7 * (1.0 - mu));
        light += uSunDisc * limb * edge;
      }
    }

    if (dot(uMoonDisc, uMoonDisc) > 0.0 && dot(direction, uMoonDirection) > 0.0) {
      vec2 local = bodyFrame(direction, uMoonDirection) / MOON_RADIUS;
      float radial = length(local);
      float edge = 1.0 - smoothstep(1.0 - pixel / MOON_RADIUS, 1.0 + pixel / MOON_RADIUS, radial);
      if (edge > 0.0) {
        // Maria: soft dark seas in the bright highlands, and a gentle limb.
        float maria = smoothstep(0.42, 0.72, skyFbm3(local * 2.4 + vec2(3.1, 7.7)));
        float craters = skyNoise(local * 9.0 + 1.7);
        float albedo = 1.0 - maria * 0.32 - (craters - 0.5) * 0.08;
        float mu = sqrt(max(0.0, 1.0 - radial * radial));
        light += uMoonDisc * albedo * (0.72 + 0.28 * mu) * edge;
      }
    }

    if (uStars > 0.0 && direction.y > 0.0) {
      vec2 cell = floor(grid);
      float seed = skyHash(cell);
      if (seed < 0.06) {
        vec2 centre = cell + 0.2 + 0.6 * vec2(skyHash(cell + 17.3), skyHash(cell - 9.1));
        float distance = length(grid - centre) / cellPixel;
        float magnitude = skyHash(cell + 3.7);
        float brightness = 0.06 + pow(magnitude, 7.0) * 2.2;
        float twinkle = 0.78 + 0.22 * sin(uCloudTime * (1.3 + magnitude * 2.4) + seed * 300.0);
        vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.7), skyHash(cell + 41.0));
        float core = exp(-distance * distance * 1.6);
        float glow = exp(-distance * 0.9) * 0.12 * smoothstep(0.6, 1.0, magnitude);
        light += tint * brightness * twinkle * (core + glow) * uStars * smoothstep(0.03, 0.22, direction.y);
      }
    }
    return light * uCelestial;
  }
`;

export const skyFragmentShader = /* glsl */ `
  ${SKY_UNIFORM_DECLARATIONS}
  uniform float uSkyDetail;
  // The lighting capture replaces everything below the horizon with the sea,
  // so hull undersides are lit by water rather than by sky.
  uniform vec3 uBelowColor;
  uniform float uBelowMix;
  varying vec3 vWorldDirection;
  ${SKY_FUNCTIONS}
  ${CELESTIAL_FUNCTIONS}

  void main() {
    vec3 direction = normalize(vWorldDirection);
    vec3 sky = skyAtmosphere(direction);
    vec4 clouds = skyClouds(direction, uSkyDetail);
    // Clouds drift across the sun, the moon and the stars; thin edges let
    // them show through, dimmed.
    vec3 bodies = skyCelestial(direction) * pow(1.0 - clouds.a, 3.0);
    sky = mix(sky, clouds.rgb, clouds.a) + bodies;
    sky = mix(sky, uBelowColor, uBelowMix * smoothstep(0.02, -0.1, direction.y));
    // Break up 8-bit banding in the smooth gradient.
    sky += (skyHash(gl_FragCoord.xy) - 0.5) * 0.004;
    gl_FragColor = vec4(max(sky, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
