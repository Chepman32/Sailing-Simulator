import * as THREE from "three";
import { injectAfter, injectBefore, patchMaterialShader } from "../core/ShaderPatch";
import { ISLAND_SLOT_UNIFORMS, SURF_GLSL } from "./SurfMath";
import { SKY_FUNCTIONS, SKY_UNIFORM_DECLARATIONS } from "./shaders/skyShader";

/**
 * What the island surface needs beyond a lit vertex colour:
 *
 * - **Sand** with a grain you can see up close and still reads from afar:
 *   speckled colour, shell fragments, wind ripples in the normal that fade
 *   before they could alias, wet sand that darkens and turns glossy toward
 *   the water;
 * - **Swash**: the thin sheet each wave runs up the beach, its lacy foam
 *   edge, and the sand it leaves wet for a few seconds (`SurfMath`, shared
 *   with the ocean shader, so the sea and the sand agree on every wave);
 * - **Volcanic rock** (`rockMask`): cinder and scoria grain, lava-flow relief
 *   and ash streaks down the slope, in the colour and in the normal, so a
 *   cone reads as rough black rock rather than a smooth painted shell;
 * - **Palm shadows**: a dedicated shadow map of the groves, rendered from the
 *   sun (or moon) only when it moves, sampled with a soft Poisson filter;
 *   plus contact darkening around each trunk.
 */

/** Layer the palms are drawn on for the shadow map. */
export const PALM_SHADOW_LAYER = 3;

export type IslandSurfaceUniforms = {
  uSurfTime: THREE.IUniform<number>;
  uWindDirection: THREE.IUniform<THREE.Vector2>;
  /** The wide cascade: the islands around the yacht, ±PALM_SHADOW_HALF_EXTENT. */
  uPalmShadowMap: THREE.IUniform<THREE.Texture | null>;
  uPalmShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uPalmShadowTexel: THREE.IUniform<number>;
  /** The near cascade: sharp shadows within ±NEAR_SHADOW_HALF_EXTENT of the yacht. */
  uPalmNearMap: THREE.IUniform<THREE.Texture | null>;
  uPalmNearMatrix: THREE.IUniform<THREE.Matrix4>;
  uPalmNearTexel: THREE.IUniform<number>;
  uPalmShadowStrength: THREE.IUniform<number>;
  uPalmTrunks: THREE.IUniform<THREE.Vector4[]>;
};

export const MAX_PALM_TRUNKS = 32;
/** Half the side of the square of islands the palm shadow map covers, metres. */
export const PALM_SHADOW_HALF_EXTENT = 260;
/** The covered square moves in steps of this many metres. */
const PALM_SHADOW_STEP = 120;
/** Half the side of the near cascade, metres: crisp shadows of every leaf, bush and rock close by. */
export const NEAR_SHADOW_HALF_EXTENT = 75;
const NEAR_SHADOW_STEP = 25;

export function createIslandSurfaceUniforms(): IslandSurfaceUniforms {
  return {
    uSurfTime: { value: 0 },
    uWindDirection: { value: new THREE.Vector2(0.851, 0.526) },
    uPalmShadowMap: { value: null },
    uPalmShadowMatrix: { value: new THREE.Matrix4() },
    uPalmShadowTexel: { value: 0 },
    uPalmNearMap: { value: null },
    uPalmNearMatrix: { value: new THREE.Matrix4() },
    uPalmNearTexel: { value: 0 },
    uPalmShadowStrength: { value: 0 },
    uPalmTrunks: { value: Array.from({ length: MAX_PALM_TRUNKS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  };
}

/**
 * Shadows of the groves, bushes, rocks and buildings on everything on an
 * island (terrain, the bushes themselves, trunks and fronds). Two
 * cascades: a sharp one around the yacht and a wide one beyond, blended
 * across the near one's edge. A rotated Poisson disc softens the edge into
 * a penumbra that widens with distance from the occluder.
 */
export const PALM_SHADOW_GLSL = /* glsl */ `
  #ifndef PALM_SHADOW_GLSL
  #define PALM_SHADOW_GLSL
  uniform sampler2D uPalmShadowMap;
  uniform mat4 uPalmShadowMatrix;
  uniform float uPalmShadowTexel;
  uniform sampler2D uPalmNearMap;
  uniform mat4 uPalmNearMatrix;
  uniform float uPalmNearTexel;
  uniform float uPalmShadowStrength;

  float palmShadowHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Fraction of the light reaching world through one cascade; weight is how
  // fully the point is inside it (0 outside, fading to 1 across its border).
  float palmCascade(sampler2D map, mat4 matrix, float texel, float bias, float spread, vec3 world, float taps, out float weight) {
    weight = 0.0;
    vec4 coord = matrix * vec4(world, 1.0);
    coord.xyz /= coord.w;
    vec2 inside = min(coord.xy, 1.0 - coord.xy);
    if (min(inside.x, inside.y) <= 0.0 || coord.z >= 1.0) return 1.0;
    weight = smoothstep(0.0, 0.08, min(inside.x, inside.y));
    float angle = palmShadowHash(world.xz * 7.13) * 6.2831853;
    mat2 spin = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    vec2 offsets[8];
    offsets[0] = vec2(-0.613, 0.617); offsets[1] = vec2(0.170, -0.040); offsets[2] = vec2(-0.299, 0.791);
    offsets[3] = vec2(0.645, 0.493); offsets[4] = vec2(-0.651, -0.717); offsets[5] = vec2(0.421, 0.027);
    offsets[6] = vec2(-0.817, -0.271); offsets[7] = vec2(0.977, -0.108);
    float lit = 0.0;
    float count = 0.0;
    for (int index = 0; index < 8; index++) {
      if (float(index) >= taps) break;
      vec2 offset = spin * offsets[index] * texel * spread;
      float occluder = unpackRGBAToDepth(texture2D(map, coord.xy + offset));
      lit += step(coord.z - bias, occluder);
      count += 1.0;
    }
    return lit / max(count, 1.0);
  }

  float palmShadowAt(vec3 world, float taps) {
    if (uPalmShadowTexel <= 0.0) return 1.0;
    float nearWeight = 0.0;
    float nearLit = uPalmNearTexel > 0.0 ? palmCascade(uPalmNearMap, uPalmNearMatrix, uPalmNearTexel, 0.0006, 2.2, world, taps, nearWeight) : 1.0;
    float lit = nearLit;
    if (nearWeight < 0.999) {
      float farWeight;
      float farLit = palmCascade(uPalmShadowMap, uPalmShadowMatrix, uPalmShadowTexel, 0.0015, 2.6, world, taps, farWeight);
      lit = mix(mix(1.0, farLit, farWeight), nearLit, nearWeight);
    }
    return mix(1.0, lit, uPalmShadowStrength);
  }
  #endif
`;

// The sky functions bring their noise; the sky uniforms they mention are
// declared so the functions compile, though the sand never calls them.
const SAND_DECLARATIONS = /* glsl */ `
  ${SKY_UNIFORM_DECLARATIONS}
  uniform float uSurfTime;
  uniform vec2 uWindDirection;
  uniform vec4 uPalmTrunks[${MAX_PALM_TRUNKS}];
  varying vec3 vSandWorld;
  varying float vSandMask;
  varying float vRockMask;
  varying vec3 vGroundNormal;
  ${SKY_FUNCTIONS}
  ${SURF_GLSL}

  ${PALM_SHADOW_GLSL}

  float trunkOcclusion(vec2 position) {
    float occlusion = 1.0;
    for (int index = 0; index < ${MAX_PALM_TRUNKS}; index++) {
      vec4 trunk = uPalmTrunks[index];
      if (trunk.w <= 0.0) continue;
      vec2 offset = position - trunk.xz;
      occlusion *= 1.0 - 0.42 * exp(-dot(offset, offset) / (trunk.w * trunk.w));
    }
    return occlusion;
  }
`;

/** Decorates the island terrain material with sand, swash and palm shadows. */
export function applyIslandSurface(
  material: THREE.MeshStandardMaterial,
  surface: IslandSurfaceUniforms,
  sky: Record<string, THREE.IUniform>,
): void {
  patchMaterialShader(material, "island-surface-v3", (shader) => {
    Object.assign(shader.uniforms, sky, surface, ISLAND_SLOT_UNIFORMS);
    shader.vertexShader = injectAfter(
      shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nattribute float sandMask;\nattribute float rockMask;\nvarying vec3 vSandWorld;\nvarying float vSandMask;\nvarying float vRockMask;\nvarying vec3 vGroundNormal;",
      ),
      "project_vertex",
      "vSandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSandMask = sandMask;\nvRockMask = rockMask;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);",
    );
    // The haze lies on the sea: high ground stands out of it, so a far
    // volcano's cone and an island's hills fade with distance like their
    // plumes and clouds do rather than turning into a ghost under them.
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "fog_vertex",
      "#ifdef USE_FOG\nvFogDepth *= 1.0 - 0.55 * smoothstep(6.0, 80.0, vSandWorld.y);\n#endif",
    );
    let fragment = injectAfter(shader.fragmentShader, "packing", SAND_DECLARATIONS);
    // Surface state shared by the colour, roughness and normal stages.
    fragment = injectBefore(
      fragment,
      "color_fragment",
      `
      vec2 sandPosition = vSandWorld.xz;
      float sandFootprint = max(length(fwidth(sandPosition)), 1.0e-4);
      vec3 shoreHere = shoreInfo(sandPosition);
      float swashEdge;
      vec4 swash = surfSample(shoreHere.x, shoreHere.y, shoreHere.z, uSurfTime, swashEdge);
      // Sand just above the waterline is damp; under the water it is soaked.
      float sandWet = max(swash.z, 1.0 - smoothstep(-1.1, 0.25, -shoreHere.x));
      // Below the still water the sea itself does the darkening and tinting.
      float submerged = smoothstep(0.02, -0.12, vSandWorld.y);
      sandWet *= vSandMask * (1.0 - submerged);
      float sheet = swash.y * vSandMask;
      // Volcanic rock: a relief field shared by the colour and the normal.
      vec2 rockPosition = vSandWorld.xz;
      float rockResolved = 1.0 - smoothstep(0.08, 0.6, sandFootprint);
      float rockBroad = skyFbm3(rockPosition * 0.045);
      float rockMid = skyFbm3(rockPosition * 0.19 + 7.3);
      // Grass and scrub ground: everything that is neither sand nor bare rock.
      float groundGreen = (1.0 - vSandMask) * (1.0 - vRockMask);
      float grassResolved = 1.0 - smoothstep(0.015, 0.09, sandFootprint);
      float tuftResolved = 1.0 - smoothstep(0.08, 0.5, sandFootprint);
      float grassBroad = skyFbm3(sandPosition * 0.07 + 3.3);
      float grassTufts = skyNoise(sandPosition * 2.6 + 1.7);
      `,
    );
    fragment = injectAfter(
      fragment,
      "color_fragment",
      `
      if (vSandMask > 0.01) {
        // Grain: fine speckle fading to its average before it can shimmer,
        // broad patches of slightly different sand, rare bright shell bits.
        float grainResolved = 1.0 - smoothstep(0.02, 0.09, sandFootprint);
        float grain = mix(0.5, skyHash(floor(sandPosition * 45.0)), grainResolved);
        float patches = skyFbm3(sandPosition * 0.18);
        float shell = step(0.994, skyHash(floor(sandPosition * 22.0) + 3.7)) * grainResolved;
        vec3 sand = diffuseColor.rgb;
        sand *= 0.9 + (grain - 0.5) * 0.16 + (patches - 0.5) * 0.18;
        sand = mix(sand, vec3(0.93, 0.9, 0.82), shell * 0.6);
        // Wet sand is darker and a little more saturated.
        vec3 wetSand = sand * vec3(0.78, 0.76, 0.72);
        sand = mix(sand, wetSand, sandWet);
        // The swash sheet: clear water over the sand, tinted by its depth.
        sand = mix(sand, sand * vec3(0.86, 0.95, 0.97), smoothstep(0.0, 0.05, sheet));
        // Foam on the sheet and the lace it leaves behind.
        float lace = skyFbm3(mat2(0.8, 0.6, -0.6, 0.8) * sandPosition * 2.3 + vec2(uSurfTime * 0.06, 0.0));
        float sandFoam = smoothstep(0.3, 0.85, swash.x * (0.1 + lace * 1.3)) * vSandMask;
        sand = mix(sand, vec3(0.86, 0.9, 0.92), sandFoam * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, sand, vSandMask);
      }
      if (groundGreen > 0.01) {
        // Grass seen up close: lusher and drier swathes, darker tussocks, single
        // blades catching the light, and bare earth where the ground is steep
        // or trodden. The vertex colour stays the average, so from afar the
        // island keeps its colours.
        vec3 grass = diffuseColor.rgb;
        // Wild coastal turf is not a lawn: swathes of sun-dried grass, darker
        // lush hollows, and patches of leaf litter and sandy soil.
        grass *= mix(vec3(0.86, 0.98, 0.84), vec3(1.25, 1.08, 0.7), smoothstep(0.35, 0.8, grassBroad));
        float litter = smoothstep(0.62, 0.8, skyFbm3(sandPosition * 0.33 + 5.7));
        grass = mix(grass, vec3(0.36, 0.3, 0.18) * (0.75 + grassTufts * 0.5), litter * 0.55);
        grass *= mix(1.0, 0.72 + grassTufts * 0.5, tuftResolved);
        // Blades: a stretched, fine grain that fades out before it can shimmer.
        vec2 bladeCell = floor(sandPosition * vec2(42.0, 13.0) + vec2(0.0, skyHash(floor(sandPosition * 42.0)) * 7.0));
        float blade = skyHash(bladeCell);
        grass *= mix(1.0, 0.82 + blade * 0.36, grassResolved);
        grass = mix(grass, grass * vec3(1.3, 1.22, 0.7), step(0.94, blade) * grassResolved * 0.55);
        // Bare earth: on slopes and in patches, a warm brown soil with a few stones.
        float slope = 1.0 - smoothstep(0.7, 0.92, normalize(vGroundNormal).y);
        float bare = clamp(slope * 0.85 + smoothstep(0.72, 0.86, skyFbm3(sandPosition * 0.21 + 9.1)) * 0.7, 0.0, 1.0);
        vec3 soil = vec3(0.3, 0.22, 0.14) * (0.8 + grassTufts * 0.4);
        soil = mix(soil, vec3(0.5, 0.47, 0.42), step(0.965, skyHash(floor(sandPosition * 18.0) + 2.3)) * grassResolved);
        grass = mix(grass, soil, bare * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, grass, groundGreen);
      }
      if (vRockMask > 0.01) {
        // Cinder and scoria: blotches of darker and rustier rock, fine grain
        // where it can be resolved, pale ash lying in the hollows and in
        // streaks down the fall line.
        vec3 rockColor = diffuseColor.rgb;
        float cinder = mix(0.5, skyHash(floor(rockPosition * 6.0)), rockResolved);
        rockColor *= 0.7 + (rockBroad - 0.5) * 0.55 + (rockMid - 0.5) * 0.35 + (cinder - 0.5) * 0.22;
        rockColor = mix(rockColor, rockColor * vec3(1.35, 0.92, 0.7), smoothstep(0.62, 0.8, rockMid) * 0.45);
        float fall = skyFbm3(vec2(atan(vSandWorld.z, vSandWorld.x) * 30.0, length(rockPosition) * 0.03));
        float ashLie = smoothstep(0.55, 0.85, fall) * smoothstep(0.35, 0.7, rockBroad);
        rockColor = mix(rockColor, vec3(0.32, 0.3, 0.28), ashLie * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, rockColor, vRockMask);
      }
      `,
    );
    fragment = injectAfter(
      fragment,
      "roughnessmap_fragment",
      // Dry sand is matte, wet sand glossy, the swash sheet a mirror.
      "roughnessFactor = mix(roughnessFactor, mix(roughnessFactor, 0.32, sandWet), vSandMask);\nroughnessFactor = mix(roughnessFactor, 0.16, smoothstep(0.0, 0.03, sheet));\nroughnessFactor = mix(roughnessFactor, 0.97, vRockMask);\nroughnessFactor = mix(roughnessFactor, 0.78, groundGreen);",
    );
    fragment = injectAfter(
      fragment,
      "normal_fragment_maps",
      `
      if (vSandMask > 0.01) {
        // Wind ripples across the breeze, bent by a slow warp; flattened by
        // the swash and faded before the pixel footprint can alias them.
        vec2 across = uWindDirection;
        float warp = skyNoise(sandPosition * 0.21) * 4.0;
        float ripplePhase = dot(sandPosition, across) * 11.0 + warp;
        float rippleResolved = 1.0 - smoothstep(0.06, 0.22, sandFootprint);
        float rippleAmount = 0.07 * rippleResolved * (1.0 - sandWet * 0.85) * vSandMask;
        // Asymmetric ripples: a gentle windward slope and a steeper lee.
        float rippleSlope = (cos(ripplePhase) + 0.35 * cos(ripplePhase * 2.0)) * rippleAmount;
        vec2 bump = across * rippleSlope;
        // Micro-relief: footprints of the wind, faint undulations.
        float relief = skyNoise(sandPosition * 1.7);
        bump += (vec2(skyNoise(sandPosition * 1.7 + vec2(0.3, 0.0)), skyNoise(sandPosition * 1.7 + vec2(0.0, 0.3))) - relief)
          * 0.35 * rippleResolved * vSandMask;
        vec3 bumpView = (viewMatrix * vec4(-bump.x, 0.0, -bump.y, 0.0)).xyz;
        normal = normalize(normal + bumpView);
      }
      if (groundGreen > 0.01) {
        // Tussocks and the grain of the turf in the normal.
        float e = 0.12;
        float t0 = skyNoise(sandPosition * 2.6 + 1.7);
        vec2 tuftSlope = vec2(skyNoise((sandPosition + vec2(e, 0.0)) * 2.6 + 1.7) - t0, skyNoise((sandPosition + vec2(0.0, e)) * 2.6 + 1.7) - t0) / e * 0.09 * tuftResolved;
        float m0 = skyFbm3(sandPosition * 0.6);
        tuftSlope += vec2(skyFbm3((sandPosition + vec2(0.5, 0.0)) * 0.6) - m0, skyFbm3((sandPosition + vec2(0.0, 0.5)) * 0.6) - m0) * 0.5;
        vec3 tuftView = (viewMatrix * vec4(-tuftSlope.x, 0.0, -tuftSlope.y, 0.0)).xyz;
        normal = normalize(normal + tuftView * groundGreen);
      }
      if (vRockMask > 0.01) {
        // Lava relief: the slope of the rock field bends the normal, broad
        // lobes and ridges from afar, rubble up close.
        float e = 0.6;
        vec2 rockSlope = vec2(
          skyFbm3((rockPosition + vec2(e, 0.0)) * 0.19 + 7.3) - rockMid,
          skyFbm3((rockPosition + vec2(0.0, e)) * 0.19 + 7.3) - rockMid
        ) * 2.6;
        rockSlope += vec2(
          skyFbm3((rockPosition + vec2(e * 4.0, 0.0)) * 0.045) - rockBroad,
          skyFbm3((rockPosition + vec2(0.0, e * 4.0)) * 0.045) - rockBroad
        ) * 3.2;
        vec3 rockBump = (viewMatrix * vec4(-rockSlope.x, 0.0, -rockSlope.y, 0.0)).xyz;
        normal = normalize(normal + rockBump * vRockMask);
      }
      `,
    );
    fragment = injectAfter(
      fragment,
      "lights_fragment_end",
      `
      float palmShade = palmShadowAt(vSandWorld, 8.0);
      reflectedLight.directDiffuse *= palmShade;
      reflectedLight.directSpecular *= palmShade;
      float trunkShade = trunkOcclusion(vSandWorld.xz);
      reflectedLight.indirectDiffuse *= trunkShade;
      reflectedLight.directDiffuse *= mix(1.0, trunkShade, 0.5);
      `,
    );
    shader.fragmentShader = fragment;
  });
}

/**
 * One cascade of the island shadow map: an orthographic depth render, from
 * the light, of everything on `PALM_SHADOW_LAYER` (palm groves, bushes,
 * rocks, huts) over a square that follows the yacht in steps. Nothing on
 * an island moves but the light, so a cascade is drawn again only when the
 * square moves, the light turns, or the islands change.
 */
class ShadowCascade {
  readonly target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 700);
  private readonly lastDirection = new THREE.Vector3(0, -2, 0);
  private readonly centre = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private readonly bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  dirty = true;

  constructor(
    size: number,
    private readonly halfExtent: number,
    private readonly step: number,
    private readonly matrix: THREE.Matrix4,
    private readonly texel: THREE.IUniform<number>,
    map: THREE.IUniform<THREE.Texture | null>,
    name: string,
  ) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.target.texture.name = name;
    this.camera.left = -halfExtent;
    this.camera.right = halfExtent;
    this.camera.top = halfExtent;
    this.camera.bottom = -halfExtent;
    // Close enough to the scene that depth keeps its precision.
    this.camera.far = halfExtent * 2 + 300;
    this.camera.layers.set(PALM_SHADOW_LAYER);
    map.value = this.target.texture;
  }

  /** Whether the cascade needs drawing for this focus and light. */
  wants(lightDirection: THREE.Vector3, focusX: number, focusZ: number): boolean {
    const centreX = Math.round(focusX / this.step) * this.step;
    const centreZ = Math.round(focusZ / this.step) * this.step;
    const moved = centreX !== this.centre.x || centreZ !== this.centre.z;
    return this.dirty || moved || lightDirection.angleTo(this.lastDirection) >= 0.004;
  }

  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, lightDirection: THREE.Vector3, focusX: number, focusZ: number): void {
    this.dirty = false;
    this.centre.set(Math.round(focusX / this.step) * this.step, 0, Math.round(focusZ / this.step) * this.step);
    this.lastDirection.copy(lightDirection);
    this.camera.position.copy(this.centre).addScaledVector(lightDirection, this.halfExtent + 150);
    this.camera.up.set(0, 1, 0);
    if (Math.abs(lightDirection.y) > 0.99) this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.centre);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    this.matrix.copy(this.bias).multiply(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    this.texel.value = 1 / this.target.width;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
  }
}

/**
 * Shadow maps of everything standing on the islands (groves, bushes, rocks,
 * buildings): a sharp near cascade round the yacht and a wide one over the
 * islands in view, sampled by `PALM_SHADOW_GLSL`. Each object is drawn with
 * its material's `userData.shadowDepth` if it has one (the fronds' leaflets
 * are cut out of their shadows) or a plain depth material.
 */
export class PalmShadowMap {
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  private readonly far: ShadowCascade;
  private readonly near: ShadowCascade;
  private readonly clearColor = new THREE.Color();
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly uniforms: IslandSurfaceUniforms,
    size: number,
  ) {
    this.far = new ShadowCascade(size, PALM_SHADOW_HALF_EXTENT, PALM_SHADOW_STEP, uniforms.uPalmShadowMatrix.value, uniforms.uPalmShadowTexel, uniforms.uPalmShadowMap, "PalmShadowMap");
    this.near = new ShadowCascade(Math.min(2048, size * 2), NEAR_SHADOW_HALF_EXTENT, NEAR_SHADOW_STEP, uniforms.uPalmNearMatrix.value, uniforms.uPalmNearTexel, uniforms.uPalmNearMap, "PalmShadowNear");
  }

  /** Asks for a redraw on the next update, because the groves have changed. */
  invalidate(): void {
    this.far.dirty = true;
    this.near.dirty = true;
  }

  /**
   * Redraws whichever cascade the light or the yacht has moved away from;
   * `strength` fades the shadows (night, low sun). Returns whether the wide
   * cascade moved (the trunk slots follow it).
   */
  update(renderer: THREE.WebGLRenderer, lightDirection: THREE.Vector3, strength: number, focusX = 0, focusZ = 0): boolean {
    this.uniforms.uPalmShadowStrength.value = strength;
    if (strength <= 0.001) return false;
    const drawFar = this.far.wants(lightDirection, focusX, focusZ);
    const drawNear = this.near.wants(lightDirection, focusX, focusZ);
    if (!drawFar && !drawNear) return false;

    const previousTarget = renderer.getRenderTarget();
    const previousBackground = this.scene.background;
    const previousFog = this.scene.fog;
    const previousShadowUpdate = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    this.scene.background = null;
    this.scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    // Depth materials in place of the real ones, only on the shadow layer.
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.layers.isEnabled(PALM_SHADOW_LAYER)) return;
      const material = object.material;
      const depth = Array.isArray(material) ? this.depthMaterial : ((material.userData.shadowDepth as THREE.Material | undefined) ?? this.depthMaterial);
      this.swapped.push({ mesh: object, material });
      object.material = depth;
    });
    try {
      if (drawFar) this.far.draw(renderer, this.scene, lightDirection, focusX, focusZ);
      if (drawNear) this.near.draw(renderer, this.scene, lightDirection, focusX, focusZ);
    } finally {
      for (const { mesh, material } of this.swapped) mesh.material = material;
      this.swapped.length = 0;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(this.clearColor, previousAlpha);
      renderer.shadowMap.autoUpdate = previousShadowUpdate;
      this.scene.background = previousBackground;
      this.scene.fog = previousFog;
    }
    return drawFar;
  }

  dispose(): void {
    this.far.dispose();
    this.near.dispose();
    this.depthMaterial.dispose();
  }
}

/**
 * Lets a material on an island (bushes, rocks, huts, the palms themselves)
 * stand in the island shadow maps: the direct light is taken off where a
 * grove, a bush or a rock is between it and the sun. Call from inside an
 * `onBeforeCompile` (the shader is edited in place). `taps` trades the
 * penumbra's smoothness for speed (fronds need fewer than the ground).
 */
export function addIslandShadows(shader: THREE.WebGLProgramParametersWithUniforms, surface: IslandSurfaceUniforms, taps = 4): void {
  Object.assign(shader.uniforms, {
    uPalmShadowMap: surface.uPalmShadowMap,
    uPalmShadowMatrix: surface.uPalmShadowMatrix,
    uPalmShadowTexel: surface.uPalmShadowTexel,
    uPalmNearMap: surface.uPalmNearMap,
    uPalmNearMatrix: surface.uPalmNearMatrix,
    uPalmNearTexel: surface.uPalmNearTexel,
    uPalmShadowStrength: surface.uPalmShadowStrength,
  });
  if (!shader.vertexShader.includes("varying vec3 vIslandShadowWorld;")) {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vIslandShadowWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvIslandShadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  }
  shader.fragmentShader = injectAfter(
    shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vIslandShadowWorld;"),
    "packing",
    PALM_SHADOW_GLSL,
  );
  shader.fragmentShader = injectAfter(
    shader.fragmentShader,
    "lights_fragment_end",
    `{
       float islandShade = palmShadowAt(vIslandShadowWorld, ${taps.toFixed(1)});
       reflectedLight.directDiffuse *= islandShade;
       reflectedLight.directSpecular *= islandShade;
     }`,
  );
}
