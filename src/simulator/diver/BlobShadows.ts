import * as THREE from "three";

/**
 * Soft shadows under the figures on a beach where the sun casts no real
 * ones: a phone below the high preset draws no shadow map (`sunShadowsOn`),
 * and an islander or the walker himself standing on bright sand with
 * nothing under his feet looks pasted onto the picture.
 *
 * Each figure gets one soft, dark ellipse laid on the ground from his feet
 * away from the sun, as long as the sun is low (`blobShadowShape`): dense
 * at the feet, fading along its length and at its edge. All of them are one
 * instanced draw of a quad; nothing is rendered twice and no texture is
 * read, so it costs a phone nothing it would notice.
 */

/** Most figures shadowed at once (the nearest traders and the walker). */
export const BLOB_SHADOWS = 8;
/** Width of a standing figure's shadow, m. */
const WIDTH = 0.78;
/** How far the shadow lies above the ground, m (and it is drawn with a depth offset). */
const LIFT = 0.035;

/**
 * The ellipse a figure `height` m tall throws on level ground for a light
 * coming from `(lightX, lightY, lightZ)` (unit, pointing at the light):
 * which way it lies (unit x, z, away from the light) and how long it is —
 * `height / tan(elevation)`, never shorter than the figure is wide (the sun
 * overhead) nor longer than 2.4 times his height (a low sun's shadow runs
 * off across the beach and fades long before its end).
 */
export function blobShadowShape(height: number, lightX: number, lightY: number, lightZ: number, out = { dirX: 0, dirZ: 1, length: WIDTH }): { dirX: number; dirZ: number; length: number } {
  const flat = Math.hypot(lightX, lightZ);
  if (flat < 1e-4) {
    out.dirX = 0;
    out.dirZ = 1;
    out.length = WIDTH;
    return out;
  }
  out.dirX = -lightX / flat;
  out.dirZ = -lightZ / flat;
  const run = lightY > 1e-3 ? (height * flat) / lightY : Infinity;
  out.length = Math.min(height * 2.4, Math.max(WIDTH, run));
  return out;
}

export type BlobCaster = { x: number; z: number; height: number };

export class BlobShadows {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly shape = { dirX: 0, dirZ: 1, length: WIDTH };

  constructor(scene: THREE.Scene) {
    // A unit quad on the ground: x across, z along the shadow (0 at the feet … 1 at its end).
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, 0.5);
    const material = new THREE.ShaderMaterial({
      name: "BlobShadows",
      uniforms: { uStrength: { value: 0.4 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = vec2(position.x + 0.5, position.z);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          // An ellipse filling the quad; a little past the feet too, so they stand in it.
          vec2 p = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.42) / 0.58);
          if (vUv.y < 0.42) p.y = (vUv.y - 0.42) / 0.42;
          float d = length(p);
          float body = 1.0 - smoothstep(0.25, 1.0, d);
          body *= body * (3.0 - 2.0 * body) * 0.5 + 0.5;
          // Dense where the feet are, thinning along its length.
          float along = mix(1.0, 0.45, smoothstep(0.1, 1.0, vUv.y));
          float alpha = body * along * uStrength;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(0.0, 0.01, 0.03, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, BLOB_SHADOWS);
    this.mesh.name = "BlobShadows";
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }

  /**
   * One frame: the casters' shadows for a light at `light` (unit, toward the
   * sun or the moon), `strength` 0…1 how dark (0 hides them: real shadows
   * are on, or the sky is black), `ground(x, z)` the height of the sand.
   */
  update(casters: readonly BlobCaster[], light: THREE.Vector3, strength: number, ground: (x: number, z: number) => number): void {
    const mesh = this.mesh;
    if (!(strength > 0.01) || casters.length === 0) {
      mesh.visible = false;
      mesh.count = 0;
      return;
    }
    let count = 0;
    for (const caster of casters) {
      if (count >= BLOB_SHADOWS) break;
      const shape = blobShadowShape(caster.height, light.x, light.y, light.z, this.shape);
      // Laid along the ground from the feet to where it ends (a slope tilts it).
      const footY = ground(caster.x, caster.z);
      const endX = caster.x + shape.dirX * shape.length;
      const endZ = caster.z + shape.dirZ * shape.length;
      const endY = ground(endX, endZ);
      // A little behind the feet as well, so they stand inside it.
      const back = shape.length * 0.16;
      this.forward.set(shape.dirX * (shape.length + back), (endY - footY) * (1 + back / shape.length), shape.dirZ * (shape.length + back));
      this.right.set(shape.dirZ, 0, -shape.dirX).multiplyScalar(WIDTH);
      this.up.crossVectors(this.forward, this.right).normalize();
      this.origin.set(caster.x - shape.dirX * back, footY + LIFT - ((endY - footY) * back) / shape.length, caster.z - shape.dirZ * back);
      this.matrix.makeBasis(this.right, this.up, this.forward).setPosition(this.origin);
      mesh.setMatrixAt(count, this.matrix);
      count += 1;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.material.uniforms.uStrength!.value = Math.min(0.7, strength);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
