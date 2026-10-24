import * as THREE from "three";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import {
  pickShadowShips,
  SHIP_SHADOW_BIAS_METRES,
  SHIP_SHADOW_GLSL,
  SHIP_SHADOW_HEIGHT,
  SHIP_SHADOW_SLOTS,
  shadowAtlasMatrix,
  shadowSlotOrigin,
  shadowSlotRadius,
  type ShadowCandidate,
  type ShipShadowUniforms,
} from "./ShipShadowMath";

/** Render layer of everything that casts a ship shadow (the ships' hulls and models). */
export const SHIP_SHADOW_LAYER = 5;

/**
 * Draws the nearest ships' sun shadows into a depth atlas each frame (see
 * `ShipShadowMath`) and lets materials look themselves up in it. The ships
 * are drawn depth only with one shared material, a quarter of the atlas
 * each, from an orthographic camera fitted round each ship along the light.
 */
export class ShipShadows {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 1000);
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private readonly picked: number[] = [];
  private readonly atlas = new THREE.Matrix4();
  private readonly centre = new THREE.Vector3();
  private readonly clearColor = new THREE.Color();
  private enabled: boolean;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly uniforms: ShipShadowUniforms,
    size: number,
  ) {
    this.enabled = size > 0;
    const edge = Math.max(256, size);
    this.target = new THREE.WebGLRenderTarget(edge, edge, { depthBuffer: true, stencilBuffer: false });
    this.target.texture.name = "ShipShadowColour";
    const depth = new THREE.DepthTexture(edge, edge);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.target.depthTexture = depth;
    this.target.scissorTest = true;
    this.uniforms.uShipShadowTexel.value = 1 / edge;
    this.camera.layers.set(SHIP_SHADOW_LAYER);
  }

  /** Atlas edge in texels; 0 switches the shadows off (low preset). */
  setSize(size: number): void {
    this.enabled = size > 0;
    if (!this.enabled) {
      this.uniforms.uShipShadowCount.value = 0;
      return;
    }
    if (this.target.width === size) return;
    this.target.setSize(size, size);
    this.target.depthTexture!.image.width = size;
    this.target.depthTexture!.image.height = size;
    this.uniforms.uShipShadowTexel.value = 1 / size;
  }

  /**
   * Shades a ship material with the atlas: the direct (sun or moon) light is
   * taken off where another part of the ship stands between it and the sun.
   */
  patch(material: THREE.Material): void {
    // Only lit materials have direct light to take away.
    const lit = material as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshLambertMaterial?: boolean };
    if (!lit.isMeshStandardMaterial && !lit.isMeshPhongMaterial && !lit.isMeshLambertMaterial) return;
    const uniforms = this.uniforms;
    patchMaterialShader(material, "ship-shadow-v1", (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = injectAfter(
        shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vShipWorld;"),
        "project_vertex",
        "vShipWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vShipWorld;\n${SHIP_SHADOW_GLSL}`),
        "lights_fragment_end",
        `{
          // A little along the surface normal, so a face does not shadow itself.
          vec3 shipNormal = inverseTransformDirection(normal, viewMatrix);
          float shipLit = shipShadowAt(vShipWorld + shipNormal * 0.45);
          reflectedLight.directDiffuse *= shipLit;
          reflectedLight.directSpecular *= shipLit;
        }`,
      );
    });
  }

  /**
   * Draws the shadows of the ships nearest to `viewer` for a light shining
   * along −`toLight`. `roots` are the ships' scene objects, by ship index.
   */
  render(
    scene: THREE.Scene,
    ships: readonly ShadowCandidate[],
    roots: readonly THREE.Object3D[],
    viewer: THREE.Vector3,
    toLight: THREE.Vector3,
  ): void {
    const uniforms = this.uniforms;
    if (!this.enabled || toLight.y <= 0.02) {
      uniforms.uShipShadowCount.value = 0;
      return;
    }
    pickShadowShips(ships, viewer.x, viewer.z, this.picked);
    uniforms.uShipShadowCount.value = 0;
    if (this.picked.length === 0) return;

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    scene.overrideMaterial = this.depthOnly;
    scene.background = null;
    scene.fog = null;
    renderer.autoClear = false;
    // World matrices once for all the slots (the ships were moved this frame).
    scene.updateMatrixWorld();
    const previousAutoUpdate = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;

    const size = this.target.width;
    const half = size / 2;
    this.picked.forEach((index, slot) => {
      const ship = ships[index]!;
      const root = roots[index]!;
      const radius = shadowSlotRadius(ship.halfLength);
      this.centre.set(root.position.x, root.position.y + SHIP_SHADOW_HEIGHT * 0.3, root.position.z);
      const reach = radius + 150;
      const camera = this.camera;
      camera.left = -radius;
      camera.right = radius;
      camera.top = radius;
      camera.bottom = -radius;
      camera.near = 1;
      camera.far = reach + radius * 1.5;
      camera.position.copy(this.centre).addScaledVector(toLight, reach);
      camera.up.set(0, 1, 0);
      if (Math.abs(toLight.y) > 0.98) camera.up.set(0, 0, 1);
      camera.lookAt(this.centre);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();

      const [u, v] = shadowSlotOrigin(slot);
      this.target.viewport.set(u * size, v * size, half, half);
      this.target.scissor.set(u * size, v * size, half, half);
      renderer.setRenderTarget(this.target);
      renderer.clear(false, true, false);
      renderer.render(scene, camera);

      shadowAtlasMatrix(slot, this.atlas);
      uniforms.uShipShadowMatrix.value[slot]!.copy(this.atlas)
        .multiply(camera.projectionMatrix)
        .multiply(camera.matrixWorldInverse);
      uniforms.uShipShadowBias.value.setComponent(slot, SHIP_SHADOW_BIAS_METRES / (camera.far - camera.near));
    });
    uniforms.uShipShadowCount.value = this.picked.length;
    uniforms.uShipShadowMap.value = this.target.depthTexture;

    scene.matrixWorldAutoUpdate = previousAutoUpdate;
    scene.overrideMaterial = previousOverride;
    scene.background = previousBackground;
    scene.fog = previousFog;
    renderer.autoClear = previousAutoClear;
    renderer.setClearColor(this.clearColor, previousAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.depthOnly.dispose();
    this.uniforms.uShipShadowCount.value = 0;
  }
}

/** Slots the atlas holds (re-exported for diagnostics). */
export const SHIP_SHADOW_ATLAS_SLOTS = SHIP_SHADOW_SLOTS;
