import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { SimulatorControls } from "../types";
import type { VesselPhysics } from "./VesselPhysics";
import { SailSystem } from "./SailSystem";

export const MAX_PROPELLER_RPM = 600;
const MIN_ACTIVE_PROPELLER_RPM = 220;
const PROPELLER_RESPONSE = 7.5;
// Helm seat and wheel hub in vessel-root space (port helm of the yacht GLB).
const HELM_SEAT = new THREE.Vector3(-1.12, 0.74, -2.6);
const HELM_WHEEL = new THREE.Vector3(-1.17, 0.88, -2.14);
// Fraction of hull heel and pitch the skipper's body counters to stay upright.
const SKIPPER_HEEL_COMPENSATION = 0.78;

/** Skipper torso lean (radians about the boat's fore-aft axis) for a hull roll. */
export function skipperLean(roll: number, time: number): number {
  return roll * SKIPPER_HEEL_COMPENSATION + Math.sin(time * 1.3) * 0.018;
}

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
  private readonly skipper = new THREE.Group();
  private readonly skipperArms = new THREE.Group();
  private readonly skipperHead = new THREE.Group();
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
    this.sailSystem = new SailSystem(this.root, this.model);
    this.createWorkingDetails();
    this.createSkipper();
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
    // The skipper sits with the boat but keeps the upper body near vertical,
    // leaning against the heel; hands follow the wheel and the gaze leads the turn.
    this.skipper.rotation.set(-physics.pitch * 0.5, 0, skipperLean(physics.roll, time), "YXZ");
    this.skipperArms.rotation.z = -controls.rudder * 0.22;
    this.skipperHead.rotation.y = THREE.MathUtils.damp(this.skipperHead.rotation.y, -controls.rudder * 0.5, 2.5, delta);
  }

  worldPoint(local: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  dispose(): void {
    this.sailSystem.dispose();
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

  private createSkipper(): void {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58a63, roughness: 0.62 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x2c7fb8, roughness: 0.74 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.82 });
    const hat = new THREE.MeshStandardMaterial({ color: 0xf3efe3, roughness: 0.7 });
    const shade = new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 0.2, metalness: 0.4 });
    const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.generatedMeshes.push(mesh);
      return mesh;
    };
    const limb = (parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): void => {
      const axis = to.clone().sub(from);
      const mesh = add(parent, new THREE.CapsuleGeometry(radius, Math.max(0.01, axis.length() - radius * 2), 4, 10), material);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    };

    // The group origin is the pelvis on the helm seat; +Z faces the bow.
    this.skipper.name = "Skipper";
    this.skipper.position.copy(HELM_SEAT);
    const torso = add(this.skipper, new THREE.CapsuleGeometry(0.15, 0.3, 4, 12), shirt);
    torso.scale.set(1.05, 1, 0.78);
    torso.position.set(0, 0.32, 0.03);
    torso.rotation.x = 0.14;
    this.skipperHead.position.set(0, 0.7, 0.09);
    this.skipper.add(this.skipperHead);
    add(this.skipperHead, new THREE.SphereGeometry(0.105, 16, 12), skin);
    const crown = add(this.skipperHead, new THREE.CylinderGeometry(0.1, 0.112, 0.08, 16), hat);
    crown.position.y = 0.075;
    const brim = add(this.skipperHead, new THREE.CylinderGeometry(0.19, 0.19, 0.012, 20), hat);
    brim.position.y = 0.045;
    const glasses = add(this.skipperHead, new THREE.BoxGeometry(0.15, 0.035, 0.02), shade);
    glasses.position.set(0, 0.01, 0.1);
    [-1, 1].forEach((side) => {
      const hip = new THREE.Vector3(side * 0.09, 0.03, 0.02);
      const knee = new THREE.Vector3(side * 0.11, 0.06, 0.38);
      const foot = new THREE.Vector3(side * 0.12, -0.27, 0.46);
      limb(this.skipper, hip, knee, 0.075, shorts);
      limb(this.skipper, knee, foot, 0.055, skin);
    });
    // Arms reach from the shoulders to the wheel rim; the group pivots
    // about the wheel axis so the hands turn with the rudder.
    const wheel = HELM_WHEEL.clone().sub(HELM_SEAT);
    this.skipperArms.position.copy(wheel);
    this.skipper.add(this.skipperArms);
    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Vector3(side * 0.19, 0.5, 0.06).sub(wheel);
      const hand = new THREE.Vector3(side * 0.17, 0.04, -0.04);
      const elbow = shoulder.clone().lerp(hand, 0.5).add(new THREE.Vector3(side * 0.06, -0.08, 0));
      limb(this.skipperArms, shoulder, elbow, 0.05, shirt);
      limb(this.skipperArms, elbow, hand, 0.042, skin);
    });
    this.root.add(this.skipper);
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
