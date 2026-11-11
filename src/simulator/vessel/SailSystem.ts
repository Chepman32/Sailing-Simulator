import * as THREE from "three";
import { damp } from "../math";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import { sailShape, type SailShape } from "./SailMath";
import { tessellate } from "./SailMath";

type SailUniforms = {
  time: { value: number };
  draft: { value: number };
  twist: { value: number };
  flutter: { value: number };
  wrinkle: { value: number };
  luffEnd: { value: number };
  verticalAxis: { value: THREE.Vector3 };
  chordAxis: { value: THREE.Vector3 };
  deformAxis: { value: THREE.Vector3 };
  verticalRange: { value: THREE.Vector2 };
  chordRange: { value: THREE.Vector2 };
  span: { value: number };
};

function axisVector(index: number): THREE.Vector3 {
  const axis = new THREE.Vector3();
  axis.setComponent(index, 1);
  return axis;
}

function axisSize(size: THREE.Vector3, index: number): number {
  return size.getComponent(index);
}

/**
 * Direction, in the cloth's own deformation axis, that deepens the authored
 * sail's belly toward its leeward side. Checked from directly above: a
 * negative bend deepens the camber the model was built with.
 */
export const SAIL_CAMBER_SIGN = -1;

/**
 * GLSL: the cloth's displacement along its deformation axis at a point of
 * the undeformed sail. `local` is the position along the chord measured from
 * the mast, as a fraction of the chord at that height (a triangular sail
 * narrows toward the head), so the belly stays a smooth curve from luff to
 * leech at every height. Belly, twist, a travelling flutter at the free
 * edges and slack-cloth wrinkles add up.
 */
const CLOTH_GLSL = `
uniform float uSailTime;
uniform float uSailDraft;
uniform float uSailTwist;
uniform float uSailFlutter;
uniform float uSailWrinkle;
uniform float uSailLuffEnd;
uniform float uSailSpan;
uniform vec3 uSailVerticalAxis;
uniform vec3 uSailChordAxis;
uniform vec3 uSailDeformAxis;
uniform vec2 uSailVerticalRange;
uniform vec2 uSailChordRange;
float sailCloth(vec3 p) {
  float h = clamp((dot(p, uSailVerticalAxis) - uSailVerticalRange.x) / max(1e-4, uSailVerticalRange.y - uSailVerticalRange.x), 0.0, 1.0);
  float x = clamp((dot(p, uSailChordAxis) - uSailChordRange.x) / max(1e-4, uSailChordRange.y - uSailChordRange.x), 0.0, 1.0);
  float fromMast = mix(x, 1.0 - x, uSailLuffEnd);
  float chordHere = max(0.1, 1.0 - h * 0.9);
  float local = clamp(fromMast / chordHere, 0.0, 1.0);
  float belly = sin(3.14159265 * pow(local, 0.72)) * (0.5 + 0.5 * smoothstep(0.0, 0.3, h));
  float length = uSailSpan * chordHere;
  float shape = uSailDraft * belly * length;
  shape += uSailTwist * h * h * local * uSailSpan;
  float freeEdge = smoothstep(0.5, 1.0, local) * (0.35 + 0.65 * h);
  float gust = 0.75 + 0.25 * sin(uSailTime * 1.7 + h * 3.0);
  float wave = 0.6 * sin(uSailTime * 9.0 + h * 14.0 + local * 6.0) + 0.4 * sin(uSailTime * 15.3 - h * 23.0 + local * 2.0);
  shape += uSailFlutter * uSailSpan * freeEdge * wave * gust;
  float folds = sin(local * 21.0 + h * 9.0 + sin(h * 5.0 + uSailTime * 0.7) * 2.0) * sin(h * 17.0 - local * 6.0 + uSailTime * 1.3);
  shape += uSailWrinkle * uSailSpan * 0.016 * folds * (0.25 + 0.75 * local) * sin(3.14159265 * local);
  return shape;
}`;

export class SailSystem {
  private readonly uniforms: SailUniforms[] = [];
  private readonly clothMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly shape: SailShape = { draft: 0, twist: 0, flutter: 0, wrinkle: 0 };

  constructor(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const materialNames = sourceMaterials.map((material) => material.name.toLowerCase());
      const objectName = object.name.toLowerCase();
      if (!objectName.includes("sail") && !materialNames.some((name) => name.includes("cloth"))) return;

      object.geometry.computeBoundingBox();
      const rough = object.geometry.boundingBox;
      if (!rough) return;
      // A sail of a few big triangles cannot bend: give it a cloth's worth of vertices.
      const roughSize = rough.getSize(new THREE.Vector3());
      const longestSide = Math.max(roughSize.x, roughSize.y, roughSize.z);
      // (The authored sail already has thousands of triangles: this only fills in a sparse one.)
      const triangles = object.geometry.getAttribute("position").count / 3;
      const passes = triangles >= 4000 ? 0 : triangles >= 1000 ? 1 : 3;
      const refined = passes > 0 ? tessellate(object.geometry, longestSide / 36, passes) : object.geometry;
      if (refined !== object.geometry) {
        object.geometry.dispose();
        object.geometry = refined;
      }
      refined.computeBoundingBox();
      const bounds = refined.boundingBox;
      if (!bounds) return;
      const size = bounds.getSize(new THREE.Vector3());
      object.updateWorldMatrix(true, false);
      const worldAxes = [0, 1, 2].map((index) => axisVector(index).transformDirection(object.matrixWorld));
      const verticalIndex = worldAxes.reduce(
        (best, axis, index) => Math.abs(axis.y) > Math.abs(worldAxes[best].y) ? index : best,
        0,
      );
      const horizontalAxes = [0, 1, 2].filter((index) => index !== verticalIndex);
      const chordIndex = axisSize(size, horizontalAxes[0]) >= axisSize(size, horizontalAxes[1])
        ? horizontalAxes[0]
        : horizontalAxes[1];
      const deformIndex = horizontalAxes.find((index) => index !== chordIndex) ?? 2;
      const verticalMin = bounds.min.getComponent(verticalIndex);
      const verticalMax = bounds.max.getComponent(verticalIndex);
      const chordMin = bounds.min.getComponent(chordIndex);
      const chordMax = bounds.max.getComponent(chordIndex);
      const chordSpan = Math.max(0.01, chordMax - chordMin);
      // The luff (mast side) is the end of the chord where the sail is tallest.
      const ends = [0, 0];
      const lows = [Infinity, Infinity];
      const highs = [-Infinity, -Infinity];
      const vertices = refined.getAttribute("position");
      for (let vertex = 0; vertex < vertices.count; vertex += 1) {
        const along = (vertices.getComponent(vertex, chordIndex) - chordMin) / chordSpan;
        const end = along < 0.15 ? 0 : along > 0.85 ? 1 : -1;
        if (end < 0) continue;
        const height = vertices.getComponent(vertex, verticalIndex);
        lows[end] = Math.min(lows[end]!, height);
        highs[end] = Math.max(highs[end]!, height);
      }
      ends[0] = highs[0]! - lows[0]!;
      ends[1] = highs[1]! - lows[1]!;
      const luffEnd = ends[1]! > ends[0]! ? 1 : 0;

      const materials = sourceMaterials.map((source) => {
        const material = source;
        const uniforms: SailUniforms = {
          time: { value: 0 },
          draft: { value: 0 },
          twist: { value: 0 },
          flutter: { value: 0 },
          wrinkle: { value: 0 },
          luffEnd: { value: luffEnd },
          verticalAxis: { value: axisVector(verticalIndex) },
          chordAxis: { value: axisVector(chordIndex) },
          deformAxis: { value: axisVector(deformIndex) },
          verticalRange: { value: new THREE.Vector2(verticalMin, verticalMax) },
          chordRange: { value: new THREE.Vector2(chordMin, chordMax) },
          span: { value: chordSpan },
        };
        this.uniforms.push(uniforms);
        // Patched on top of the seams and shading `Vessel` already installed.
        patchMaterialShader(material, "cloth-sail-v4", (shader) => {
          shader.uniforms.uSailTime = uniforms.time;
          shader.uniforms.uSailDraft = uniforms.draft;
          shader.uniforms.uSailTwist = uniforms.twist;
          shader.uniforms.uSailFlutter = uniforms.flutter;
          shader.uniforms.uSailWrinkle = uniforms.wrinkle;
          shader.uniforms.uSailLuffEnd = uniforms.luffEnd;
          shader.uniforms.uSailVerticalAxis = uniforms.verticalAxis;
          shader.uniforms.uSailChordAxis = uniforms.chordAxis;
          shader.uniforms.uSailDeformAxis = uniforms.deformAxis;
          shader.uniforms.uSailVerticalRange = uniforms.verticalRange;
          shader.uniforms.uSailChordRange = uniforms.chordRange;
          shader.uniforms.uSailSpan = uniforms.span;
          shader.vertexShader = injectAfter(shader.vertexShader, "common", CLOTH_GLSL);
          shader.vertexShader = injectAfter(
            shader.vertexShader,
            "beginnormal_vertex",
            `{
               float sailEps = uSailSpan * 0.012;
               float sailBase = sailCloth(position);
               float dChord = (sailCloth(position + uSailChordAxis * sailEps) - sailBase) / sailEps;
               float dUp = (sailCloth(position + uSailVerticalAxis * sailEps) - sailBase) / sailEps;
               vec3 slope = uSailDeformAxis - dChord * uSailChordAxis - dUp * uSailVerticalAxis;
               float facing = dot(objectNormal, uSailDeformAxis) >= 0.0 ? 1.0 : -1.0;
               objectNormal = normalize(objectNormal + (slope - uSailDeformAxis) * facing);
             }`,
          );
          shader.vertexShader = injectAfter(
            shader.vertexShader,
            "begin_vertex",
            "transformed += uSailDeformAxis * sailCloth(position);",
          );
        });
        if (material instanceof THREE.MeshStandardMaterial) {
          this.clothMaterials.push(material);
          material.roughness = 0.82;
          material.metalness = 0;
          material.side = THREE.DoubleSide;
          material.transparent = false;
          material.opacity = 1;
          material.depthWrite = true;
        }
        return material;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    });
  }

  /**
   * Dyes the cloth (sRGB hex). A dark sail is a little glossier, as tanned
   * and black laminates are.
   */
  setColor(hex: number): void {
    for (const material of this.clothMaterials) {
      material.color.setHex(hex);
      const luminance = material.color.r * 0.2126 + material.color.g * 0.7152 + material.color.b * 0.0722;
      material.roughness = luminance < 0.08 ? 0.62 : 0.82;
    }
  }

  /**
   * Camber and flogging. The swing of the sail and boom around the mast is
   * owned by `Vessel`, which mirrors the rig across the centreline on the
   * other tack, so the camber here is always toward the authored leeward
   * side of the cloth.
   * @param luff 0 drawing … 1 flogging head to wind.
   */
  update(time: number, apparentWindSpeed: number, luff: number, trim: number, delta: number): void {
    const target = sailShape(apparentWindSpeed, luff, trim);
    const shape = this.shape;
    shape.draft = damp(shape.draft, target.draft, 3.2, delta);
    shape.twist = damp(shape.twist, target.twist, 2.2, delta);
    shape.flutter = damp(shape.flutter, target.flutter, 6, delta);
    shape.wrinkle = damp(shape.wrinkle, target.wrinkle, 2.5, delta);
    this.uniforms.forEach((uniforms) => {
      uniforms.time.value = time;
      uniforms.draft.value = shape.draft;
      uniforms.twist.value = Math.abs(shape.twist) * SAIL_CAMBER_SIGN;
      uniforms.flutter.value = shape.flutter;
      uniforms.wrinkle.value = shape.wrinkle;
    });
  }
}
