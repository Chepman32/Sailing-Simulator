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
  uPalmShadowMap: THREE.IUniform<THREE.Texture | null>;
  uPalmShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uPalmShadowTexel: THREE.IUniform<number>;
  uPalmShadowStrength: THREE.IUniform<number>;
  uPalmTrunks: THREE.IUniform<THREE.Vector4[]>;
};

export const MAX_PALM_TRUNKS = 32;
/** Half the side of the square of islands the palm shadow map covers, metres. */
export const PALM_SHADOW_HALF_EXTENT = 260;
/** The covered square moves in steps of this many metres. */
const PALM_SHADOW_STEP = 120;

export function createIslandSurfaceUniforms(): IslandSurfaceUniforms {
  return {
    uSurfTime: { value: 0 },
    uWindDirection: { value: new THREE.Vector2(0.851, 0.526) },
    uPalmShadowMap: { value: null },
    uPalmShadowMatrix: { value: new THREE.Matrix4() },
    uPalmShadowTexel: { value: 0 },
    uPalmShadowStrength: { value: 0 },
    uPalmTrunks: { value: Array.from({ length: MAX_PALM_TRUNKS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  };
}

// The sky functions bring their noise; the sky uniforms they mention are
// declared so the functions compile, though the sand never calls them.
const SAND_DECLARATIONS = /* glsl */ `
  ${SKY_UNIFORM_DECLARATIONS}
  uniform float uSurfTime;
  uniform vec2 uWindDirection;
  uniform sampler2D uPalmShadowMap;
  uniform mat4 uPalmShadowMatrix;
  uniform float uPalmShadowTexel;
  uniform float uPalmShadowStrength;
  uniform vec4 uPalmTrunks[${MAX_PALM_TRUNKS}];
  varying vec3 vSandWorld;
  varying float vSandMask;
  varying float vRockMask;
  ${SKY_FUNCTIONS}
  ${SURF_GLSL}

  float palmShadowAt(vec3 world) {
    if (uPalmShadowTexel <= 0.0) return 1.0;
    vec4 coord = uPalmShadowMatrix * vec4(world, 1.0);
    coord.xyz /= coord.w;
    if (coord.x <= 0.0 || coord.x >= 1.0 || coord.y <= 0.0 || coord.y >= 1.0 || coord.z >= 1.0) return 1.0;
    // Soft penumbra: a rotated Poisson disc a little over half a metre wide.
    float angle = skyHash(world.xz * 7.13) * 6.2831853;
    mat2 spin = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    float lit = 0.0;
    vec2 taps[8];
    taps[0] = vec2(-0.613, 0.617); taps[1] = vec2(0.170, -0.040); taps[2] = vec2(-0.299, 0.791);
    taps[3] = vec2(0.645, 0.493); taps[4] = vec2(-0.651, -0.717); taps[5] = vec2(0.421, 0.027);
    taps[6] = vec2(-0.817, -0.271); taps[7] = vec2(0.977, -0.108);
    for (int index = 0; index < 8; index++) {
      vec2 offset = spin * taps[index] * uPalmShadowTexel * 2.6;
      float occluder = unpackRGBAToDepth(texture2D(uPalmShadowMap, coord.xy + offset));
      lit += step(coord.z - 0.0015, occluder);
    }
    return mix(1.0, lit / 8.0, uPalmShadowStrength);
  }

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
  patchMaterialShader(material, "island-surface-v2", (shader) => {
    Object.assign(shader.uniforms, sky, surface, ISLAND_SLOT_UNIFORMS);
    shader.vertexShader = injectAfter(
      shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nattribute float sandMask;\nattribute float rockMask;\nvarying vec3 vSandWorld;\nvarying float vSandMask;\nvarying float vRockMask;",
      ),
      "project_vertex",
      "vSandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSandMask = sandMask;\nvRockMask = rockMask;",
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
      "roughnessFactor = mix(roughnessFactor, mix(roughnessFactor, 0.32, sandWet), vSandMask);\nroughnessFactor = mix(roughnessFactor, 0.16, smoothstep(0.0, 0.03, sheet));\nroughnessFactor = mix(roughnessFactor, 0.97, vRockMask);",
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
      float palmShade = palmShadowAt(vSandWorld);
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
 * Shadow map of the palm groves for the island surface. The groves never
 * move, so the map is redrawn only when the light direction changes.
 */
export class PalmShadowMap {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 700);
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private readonly lastDirection = new THREE.Vector3(0, -2, 0);
  private readonly centre = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private readonly bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private readonly clearColor = new THREE.Color();
  private readonly halfExtent: number;
  /** The groves changed (an island was streamed in or out): draw the map again. */
  private dirty = true;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly uniforms: IslandSurfaceUniforms,
    size: number,
  ) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.target.texture.name = "PalmShadowMap";
    this.halfExtent = PALM_SHADOW_HALF_EXTENT;
    this.camera.left = -this.halfExtent;
    this.camera.right = this.halfExtent;
    this.camera.top = this.halfExtent;
    this.camera.bottom = -this.halfExtent;
    this.camera.layers.set(PALM_SHADOW_LAYER);
    uniforms.uPalmShadowMap.value = this.target.texture;
  }

  /** Asks for a redraw on the next update, because the groves have changed. */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Redraws the map if the light has moved or the yacht has sailed into
   * another part of the archipelago; `strength` fades the shadows (night,
   * low sun). The map covers the islands around (focusX, focusZ), on a grid
   * so it does not have to follow every metre.
   */
  update(renderer: THREE.WebGLRenderer, lightDirection: THREE.Vector3, strength: number, focusX = 0, focusZ = 0): boolean {
    this.uniforms.uPalmShadowStrength.value = strength;
    const centreX = Math.round(focusX / PALM_SHADOW_STEP) * PALM_SHADOW_STEP;
    const centreZ = Math.round(focusZ / PALM_SHADOW_STEP) * PALM_SHADOW_STEP;
    const moved = centreX !== this.centre.x || centreZ !== this.centre.z || this.dirty;
    if (strength <= 0.001 || (!moved && lightDirection.angleTo(this.lastDirection) < 0.004)) return false;
    this.dirty = false;
    this.centre.set(centreX, 0, centreZ);
    this.lastDirection.copy(lightDirection);
    this.camera.position.copy(this.centre).addScaledVector(lightDirection, 300);
    this.camera.up.set(0, 1, 0);
    if (Math.abs(lightDirection.y) > 0.99) this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.centre);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    this.uniforms.uPalmShadowMatrix.value
      .copy(this.bias)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
    this.uniforms.uPalmShadowTexel.value = 1 / this.target.width;

    const previousTarget = renderer.getRenderTarget();
    const previousOverride = this.scene.overrideMaterial;
    const previousBackground = this.scene.background;
    const previousFog = this.scene.fog;
    const previousShadowUpdate = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    this.scene.overrideMaterial = this.depthMaterial;
    this.scene.background = null;
    this.scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
    renderer.shadowMap.autoUpdate = previousShadowUpdate;
    this.scene.overrideMaterial = previousOverride;
    this.scene.background = previousBackground;
    this.scene.fog = previousFog;
    return moved;
  }

  dispose(): void {
    this.target.dispose();
    this.depthMaterial.dispose();
  }
}
