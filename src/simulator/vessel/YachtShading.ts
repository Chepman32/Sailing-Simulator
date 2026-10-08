import * as THREE from "three";
import { injectAfter, injectBefore, patchMaterialShader } from "../core/ShaderPatch";
import type { EnvironmentPalette } from "../environment/EnvironmentPalette";
import { OCEAN_SURFACE_HEIGHT_GLSL } from "../environment/shaders/oceanShader";

/**
 * Surface detail painted onto the untextured yacht model in its own frame.
 *
 * The source catamaran has eight flat-coloured materials and no textures,
 * which reads as plastic. These patches add what a real cruising catamaran
 * shows at a glance:
 *
 * - hulls: dark antifouling below the waterline, a boot stripe just above it,
 *   a thin cove line under the sheer, and a wet, darker splash band wherever
 *   the actual wave surface is touching the hull;
 * - deck and coachroof: a moulded non-skid texture on the walkable surfaces;
 * - sail: horizontal panel seams, batten pockets and diffuse light passing
 *   through the cloth when the sun is behind it.
 *
 * Everything is expressed in vessel space (+Z bow, +Y up) so it follows the
 * yacht through heave, pitch and roll and needs no texture coordinates.
 */

/** Static waterline in vessel space: the hull floats 0.46 m below the root. */
export const DESIGN_WATERLINE = -0.46;
export const BOOT_STRIPE_HEIGHT = 0.14;
/** White gelcoat left between the antifouling and the boot stripe. */
export const BOOT_STRIPE_GAP = 0.06;

export class YachtShading {
  readonly uniforms = {
    uWorldToVessel: { value: new THREE.Matrix4() },
    uOceanTime: { value: 0 },
    uSunViewDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunLight: { value: new THREE.Color(1, 1, 1) },
  };

  update(root: THREE.Object3D, time: number, camera: THREE.Camera, lightDirection: THREE.Vector3, palette: EnvironmentPalette): void {
    this.uniforms.uWorldToVessel.value.copy(root.matrixWorld).invert();
    this.uniforms.uOceanTime.value = time;
    this.uniforms.uSunViewDirection.value.copy(lightDirection).transformDirection(camera.matrixWorldInverse);
    const light = this.uniforms.uSunLight.value;
    light.r = palette.lightColor[0];
    light.g = palette.lightColor[1];
    light.b = palette.lightColor[2];
  }

  /** @param sheerHeight Top of the hull topsides in vessel space. */
  applyHull(material: THREE.MeshStandardMaterial, sheerHeight: number): void {
    const uniforms = this.uniforms;
    patchMaterialShader(material, "yacht-hull-v1", (shader) => {
      this.declare(shader);
      shader.uniforms.uOceanTime = uniforms.uOceanTime;
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "common",
        `uniform float uOceanTime;
        ${OCEAN_SURFACE_HEIGHT_GLSL}`,
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "color_fragment",
        `float hullHeight = vYachtPosition.y;
        float antifouling = 1.0 - smoothstep(${(DESIGN_WATERLINE + 0.015).toFixed(3)}, ${(DESIGN_WATERLINE + 0.025).toFixed(3)}, hullHeight);
        // The boot stripe sits just above the antifouling, where waves wash it.
        float bootStripe = smoothstep(${(DESIGN_WATERLINE + BOOT_STRIPE_GAP - 0.005).toFixed(3)}, ${(DESIGN_WATERLINE + BOOT_STRIPE_GAP + 0.005).toFixed(3)}, hullHeight)
          * (1.0 - smoothstep(${(DESIGN_WATERLINE + BOOT_STRIPE_GAP + BOOT_STRIPE_HEIGHT - 0.005).toFixed(3)}, ${(DESIGN_WATERLINE + BOOT_STRIPE_GAP + BOOT_STRIPE_HEIGHT + 0.005).toFixed(3)}, hullHeight));
        float coveLine = 1.0 - smoothstep(0.008, 0.014, abs(hullHeight - ${(sheerHeight - 0.14).toFixed(3)}));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.03, 0.055), antifouling);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.085, 0.13), bootStripe);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.24, 0.26), coveLine * 0.85);
        // Where the real wave surface meets the hull the gelcoat is wet.
        float waterClearance = vYachtWorld.y - oceanSurfaceHeight(vYachtWorld.xz, uOceanTime);
        float hullWetness = (1.0 - smoothstep(0.0, 0.34, waterClearance)) * step(-0.08, waterClearance);
        diffuseColor.rgb *= 1.0 - hullWetness * 0.16;`,
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "roughnessmap_fragment",
        `roughnessFactor = mix(roughnessFactor, 0.62, antifouling);
        roughnessFactor = mix(roughnessFactor, 0.18, bootStripe);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, hullWetness);`,
      );
    });
  }

  applyDeck(material: THREE.MeshStandardMaterial): void {
    patchMaterialShader(material, "yacht-deck-v1", (shader) => {
      this.declare(shader);
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "color_fragment",
        `// Moulded non-skid: a fine diamond pattern on surfaces you can walk on.
        float walkable = smoothstep(0.82, 0.93, vYachtNormal.y);
        vec2 grid = vYachtPosition.xz * 9.0;
        vec2 cell = abs(fract(grid) - 0.5);
        float nonSkid = smoothstep(0.32, 0.46, max(cell.x, cell.y));
        diffuseColor.rgb *= 1.0 - walkable * (0.05 + nonSkid * 0.05);`,
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "roughnessmap_fragment",
        "roughnessFactor = mix(roughnessFactor, 0.74, walkable);",
      );
    });
  }

  applySail(material: THREE.MeshStandardMaterial): void {
    const uniforms = this.uniforms;
    patchMaterialShader(material, "yacht-sail-v1", (shader) => {
      this.declare(shader);
      shader.uniforms.uSunViewDirection = uniforms.uSunViewDirection;
      shader.uniforms.uSunLight = uniforms.uSunLight;
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "common",
        `uniform vec3 uSunViewDirection;
        uniform vec3 uSunLight;`,
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "color_fragment",
        `// Crosscut panels: a seam every 0.82 m, a heavier batten pocket every
        // third seam, and slightly darker tape along the foot.
        float sailHeight = vYachtPosition.y;
        float seamPhase = abs(fract(sailHeight / 0.82) - 0.5);
        float seam = 1.0 - smoothstep(0.0, 0.009, 0.5 - seamPhase);
        float battenPhase = abs(fract(sailHeight / 2.46 + 0.17) - 0.5);
        float batten = 1.0 - smoothstep(0.004, 0.012, 0.5 - battenPhase);
        diffuseColor.rgb *= 1.0 - seam * 0.13 - batten * 0.09;`,
      );
      shader.fragmentShader = injectBefore(
        shader.fragmentShader,
        "opaque_fragment",
        `// Woven sailcloth passes a little diffuse light: a sail between the
        // viewer and the sun glows softly, while the solar disc stays hidden.
        float sunBehind = max(dot(-normal, normalize(uSunViewDirection)), 0.0);
        outgoingLight += diffuseColor.rgb * uSunLight * sunBehind * 0.075 * (1.0 - seam * 0.6 - batten * 0.6);`,
      );
    });
  }

  private declare(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uWorldToVessel = this.uniforms.uWorldToVessel;
    if (!shader.vertexShader.includes("varying vec3 vYachtPosition;")) {
      shader.vertexShader = injectAfter(
        shader.vertexShader,
        "common",
        `uniform mat4 uWorldToVessel;
        varying vec3 vYachtPosition;
        varying vec3 vYachtWorld;
        varying vec3 vYachtNormal;`,
      );
      shader.vertexShader = injectAfter(
        shader.vertexShader,
        "project_vertex",
        `vec4 yachtWorld = modelMatrix * vec4(transformed, 1.0);
        vYachtWorld = yachtWorld.xyz;
        vYachtPosition = (uWorldToVessel * yachtWorld).xyz;
        vYachtNormal = normalize(mat3(uWorldToVessel) * mat3(modelMatrix) * objectNormal);`,
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "common",
        `varying vec3 vYachtPosition;
        varying vec3 vYachtWorld;
        varying vec3 vYachtNormal;`,
      );
    }
  }
}
