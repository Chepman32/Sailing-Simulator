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
import { HELM_EYE, HelmStation, type HelmTraffic } from "./HelmStation";
import { YachtDecor } from "./YachtDecor";
import type { SonarBlip } from "./WideMonitor";
import { Skipper } from "./Skipper";
import { RiggedSkipper } from "./RiggedSkipper";
import { ShipBell } from "./ShipBell";
import { audibleSlam, boomPivotPose, boomTarget, createBoomState, steadyLeewardSide, stepBoom } from "./BoomDynamics";
import { SailSystem } from "./SailSystem";
import { JibSail } from "./JibSail";
import type { VesselPhysics } from "./VesselPhysics";
import { YachtShading } from "./YachtShading";

export const MAX_PROPELLER_RPM = 600;
const MIN_ACTIVE_PROPELLER_RPM = 220;
const PROPELLER_RESPONSE = 7.5;
/** Matches the physics: the HUD maps full helm to 35 degrees. */
const MAX_RUDDER_ANGLE = 0.61;
/**
 * Night-light intensities (candela): port, starboard, stern, the cockpit
 * lantern and the masthead light. They stay in the scene by day at zero.
 */
const NAVIGATION_LIGHT_INTENSITY = [6, 6, 5, 24, 8] as const;

export function propellerRpmForThrottle(throttle: number): number {
  const magnitude = THREE.MathUtils.clamp(Math.abs(throttle), 0, 1);
  if (magnitude < 0.001) return 0;
  return Math.sign(throttle) * THREE.MathUtils.lerp(MIN_ACTIVE_PROPELLER_RPM, MAX_PROPELLER_RPM, magnitude);
}

export type VesselLighting = {
  camera: THREE.Camera;
  lightDirection: THREE.Vector3;
  palette: EnvironmentPalette;
  /** For the helm displays: whether the engine runs, and whether anyone is close enough to read them. */
  engineRunning?: boolean;
  helmReadable?: boolean;
  /** Read from the wheel itself: the moving chart is redrawn smoothly, not in steps. */
  helmLive?: boolean;
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
/** Parts with a bounding radius under this (metres) skip the mirror and the shadow map. */
const SMALL_PART_RADIUS = 0.4;

/** Rise of the boom per metre aft of the mast (about 6.5°). */
const BOOM_RISE = 0.115;

export class Vessel {
  readonly root = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly sailSystem: SailSystem;
  private readonly jib = new JibSail();
  private readonly shading = new YachtShading();
  private readonly rudders: THREE.Object3D[] = [];
  private readonly propellers: THREE.Mesh[] = [];
  private readonly generatedMeshes: THREE.Mesh[] = [];
  private readonly generatedGeometries: THREE.BufferGeometry[] = [];
  private readonly navigationLights: THREE.PointLight[] = [];
  private readonly navigationLamps = new THREE.Group();
  private readonly hulls: HullProfile[] = [];
  private readonly boomPivot = new THREE.Group();
  /** The boom as rigged (after `raiseBoom`), for the lantern hung under it. */
  private boomMesh: THREE.Mesh | null = null;
  /** The mast, the sail and the rigging that runs above head height (hidden when the rig is shot away). */
  private mastMesh: THREE.Mesh | null = null;
  private mastBox: THREE.Box3 | null = null;
  private sailMeshRef: THREE.Mesh | null = null;
  private readonly rigging: THREE.Mesh[] = [];
  /** What is left of the rig when it is shot away: the stump, the fallen spar, rags. */
  private brokenRig: { group: THREE.Group; rags: THREE.Mesh[] } | null = null;
  private rigBroken = false;
  /** The cockpit lantern hung from the boom: it swings a little; its glass glows at night. */
  private readonly lanternRig = new THREE.Group();
  private lanternGlow: THREE.Mesh | null = null;
  private readonly helm = new HelmStation();
  /** Flag, charm and bobblehead bought from the traders. */
  private decor?: YachtDecor;
  private skipper?: Skipper | RiggedSkipper;
  private bell?: ShipBell;
  /** The mast's forward face at its foot (vessel space) and the cabin top there; set by `classifyParts`. */
  private readonly mastFront = new THREE.Vector3(0, 0, 1.9);
  private mastFootY = 1.3;
  /** Where the horns are: on the mast's forward face below the spreaders (vessel space). */
  private readonly hornLocal = new THREE.Vector3(0, 4.6, 1.95);
  /** Parts left out of the planar mirror (see `batchStaticParts`). */
  readonly mirrorSkipped: THREE.Object3D[] = [];
  private readonly boom = createBoomState();
  private authoredBoomAngle = 0;
  private hasRig = false;
  private pendingSlam = 0;
  /** The side the sails show (`steadyLeewardSide`): steadier than the physics' sign. */
  private leewardShown = 1;
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
    this.root.add(this.helm.group);
    this.root.add(this.jib.group);
    this.bell = new ShipBell(this.mastFront, this.mastFootY);
    this.root.add(this.bell.group);
    this.decor = new YachtDecor(this.root);
    const stand = {
      feet: HelmStation.STAND_FEET,
      eyeHeight: HELM_EYE.y - HelmStation.STAND_FEET.y,
      rimPoint: (angle: number, target: THREE.Vector3) => this.helm.rimPoint(angle, target),
      wheelAngle: () => this.helm.wheelAngle,
    };
    // The skipper is the rigged man (the islanders' model) when it loaded;
    // the procedural figure stands in otherwise.
    const man = assets.animated("traderMan");
    if (man) {
      try {
        this.skipper = new RiggedSkipper(this.root, stand, man.scene);
      } catch (error) {
        console.warn("The skipper's model has not the expected skeleton; the procedural figure stands in.", error);
      }
    }
    this.skipper ??= new Skipper(this.root, stand);
    this.skipSmallParts();
  }

  /**
   * The fittings smaller than a hand span (the helm's instruments and
   * compass, the jib's blocks, cleats, lines) are each a draw call of their
   * own and cover a few pixels: they are left out of the blurred planar
   * mirror and cast no shadow. The navigation lamps keep their reflection,
   * which is what is seen of them on the water at night.
   */
  private skipSmallParts(): void {
    this.root.updateMatrixWorld(true);
    const skipped = new Set(this.mirrorSkipped);
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line) || object instanceof THREE.SkinnedMesh) return;
      if (skipped.has(object)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const radius = (geometry.boundingSphere?.radius ?? 0) * object.matrixWorld.getMaxScaleOnAxis();
      if (radius >= SMALL_PART_RADIUS) return;
      object.castShadow = false;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (material instanceof THREE.MeshBasicMaterial) return;
      this.mirrorSkipped.push(object);
    });
  }

  /** The bell's clapper strikes (the sound itself is `AudioSystem.bell`). */
  strikeBell(): void {
    this.bell?.strike(1);
    window.setTimeout(() => this.bell?.strike(0.86), 460);
  }

  /** Where the bell and the horns are now, in the world. */
  signalPoints(bell: THREE.Vector3, horn: THREE.Vector3): void {
    bell.copy(this.bell?.soundPoint ?? this.mastFront).applyMatrix4(this.root.matrixWorld);
    horn.copy(this.hornLocal).applyMatrix4(this.root.matrixWorld);
  }

  /** The rigged skipper's figure, when he is the rigged model (for levels of detail). */
  get skipperFigure(): THREE.Object3D | null {
    return this.skipper instanceof RiggedSkipper ? this.skipper.object : null;
  }

  /** The skipper is hidden from his own eyes (the helm camera). */
  setCrewVisible(visible: boolean): void {
    if (this.skipper) this.skipper.visible = visible;
  }

  /** Flies, hangs and stands the decor chosen (null takes it down). */
  setDecor(flag: string | null, charm: string | null, bobble: string | null): void {
    this.decor?.setDecor(flag, charm, bobble);
  }

  /** The helm monitor's level and what the sonar sees (with its level and reach, m). */
  setMonitorLevel(level: number): void {
    this.helm.setMonitorLevel(level);
  }

  setSonar(contacts: readonly SonarBlip[], level: number, reach: number): void {
    this.helm.setSonar(contacts, level, reach);
  }

  /** The skipper's leap over the side, `t` seconds in (null: back at the wheel). */
  setSkipperLeap(t: number | null): void {
    this.skipper?.leap(t);
  }

  /** The skipper's eyes in the world, and his leap pose (valid while leaping). */
  skipperEyes(out: THREE.Vector3): THREE.Vector3 {
    return this.skipper ? this.skipper.eyes(out) : out.copy(HELM_EYE).applyMatrix4(this.root.matrixWorld);
  }

  get skipperLeap(): Readonly<import("../diver/LeapMath").LeapPose> | null {
    return this.skipper?.leapPoseNow ?? null;
  }

  /** Dyes the mainsail (sRGB hex). */
  setSailColor(hex: number): void {
    this.sailSystem.setColor(hex);
    this.jib.setColor(hex);
  }


  /** Where the helmsman's eyes are, in vessel space (the helm camera's anchor). */
  get helmEye(): THREE.Vector3 {
    return HELM_EYE;
  }

  /** Ships the chart plotter shows. */
  setChartTraffic(traffic: readonly HelmTraffic[]): void {
    this.helm.setTraffic(traffic);
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
    this.leewardShown = steadyLeewardSide(this.leewardShown, physics.telemetry.apparentWindAngle);
    this.jib.update(
      time,
      delta,
      physics.telemetry.sheetAngle,
      this.leewardShown,
      physics.telemetry.sailLuff,
      physics.telemetry.apparentWindSpeed,
      controls.sailTrim,
    );
    if (this.hasRig) {
      const target = boomTarget(
        physics.telemetry.sheetAngle,
        this.leewardShown,
        physics.telemetry.sailLuff,
        time,
      );
      // Integrate in short steps so a slow frame cannot destabilise the swing.
      let remaining = Math.min(delta, 0.1);
      while (remaining > 1e-5) {
        const step = Math.min(remaining, 1 / 60);
        const slam = audibleSlam(stepBoom(this.boom, target, step), physics.telemetry.apparentWindAngle, physics.telemetry.apparentWindSpeed);
        this.pendingSlam = Math.max(this.pendingSlam, slam);
        remaining -= step;
      }
      const pose = boomPivotPose(this.boom.angle, this.authoredBoomAngle);
      this.boomPivot.rotation.y = pose.rotationY;
      this.boomPivot.scale.x = pose.mirror;
    }
    this.rudders.forEach((rudder) => {
      rudder.rotation.y = -controls.rudder * MAX_RUDDER_ANGLE;
    });
    // Rags flog in the wind.
    if (this.rigBroken && this.brokenRig) {
      this.brokenRig.rags.forEach((rag, index) => {
        rag.rotation.y = Math.sin(time * 6.5 + index * 1.7) * 0.9 + index;
        rag.rotation.x = 0.25 + Math.sin(time * 9.1 + index) * 0.25;
      });
    }
    const telemetry = physics.telemetry;
    this.helm.update(delta, {
      x: physics.position.x,
      z: physics.position.z,
      heading: physics.heading,
      speed: Math.hypot(physics.velocity.x, physics.velocity.z),
      depth: telemetry.depth,
      apparentWindSpeed: telemetry.apparentWindSpeed,
      apparentWindAngle: telemetry.apparentWindAngle,
      shaft: physics.engineShaft,
      engineRunning: lighting?.engineRunning ?? Math.abs(physics.engineShaft) > 0.01,
      throttle: controls.throttle,
      rudder: controls.rudder,
      night: nightFactor,
      readable: lighting?.helmReadable ?? false,
      live: lighting?.helmLive ?? false,
    });
    this.skipper?.update(time, delta, physics.roll, physics.pitch, physics.yawRate, physics.telemetry.forwardSpeed, telemetry.apparentWindSpeed);
    this.decor?.update(delta, physics);
    this.bell?.update(delta, physics.roll, physics.pitch);
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
    if (this.lanternGlow) this.lanternGlow.visible = lit > 0.01;
    // The lantern swings a little on its lanyard as she moves.
    this.lanternRig.rotation.set(Math.sin(time * 1.9 + 0.6) * 0.045, 0, Math.sin(time * 1.37) * 0.06);
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
    this.skipper?.dispose();
    this.decor?.dispose();
    this.helm.dispose();
    this.jib.dispose();
    this.bell?.dispose();
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
      if (size.y > 6 && size.x < 0.35 && size.z < 0.45) {
        mast = box.clone();
        this.mastMesh = mesh;
      } else if (box.max.y > 6 && Math.min(size.x, size.z) < 0.12 && size.y > 2.5) {
        // Shrouds and stays: thin lines up to the masthead.
        this.rigging.push(mesh);
      }
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
    if (mastBounds) {
      this.mastFront.set((mastBounds.min.x + mastBounds.max.x) / 2, 0, mastBounds.max.z);
      this.mastFootY = mastBounds.min.y;
      this.hornLocal.set(this.mastFront.x, mastBounds.min.y + 3.4, mastBounds.max.z + 0.06);
    }
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
    this.raiseBoom(boomPart.mesh, sailMesh);
    this.boomMesh = boomPart.mesh;
    this.sailMeshRef = sailMesh;
    this.mastBox = mastBounds.clone();
    this.hasRig = true;
  }

  /** Her displays taken over by the network's alert (null: back to work). */
  setLockdown(lines: readonly string[] | null): void {
    this.helm.setLockdown(lines);
  }

  /**
   * The rig shot away (a heavy round through the mast): the mast snapped
   * at a third of its height, its top fallen across the deck, the sail gone
   * to rags flogging from the stump and the boom, the stays slack and gone.
   * False puts it all back (a jury rig is as good as a mast to look at).
   */
  setRigBroken(broken: boolean): void {
    if (broken === this.rigBroken) return;
    this.rigBroken = broken;
    if (this.mastMesh) this.mastMesh.visible = !broken;
    if (this.sailMeshRef) this.sailMeshRef.visible = !broken;
    for (const line of this.rigging) line.visible = !broken;
    if (broken && !this.brokenRig) this.brokenRig = this.buildBrokenRig();
    if (this.brokenRig) this.brokenRig.group.visible = broken;
  }

  private buildBrokenRig(): { group: THREE.Group; rags: THREE.Mesh[] } {
    const group = new THREE.Group();
    group.name = "BrokenRig";
    const box = this.mastBox ?? new THREE.Box3(new THREE.Vector3(-0.08, 1.3, 1.8), new THREE.Vector3(0.08, 13, 2.0));
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.06, Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2);
    const height = box.max.y - box.min.y;
    const breakAt = height * 0.34;
    const metal = (this.mastMesh?.material as THREE.Material | undefined) ?? new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.8, roughness: 0.35 });
    // The stump, its top torn.
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius, breakAt, 10), metal);
    stump.position.set(centre.x, box.min.y + breakAt / 2, centre.z);
    stump.castShadow = true;
    const tear = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.9, radius * 3, 6), metal);
    tear.position.set(centre.x, box.min.y + breakAt + radius * 1.2, centre.z);
    tear.rotation.z = 0.5;
    // The top, fallen aft and to one side, its foot still at the break.
    const length = height - breakAt;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.9, length, 10), metal);
    const pivot = new THREE.Group();
    pivot.position.set(centre.x, box.min.y + breakAt, centre.z);
    pivot.rotation.set(-1.25, 0, 0.42);
    top.position.y = length / 2;
    top.castShadow = true;
    pivot.add(top);
    group.add(stump, tear, pivot);
    // Rags of sail, flogging.
    const cloth = (this.sailMeshRef?.material as THREE.Material | undefined) ?? new THREE.MeshStandardMaterial({ color: 0xf2efe6, side: THREE.DoubleSide });
    const rags: THREE.Mesh[] = [];
    const ragGeometry = new THREE.PlaneGeometry(0.55, 1.6, 2, 6);
    ragGeometry.translate(0, -0.8, 0);
    for (let index = 0; index < 4; index += 1) {
      const rag = new THREE.Mesh(ragGeometry, cloth);
      rag.position.set(centre.x + (index - 1.5) * 0.06, box.min.y + breakAt - 0.1 - index * 0.25, centre.z - 0.12 - index * 0.05);
      rag.scale.set(0.7 + index * 0.15, 0.6 + (index % 2) * 0.5, 1);
      rag.castShadow = true;
      rags.push(rag);
      group.add(rag);
    }
    this.root.add(group);
    return { group, rags };
  }

  /**
   * The boom rises toward its end (as a catamaran's does, to clear the
   * hardtop and the helmsman): as authored it sat at head height, and close
   * hauled on starboard its end swept through the helm station and the
   * skipper. Boom and sail are sheared up by `BOOM_RISE` per metre aft of
   * the mast, the sail less toward its head (which stays at the masthead)
   * and not at all along the luff, so it still runs up the mast.
   */
  private raiseBoom(boom: THREE.Mesh, sail: THREE.Mesh): void {
    sail.geometry.computeBoundingBox();
    const sailBox = sail.geometry.boundingBox!.clone().applyMatrix4(sail.matrix);
    const foot = sailBox.min.y;
    const head = sailBox.max.y;
    const shear = (mesh: THREE.Mesh, toHead: boolean) => {
      const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const toPivot = mesh.matrix;
      const fromPivot = mesh.matrix.clone().invert();
      const point = new THREE.Vector3();
      for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index).applyMatrix4(toPivot);
        const aft = Math.hypot(point.x, point.z);
        const fade = toHead ? THREE.MathUtils.clamp((head - point.y) / Math.max(0.1, head - foot), 0, 1) : 1;
        point.y += aft * BOOM_RISE * fade;
        point.applyMatrix4(fromPivot);
        position.setXYZ(index, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    };
    shear(boom, false);
    shear(sail, true);
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
    const copies = new Set<THREE.Mesh>();
    coincidentShells(bounds, meshes.map(keyOf), SHELL_TOLERANCE).forEach((index) => {
      meshes[index].castShadow = false;
      copies.add(meshes[index]);
    });
    const copyNames = new Set([...copies].map((mesh) => mesh.name));
    const result = batchStaticMeshes(
      this.root,
      meshes,
      (mesh) => `${keyOf(mesh)}|${mesh.castShadow}|${mesh.receiveShadow}|${copies.has(mesh)}`,
      "YachtBatch",
    );
    this.generatedGeometries.push(...result.geometries);
    // The copies only resolve each other's z-fighting up close; a blurred
    // reflection does not need them (about 90k triangles less in the mirror).
    for (const batch of result.batches) {
      const from = batch.userData.batchedFrom as string[] | undefined;
      if (from?.length && from.every((name) => copyNames.has(name))) this.mirrorSkipped.push(batch);
    }
    for (const mesh of copies) if (mesh.parent) this.mirrorSkipped.push(mesh);
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

  /**
   * Hangs the cockpit lantern under the boom, a little aft of its middle
   * (over the cockpit): a lanyard, a brass cap with its ring, glass in a
   * brass frame and a brass foot, the light inside the glass. Returns
   * whether there was a boom to hang it from.
   */
  private hangLantern(light: THREE.PointLight): boolean {
    const boom = this.boomMesh;
    if (!boom) return false;
    // The boom's line in the pivot's space (the pivot is at the mast's foot).
    const position = boom.geometry.getAttribute("position") as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    let endX = 0;
    let endZ = 0;
    let reach = 0;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(boom.matrix);
      const along = Math.hypot(point.x, point.z);
      if (along > reach) {
        reach = along;
        endX = point.x;
        endZ = point.z;
      }
    }
    if (reach < 1) return false;
    const dirX = endX / reach;
    const dirZ = endZ / reach;
    const station = reach * 0.56;
    // The underside of the boom at that station: a spar may have vertices
    // only at its ends, so the underside is taken at both ends (the lowest
    // points of the first and the last fifth of its length) and drawn
    // straight between them (it is straight, raised evenly toward its end).
    let near = Infinity;
    let far = Infinity;
    let nearAt = 0;
    let farAt = reach;
    let start = Infinity;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(boom.matrix);
      start = Math.min(start, point.x * dirX + point.z * dirZ);
    }
    const span = reach - start;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(boom.matrix);
      const along = point.x * dirX + point.z * dirZ;
      if (along < start + span * 0.2 && point.y < near) {
        near = point.y;
        nearAt = along;
      }
      if (along > reach - span * 0.2 && point.y < far) {
        far = point.y;
        farAt = along;
      }
    }
    if (!Number.isFinite(near) || !Number.isFinite(far) || farAt - nearAt < 0.5) return false;
    const underside = near + ((far - near) * (station - nearAt)) / (farAt - nearAt);
    const rig = this.lanternRig;
    rig.name = "BoomLantern";
    rig.position.set(dirX * station, underside, dirZ * station);
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a45, metalness: 0.85, roughness: 0.38 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x4a3e2c, roughness: 0.95 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xfff1d8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = material !== glass;
      rig.add(mesh);
      this.generatedMeshes.push(mesh);
      this.generatedGeometries.push(geometry);
      return mesh;
    };
    // Lanyard from the boom, the ring, the cap.
    part(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), rope, -0.1);
    const ring = part(new THREE.TorusGeometry(0.026, 0.005, 6, 14), brass, -0.215);
    ring.rotation.y = Math.PI / 2;
    part(new THREE.ConeGeometry(0.085, 0.06, 16), brass, -0.27);
    part(new THREE.CylinderGeometry(0.086, 0.086, 0.012, 16), brass, -0.302);
    // Glass between four brass posts.
    part(new THREE.CylinderGeometry(0.066, 0.066, 0.15, 16, 1, true), glass, -0.383);
    for (let post = 0; post < 4; post += 1) {
      const angle = (post / 4) * Math.PI * 2 + Math.PI / 4;
      part(new THREE.CylinderGeometry(0.0055, 0.0055, 0.155, 5), brass, -0.383, Math.cos(angle) * 0.07, Math.sin(angle) * 0.07);
    }
    part(new THREE.CylinderGeometry(0.08, 0.07, 0.028, 16), brass, -0.47);
    // The flame's light in the glass.
    light.position.set(0, -0.385, 0);
    rig.add(light);
    this.boomPivot.add(rig);
    return true;
  }

  private createNavigationLights(): void {
    const red = new THREE.PointLight(0xff233d, 0, 22, 2);
    // Red to port, green to starboard. As the view shows her, local +X is
    // her port side (see the frame note in AGENTS.md), so red goes on +X.
    red.position.set(2.05, 1.75, 0.65);
    const green = new THREE.PointLight(0x38ffb1, 0, 22, 2);
    green.position.set(-2.05, 1.75, 0.65);
    const stern = new THREE.PointLight(0xd7ecff, 0, 18, 2);
    stern.position.set(0, 1.35, -4.5);
    // A warm lantern hung under the cockpit roof: it lights the deck, the
    // skipper and the foot of the sail, and glows across the water.
    const lantern = new THREE.PointLight(0xffb764, 0, 26, 2);
    lantern.position.set(0.35, 2.12, -1.35);
    // The all-round white light at the masthead, seen for miles.
    const masthead = new THREE.PointLight(0xfff4e0, 0, 30, 2);
    masthead.position.set(0, 8.3, 1.7);
    this.navigationLights.push(red, green, stern, lantern, masthead);
    this.root.add(red, green, stern, masthead);
    // The lantern hangs from the boom over the cockpit on a short lanyard
    // (a cruising yacht's cockpit lamp), swinging with the boat; without a
    // boom (a model without one) it is not drawn, only its light kept.
    const hung = this.hangLantern(lantern);
    if (!hung) this.root.add(lantern);

    // Visible lamp lenses. Their colours are far brighter than white so the
    // bloom pass gives each one a coloured halo.
    const lampGeometry = new THREE.SphereGeometry(0.075, 14, 10);
    const lanternGeometry = new THREE.CylinderGeometry(0.075, 0.09, 0.2, 12);
    this.generatedGeometries.push(lampGeometry, lanternGeometry);
    const lamps: Array<[THREE.PointLight, THREE.BufferGeometry, number, number, number]> = [
      [red, lampGeometry, 9, 0.35, 0.5],
      [green, lampGeometry, 0.45, 8, 2.6],
      [stern, lampGeometry, 6, 6.6, 7.4],
      [masthead, lampGeometry, 8, 7.6, 6.6],
    ];
    lamps.forEach(([light, geometry, r, g, b]) => {
      const material = new THREE.MeshBasicMaterial({ fog: false });
      material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
      const lamp = new THREE.Mesh(geometry, material);
      lamp.position.copy(light.position);
      this.navigationLamps.add(lamp);
      this.generatedMeshes.push(lamp);
    });
    // The lantern's glass glows with its flame at night (it is on the boom, see `hangLantern`).
    if (hung) {
      const material = new THREE.MeshBasicMaterial({ fog: false });
      material.color.setRGB(9, 5.4, 2.1, THREE.LinearSRGBColorSpace);
      this.lanternGlow = new THREE.Mesh(lanternGeometry, material);
      this.lanternGlow.scale.set(0.72, 0.62, 0.72);
      this.lanternGlow.position.copy(lantern.position);
      this.lanternGlow.visible = false;
      this.lanternRig.add(this.lanternGlow);
      this.generatedMeshes.push(this.lanternGlow);
    }
    this.navigationLamps.visible = false;
    this.root.add(this.navigationLamps);
  }
}
