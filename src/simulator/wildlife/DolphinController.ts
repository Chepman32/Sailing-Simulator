import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { animationInterval, BodyPoint, filterClip, findBone, ProceduralBone } from "./BodyRig";
import {
  createDolphinPod,
  DOLPHIN_LENGTH,
  stepDolphinPod,
  type DolphinAgent,
  type DolphinObstacle,
  type DolphinPod,
} from "./DolphinBehavior";
import { CONTACT_MASS, contactIntensity, SurfacePoint, type MarineWorld, type VesselState, type WaterEffects } from "./WaterContact";
import { createAnimatedVisual, type AnimatedVisual } from "./WildlifeModel";

/**
 * Renders the dolphin pod described by {@link DolphinBehavior}.
 *
 * The rig's authored clip flaps the pectoral fins like wings and leaves the
 * spine still, so the swimming motion is procedural: a dorsoventral wave
 * runs from the head to the flukes, growing toward the tail, its frequency
 * set by the dolphin's speed. In the air the strokes stop and the body takes
 * the curve of its ballistic path. The rig is rooted at the tail, so after
 * bending, the model is shifted to keep the mid-body on the swimming path.
 */

/** Spine from the tail forward, with each segment's centre along the body (m). */
const SPINE = [
  { name: "Bone_00", centre: -0.41, amplitude: 0.16, lag: 1.7 },
  { name: "Bone.001_01", centre: 0.05, amplitude: 0.05, lag: 1 },
  { name: "Bone.002_02", centre: 0.39, amplitude: 0.016, lag: 0.5 },
  { name: "Bone.003_03", centre: 0.71, amplitude: 0.022, lag: 0 },
] as const;
const FLUKE = { name: "Bone.005_018", centre: -1, amplitude: 0.38, lag: 2.6 } as const;
/** Bones the authored clip must leave alone. */
const PROCEDURAL_TRACKS = ["Bone.005_018", "Bone_00", "Bone.001_01", "Bone.002_02", "Bone.003_03"] as const;

type TrackedPoint = {
  point: BodyPoint;
  tracker: SurfacePoint;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  trailDistance: number;
};

type DolphinVisual = {
  root: THREE.Group;
  visual: AnimatedVisual;
  secondary?: THREE.AnimationAction;
  spine: ProceduralBone[];
  fluke?: ProceduralBone;
  anchor?: BodyPoint;
  anchorRest: THREE.Vector3;
  modelBase: THREE.Vector3;
  rostrum?: TrackedPoint;
  blowhole?: TrackedPoint;
  dorsal?: TrackedPoint;
  tail?: TrackedPoint;
  animationClock: number;
  shedTime: number;
};

export class DolphinController {
  private readonly visuals: DolphinVisual[] = [];
  private readonly count: number;
  private readonly anchorWorld = new THREE.Vector3();
  private readonly surfacePoint = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly angles = new Float32Array(SPINE.length);
  private readonly yaws = new Float32Array(SPINE.length);
  private podState: DolphinPod | null = null;

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    private readonly world: MarineWorld,
    assets: AssetManager,
    count: number,
    private readonly effects: WaterEffects,
  ) {
    this.count = count;
    for (let index = 0; index < count; index += 1) this.visuals.push(this.createVisual(assets, index));
  }

  /** Positions of every dolphin, for prey that must avoid them. */
  collectPositions(target: THREE.Vector3[]): void {
    this.visuals.forEach((visual) => target.push(visual.root.position));
  }

  /** Agents, for tests and tuning tools. */
  get agents(): readonly DolphinAgent[] {
    return this.podState?.agents ?? [];
  }

  update(delta: number, vessel: VesselState, obstacles: readonly DolphinObstacle[], camera: THREE.Camera): void {
    if (delta <= 0 || this.visuals.length === 0) return;
    if (!this.podState) this.podState = createDolphinPod(this.count, vessel, this.world, Math.random);
    const pod = this.podState;
    stepDolphinPod(pod, this.world, vessel, obstacles, delta, Math.random);
    camera.getWorldPosition(this.cameraPosition);
    pod.agents.forEach((agent, index) => {
      const visual = this.visuals[index];
      if (visual) this.apply(agent, visual, delta);
    });
  }

  dispose(): void {
    this.visuals.forEach((visual) => {
      visual.visual.mixer?.stopAllAction();
      this.group.remove(visual.root);
    });
    this.visuals.length = 0;
  }

  private createVisual(assets: AssetManager, index: number): DolphinVisual {
    const visual = createAnimatedVisual(
      assets.dolphin(),
      // The rig's rostrum points along +X; turned to +Z and scaled by its
      // length (not the span of its pectoral fins) to a 2.7 m bottlenose.
      { targetSize: DOLPHIN_LENGTH, measureAxis: "z", yaw: -Math.PI / 2, castShadow: false },
      [],
    );
    visual.model.name = `Rigged_Dolphin_${index + 1}`;
    // The source paints the back a saturated teal; a bottlenose is slate grey.
    visual.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial && /body/iu.test(material.name)) {
          material.color.setRGB(0.07, 0.085, 0.1, THREE.LinearSRGBColorSpace);
          material.roughness = 0.38;
        }
      });
    });
    visual.actions.forEach((action) => action.stop());
    visual.mixer?.stopAllAction();
    const swim = visual.clips[0];
    const secondary = swim && visual.mixer ? visual.mixer.clipAction(filterClip(swim, PROCEDURAL_TRACKS)) : undefined;
    secondary?.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    secondary?.play();
    if (secondary) {
      secondary.time = Math.random() * secondary.getClip().duration;
      secondary.setEffectiveWeight(0.3);
    }

    const root = new THREE.Group();
    root.name = `Dolphin_Behaviour_Root_${index + 1}`;
    root.rotation.order = "YXZ";
    root.add(visual.model);
    this.group.add(root);
    root.updateMatrixWorld(true);

    const spine = SPINE.flatMap(({ name }) => {
      const bone = findBone(visual.model, name);
      return bone ? [new ProceduralBone(bone, root)] : [];
    });
    if (spine.length !== SPINE.length) console.warn("Dolphin spine rig is incomplete; swimming will be reduced.");
    const flukeBone = findBone(visual.model, FLUKE.name);
    const midBone = findBone(visual.model, "Bone.001_01");
    const headBone = findBone(visual.model, "Bone.003_03");
    const anchorRest = new THREE.Vector3(0, 0.08, 0.05);
    const track = (bone: THREE.Object3D | undefined, x: number, y: number, z: number): TrackedPoint | undefined =>
      bone
        ? {
            point: new BodyPoint(bone, root, new THREE.Vector3(x, y, z)),
            tracker: new SurfacePoint(),
            position: new THREE.Vector3(),
            previous: new THREE.Vector3(Number.NaN, 0, 0),
            velocity: new THREE.Vector3(),
            trailDistance: 0,
          }
        : undefined;
    return {
      root,
      visual,
      secondary,
      spine,
      fluke: flukeBone ? new ProceduralBone(flukeBone, root) : undefined,
      anchor: midBone ? new BodyPoint(midBone, root, anchorRest) : undefined,
      anchorRest,
      modelBase: visual.model.position.clone(),
      rostrum: track(headBone, 0, 0.02, 1.36),
      blowhole: track(headBone, 0, 0.23, 0.83),
      dorsal: track(midBone, 0, 0.5, 0.2),
      tail: track(flukeBone, 0, -0.12, -1.25),
      animationClock: 0,
      shedTime: 0,
    };
  }

  private apply(agent: DolphinAgent, visual: DolphinVisual, delta: number): void {
    const motion = agent.motion;
    const root = visual.root;
    root.position.set(motion.x, motion.y, motion.z);
    root.rotation.set(-motion.pitch, motion.heading, agent.roll, "YXZ");
    const cameraDistance = this.cameraPosition.distanceTo(root.position);
    const visible = cameraDistance < 320;
    visual.visual.model.visible = visible;
    if (!visible) {
      root.updateMatrixWorld(true);
      return;
    }

    // Skeleton: authored fins at a reduced rate far away, procedural spine every frame.
    visual.spine.forEach((bone) => bone.restore());
    visual.fluke?.restore();
    visual.animationClock += delta;
    if (visual.secondary && visual.animationClock >= animationInterval(cameraDistance)) {
      const airborne = agent.phase === "leap" || agent.phase === "airborne" || agent.phase === "reentry";
      visual.secondary.setEffectiveWeight(airborne ? 0.12 : 0.3);
      visual.secondary.timeScale = 0.6 + motion.speed * 0.08;
      visual.visual.mixer?.update(visual.animationClock);
      visual.animationClock = 0;
      visual.spine.forEach((bone) => bone.capture());
      visual.fluke?.capture();
    }

    // Absolute segment angles: a travelling wave plus the curve of the path.
    const stroke = agent.strokeAmplitude;
    SPINE.forEach((segment, index) => {
      this.angles[index] =
        stroke * segment.amplitude * Math.sin(agent.strokePhase - segment.lag) + agent.curvature * segment.centre;
      this.yaws[index] = agent.lateralCurvature * segment.centre;
    });
    let previousPitch = 0;
    let previousYaw = 0;
    visual.spine.forEach((bone, index) => {
      const pitch = this.angles[index] ?? 0;
      const yaw = this.yaws[index] ?? 0;
      bone.rotate("pitch", pitch - previousPitch);
      bone.rotate("yaw", yaw - previousYaw);
      previousPitch = pitch;
      previousYaw = yaw;
    });
    if (visual.fluke) {
      visual.fluke.rotate(
        "pitch",
        stroke * FLUKE.amplitude * Math.sin(agent.strokePhase - FLUKE.lag) + agent.curvature * FLUKE.centre,
      );
      visual.fluke.rotate("yaw", agent.lateralCurvature * FLUKE.centre);
    }

    // Keep the mid-body on the path: the rig pivots about its tail.
    visual.visual.model.position.copy(visual.modelBase);
    root.updateMatrixWorld(true);
    if (visual.anchor) {
      visual.anchor.world(this.anchorWorld);
      root.worldToLocal(this.anchorWorld);
      visual.visual.model.position.sub(this.anchorWorld.sub(visual.anchorRest));
      root.updateMatrixWorld(true);
    }

    this.updateContacts(agent, visual, delta);
  }

  private sample(tracked: TrackedPoint, delta: number): string | null {
    tracked.point.world(tracked.position);
    if (Number.isFinite(tracked.previous.x)) {
      tracked.velocity.copy(tracked.position).sub(tracked.previous).divideScalar(Math.max(delta, 1e-3));
    } else {
      tracked.velocity.set(0, 0, 0);
    }
    tracked.previous.copy(tracked.position);
    return tracked.tracker.update(tracked.position.y, this.ocean.sample(tracked.position.x, tracked.position.z).height, delta);
  }

  private onSurface(position: THREE.Vector3): THREE.Vector3 {
    return this.surfacePoint.set(position.x, this.ocean.sample(position.x, position.z).height, position.z);
  }

  private updateContacts(agent: DolphinAgent, visual: DolphinVisual, delta: number): void {
    const leaping = agent.phase === "leap" || agent.phase === "airborne" || agent.phase === "reentry" || agent.phase === "dive";
    const speed = agent.motion.speed;

    if (visual.rostrum) {
      const crossing = this.sample(visual.rostrum, delta);
      if (crossing === "exit" && agent.phase === "leap") {
        // The head breaks through: a sheet of water is dragged up along the body.
        this.effects.splash(
          this.onSurface(visual.rostrum.position),
          contactIntensity(CONTACT_MASS.dolphin, speed) * 0.55,
          "exit",
          visual.rostrum.velocity,
        );
      } else if (crossing === "entry" && (agent.phase === "reentry" || agent.phase === "airborne")) {
        this.effects.splash(
          this.onSurface(visual.rostrum.position),
          contactIntensity(CONTACT_MASS.dolphin, speed),
          "entry",
          visual.rostrum.velocity,
        );
      }
    }

    if (visual.tail) {
      const crossing = this.sample(visual.tail, delta);
      if (crossing === "exit" && leaping) {
        visual.shedTime = 0.35;
        this.effects.splash(this.onSurface(visual.tail.position), 0.35, "exit", visual.tail.velocity);
      } else if (crossing === "entry" && leaping) {
        this.effects.splash(this.onSurface(visual.tail.position), 0.3, "breath", visual.tail.velocity);
      }
      if (visual.shedTime > 0 && visual.tail.tracker.clearance > 0.05) {
        // Water streams off the flukes for a moment after they clear.
        visual.shedTime -= delta;
        if (Math.random() < delta * 40) this.effects.shed(visual.tail.position, visual.tail.velocity, 2, 0.07);
      }
    }

    if (visual.blowhole) {
      const crossing = this.sample(visual.blowhole, delta);
      if (crossing === "exit" && !leaping && agent.phase !== "accelerate" && agent.phase !== "approach_surface") {
        // A breath at the surface: a quick chuff of mist and a ripple.
        const position = this.onSurface(visual.blowhole.position);
        this.effects.splash(position, 0.25, "blow");
        this.effects.splash(position, 0.3, "breath", visual.blowhole.velocity);
      }
    }

    if (visual.dorsal) {
      this.sample(visual.dorsal, delta);
      // Only a fin actually standing out of the water leaves a line of foam.
      const cutting = visual.dorsal.tracker.clearance > 0.02 && visual.dorsal.tracker.clearance < 0.45;
      if (cutting && !leaping && speed > 1) {
        visual.dorsal.trailDistance += speed * delta;
        if (visual.dorsal.trailDistance > 1.5) {
          visual.dorsal.trailDistance = 0;
          this.effects.trail(this.onSurface(visual.dorsal.position), agent.motion.heading, 0.12 + speed * 0.02, 0.32);
        }
      }
    }
  }
}
