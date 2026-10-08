import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { animationInterval, BodyPoint, filterClip, findBone, ProceduralBone } from "./BodyRig";
import {
  createWhaleAgent,
  stepWhale,
  whalePose,
  whaleWorldY,
  WHALE_DORSAL_HEIGHT,
  type WhaleAgent,
} from "./WhaleBehavior";
import { CONTACT_MASS, contactIntensity, SurfacePoint, type MarineWorld, type VesselState, type WaterEffects } from "./WaterContact";
import { createAnimatedVisual, isDetailedSwimAsset, type AnimatedVisual } from "./WildlifeModel";

/**
 * Renders and animates the whale described by {@link WhaleBehavior}.
 *
 * The body is never hidden by a trick: below the surface it is veiled by the
 * same Beer–Lambert water every submerged material uses, so it reads as a
 * huge dark shape when shallow and disappears with depth. The tail is bent
 * procedurally through its three real joints; the authored clip only adds
 * flipper and eye motion. Splashes, blows, foam trails and ring waves come
 * from tracked points on the body crossing the rendered wave surface.
 */

/** Tail joints driven procedurally, from the body toward the flukes. */
const TAIL_BONES = ["locator4", "locator5", "locator6"] as const;
/** Tracks the authored clip must not touch: body pitch and the tail belong to the behaviour. */
const PROCEDURAL_TRACKS = ["locator3", "locator4", "locator5", "locator6"] as const;

type TrackedPoint = {
  point: BodyPoint;
  tracker: SurfacePoint;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Horizontal distance travelled since the last foam trail. */
  trailDistance: number;
};

type Whale = {
  agent: WhaleAgent;
  root: THREE.Group;
  visual: AnimatedVisual;
  secondary?: THREE.AnimationAction;
  tail: ProceduralBone[];
  blowhole?: TrackedPoint;
  back: TrackedPoint[];
  fluke: TrackedPoint[];
  animationClock: number;
  /** One slap per downstroke, however many fluke points cross. */
  slapDelivered: boolean;
  shedTime: number;
  footprintLeft: boolean;
  materials: THREE.Material[];
};

export class WhaleController {
  private readonly whale?: Whale;
  private readonly scratch = new THREE.Vector3();
  private readonly surfacePoint = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    private readonly world: MarineWorld,
    assets: AssetManager,
    private readonly effects: WaterEffects,
  ) {
    const asset = assets.animated("whale");
    if (!asset) return;
    if (!isDetailedSwimAsset(asset)) {
      console.warn("Whale asset failed geometry, rig, or animation validation and was omitted.");
      return;
    }
    const visual = createAnimatedVisual(asset, { targetSize: 18, measureAxis: "z", castShadow: false }, []);
    visual.model.name = "Rigged_PBR_Blue_Whale";
    // The authored swim clip beats the flukes through seven metres; only its
    // flipper and eye motion is kept, the body and tail are procedural.
    visual.actions.forEach((action) => action.stop());
    visual.mixer?.stopAllAction();
    const swim = visual.clips.find((clip) => /swim/iu.test(clip.name)) ?? visual.clips[0];
    const secondary = swim && visual.mixer ? visual.mixer.clipAction(filterClip(swim, PROCEDURAL_TRACKS)) : undefined;
    secondary?.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    secondary?.play();
    if (secondary) secondary.time = Math.random() * secondary.getClip().duration;

    const materials: THREE.Material[] = [];
    visual.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = sources.map((source) => {
        const material = source.clone();
        material.side = THREE.FrontSide;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.metalness = 0;
          material.roughness = Math.max(0.62, material.roughness);
        }
        materials.push(material);
        return material;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0]!;
      if (object instanceof THREE.SkinnedMesh) {
        // A raised tail reaches beyond the rest-pose bounds.
        object.computeBoundingSphere();
        if (object.boundingSphere) object.boundingSphere.radius *= 1.4;
      }
    });

    const root = new THREE.Group();
    root.name = "Whale_Behaviour_Root";
    root.rotation.order = "YXZ";
    root.add(visual.model);
    group.add(root);
    root.updateMatrixWorld(true);

    const tail = TAIL_BONES.flatMap((name) => {
      const bone = findBone(visual.model, name);
      return bone ? [new ProceduralBone(bone, root)] : [];
    });
    if (tail.length !== TAIL_BONES.length) console.warn("Whale tail rig is incomplete; the tail cannot lift.");

    const track = (boneName: string, x: number, y: number, z: number): TrackedPoint | undefined => {
      const bone = findBone(visual.model, boneName);
      if (!bone) return undefined;
      return {
        point: new BodyPoint(bone, root, new THREE.Vector3(x, y, z)),
        tracker: new SurfacePoint(),
        position: new THREE.Vector3(),
        previous: new THREE.Vector3(Number.NaN, 0, 0),
        velocity: new THREE.Vector3(),
        trailDistance: 0,
      };
    };
    const back = [
      track("_rootJoint", 0, 2.12, 2.2),
      track("locator4", 0, 2.02, -0.9),
      track("locator5", 0, 1.55, -3.5),
      track("locator5", 0, 0.75, -5.4),
    ].filter((point): point is TrackedPoint => Boolean(point));
    const fluke = [
      track("joint6_07", 0, -1.35, -8.3),
      track("joint6_07", 2.3, -1.45, -8.6),
      track("joint6_07", -2.3, -1.45, -8.6),
      track("joint6_07", 0, -1.6, -9),
    ].filter((point): point is TrackedPoint => Boolean(point));

    // Start ahead of the scene, hidden at depth, swimming across the view.
    const start = { x: 0, z: 140 };
    const agent = createWhaleAgent(start.x + (Math.random() - 0.5) * 60, start.z, Math.PI * (0.6 + Math.random() * 0.8), Math.random);
    this.whale = {
      agent,
      root,
      visual,
      secondary,
      tail,
      blowhole: track("joint2_01", 0, 1.95, 5.4),
      back,
      fluke,
      animationClock: 0,
      slapDelivered: false,
      shedTime: 0,
      footprintLeft: true,
      materials,
    };
  }

  /** Centre and clearance radius of the whale, for other animals to avoid. */
  obstacle(): { position: THREE.Vector3; radius: number } | undefined {
    if (!this.whale) return undefined;
    return { position: this.whale.root.position, radius: 11 };
  }

  get phase(): string | undefined {
    return this.whale?.agent.phase;
  }

  update(delta: number, vessel: VesselState, camera: THREE.Camera): void {
    const whale = this.whale;
    if (!whale || delta <= 0) return;
    const agent = whale.agent;
    stepWhale(agent, this.world, vessel, delta, Math.random);
    if (agent.relocated) {
      agent.relocated = false;
      [whale.blowhole, ...whale.back, ...whale.fluke].forEach((tracked) => {
        if (!tracked) return;
        tracked.tracker.reset();
        tracked.previous.set(Number.NaN, 0, 0);
      });
    }

    const motion = agent.motion;
    const pose = whalePose(agent);
    whale.root.position.set(motion.x, whaleWorldY(agent), motion.z);
    const bank = THREE.MathUtils.clamp(-motion.yawRate * motion.speed * 2.2, -0.07, 0.07);
    whale.root.rotation.set(-motion.pitch + pose.bodyAngle, motion.heading, bank, "YXZ");

    // Deep and far, the whale is fully absorbed by the water: skip it.
    camera.getWorldPosition(this.cameraPosition);
    const cameraDistance = this.cameraPosition.distanceTo(whale.root.position);
    const surface = this.ocean.sample(motion.x, motion.z).height;
    const depth = surface - whale.root.position.y;
    const visible = depth < 13.5 && cameraDistance < 420;
    whale.visual.model.visible = visible;
    if (!visible) {
      whale.root.updateMatrixWorld(true);
      return;
    }

    whale.tail.forEach((bone) => bone.restore());
    whale.animationClock += delta;
    if (whale.secondary && whale.animationClock >= animationInterval(cameraDistance)) {
      whale.secondary.setEffectiveWeight(pose.secondaryWeight);
      whale.secondary.timeScale = 0.45 + motion.speed * 0.22;
      whale.visual.mixer?.update(whale.animationClock);
      whale.animationClock = 0;
      whale.tail.forEach((bone) => bone.capture());
    }
    whale.tail.forEach((bone, index) => bone.rotate("pitch", pose.bends[index] ?? 0));
    whale.root.updateMatrixWorld(true);

    this.updateContacts(whale, delta, depth);
  }

  dispose(): void {
    if (!this.whale) return;
    this.whale.visual.mixer?.stopAllAction();
    this.whale.materials.forEach((material) => material.dispose());
    this.group.remove(this.whale.root);
  }

  private sampleTracked(tracked: TrackedPoint, delta: number): string | null {
    tracked.point.world(tracked.position);
    if (Number.isFinite(tracked.previous.x)) {
      tracked.velocity.copy(tracked.position).sub(tracked.previous).divideScalar(Math.max(delta, 1e-3));
    } else {
      tracked.velocity.set(0, 0, 0);
    }
    tracked.previous.copy(tracked.position);
    const surface = this.ocean.sample(tracked.position.x, tracked.position.z).height;
    return tracked.tracker.update(tracked.position.y, surface, delta);
  }

  private onSurface(position: THREE.Vector3): THREE.Vector3 {
    return this.surfacePoint.set(position.x, this.ocean.sample(position.x, position.z).height, position.z);
  }

  private updateContacts(whale: Whale, delta: number, depth: number): void {
    const agent = whale.agent;
    const nearSurface = depth < WHALE_DORSAL_HEIGHT + 4.5;
    const tailWork =
      agent.phase === "prepare_tail_slap" || agent.phase === "tail_slap" || (agent.phase === "submerge" && agent.flukeUp);

    // Blow: the blowhole clearing the water at a breath.
    if (whale.blowhole) {
      const crossing = this.sampleTracked(whale.blowhole, delta);
      if (crossing === "exit" && agent.phase === "surface") {
        const position = this.onSurface(whale.blowhole.position);
        this.effects.splash(position, 2.6 + Math.random() * 1.2, "blow");
        this.effects.splash(position, 0.5, "breath", whale.blowhole.velocity);
      }
    }

    // The back rolling through the surface: a little spray, a foam trail and
    // the slick a moving whale leaves.
    for (const tracked of whale.back) {
      const crossing = this.sampleTracked(tracked, delta);
      if (!nearSurface) continue;
      if (crossing) {
        const intensity = contactIntensity(CONTACT_MASS.whaleBack, Math.abs(tracked.tracker.verticalSpeed) + 0.25);
        this.effects.splash(this.onSurface(tracked.position), Math.min(0.9, intensity), "breath", tracked.velocity);
      }
      if (tracked.tracker.clearance > -0.3) {
        tracked.trailDistance += Math.hypot(tracked.velocity.x, tracked.velocity.z) * delta;
        if (tracked.trailDistance > 1.4) {
          tracked.trailDistance = 0;
          const heading = Math.atan2(tracked.velocity.x, tracked.velocity.z);
          this.effects.trail(this.onSurface(tracked.position), heading, 0.55, 1.5);
        }
      }
    }

    // Flukes: water pours off as they lift, a slap when they come down.
    if (agent.phase === "tail_slap" && (agent.stage === "hold" || agent.stage === "relift")) whale.slapDelivered = false;
    let anyAirborne = false;
    for (const tracked of whale.fluke) {
      const crossing = this.sampleTracked(tracked, delta);
      if (tracked.tracker.clearance > 0) anyAirborne = true;
      if (!tailWork || !crossing) continue;
      const verticalSpeed = tracked.tracker.verticalSpeed;
      if (crossing === "exit") {
        this.effects.splash(this.onSurface(tracked.position), 0.55, "exit", tracked.velocity);
        whale.shedTime = 1.6;
        continue;
      }
      const striking =
        agent.phase === "tail_slap" && (agent.stage === "downstroke" || agent.stage === "follow") && verticalSpeed < -1.2;
      if (striking && !whale.slapDelivered) {
        whale.slapDelivered = true;
        const intensity = THREE.MathUtils.clamp(
          contactIntensity(CONTACT_MASS.whaleFluke, Math.abs(verticalSpeed)) * agent.slap.force,
          2.6,
          6,
        );
        this.effects.splash(this.onSurface(tracked.position), intensity, "slap", tracked.velocity);
      } else if (!striking) {
        this.effects.splash(this.onSurface(tracked.position), contactIntensity(500, Math.abs(verticalSpeed)), "entry", tracked.velocity);
      }
    }
    if (whale.shedTime > 0 && anyAirborne) {
      whale.shedTime -= delta;
      for (const tracked of whale.fluke) {
        if (tracked.tracker.clearance <= 0.1 || Math.random() > delta * 28) continue;
        this.effects.shed(tracked.position, tracked.velocity, 2, 0.14);
      }
    }

    // A whale sounding from the surface leaves a glassy footprint.
    if (agent.phase === "surface" || agent.phase === "tail_slap") whale.footprintLeft = false;
    if (agent.phase === "submerge" && !whale.footprintLeft && depth > 4.2) {
      whale.footprintLeft = true;
      this.scratch.copy(whale.root.position);
      this.effects.ripple(this.onSurface(this.scratch), 2.4);
    }
  }
}
