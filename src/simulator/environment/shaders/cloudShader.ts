import { WEATHER_LAYERS } from "../CloudNoise";

/**
 * Volumetric clouds.
 *
 * The clouds are a volume: a slab of air between a flat base and the tops,
 * wrapped round the Earth, whose density comes from tileable 3D noise
 * (`CloudNoise.ts`). A ray march through it, with a second short march
 * toward the light at every lit sample, gives clouds their bodies: bright
 * sunward heads, grey bases, shadows that one tower throws on the next, a
 * silver lining where a thin edge stands before the sun.
 *
 * Marching a volume for every pixel of the screen, of the sea's mirror and of
 * the lighting capture would cost far more than a browser can spare, and
 * clouds change slowly. So the march is done into a map of the whole sky
 * (`CloudMap.ts`), a few tiles a frame, and the sky dome, the ocean and the
 * lighting capture look their clouds up in it: `skyClouds` in
 * `skyShader.ts` becomes one texture read.
 *
 * The map is a stereographic chart of the upper hemisphere: conformal, one
 * piece (no seams), finest at the horizon, where clouds are seen most.
 */

/** Radius of the horizon circle in the map, in half-widths: the rest is margin for filtering. */
export const CLOUD_MAP_RIM = 0.96;
/** Cloud base above the sea (m). */
export const CLOUD_BASE = 900;
/** The Earth's radius (m): the cloud deck curves down to the horizon. */
export const EARTH_RADIUS = 6_360_000;
/** Farthest cloud marched (m); beyond it the air has taken everything. */
export const CLOUD_REACH = 70_000;

/** Map lookup shared by every consumer of the sky. */
export const CLOUD_MAP_GLSL = /* glsl */ `
  vec2 cloudMapUv(vec3 direction) {
    return 0.5 + 0.5 * ${CLOUD_MAP_RIM.toFixed(3)} * direction.xz / (1.0 + direction.y);
  }
`;

/**
 * The clouds' shadows on the sea: how much of the sun a cloud takes from a
 * point of the water (0…1). The cloud volume's density where the ray from
 * the point to the light crosses the clouds' widest level; see
 * `cloudShadowAt` in `CloudMap.ts`, the same arithmetic on the CPU. Needs
 * `SKY_UNIFORM_DECLARATIONS` and `cameraPosition`.
 */
/** Height above the cloud base (as a part of the slab) at which a cumulus is widest: where its shadow is taken. */
export const CLOUD_SHADOW_LEVEL = 0.09;

const shadowWeatherGlsl = WEATHER_LAYERS.map(
    (layer) =>
      `texture(uCloudNoise, vec3(p.x / ${layer.scale.toFixed(1)} + ${layer.offsetX.toFixed(3)}, ${layer.level.toFixed(3)}, p.y / ${layer.scale.toFixed(1)} + ${layer.offsetZ.toFixed(3)})).b * ${layer.weight.toFixed(3)}`,
  ).join(" + ");

export const CLOUD_SHADOW_GLSL = /* glsl */ `
  float cloudShadowAt(vec2 worldXZ) {
    if (uCloudShadow.z <= 0.0) return 0.0;
    float level = ${CLOUD_BASE.toFixed(1)} + uCloudShadow.y * ${CLOUD_SHADOW_LEVEL.toFixed(3)};
    vec2 p = worldXZ - cameraPosition.xz + uCloudDrift + uLightDirection.xz * (level / max(uLightDirection.y, 0.12));
    float weather = ${shadowWeatherGlsl};
    float field = smoothstep(uCloudShadow.x - 0.01, uCloudShadow.x + 0.085, weather);
    if (field <= 0.0) return 0.0;
    float closing = smoothstep(0.58, 0.94, uCloudCover);
    vec3 at = vec3(p.x + level * 0.35, level, p.y + level * 0.2);
    float body = clamp((texture(uCloudNoise, at / 5600.0).r - 0.45) / 0.47, 0.0, 1.0);
    float low = 1.0 - mix(mix(0.3, 0.54, field), 0.93, closing) * smoothstep(0.0, 0.25, field);
    float high = low + mix(0.3, 0.42, closing);
    return clamp((body - low) / max(high - low, 1.0e-4), 0.0, 1.0) * uCloudShadow.z;
  }
`;

export const cloudMarchVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const weatherGlsl = WEATHER_LAYERS.map(
  (layer) =>
    `texture(uNoise, vec3(xz.x / ${layer.scale.toFixed(1)} + ${layer.offsetX.toFixed(3)}, ${layer.level.toFixed(3)}, xz.y / ${layer.scale.toFixed(1)} + ${layer.offsetZ.toFixed(3)})).b * ${layer.weight.toFixed(3)}`,
).join(" + ");

export const cloudMarchFragment = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uNoise;
  // The tile of the map being drawn: offset (xy) and size (zw) in map uv.
  uniform vec4 uTile;
  uniform vec3 uLight;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uHaze;
  // Where the viewer is over the sea plus how far the wind has carried the clouds (m).
  uniform vec2 uDrift;
  // Weather value above which clouds stand, and how firmly (0…1) the cover closes.
  uniform float uThreshold;
  uniform float uCover;
  // Height of the tallest tops above the sea (m).
  uniform float uTop;
  uniform float uSteps;
  uniform float uJitter;
  // Distance over which the air takes a cloud into the horizon's colour (m).
  uniform float uAerial;
  varying vec2 vUv;

  const float BASE = ${CLOUD_BASE.toFixed(1)};
  const float EARTH = ${EARTH_RADIUS.toFixed(1)};
  const float REACH = ${CLOUD_REACH.toFixed(1)};
  // Extinction of the densest cloud along the view (1/m) and toward the light.
  const float SIGMA_VIEW = 0.034;
  const float SIGMA_LIGHT = 0.03;

  float remap01(float value, float low, float high) {
    return clamp((value - low) / max(high - low, 1.0e-4), 0.0, 1.0);
  }

  // Height above the sea of a point given relative to the viewer: the
  // Earth's surface falls away with the square of the distance.
  float altitude(vec3 p) {
    return p.y + dot(p.xz, p.xz) / (2.0 * EARTH);
  }

  // Distance along a ray of elevation sine mu to the shell at that height.
  float shellDistance(float mu, float height) {
    float across = 1.0 - mu * mu;
    return 2.0 * height / (mu + sqrt(mu * mu + 2.0 * height * across / EARTH));
  }

  // 0…1: clouds stand where it is high (see CloudNoise.cloudWeatherAt).
  float cloudWeather(vec2 xz) {
    return ${weatherGlsl};
  }

  // Density 0…1 at a point (metres from the viewer), h its height in the slab 0…1.
  // coarse > 0.5 leaves the fine erosion out (far away, and deep on a light ray):
  // it is never less than the eroded density, so it also serves as a probe.
  float cloudDensity(vec3 p, float h, float coarse) {
    if (h <= 0.0 || h >= 1.0) return 0.0;
    vec2 xz = p.xz + uDrift;
    float weather = cloudWeather(xz);
    // How far inside a cloud field this place is: 0 clear sky … 1 its middle.
    float field = smoothstep(uThreshold - 0.01, uThreshold + 0.085, weather);
    if (field <= 0.0) return 0.0;
    // A closing sky (overcast, rain, storm) joins the cumulus into a deck.
    float closing = smoothstep(0.58, 0.94, uCover);
    // A cumulus has a flat base and a rounded head; the towers stand tallest
    // in the middle of a field, and a closing sky lifts them all.
    float crown = mix(0.32, 1.0, max(field * field, closing));
    float profile = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(crown * 0.34, crown, h));
    if (profile <= 0.0) return 0.0;
    // The wind aloft is stronger: the heads lean a little downwind.
    vec3 at = vec3(xz.x + p.y * 0.35, p.y, xz.y + p.y * 0.2);
    // The noise's own values crowd round 0.68: spread them over 0…1.
    float body = remap01(texture(uNoise, at / 5600.0).r, 0.45, 0.92) * profile;
    // Inside a field single cumulus stand apart, sky between them; only a
    // closing sky fills the gaps.
    // (Even a storm's deck keeps thin places: an even sheet looks like a lid.)
    float cover = mix(mix(0.3, 0.54, field), 0.93, closing) * smoothstep(0.0, 0.25, field);
    float low = 1.0 - cover;
    float high = low + mix(0.3, 0.42, closing);
    if (body <= low) return 0.0;
    if (coarse > 0.5) return remap01(body, low, high);
    // Erosion moves the cloud's surface itself: wisps at the base,
    // cauliflower billows toward the head.
    float cells = remap01(texture(uNoise, at / 1350.0 + vec3(0.13, 0.29, 0.41)).g, 0.25, 0.7);
    float erosion = mix(cells, 1.0 - cells, clamp(h * 2.6, 0.0, 1.0));
    return remap01(body - erosion * 0.3, low, high);
  }

  // Cloud between a point and the light, as an optical depth.
  float lightDepth(vec3 p) {
    float depth = 0.0;
    float stride = 60.0;
    float slab = uTop - BASE;
    for (int i = 0; i < 5; i++) {
      p += uLight * stride;
      float h = (altitude(p) - BASE) / slab;
      if (h >= 1.0) break;
      depth += cloudDensity(p, h, i < 2 ? 0.0 : 1.0) * stride;
      stride *= 1.75;
    }
    return depth * SIGMA_LIGHT;
  }

  float ditherNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec2 uv = uTile.xy + vUv * uTile.zw;
    vec2 chart = (uv - 0.5) * (2.0 / ${CLOUD_MAP_RIM.toFixed(3)});
    float radius2 = dot(chart, chart);
    vec3 direction = vec3(2.0 * chart.x, 1.0 - radius2, 2.0 * chart.y) / (1.0 + radius2);
    float mu = direction.y;
    gl_FragColor = vec4(0.0);
    if (mu <= 0.003) return;
    float near = shellDistance(mu, BASE);
    if (near >= REACH) return;
    float far = min(shellDistance(mu, uTop), REACH);
    // Long strides find the clouds; inside one the march goes back a
    // stride and walks it in quarter steps, so an edge is where it is and
    // not where a stride happened to land.
    float stride = (far - near) / uSteps;
    float fine = stride * 0.25;
    float t = near + stride * fract(ditherNoise(gl_FragCoord.xy) + uJitter);
    float slab = uTop - BASE;
    float toward = dot(direction, uLight);
    // A thin edge before the light glows: the silver lining.
    float lining = pow(max(toward, 0.0), 10.0);
    float closing = smoothstep(0.58, 0.94, uCover);
    vec3 radiance = vec3(0.0);
    float through = 1.0;
    bool inside = false;
    int dry = 0;
    for (int i = 0; i < 224; i++) {
      if (t >= far || through < 0.012 || float(i) >= uSteps * 3.0) break;
      vec3 p = direction * t;
      float h = (altitude(p) - BASE) / slab;
      if (!inside) {
        if (cloudDensity(p, h, 1.0) > 0.0) {
          inside = true;
          dry = 0;
          t = max(near, t - stride) + fine;
        } else {
          t += stride;
        }
        continue;
      }
      float density = cloudDensity(p, h, t > 26000.0 ? 1.0 : 0.0);
      if (density > 0.002) {
        dry = 0;
        float depth = lightDepth(p);
        // Light scattered many times goes deeper than Beer's law lets a
        // single ray: three octaves of it (after Wrenninge).
        float sunlit = (exp(-depth) + 0.42 * exp(-depth * 0.3) + 0.16 * exp(-depth * 0.09)) / 1.58;
        // Sky light from above, the sea's dim light from below; less of
        // either deep inside.
        // A single cumulus has a dark flat base; under a closed sky the
        // whole deck is base, lighter, with gloomier patches where it is thick.
        vec3 shade = uShade * mix(mix(0.56, 0.8, closing), 1.12, pow(h, 0.7)) * (1.0 - 0.2 * density);
        shade *= 1.0 - closing * 0.42 * smoothstep(0.35, 0.75, texture(uNoise, vec3((p.xz + uDrift) / 11000.0, 0.21).xzy).a);
        vec3 colour = mix(shade, uLit, sunlit);
        colour += uLit * lining * exp(-depth * 2.2) * (1.0 - density) * 1.5;
        // Distance takes a cloud into the haze of the horizon.
        colour = mix(uHaze, colour, exp(-t / uAerial));
        float opacity = 1.0 - exp(-density * SIGMA_VIEW * fine);
        radiance += through * opacity * colour;
        through *= 1.0 - opacity;
      } else {
        dry += 1;
        if (dry > 5) inside = false;
      }
      t += fine;
    }
    gl_FragColor = vec4(radiance, 1.0 - through);
  }
`;
