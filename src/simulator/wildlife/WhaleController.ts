import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import {
  WHALE_PHASE_DURATION,
  WHALE_SUBMERGED_FADE_START,
  WHALE_SURFACE_REVEAL_CLEARANCE,
  WHALE_TAIL_IMPACT_ARM_CLEARANCE,
  WHALE_TAIL_SPLASH_INTENSITY,
  didWhaleFlukeStrike,
  isWhaleWithinBoatRange,
  nextWhalePhase,
  whaleOrbitHeading,
  whaleSpawnDistance,
  whaleTailSlapPose,
  type WhalePhase,
} from "./WildlifeState";
import {
  createAnimatedVisual,
  isDetailedSwimAsset,
  moveAngle,
  setRandomAnimationTime,
  type AnimatedVisual,
} from "./WildlifeModel";

type TailJoint = {
  node: THREE.Object3D;
  weight: number;
};

type Whale = {
  root: THREE.Group;
  visual: AnimatedVisual;
  tailJoints: TailJoint[];
  position: THREE.Vector3;
  heading: number;
  speed: number;
  orbitDirection: number;
  preferredDistance: number;
  age: number;
  phase: WhalePhase;
  phaseElapsed: number;
  initialized: boolean;
  tailSplash: boolean;
  tailContact?: THREE.Object3D;
  previousTailClearance: number;
  impactArmed: boolean;
  waterFadeMaterials: THREE.MeshStandardMaterial[];
};

const TAIL_JOINTS = [
  { name: "locator4", weight: 0.26 },
  { name: "locator5", weight: 0.42 },
  { name: "locator6", weight: 0.54 },
] as const;

const TAIL_CONTACT_NODES = ["joint3_08", "Tail_end", "locator6"] as const;

export class WhaleController {
  private readonly whale?: Whale;
  private readonly tailAxis = new THREE.Vector3(1, 0, 0);
  private readonly tailQuaternion = new THREE.Quaternion();
  private readonly tailImpact = new THREE.Vector3();
  private readonly relativeToVessel = new THREE.Vector3();
  private readonly whaleSurfacePlane = new THREE.Vector4(0, 1, 0, 0);

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    private readonly onSplash: (position: THREE.Vector3, intensity: number) => void,
  ) {
    const asset = assets.animated("whale");
    if (!asset) return;
    if (!isDetailedSwimAsset(asset)) {
      console.warn("Whale asset failed geometry, rig, or animation validation and was omitted.");
      return;
    }
    const visual = createAnimatedVisual(
      asset,
      { targetSize: 18, measureAxis: "z", castShadow: false },
      [/^swimming$/i, /swim/i],
    );
    setRandomAnimationTime(visual, 0.78);
    visual.model.name = "Rigged_PBR_Blue_Whale_Tail_Slap_v2";
    // Keep the complete volumetric mesh. The local water-plane fade prevents
    // translucent ocean water from exposing a submerged body while keeping the
    // articulated fluke free to clear the waves without a hard clipping slice.
    const waterFadeMaterials: THREE.MeshStandardMaterial[] = [];
    visual.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const materials = sourceMaterials.map((source) => {
        const material = source.clone();
        material.side = THREE.FrontSide;
        material.depthTest = true;
        material.depthWrite = true;
        material.clippingPlanes = [];
        if (material instanceof THREE.MeshStandardMaterial) {
          material.metalness = 0;
          material.roughness = Math.max(0.68, material.roughness);
          this.applySubmergedWaterFade(material);
          waterFadeMaterials.push(material);
        }
        material.needsUpdate = true;
        return material;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0]!;
    });
    const root = new THREE.Group();
    root.name = "Whale_State_Root";
    root.rotation.order = "YXZ";
    root.add(visual.model);
    group.add(root);
    const tailJoints = TAIL_JOINTS.flatMap(({ name, weight }) => {
      const node = visual.model.getObjectByName(name);
      return node ? [{ node, weight }] : [];
    });
    if (tailJoints.length !== TAIL_JOINTS.length) {
      console.warn("Whale tail rig is incomplete; the tail-slap motion may be reduced.");
    }
    const tailContact = TAIL_CONTACT_NODES
      .map((name) => visual.model.getObjectByName(name))
      .find((node): node is THREE.Object3D => Boolean(node));
    this.whale = {
      root,
      visual,
      tailJoints,
      position: root.position,
      heading: 0,
      speed: 2.25,
      orbitDirection: Math.random() < 0.5 ? -1 : 1,
      preferredDistance: 72 + Math.random() * 10,
      age: 0,
      phase: "cruise",
      phaseElapsed: Math.random() * 14,
      initialized: false,
      tailSplash: false,
      tailContact,
      previousTailClearance: Number.NEGATIVE_INFINITY,
      impactArmed: false,
      waterFadeMaterials,
    };
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    const whale = this.whale;
    if (!whale) return;
    whale.age += delta;
    whale.phaseElapsed += delta;
    // update(0) deliberately reapplies the authored pose between the 30 fps
    // animation ticks, preventing the procedural tail bend from accumulating.
    whale.visual.mixer?.update(animationDelta * 0.82);

    if (!whale.initialized) this.initialize(whale, physics);
    if (!isWhaleWithinBoatRange(this.horizontalDistanceToVessel(whale, physics))) this.initialize(whale, physics);
    if (whale.phaseElapsed >= WHALE_PHASE_DURATION[whale.phase]) this.transition(whale, nextWhalePhase(whale.phase));

    this.relativeToVessel.copy(whale.position).sub(physics.position);
    const desiredHeading = whaleOrbitHeading(
      this.relativeToVessel.x,
      this.relativeToVessel.z,
      whale.orbitDirection,
      whale.preferredDistance,
    );
    const previousHeading = whale.heading;
    whale.heading = moveAngle(whale.heading, desiredHeading, delta * 0.14);
    whale.position.x += Math.sin(whale.heading) * whale.speed * delta;
    whale.position.z += Math.cos(whale.heading) * whale.speed * delta;
    if (!isWhaleWithinBoatRange(this.horizontalDistanceToVessel(whale, physics))) {
      this.initialize(whale, physics);
      return;
    }
    const phaseProgress = THREE.MathUtils.clamp(
      whale.phaseElapsed / WHALE_PHASE_DURATION[whale.phase],
      0,
      1,
    );
    const pose = whaleTailSlapPose(whale.phase, phaseProgress);
    const water = this.ocean.sample(whale.position.x, whale.position.z);
    const cruiseUndulation = whale.phase === "cruise" ? Math.sin(whale.age * 0.22) * 0.22 : 0;
    const targetY = water.height + pose.bodyDepth + cruiseUndulation;
    whale.position.y = THREE.MathUtils.damp(whale.position.y, targetY, 0.75, delta);
    this.whaleSurfacePlane.set(
      water.normalX,
      water.normalY,
      water.normalZ,
      -(
        water.normalX * whale.position.x +
        water.normalY * water.height +
        water.normalZ * whale.position.z
      ),
    );

    const turn = Math.atan2(Math.sin(whale.heading - previousHeading), Math.cos(whale.heading - previousHeading));
    whale.root.rotation.y = whale.heading;
    whale.root.rotation.x = THREE.MathUtils.damp(whale.root.rotation.x, pose.bodyPitch, 1.8, delta);
    whale.root.rotation.z = THREE.MathUtils.damp(whale.root.rotation.z, -turn * 8, 1.4, delta);
    this.applyTailFlex(whale, pose.tailFlex);
    whale.root.updateMatrixWorld(true);
    this.updateTailImpact(whale);
  }

  dispose(): void {
    if (!this.whale) return;
    this.whale.visual.mixer?.stopAllAction();
    this.whale.waterFadeMaterials.forEach((material) => material.dispose());
    this.group.remove(this.whale.root);
  }

  private initialize(whale: Whale, physics: VesselPhysics): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = whaleSpawnDistance(Math.random());
    const spawnX = physics.position.x + Math.sin(angle) * radius;
    const spawnZ = physics.position.z + Math.cos(angle) * radius;
    const water = this.ocean.sample(spawnX, spawnZ);
    whale.position.set(
      spawnX,
      water.height + whaleTailSlapPose("cruise", 0).bodyDepth,
      spawnZ,
    );
    whale.preferredDistance = 72 + Math.random() * 10;
    whale.orbitDirection = Math.random() < 0.5 ? -1 : 1;
    whale.heading = whaleOrbitHeading(
      whale.position.x - physics.position.x,
      whale.position.z - physics.position.z,
      whale.orbitDirection,
      whale.preferredDistance,
    );
    whale.root.rotation.y = whale.heading;
    whale.root.rotation.x = 0;
    whale.root.rotation.z = 0;
    whale.phase = "cruise";
    whale.phaseElapsed = Math.random() * 5;
    whale.tailSplash = false;
    whale.impactArmed = false;
    whale.previousTailClearance = Number.NEGATIVE_INFINITY;
    whale.initialized = true;
  }

  private horizontalDistanceToVessel(whale: Whale, physics: VesselPhysics): number {
    return Math.hypot(
      whale.position.x - physics.position.x,
      whale.position.z - physics.position.z,
    );
  }

  private applyTailFlex(whale: Whale, flex: number): void {
    whale.tailJoints.forEach(({ node, weight }) => {
      this.tailQuaternion.setFromAxisAngle(this.tailAxis, flex * weight);
      node.quaternion.multiply(this.tailQuaternion);
    });
  }

  private applySubmergedWaterFade(material: THREE.MeshStandardMaterial): void {
    material.transparent = false;
    material.alphaHash = true;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.whaleSurfacePlane = { value: this.whaleSurfacePlane };
      shader.vertexShader = `varying vec3 vWhaleWorldPosition;\n${shader.vertexShader}`.replace(
        "#include <skinning_vertex>",
        "#include <skinning_vertex>\n\tvWhaleWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
      );
      shader.fragmentShader = `uniform vec4 whaleSurfacePlane;\nvarying vec3 vWhaleWorldPosition;\n${shader.fragmentShader}`.replace(
        "#include <alphamap_fragment>",
        `#include <alphamap_fragment>
\tfloat whaleSurfaceClearance = dot( vec4( vWhaleWorldPosition, 1.0 ), whaleSurfacePlane );
\tfloat whaleSurfaceAlpha = smoothstep( ${WHALE_SUBMERGED_FADE_START.toFixed(2)}, ${WHALE_SURFACE_REVEAL_CLEARANCE.toFixed(2)}, whaleSurfaceClearance );
\tdiffuseColor.a *= whaleSurfaceAlpha;`,
      );
    };
    material.customProgramCacheKey = () => "submerged-whale-surface-fade-v1";
  }

  private updateTailImpact(whale: Whale): void {
    if (!whale.tailContact || (whale.phase !== "tail_rise" && whale.phase !== "tail_strike")) {
      whale.previousTailClearance = Number.NEGATIVE_INFINITY;
      return;
    }
    whale.tailContact.getWorldPosition(this.tailImpact);
    const waterHeight = this.ocean.sample(this.tailImpact.x, this.tailImpact.z).height;
    const clearance = this.tailImpact.y - waterHeight;
    if (clearance > WHALE_TAIL_IMPACT_ARM_CLEARANCE) whale.impactArmed = true;
    if (
      didWhaleFlukeStrike(whale.phase, whale.impactArmed, whale.previousTailClearance, clearance) &&
      !whale.tailSplash
    ) {
      whale.tailSplash = true;
      whale.impactArmed = false;
      this.tailImpact.y = waterHeight + 0.1;
      this.onSplash(this.tailImpact, WHALE_TAIL_SPLASH_INTENSITY);
    }
    whale.previousTailClearance = clearance;
  }

  private transition(whale: Whale, phase: WhalePhase): void {
    whale.phase = phase;
    whale.phaseElapsed = 0;
    if (phase === "tail_rise") {
      whale.tailSplash = false;
      whale.impactArmed = false;
      whale.previousTailClearance = Number.NEGATIVE_INFINITY;
    }
  }
}
