import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { SimulatorControls } from "../types";
import type { VesselPhysics } from "./VesselPhysics";
import { Helmsman } from "./Helmsman";
import { SailSystem } from "./SailSystem";

export const MAX_PROPELLER_RPM = 600;
const MIN_ACTIVE_PROPELLER_RPM = 220;
const PROPELLER_RESPONSE = 7.5;
/** Wheel turns this many radians at full rudder (clockwise for starboard). */
export const HELM_WHEEL_TRAVEL = 2.4;
const WHEEL_NODE = /^(Torus_17|Cone_18|Cylinder\.?0(09_19|1[0-3]_2[0-3]))$/;
/** Fallback helm layout measured from the normalised GLB (vessel space). */
const DEFAULT_WHEEL_CENTER = new THREE.Vector3(-1.18, 0.88, -2.15);
const DEFAULT_SEAT_TOP = new THREE.Vector3(-1.11, 0.8, -2.57);
const COCKPIT_SOLE_Y = 0.63;
// Forward face of the mast, clear of the mainsail luff and the jib leech.
const BELL_POSITION = new THREE.Vector3(0, 2.55, 1.9);
const NAV_LIGHT_INTENSITY = [0.9, 0.9, 0.72] as const;

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
  private readonly navigationLightSources: THREE.PointLight[] = [];
  private readonly wheelPivot = new THREE.Group();
  private readonly bell = new THREE.Group();
  readonly helmsman: Helmsman;
  private propellerAngularVelocity = 0;
  private wheelAngle = 0;
  private bellSwing = 0;
  private bellSwingVelocity = 0;

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
    this.sailSystem = new SailSystem(this.model, this.root);
    const wheelCenter = this.createWheelPivot();
    this.helmsman = new Helmsman(this.root, {
      wheelCenter,
      wheelRadius: 0.265,
      seatTop: DEFAULT_SEAT_TOP,
      floorY: COCKPIT_SOLE_Y,
    });
    this.createWorkingDetails();
    this.createBell();
  }

  get sailMeshes(): readonly THREE.Mesh[] {
    return this.sailSystem.sailMeshes;
  }

  /** Swing the ship's bell; the caller plays the positional strike sound. */
  ringBell(): void {
    this.bellSwingVelocity += 5.5;
  }

  bellWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(target.copy(BELL_POSITION));
  }

  /** The skipper raises the flare pistol; returns the muzzle world position. */
  prepareFlareLaunch(target: THREE.Vector3): THREE.Vector3 {
    this.helmsman.startFlarePose();
    return this.helmsman.muzzleWorldPosition(target);
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
      // The trailing edge swings to starboard (-X) for a starboard turn.
      rudder.rotation.y = controls.rudder * 0.58;
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
    // Keep the lights in the scene and fade their intensity: toggling light
    // visibility would change the light count and recompile every material.
    const navigation = THREE.MathUtils.smoothstep(nightFactor, 0.12, 0.4);
    this.navigationLightSources.forEach((light, index) => {
      light.intensity = NAV_LIGHT_INTENSITY[index] * navigation;
    });

    this.wheelAngle = THREE.MathUtils.damp(this.wheelAngle, controls.rudder * HELM_WHEEL_TRAVEL, 9, delta);
    this.wheelPivot.rotation.z = this.wheelAngle;
    this.helmsman.update(
      time,
      delta,
      this.wheelAngle,
      physics.roll,
      physics.pitch,
      physics.position.y,
      THREE.MathUtils.clamp(-physics.yawRate * Math.abs(physics.telemetry.forwardSpeed) * 0.06, -0.12, 0.12),
    );

    this.bellSwingVelocity += (-28 * this.bellSwing - 1.6 * this.bellSwingVelocity + physics.roll * 6) * delta;
    this.bellSwing += this.bellSwingVelocity * delta;
    this.bell.rotation.x = THREE.MathUtils.clamp(this.bellSwing, -0.9, 0.9);
  }

  worldPoint(local: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  dispose(): void {
    this.helmsman.dispose();
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

    // Port (red) is +X and starboard (green) is -X in this right-handed frame.
    const red = new THREE.PointLight(0xff233d, 0.9, 13, 2);
    red.position.set(2.05, 1.75, 0.65);
    const green = new THREE.PointLight(0x38ffb1, 0.9, 13, 2);
    green.position.set(-2.05, 1.75, 0.65);
    const stern = new THREE.PointLight(0xd7ecff, 0.72, 10, 2);
    stern.position.set(0, 1.35, -4.5);
    this.navigationLights.add(red, green, stern);
    this.navigationLightSources.push(red, green, stern);
    this.navigationLightSources.forEach((light) => {
      light.intensity = 0;
    });
    this.root.add(this.navigationLights);
  }

  /** Group the GLB wheel rim, hub and spokes under a pivot on the wheel axle. */
  private createWheelPivot(): THREE.Vector3 {
    const parts: THREE.Object3D[] = [];
    this.model.traverse((object) => {
      if (WHEEL_NODE.test(object.name)) parts.push(object);
    });
    const center = DEFAULT_WHEEL_CENTER.clone();
    const rim = parts.find((part) => part.name.startsWith("Torus"));
    if (rim) {
      this.root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(rim);
      if (!bounds.isEmpty()) this.root.worldToLocal(bounds.getCenter(center));
    }
    this.wheelPivot.name = "HelmWheelPivot";
    this.wheelPivot.position.copy(center);
    this.root.add(this.wheelPivot);
    this.wheelPivot.updateMatrixWorld(true);
    parts.forEach((part) => this.wheelPivot.attach(part));
    return center;
  }

  private createBell(): void {
    const profile = [
      [0.0001, 0.11], [0.03, 0.108], [0.046, 0.09], [0.052, 0.05], [0.06, 0.012], [0.075, -0.012], [0.074, -0.02], [0.0001, -0.018],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const bronze = new THREE.MeshStandardMaterial({ color: 0xc89b4a, metalness: 0.92, roughness: 0.28 });
    const bellMesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), bronze);
    bellMesh.position.y = -0.14;
    bellMesh.scale.setScalar(1.3);
    bellMesh.castShadow = true;
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 0.1).translate(0, 0, -0.05),
      new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.4 }),
    );
    this.bell.name = "Ships_Bell";
    this.bell.position.copy(BELL_POSITION);
    this.bell.add(bellMesh);
    this.root.add(this.bell);
    bracket.position.copy(BELL_POSITION);
    this.root.add(bracket);
    this.generatedMeshes.push(bellMesh, bracket);
  }
}
