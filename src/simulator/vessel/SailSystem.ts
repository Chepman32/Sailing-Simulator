import * as THREE from "three";
import { damp } from "../math";

type SailUniforms = {
  time: { value: number };
  bend: { value: number };
  flutter: { value: number };
  verticalAxis: { value: THREE.Vector3 };
  chordAxis: { value: THREE.Vector3 };
  deformAxis: { value: THREE.Vector3 };
  verticalRange: { value: THREE.Vector2 };
  chordRange: { value: THREE.Vector2 };
  amplitude: { value: number };
};

type SailNode = {
  object: THREE.Object3D;
  baseRotationY: number;
  allowRotation: boolean;
};

function axisVector(index: number): THREE.Vector3 {
  const axis = new THREE.Vector3();
  axis.setComponent(index, 1);
  return axis;
}

function axisSize(size: THREE.Vector3, index: number): number {
  return size.getComponent(index);
}

export class SailSystem {
  private readonly uniforms: SailUniforms[] = [];
  private readonly sails: SailNode[] = [];
  private bend = 0;
  private swing = 0;

  constructor(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const materialNames = sourceMaterials.map((material) => material.name.toLowerCase());
      const objectName = object.name.toLowerCase();
      if (!objectName.includes("sail") && !materialNames.some((name) => name.includes("cloth"))) return;

      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
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

      this.sails.push({
        object,
        baseRotationY: object.rotation.y,
        allowRotation: objectName.includes("sail"),
      });
      const materials = sourceMaterials.map((source) => {
        const material = source;
        const uniforms: SailUniforms = {
          time: { value: 0 },
          bend: { value: 0 },
          flutter: { value: 0 },
          verticalAxis: { value: axisVector(verticalIndex) },
          chordAxis: { value: axisVector(chordIndex) },
          deformAxis: { value: axisVector(deformIndex) },
          verticalRange: { value: new THREE.Vector2(verticalMin, verticalMax) },
          chordRange: { value: new THREE.Vector2(chordMin, chordMax) },
          amplitude: { value: Math.max(0.12, chordSpan * 0.06) },
        };
        this.uniforms.push(uniforms);
        material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
          shader.uniforms.uSailTime = uniforms.time;
          shader.uniforms.uSailBend = uniforms.bend;
          shader.uniforms.uSailFlutter = uniforms.flutter;
          shader.uniforms.uSailVerticalAxis = uniforms.verticalAxis;
          shader.uniforms.uSailChordAxis = uniforms.chordAxis;
          shader.uniforms.uSailDeformAxis = uniforms.deformAxis;
          shader.uniforms.uSailVerticalRange = uniforms.verticalRange;
          shader.uniforms.uSailChordRange = uniforms.chordRange;
          shader.uniforms.uSailAmplitude = uniforms.amplitude;
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              `#include <common>
               uniform float uSailTime;
               uniform float uSailBend;
               uniform float uSailFlutter;
               uniform vec3 uSailVerticalAxis;
               uniform vec3 uSailChordAxis;
               uniform vec3 uSailDeformAxis;
               uniform vec2 uSailVerticalRange;
               uniform vec2 uSailChordRange;
               uniform float uSailAmplitude;`,
            )
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
               float sailVertical = dot(position, uSailVerticalAxis);
               float sailChordPosition = dot(position, uSailChordAxis);
               float sailHeight = smoothstep(uSailVerticalRange.x, uSailVerticalRange.y, sailVertical);
               float chord = smoothstep(uSailChordRange.x, uSailChordRange.y, sailChordPosition);
               float camber = sin(chord * 3.14159265) * uSailBend * uSailAmplitude * (0.28 + sailHeight * 0.72);
               float flutterWave = sin(uSailTime * 8.0 + sailHeight * 31.0 + chord * 4.0);
               transformed += uSailDeformAxis * (camber + flutterWave * uSailFlutter * uSailAmplitude * sailHeight);`,
            );
        };
        material.customProgramCacheKey = () => "deformable-sail-v3";
        if (material instanceof THREE.MeshStandardMaterial) {
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
   * @param leewardSide +1 when the wind fills the sails toward starboard.
   * @param sheetAngle Boom angle off the centreline in radians.
   * @param luff 0 drawing … 1 flogging head to wind.
   */
  update(
    time: number,
    leewardSide: number,
    apparentWindSpeed: number,
    sheetAngle: number,
    luff: number,
    trim: number,
    delta: number,
  ): void {
    const side = leewardSide >= 0 ? 1 : -1;
    const drawing = 1 - luff;
    // A drawing sail bellies to leeward in proportion to the pressure on it;
    // a luffing sail goes slack and shakes.
    const targetBend = side * Math.min(0.82, apparentWindSpeed * 0.03) * (0.35 + trim * 0.65) * drawing;
    this.bend = damp(this.bend, targetBend, 3.4, delta);
    this.swing = damp(this.swing, side * Math.min(sheetAngle, 1.25) * 0.26, 2.6, delta);
    const flutter = Math.min(0.14, apparentWindSpeed * 0.009) * luff + 0.006;
    this.uniforms.forEach((uniforms) => {
      uniforms.time.value = time;
      uniforms.bend.value = this.bend;
      uniforms.flutter.value = flutter;
    });
    this.sails.forEach(({ object, baseRotationY, allowRotation }, index) => {
      if (!allowRotation) return;
      const delay = 1 - index * 0.08;
      object.rotation.y = baseRotationY + this.swing * delay;
    });
  }
}
