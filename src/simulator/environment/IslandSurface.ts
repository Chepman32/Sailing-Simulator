import * as THREE from "three";
import { injectAfter, injectBefore, patchMaterialShader } from "../core/ShaderPatch";
import { ISLAND_DEFINITIONS } from "./IslandMath";
import { SURF_GLSL } from "./SurfMath";
import { SKY_FUNCTIONS } from "./shaders/skyShader";

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
  uniform float uSurfTime;
  uniform vec2 uWindDirection;
  uniform sampler2D uPalmShadowMap;
  uniform mat4 uPalmShadowMatrix;
  uniform float uPalmShadowTexel;
  uniform float uPalmShadowStrength;
  uniform vec4 uPalmTrunks[${MAX_PALM_TRUNKS}];
  varying vec3 vSandWorld;
  varying float vSandMask;
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
  patchMaterialShader(material, "island-surface-v1", (shader) => {
    Object.assign(shader.uniforms, sky, surface);
    shader.vertexShader = injectAfter(
      shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nattribute float sandMask;\nvarying vec3 vSandWorld;\nvarying float vSandMask;",
      ),
      "project_vertex",
      "vSandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSandMask = sandMask;",
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
      `,
    );
    fragment = injectAfter(
      fragment,
      "roughnessmap_fragment",
      // Dry sand is matte, wet sand glossy, the swash sheet a mirror.
      "roughnessFactor = mix(roughnessFactor, mix(roughnessFactor, 0.32, sandWet), vSandMask);\nroughnessFactor = mix(roughnessFactor, 0.16, smoothstep(0.0, 0.03, sheet));",
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
  private readonly centre = new THREE.Vector3();
  private readonly bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private readonly clearColor = new THREE.Color();
  private readonly halfExtent: number;

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
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const island of ISLAND_DEFINITIONS) {
      minX = Math.min(minX, island.centerX - island.beachRadius * 1.1);
      maxX = Math.max(maxX, island.centerX + island.beachRadius * 1.1);
      minZ = Math.min(minZ, island.centerZ - island.beachRadius * island.scaleZ * 1.1);
      maxZ = Math.max(maxZ, island.centerZ + island.beachRadius * island.scaleZ * 1.1);
    }
    this.centre.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.halfExtent = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 12;
    this.camera.left = -this.halfExtent;
    this.camera.right = this.halfExtent;
    this.camera.top = this.halfExtent;
    this.camera.bottom = -this.halfExtent;
    this.camera.layers.set(PALM_SHADOW_LAYER);
    uniforms.uPalmShadowMap.value = this.target.texture;
  }

  /** Redraws the map if the light has moved; `strength` fades the shadows (night, low sun). */
  update(renderer: THREE.WebGLRenderer, lightDirection: THREE.Vector3, strength: number): void {
    this.uniforms.uPalmShadowStrength.value = strength;
    if (strength <= 0.001 || lightDirection.angleTo(this.lastDirection) < 0.004) return;
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
  }

  dispose(): void {
    this.target.dispose();
    this.depthMaterial.dispose();
  }
}
