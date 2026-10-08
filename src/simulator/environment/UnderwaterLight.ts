import * as THREE from "three";
import { injectAfter, injectBefore, patchMaterialShader } from "../core/ShaderPatch";
import type { EnvironmentPalette, Rgb } from "./EnvironmentPalette";
import { OCEAN_SURFACE_HEIGHT_FAST_GLSL } from "./shaders/oceanShader";

/**
 * Light travelling through sea water.
 *
 * Clear tropical water absorbs red within a few metres, green more slowly
 * and blue least of all, while scattering adds back the water's own colour.
 * Every material below the surface (wildlife, the hulls' underwater parts,
 * keels, propellers, the island aprons and the seabed) applies the same
 * Beer–Lambert transmittance so they read as *in* the water instead of
 * behind glass.
 *
 * Depth is measured from the local wave surface, evaluated per vertex from
 * the shared spectrum: a whale's fluke lifting through a crest clears the
 * water exactly where the crest is drawn, and a body lying under a trough is
 * less veiled than one under a crest.
 */

/** Absorption coefficients per metre for red, green and blue. */
export const UNDERWATER_ABSORPTION: Rgb = [0.42, 0.065, 0.045];
/** Depth over which the effect fades in, so the waterline has no hard edge. */
export const UNDERWATER_FADE_DEPTH = 0.35;

/**
 * Path length through water from a submerged point to a camera above the
 * surface, plus the sunlight's path down from the surface to that point.
 */
export function underwaterPathLength(depth: number, verticalViewFraction: number, viewDistance: number): number {
  if (depth <= 0) return 0;
  const slant = Math.max(Math.abs(verticalViewFraction), 0.2);
  const viewPath = Math.min(depth / slant, viewDistance);
  const fade = Math.min(1, depth / UNDERWATER_FADE_DEPTH);
  return (viewPath + depth * 0.6) * fade * fade * (3 - 2 * fade);
}

export function underwaterTransmittance(pathLength: number, target: Rgb = [0, 0, 0]): Rgb {
  for (let channel = 0; channel < 3; channel += 1) {
    target[channel] = Math.exp(-UNDERWATER_ABSORPTION[channel] * Math.max(0, pathLength));
  }
  return target;
}

function glslVector(color: Rgb): string {
  return `vec3(${color.map((value) => value.toFixed(5)).join(", ")})`;
}

export class UnderwaterLight {
  readonly uniforms = {
    uUnderwaterColor: { value: new THREE.Color(0.01, 0.06, 0.12) },
    uUnderwaterTime: { value: 0 },
  };

  /** Keeps the waterline in step with the ocean. */
  setTime(time: number): void {
    this.uniforms.uUnderwaterTime.value = time;
  }

  /** In-scattered water colour for the current time of day. */
  setPalette(palette: EnvironmentPalette): void {
    const color = this.uniforms.uUnderwaterColor.value;
    color.r = palette.deepWater[0] * (palette.ambientColor[0] + 0.25 * palette.lightColor[0]) * 1.4;
    color.g = palette.deepWater[1] * (palette.ambientColor[1] + 0.25 * palette.lightColor[1]) * 1.4;
    color.b = palette.deepWater[2] * (palette.ambientColor[2] + 0.25 * palette.lightColor[2]) * 1.4;
  }

  /** Decorates a lit or unlit built-in material; works with skinning and instancing. */
  apply(material: THREE.Material): void {
    const uniforms = this.uniforms;
    patchMaterialShader(material, "underwater-v2", (shader) => {
      shader.uniforms.uUnderwaterColor = uniforms.uUnderwaterColor;
      shader.uniforms.uUnderwaterTime = uniforms.uUnderwaterTime;
      shader.vertexShader = injectAfter(
        shader.vertexShader,
        "common",
        `uniform float uUnderwaterTime;
        varying vec3 vUnderwaterWorld;
        varying float vUnderwaterSurface;
        ${OCEAN_SURFACE_HEIGHT_FAST_GLSL}`,
      );
      shader.vertexShader = injectAfter(
        shader.vertexShader,
        "project_vertex",
        `vec4 underwaterWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          underwaterWorld = instanceMatrix * underwaterWorld;
        #endif
        vUnderwaterWorld = (modelMatrix * underwaterWorld).xyz;
        vUnderwaterSurface = oceanSurfaceHeightFast(vUnderwaterWorld.xz, uUnderwaterTime);`,
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader,
        "common",
        `uniform vec3 uUnderwaterColor;
        varying vec3 vUnderwaterWorld;
        varying float vUnderwaterSurface;`,
      );
      shader.fragmentShader = injectBefore(
        shader.fragmentShader,
        "tonemapping_fragment",
        `{
          float underwaterDepth = vUnderwaterSurface - vUnderwaterWorld.y;
          if (underwaterDepth > 0.0) {
            vec3 toFragment = vUnderwaterWorld - cameraPosition;
            float viewDistance = length(toFragment);
            float slant = max(abs(toFragment.y) / max(viewDistance, 0.001), 0.2);
            float fade = smoothstep(0.0, ${UNDERWATER_FADE_DEPTH.toFixed(2)}, underwaterDepth);
            float path = (min(underwaterDepth / slant, viewDistance) + underwaterDepth * 0.6) * fade;
            vec3 transmittance = exp(-${glslVector(UNDERWATER_ABSORPTION)} * path);
            gl_FragColor.rgb = gl_FragColor.rgb * transmittance + uUnderwaterColor * (1.0 - transmittance);
          }
        }`,
      );
    });
  }
}
