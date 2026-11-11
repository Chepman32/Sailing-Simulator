import type * as THREE from "three";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import { addIslandShadows, type IslandSurfaceUniforms } from "./IslandSurface";

/**
 * Surface detail for the island furniture, by kind (`PROP_KIND` in
 * IslandProps), all in one shader so every island's furniture stays one
 * draw call:
 *
 * - **rock**: granite seen up close: a speckle of feldspar, quartz and
 *   mica crystals, weathered blotches, dark hairline cracks, yellow-grey
 *   lichen on the tops, all bending the normal as well as the colour;
 * - **foliage**: a bush is not a smooth ball: its surface is broken into
 *   leaf clumps (bumps in the normal, light and dark leaves), its outline
 *   is a ragged fringe of leaves (the blob's skin is cut away where it is
 *   seen edge-on), and leaves facing away from the sun glow through when
 *   it is behind them;
 * - **built**: wood, thatch and paint get a fine grain so they are not
 *   flat colour.
 *
 * Detail is a function of world position (3D value noise, no texture
 * lookups), faded to its average where a pixel covers more than the
 * feature, so it never shimmers in the distance.
 */

export const DETAIL_NOISE_GLSL = /* glsl */ `
  #ifndef DETAIL_NOISE_GLSL
  #define DETAIL_NOISE_GLSL
  float detailHash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float detailNoise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(detailHash3(i), detailHash3(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(detailHash3(i + vec3(0.0, 1.0, 0.0)), detailHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(detailHash3(i + vec3(0.0, 0.0, 1.0)), detailHash3(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(detailHash3(i + vec3(0.0, 1.0, 1.0)), detailHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float detailFbm3(vec3 x) {
    return detailNoise3(x) * 0.5 + detailNoise3(x * 2.03 + 7.1) * 0.3 + detailNoise3(x * 4.11 + 3.7) * 0.2;
  }
  #endif
`;

export function applyFurnitureSurface(
  material: THREE.MeshStandardMaterial,
  surface: IslandSurfaceUniforms,
  sky: Record<string, THREE.IUniform>,
): void {
  patchMaterialShader(material, "furniture-surface-v1", (shader) => {
    shader.uniforms.uSunDirection = sky.uSunDirection!;
    shader.uniforms.uSunColor = sky.uSunColor!;
    shader.uniforms.uNight = sky.uNight!;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float propKind;\nvarying float vPropKind;\nvarying vec3 vPropWorld;\nvarying vec3 vPropWorldNormal;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         vPropKind = propKind;
         vPropWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vPropWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    let fragment = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
       uniform vec3 uSunDirection;
       uniform vec3 uSunColor;
       uniform float uNight;
       varying float vPropKind;
       varying vec3 vPropWorld;
       varying vec3 vPropWorldNormal;
       ${DETAIL_NOISE_GLSL}`,
    );
    // Colour and the leafy outline.
    fragment = injectAfter(
      fragment,
      "color_fragment",
      `
      float propFootprint = max(length(fwidth(vPropWorld)), 1.0e-4);
      float propRock = 1.0 - smoothstep(0.3, 0.7, abs(vPropKind - 1.0));
      float propLeaf = smoothstep(1.3, 1.7, vPropKind);
      float propBuilt = 1.0 - smoothstep(0.3, 0.7, vPropKind);
      vec3 propNormalW = normalize(vPropWorldNormal);
      if (propRock > 0.01) {
        float resolved = 1.0 - smoothstep(0.004, 0.03, propFootprint);
        float blotch = detailFbm3(vPropWorld * 0.9);
        float grain = detailNoise3(vPropWorld * 38.0);
        float crystals = detailHash3(floor(vPropWorld * 55.0));
        vec3 rock = diffuseColor.rgb * (0.82 + (blotch - 0.5) * 0.45);
        // Granite: dark mica and white quartz grains among the pink-grey feldspar.
        rock = mix(rock, rock * vec3(0.45, 0.43, 0.42), step(0.86, crystals) * resolved * 0.7);
        rock = mix(rock, vec3(0.86, 0.84, 0.8), step(crystals, 0.07) * resolved * 0.45);
        rock *= mix(1.0, 0.9 + grain * 0.2, resolved);
        // Hairline cracks.
        float crackField = abs(detailNoise3(vPropWorld * vec3(1.7, 0.9, 1.7)) - 0.5);
        rock *= 1.0 - (1.0 - smoothstep(0.0, 0.025 + propFootprint * 0.6, crackField)) * 0.45 * (1.0 - smoothstep(0.02, 0.2, propFootprint));
        // Lichen on surfaces facing up, in patches.
        float lichen = smoothstep(0.55, 0.85, propNormalW.y) * smoothstep(0.55, 0.75, detailFbm3(vPropWorld * 1.7 + 4.0));
        rock = mix(rock, vec3(0.62, 0.6, 0.42) * (0.8 + grain * 0.3), lichen * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, rock, propRock);
      }
      if (propLeaf > 0.01) {
        float resolved = 1.0 - smoothstep(0.01, 0.08, propFootprint);
        // Leaves a few centimetres across: each its own shade, some catching the light.
        vec3 leafCell = floor(vPropWorld * 14.0);
        float leaf = detailHash3(leafCell);
        float clump = detailFbm3(vPropWorld * 2.2);
        vec3 foliage = diffuseColor.rgb * (0.72 + clump * 0.5);
        foliage *= mix(1.0, 0.75 + leaf * 0.55, resolved);
        foliage = mix(foliage, foliage * vec3(1.25, 1.2, 0.75), step(0.93, leaf) * resolved * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, foliage, propLeaf);
        // A ragged fringe: where the skin is seen edge-on, cut it away between
        // leaves, more the more nearly edge-on. Hashed per leaf, so the cut is
        // leaf-shaped and still at rest.
        vec3 toEye = normalize(cameraPosition - vPropWorld);
        float edgeOn = 1.0 - abs(dot(propNormalW, toEye));
        float fringe = detailNoise3(vPropWorld * 9.0) * 0.65 + leaf * 0.35;
        if (propLeaf > 0.5 && fringe < smoothstep(0.55, 0.95, edgeOn) * 0.85 * (1.0 - smoothstep(0.05, 0.4, propFootprint))) discard;
      }
      if (propBuilt > 0.01) {
        float resolved = 1.0 - smoothstep(0.005, 0.04, propFootprint);
        float grain = detailNoise3(vPropWorld * vec3(3.0, 26.0, 3.0));
        diffuseColor.rgb *= mix(1.0, 0.86 + grain * 0.24, resolved * propBuilt);
      }
      `,
    );
    // Relief in the normal: rock grain and leaf clumps.
    fragment = injectAfter(
      fragment,
      "normal_fragment_maps",
      `
      {
        float e = 0.04;
        vec3 bumpWorld = vec3(0.0);
        if (propRock > 0.01) {
          float scale = 4.5;
          float h0 = detailFbm3(vPropWorld * scale);
          bumpWorld += vec3(detailFbm3((vPropWorld + vec3(e, 0.0, 0.0)) * scale) - h0, detailFbm3((vPropWorld + vec3(0.0, e, 0.0)) * scale) - h0, detailFbm3((vPropWorld + vec3(0.0, 0.0, e)) * scale) - h0) / e * 0.07 * propRock;
        }
        if (propLeaf > 0.01) {
          float scale = 7.0;
          float h0 = detailNoise3(vPropWorld * scale);
          bumpWorld += vec3(detailNoise3((vPropWorld + vec3(e, 0.0, 0.0)) * scale) - h0, detailNoise3((vPropWorld + vec3(0.0, e, 0.0)) * scale) - h0, detailNoise3((vPropWorld + vec3(0.0, 0.0, e)) * scale) - h0) / e * 0.09 * propLeaf;
        }
        float fade = 1.0 - smoothstep(0.03, 0.3, propFootprint);
        vec3 bumpView = (viewMatrix * vec4(bumpWorld * fade, 0.0)).xyz;
        normal = normalize(normal - bumpView + dot(bumpView, normal) * normal);
      }
      `,
    );
    // Sun through the leaves.
    fragment = fragment.replace(
      "#include <opaque_fragment>",
      `{
         vec3 toEye = normalize(cameraPosition - vPropWorld);
         float through = pow(max(dot(-toEye, uSunDirection), 0.0), 3.0);
         float day = (1.0 - uNight) * smoothstep(-0.05, 0.15, uSunDirection.y);
         outgoingLight += diffuseColor.rgb * vec3(1.1, 1.2, 0.6) * uSunColor * through * day * 0.35 * propLeaf;
       }
       #include <opaque_fragment>`,
    );
    shader.fragmentShader = fragment;
    addIslandShadows(shader, surface, 4);
  });
}
