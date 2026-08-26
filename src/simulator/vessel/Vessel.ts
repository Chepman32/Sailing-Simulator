import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { SimulatorControls } from "../types";
import type { VesselPhysics } from "./VesselPhysics";
import { SailSystem } from "./SailSystem";

export const MAX_PROPELLER_RPM = 600;
const MIN_ACTIVE_PROPELLER_RPM = 220;
const PROPELLER_RESPONSE = 7.5;

export function propellerRpmForThrottle(throttle: number): number {
  const magnitude = THREE.MathUtils.clamp(Math.abs(throttle), 0, 1);
  if (magnitude < 0.001) return 0;
  return Math.sign(throttle) * THREE.MathUtils.lerp(MIN_ACTIVE_PROPELLER_RPM, MAX_PROPELLER_RPM, magnitude);
}

export class Vessel {
  readonly root = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sailSystem: SailSystem;
  private readonly rudders: THREE.Object3D[] = [];
  private readonly propellers: THREE.Mesh[] = [];
  private readonly generatedMeshes: THREE.Mesh[] = [];
  private readonly navigationLights = new THREE.Group();
  private propellerAngularVelocity = 0;

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
  ) {
    this.root.name = "VesselRoot";
    this.root.rotation.order = "YXZ";
    scene.add(this.root);
    this.model = assets.yacht();
    this.model.name = "GLB_High_Detail_Sailing_Catamaran";
    // The source model's bow faces -Z; simulation forward is +Z.
    this.model.rotation.y = Math.PI;
    this.model.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(this.model);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const scale = 9.4 / Math.max(sourceSize.z, sourceSize.x, 0.01);
    this.model.scale.setScalar(scale);
    this.model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model);
    const center = bounds.getCenter(new THREE.Vector3());
    // The source GLB's hulls are already centered around x=0. Centering the
    // complete bounds would use the asymmetric sail and shift both hulls more
    // than a metre away from their buoyancy and wake points.
    this.model.position.z -= center.z;
    this.model.position.y -= bounds.min.y + 1.06;
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = materials.map((source) => {
        const material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          const name = material.name.toLowerCase();
          if (name.includes("cloth")) {
            material.color.set(0xf5f0df);
            material.roughness = 0.76;
            material.metalness = 0;
            material.side = THREE.DoubleSide;
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.depthTest = true;
            material.emissive.set(0x000000);
            material.emissiveIntensity = 0;
          } else if (name.includes("fiberglass")) {
            material.color.set(0xf2f4f2);
            material.roughness = 0.3;
            material.metalness = 0.04;
          } else if (name.includes("stainless")) {
            material.metalness = 0.88;
            material.roughness = 0.2;
          } else if (name === "glass") {
            material.color.set(0x173e4b);
            material.transparent = true;
            material.opacity = 0.38;
            material.roughness = 0.12;
            material.metalness = 0.08;
            material.depthWrite = false;
          } else if (name.includes("rough_white")) {
            material.color.set(0xe9e8e1);
            material.roughness = 0.72;
          }
        }
        return material;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
      if (object.name.toLowerCase().includes("rudder")) this.rudders.push(object);
    });
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);
    this.sailSystem = new SailSystem(this.model);
    this.createWorkingDetails();
  }

  update(
    physics: VesselPhysics,
    controls: SimulatorControls,
    time: number,
    delta: number,
    nightFactor: number,
  ): void {
    this.root.position.copy(physics.position);
    this.root.rotation.set(physics.pitch, physics.heading, -physics.roll, "YXZ");
    this.sailSystem.update(
      time,
      physics.telemetry.apparentWindAngle,
      physics.telemetry.apparentWindSpeed,
      controls.sailTrim,
      delta,
    );
    this.rudders.forEach((rudder) => {
      rudder.rotation.y = -controls.rudder * 0.58;
    });
    const targetAngularVelocity = propellerRpmForThrottle(controls.throttle) * Math.PI * 2 / 60;
    this.propellerAngularVelocity = THREE.MathUtils.damp(
      this.propellerAngularVelocity,
      targetAngularVelocity,
      PROPELLER_RESPONSE,
      delta,
    );
    this.propellers.forEach((propeller, index) => {
      // Twin screws counter-rotate; astern throttle reverses both directions.
      const sideDirection = index % 2 === 0 ? 1 : -1;
      propeller.rotation.z += this.propellerAngularVelocity * delta * sideDirection;
    });
    this.navigationLights.visible = nightFactor > 0.18;
  }

  worldPoint(local: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.generatedMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private createWorkingDetails(): void {
    const propellerMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a74a, metalness: 0.84, roughness: 0.24 });
    [-1.52, 1.52].forEach((x) => {
      const propeller = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.065, 0.12), propellerMaterial.clone());
      propeller.position.set(x, -0.86, -4.42);
      propeller.castShadow = true;
      this.root.add(propeller);
      this.propellers.push(propeller);
      this.generatedMeshes.push(propeller);

      const rudder = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.68, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x27383e, metalness: 0.22, roughness: 0.44 }),
      );
      rudder.position.set(x, -0.78, -4.18);
      rudder.castShadow = true;
      this.root.add(rudder);
      this.rudders.push(rudder);
      this.generatedMeshes.push(rudder);
    });
    propellerMaterial.dispose();

    const red = new THREE.PointLight(0xff233d, 0.9, 13, 2);
    red.position.set(-2.05, 1.75, 0.65);
    const green = new THREE.PointLight(0x38ffb1, 0.9, 13, 2);
    green.position.set(2.05, 1.75, 0.65);
    const stern = new THREE.PointLight(0xd7ecff, 0.72, 10, 2);
    stern.position.set(0, 1.35, -4.5);
    this.navigationLights.add(red, green, stern);
    this.navigationLights.visible = false;
    this.root.add(this.navigationLights);
  }
}
