import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { batchStaticMeshes, coincidentShells } from "../core/StaticBatching";
import type { EnvironmentPalette } from "../environment/EnvironmentPalette";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import type { SimulatorControls } from "../types";
import {
  createPropellerGeometry,
  createRudderGeometry,
  createSaildriveGeometry,
  RUDDER_SPAN,
} from "./Appendages";
import { boomPivotPose, boomTarget, createBoomState, stepBoom } from "./BoomDynamics";
import { SailSystem } from "./SailSystem";
import type { VesselPhysics } from "./VesselPhysics";
import { YachtShading } from "./YachtShading";

export const MAX_PROPELLER_RPM = 600;
const MIN_ACTIVE_PROPELLER_RPM = 220;
const PROPELLER_RESPONSE = 7.5;
/** Matches the physics: the HUD maps full helm to 35 degrees. */
const MAX_RUDDER_ANGLE = 0.61;
/** Night-light intensities; lights stay in the scene by day at zero. */
const NAVIGATION_LIGHT_INTENSITY = [0.9, 0.9, 0.72] as const;

export function propellerRpmForThrottle(throttle: number): number {
  const magnitude = THREE.MathUtils.clamp(Math.abs(throttle), 0, 1);
  if (magnitude < 0.001) return 0;
  return Math.sign(throttle) * THREE.MathUtils.lerp(MIN_ACTIVE_PROPELLER_RPM, MAX_PROPELLER_RPM, magnitude);
}

export type VesselLighting = {
  camera: THREE.Camera;
  lightDirection: THREE.Vector3;
  palette: EnvironmentPalette;
};

type HullProfile = {
  centerX: number;
  minZ: number;
  maxZ: number;
  /** Lowest hull surface in 0.1 m stations along Z. */
  bottom: Map<number, number>;
};

const STATION = 0.1;
/** Meshes whose bounds agree this closely are copies of one shell. */
const SHELL_TOLERANCE = 0.06;

export class Vessel {
  readonly root = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sailSystem: SailSystem;
  private readonly shading = new YachtShading();
  private readonly rudders: THREE.Object3D[] = [];
  private readonly propellers: THREE.Mesh[] = [];
  private readonly generatedMeshes: THREE.Mesh[] = [];
  private readonly generatedGeometries: THREE.BufferGeometry[] = [];
  private readonly navigationLights: THREE.PointLight[] = [];
  private readonly navigationLamps = new THREE.Group();
  private readonly hulls: HullProfile[] = [];
  private readonly boomPivot = new THREE.Group();
  private readonly boom = createBoomState();
  private authoredBoomAngle = 0;
  private hasRig = false;
  private pendingSlam = 0;
  private propellerAngularVelocity = 0;

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
    private readonly underwater: UnderwaterLight,
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
            material.color.set(0xdcd8ca);
            material.roughness = 0.82;
            material.metalness = 0;
            material.side = THREE.DoubleSide;
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.depthTest = true;
            material.emissive.set(0x000000);
            material.emissiveIntensity = 0;
          } else if (name.includes("fiberglass")) {
            // Polished gelcoat: a glossy dielectric that mirrors sky and sea.
            material.color.set(0xd9dcdb);
            material.roughness = 0.24;
            material.metalness = 0;
            material.envMapIntensity = 1.15;
          } else if (name.includes("stainless")) {
            material.metalness = 1;
            material.roughness = 0.16;
            material.envMapIntensity = 1.3;
          } else if (name === "glass") {
            // Tinted glazing shows mostly reflection at deck-level angles.
            material.color.set(0x0c2a36);
            material.transparent = true;
            material.opacity = 0.62;
            material.roughness = 0.04;
            material.metalness = 0;
            material.envMapIntensity = 1.8;
            material.depthWrite = false;
          } else if (name.includes("rough_white")) {
            material.color.set(0xd2d3cf);
            material.roughness = 0.3;
            material.envMapIntensity = 1.1;
          }
        }
        return material;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
    });
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);
    this.sailSystem = new SailSystem(this.model);
    this.classifyParts();
    this.batchStaticParts();
    this.createAppendages();
    this.createNavigationLights();
  }

  update(
    physics: VesselPhysics,
    controls: SimulatorControls,
    time: number,
    delta: number,
    nightFactor: number,
    lighting?: VesselLighting,
  ): void {
    this.root.position.copy(physics.position);
    this.root.rotation.set(physics.pitch, physics.heading, -physics.roll, "YXZ");
    this.root.updateMatrixWorld(true);
    this.sailSystem.update(
      time,
      physics.telemetry.apparentWindSpeed,
      physics.telemetry.sailLuff,
      controls.sailTrim,
      delta,
    );
    if (this.hasRig) {
      const target = boomTarget(
        physics.telemetry.sheetAngle,
        physics.telemetry.leewardSide,
        physics.telemetry.sailLuff,
        time,
      );
      // Integrate in short steps so a slow frame cannot destabilise the swing.
      let remaining = Math.min(delta, 0.1);
      while (remaining > 1e-5) {
        const step = Math.min(remaining, 1 / 60);
        this.pendingSlam = Math.max(this.pendingSlam, stepBoom(this.boom, target, step));
        remaining -= step;
      }
      const pose = boomPivotPose(this.boom.angle, this.authoredBoomAngle);
      this.boomPivot.rotation.y = pose.rotationY;
      this.boomPivot.scale.x = pose.mirror;
    }
    this.rudders.forEach((rudder) => {
      rudder.rotation.y = -controls.rudder * MAX_RUDDER_ANGLE;
    });
    // Follow the simulated shaft so the screws spool up and down with the
    // engines instead of snapping to the lever position.
    const shaft = physics.engineShaft;
    const targetAngularVelocity =
      Math.abs(shaft) < 0.001 ? 0 : Math.sign(shaft) * MAX_PROPELLER_RPM * Math.abs(shaft) * Math.PI * 2 / 60;
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
    // Lights stay in the scene so the number of lights, and therefore every
    // compiled lit shader, never changes at dusk.
    const lit = THREE.MathUtils.smoothstep(nightFactor, 0.12, 0.3);
    this.navigationLights.forEach((light, index) => {
      light.intensity = NAVIGATION_LIGHT_INTENSITY[index] * lit;
    });
    this.navigationLamps.visible = lit > 0.01;
    if (lighting) {
      this.shading.update(this.root, time, lighting.camera, lighting.lightDirection, lighting.palette);
    }
  }

  /** Strength in [0, 1] of a boom slam since the last call, for audio. */
  consumeBoomSlam(): number {
    const slam = this.pendingSlam;
    this.pendingSlam = 0;
    return slam;
  }

  worldPoint(local: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.generatedGeometries.forEach((geometry) => geometry.dispose());
  }

  /**
   * Finds the hulls, deck, mast, boom and sail by shape rather than by name:
   * the source file's node names are generic ("Cylinder.004").
   */
  private classifyParts(): void {
    const inverseRoot = this.root.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    let mast: THREE.Box3 | null = null;
    let boom: { mesh: THREE.Mesh; bounds: THREE.Box3 } | null = null;
    let sail: THREE.Mesh | null = null;
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });

    meshes.forEach((mesh) => {
      mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;
      box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
      const size = box.getSize(point);
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const name = material.name.toLowerCase();
      if (name.includes("cloth")) {
        sail = mesh;
        if (material instanceof THREE.MeshStandardMaterial) {
          this.shading.applySail(material);
        }
        return;
      }
      if (size.y > 6 && size.x < 0.35 && size.z < 0.45) mast = box.clone();
      if (size.y < 0.5 && size.z > 3 && box.min.y > 1.2) boom = { mesh, bounds: box.clone() };

      const isHull = box.min.y < -0.9 && Math.abs((box.min.x + box.max.x) / 2) > 1 && size.z > 6;
      if (isHull) {
        this.hulls.push(this.measureHull(mesh, inverseRoot, box));
        if (material instanceof THREE.MeshStandardMaterial) {
          this.shading.applyHull(material, box.max.y);
          this.underwater.apply(material);
        }
      } else if (name.includes("fiberglass") && material instanceof THREE.MeshStandardMaterial) {
        this.shading.applyDeck(material);
      }
    });
    this.hulls.sort((left, right) => left.centerX - right.centerX);

    const mastBounds = mast as THREE.Box3 | null;
    const boomPart = boom as { mesh: THREE.Mesh; bounds: THREE.Box3 } | null;
    const sailMesh = sail as THREE.Mesh | null;
    if (!mastBounds || !boomPart || !sailMesh) return;
    const mastX = (mastBounds.min.x + mastBounds.max.x) / 2;
    const mastZ = (mastBounds.min.z + mastBounds.max.z) / 2;
    const outboardX =
      Math.abs(boomPart.bounds.max.x - mastX) >= Math.abs(boomPart.bounds.min.x - mastX)
        ? boomPart.bounds.max.x
        : boomPart.bounds.min.x;
    this.authoredBoomAngle = Math.atan2(outboardX - mastX, mastZ - boomPart.bounds.min.z);
    this.boom.angle = this.authoredBoomAngle;
    this.boomPivot.name = "MainBoomPivot";
    this.boomPivot.position.set(mastX, 0, mastZ);
    this.root.add(this.boomPivot);
    this.boomPivot.updateMatrixWorld(true);
    // attach() keeps each part exactly where it was while re-parenting it.
    this.boomPivot.attach(boomPart.mesh);
    this.boomPivot.attach(sailMesh);
    this.hasRig = true;
  }

  /**
   * Merges the model's fixed parts by material (see `StaticBatching`): about
   * forty meshes become nine, in the colour pass and in the shadow pass. The
   * boom and sail were moved onto the boom pivot by `classifyParts` and stay
   * separate. Stacked copies of one shell keep drawing, since they differ in
   * detail, but only the first casts a shadow.
   */
  private batchStaticParts(): void {
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh && !Array.isArray(object.material)) meshes.push(object);
    });
    const keyOf = (mesh: THREE.Mesh): string => {
      const material = mesh.material as THREE.Material;
      return `${material.name}|${material.type}|${material.customProgramCacheKey()}|${material.transparent}|${material.side}`;
    };
    this.model.updateMatrixWorld(true);
    const inverseRoot = this.root.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const bounds = meshes.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox ?? box.makeEmpty()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
      return {
        min: [box.min.x, box.min.y, box.min.z] as const,
        max: [box.max.x, box.max.y, box.max.z] as const,
      };
    });
    coincidentShells(bounds, meshes.map(keyOf), SHELL_TOLERANCE).forEach((index) => {
      meshes[index].castShadow = false;
    });
    const result = batchStaticMeshes(
      this.root,
      meshes,
      (mesh) => `${keyOf(mesh)}|${mesh.castShadow}|${mesh.receiveShadow}`,
      "YachtBatch",
    );
    this.generatedGeometries.push(...result.geometries);
  }

  private measureHull(mesh: THREE.Mesh, inverseRoot: THREE.Matrix4, bounds: THREE.Box3): HullProfile {
    const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const toRoot = new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
    const vertex = new THREE.Vector3();
    const bottom = new Map<number, number>();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(toRoot);
      const station = Math.round(vertex.z / STATION);
      const lowest = bottom.get(station);
      if (lowest === undefined || vertex.y < lowest) bottom.set(station, vertex.y);
    }
    return {
      centerX: (bounds.min.x + bounds.max.x) / 2,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
      bottom,
    };
  }

  private hullBottom(hull: HullProfile, z: number): number {
    const station = Math.round(z / STATION);
    for (let offset = 0; offset < 8; offset += 1) {
      const value = hull.bottom.get(station + offset) ?? hull.bottom.get(station - offset);
      if (value !== undefined) return value;
    }
    return -1;
  }

  private createAppendages(): void {
    const propellerGeometry = createPropellerGeometry();
    const rudderGeometry = createRudderGeometry();
    this.generatedGeometries.push(propellerGeometry, rudderGeometry);
    const bronze = new THREE.MeshStandardMaterial({ color: 0xb08a52, metalness: 1, roughness: 0.3 });
    const antifouling = new THREE.MeshStandardMaterial({ color: 0x0b1424, metalness: 0, roughness: 0.62 });
    const saildriveLeg = new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.2, roughness: 0.45 });
    [bronze, antifouling, saildriveLeg].forEach((material) => this.underwater.apply(material));

    const hulls: Array<Pick<HullProfile, "centerX" | "minZ" | "maxZ"> & { profile?: HullProfile }> =
      this.hulls.length === 2
        ? this.hulls.map((profile) => ({ ...profile, profile }))
        : [
            { centerX: -1.72, minZ: -4.02, maxZ: 4.7 },
            { centerX: 1.7, minZ: -4.02, maxZ: 4.7 },
          ];

    hulls.forEach((hull) => {
      const bottomAt = (z: number): number => (hull.profile ? this.hullBottom(hull.profile, z) : -1);
      // Saildrive about a fifth of the way forward from the transom.
      const driveZ = hull.minZ + 1.75;
      const podY = bottomAt(driveZ) - 0.2;
      const legHeight = Math.max(0.3, bottomAt(driveZ) + 0.12 - podY);
      const legGeometry = createSaildriveGeometry(legHeight);
      this.generatedGeometries.push(legGeometry);
      const leg = new THREE.Mesh(legGeometry, saildriveLeg);
      leg.position.set(hull.centerX, podY, driveZ);
      // Underwater gear: its shadow could only fall on hull bottoms under the
      // sea, where nothing shows it, so it stays out of the shadow pass.
      leg.castShadow = false;
      leg.name = "SaildriveLeg";
      this.root.add(leg);
      this.generatedMeshes.push(leg);

      const propeller = new THREE.Mesh(propellerGeometry, bronze);
      propeller.position.set(hull.centerX, podY, driveZ - 0.06);
      propeller.castShadow = false;
      propeller.name = "Propeller";
      this.root.add(propeller);
      this.propellers.push(propeller);
      this.generatedMeshes.push(propeller);

      // Spade rudder hung just forward of the transom.
      const rudderZ = hull.minZ + 0.42;
      const rudder = new THREE.Mesh(rudderGeometry, antifouling);
      const stockTop = bottomAt(rudderZ) + 0.12;
      rudder.position.set(hull.centerX, stockTop, rudderZ);
      rudder.scale.y = Math.max(0.6, (stockTop - (bottomAt(rudderZ) - 0.5)) / RUDDER_SPAN);
      rudder.castShadow = false;
      rudder.name = "SpadeRudder";
      this.root.add(rudder);
      this.rudders.push(rudder);
      this.generatedMeshes.push(rudder);
    });
  }

  private createNavigationLights(): void {
    const red = new THREE.PointLight(0xff233d, 0, 13, 2);
    red.position.set(-2.05, 1.75, 0.65);
    const green = new THREE.PointLight(0x38ffb1, 0, 13, 2);
    green.position.set(2.05, 1.75, 0.65);
    const stern = new THREE.PointLight(0xd7ecff, 0, 10, 2);
    stern.position.set(0, 1.35, -4.5);
    this.navigationLights.push(red, green, stern);
    this.root.add(red, green, stern);

    // Visible lamp lenses. Their colours are brighter than white so the
    // bloom pass gives each one a small coloured halo.
    const lampGeometry = new THREE.SphereGeometry(0.055, 12, 8);
    this.generatedGeometries.push(lampGeometry);
    const lamps: Array<[THREE.PointLight, number, number, number]> = [
      [red, 4.2, 0.16, 0.24],
      [green, 0.22, 3.8, 1.2],
      [stern, 2.6, 2.9, 3.3],
    ];
    lamps.forEach(([light, r, g, b]) => {
      const material = new THREE.MeshBasicMaterial({ fog: false });
      material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
      const lamp = new THREE.Mesh(lampGeometry, material);
      lamp.position.copy(light.position);
      this.navigationLamps.add(lamp);
      this.generatedMeshes.push(lamp);
    });
    this.navigationLamps.visible = false;
    this.root.add(this.navigationLamps);
  }
}
