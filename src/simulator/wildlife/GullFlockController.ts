import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { mergeSkinnedParts, smoothNormalsByPosition } from "../core/SkinnedMerge";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { ProceduralBone } from "./BodyRig";
import { createAnimatedVisual, dampAngle, type AnimatedVisual } from "./WildlifeModel";

type Gull = {
  root: THREE.Group;
  visual: AnimatedVisual;
  center: THREE.Vector3;
  radius: number;
  direction: number;
  heading: number;
  altitude: number;
  speed: number;
  age: number;
  phase: number;
  flap?: THREE.AnimationAction;
  /** Window of the flap clip that makes one full, cleanly looping wing beat. */
  flapCycle: { start: number; length: number };
  flapPhase: number;
  /** Shoulder and elbow joints of each wing, with the side they are on (+1 starboard). */
  wingJoints: { joint: ProceduralBone; side: number; elbow: boolean }[];
  glide?: THREE.AnimationAction;
  initialized: boolean;
};

/** Shoulder and hand swing of a full wing beat, radians either side. */
const GULL_SHOULDER_SWING = 0.5;
const GULL_HAND_SWING = 0.28;

/**
 * The shoulder ("aile1") and hand ("aile2") joints of each wing, with the side
 * each wing is on, measured from where its tip lies in the bird's frame.
 */
function findWingJoints(model: THREE.Object3D, frame: THREE.Object3D): { joint: ProceduralBone; side: number; elbow: boolean }[] {
  const joints: { joint: ProceduralBone; side: number; elbow: boolean }[] = [];
  const inverse = frame.matrixWorld.clone().invert();
  const position = new THREE.Vector3();
  model.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const match = /aile([12])/i.exec(object.name);
    if (!match) return;
    const tip = object.children.find((child) => child instanceof THREE.Bone) ?? object;
    position.setFromMatrixPosition(tip.matrixWorld).applyMatrix4(inverse);
    const side = position.x >= 0 ? 1 : -1;
    joints.push({ joint: new ProceduralBone(object, frame), side, elbow: match[1] === "2" });
  });
  return joints;
}

/** Wing beats per second in flapping flight (large gulls beat at 2–3 Hz). */
const GULL_BEAT_FREQUENCY = 2.1;

/**
 * Length of one complete wing beat in the flap clip. The authored clip holds
 * about one and a half beats, so looping it whole makes the wings snap at the
 * seam; one measured cycle loops cleanly.
 */
function measureBeatCycle(
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction,
  model: THREE.Object3D,
): { start: number; length: number } {
  const duration = action.getClip().duration;
  const bones: THREE.Bone[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Bone) bones.push(object);
  });
  const samples = 96;
  // Every bone's rotation over the clip, sign-aligned so q and −q compare equal.
  const poses: number[][] = [];
  for (let index = 0; index <= samples; index += 1) {
    action.time = (duration * index) / samples;
    mixer.update(0);
    const pose: number[] = [];
    bones.forEach((bone, boneIndex) => {
      const q = bone.quaternion;
      const reference = poses[0]?.slice(boneIndex * 4, boneIndex * 4 + 4);
      const sign = reference && reference[0] * q.x + reference[1] * q.y + reference[2] * q.z + reference[3] * q.w < 0 ? -1 : 1;
      pose.push(q.x * sign, q.y * sign, q.z * sign, q.w * sign);
    });
    poses.push(pose);
  }
  action.time = 0;
  // Only the wing defines the cycle; the tail and head drift on their own.
  const ranges = bones.map((_, boneIndex) => {
    let range = 0;
    for (const pose of poses) {
      range = Math.max(range, Math.hypot(...[0, 1, 2, 3].map((c) => pose[boneIndex * 4 + c] - poses[0][boneIndex * 4 + c])));
    }
    return range;
  });
  const widest = Math.max(...ranges);
  // The shoulder joint that sweeps furthest carries the beat.
  const beating = [ranges.indexOf(widest)];
  const distance = (a: number[], b: number[]): number =>
    beating.reduce((sum, boneIndex) => {
      let part = 0;
      for (let c = 0; c < 4; c += 1) part += (a[boneIndex * 4 + c] - b[boneIndex * 4 + c]) ** 2;
      return sum + part;
    }, 0);
  let spread = 0;
  for (const pose of poses) spread = Math.max(spread, distance(pose, poses[0]));
  if (spread < 1e-4) return { start: 0, length: duration };
  // The beat is the lag at which the whole pose best repeats itself.
  let bestLag = samples;
  let bestError = Number.POSITIVE_INFINITY;
  for (let lag = Math.floor(samples * 0.25); lag <= Math.floor(samples * 0.8); lag += 1) {
    let error = 0;
    for (let index = 0; index + lag <= samples; index += 1) error += distance(poses[index], poses[index + lag]);
    error /= samples + 1 - lag;
    if (error < bestError) {
      bestError = error;
      bestLag = lag;
    }
  }
  if (bestError > spread * 0.3) return { start: 0, length: duration };
  // Loop the window whose ends match best, so the seam is invisible.
  let start = 0;
  let seam = Number.POSITIVE_INFINITY;
  for (let index = 0; index + bestLag <= samples; index += 1) {
    const mismatch = distance(poses[index], poses[index + bestLag]);
    if (mismatch < seam) {
      seam = mismatch;
      start = index;
    }
  }
  return { start: (duration * start) / samples, length: (duration * bestLag) / samples };
}

export class GullFlockController {
  private readonly gulls: Gull[] = [];
  /** Merged bird meshes created here (see `mergeSkinnedParts`). */
  private readonly owned: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];

  constructor(
    private readonly group: THREE.Group,
    assets: AssetManager,
    qualityCount: number,
  ) {
    const gullCount = qualityCount > 1 ? 4 : 2;
    for (let index = 0; index < gullCount; index += 1) {
      const asset = assets.animated("seagull");
      if (!asset) break;
      const visual = createAnimatedVisual(
        asset,
        { targetSize: 1.4, measureAxis: "x", pitch: -Math.PI / 2, castShadow: false },
      );
      visual.model.name = `Rigged_Seagull_${index + 1}`;
      // Fourteen flat-coloured parts become one mesh: one draw call and one
      // bone upload per bird instead of fourteen.
      const merged = mergeSkinnedParts(visual.model);
      if (merged) {
        // The source is faceted low-poly; rounded shading reads as feathers.
        smoothNormalsByPosition(merged.geometry);
        this.owned.push({ geometry: merged.geometry, material: merged.material as THREE.Material });
      }
      const flapClip = visual.clips.find((clip) => /^flap$/i.test(clip.name));
      const glideClip = visual.clips.find((clip) => /planer|glide/i.test(clip.name));
      let flap: THREE.AnimationAction | undefined;
      let glide: THREE.AnimationAction | undefined;
      if (visual.mixer && flapClip) {
        flap = visual.mixer.clipAction(flapClip).reset().play();
        flap.timeScale = 0;
      }
      if (visual.mixer && glideClip) {
        glide = visual.mixer.clipAction(glideClip).reset().play();
        glide.time = Math.random() * Math.max(0.01, glideClip.duration);
        glide.setEffectiveWeight(0);
      }
      const root = new THREE.Group();
      root.name = `Seagull_Flight_Root_${index + 1}`;
      root.rotation.order = "YXZ";
      root.add(visual.model);
      group.add(root);
      root.updateMatrixWorld(true);
      const wingJoints = findWingJoints(visual.model, root);
      this.gulls.push({
        root,
        visual,
        center: new THREE.Vector3(),
        radius: 24 + index * 3.4 + Math.random() * 7,
        direction: index % 2 === 0 ? 1 : -1,
        heading: index * 1.3,
        altitude: 12 + index * 1.25 + Math.random() * 4,
        speed: 7 + Math.random() * 3.5,
        age: 0,
        phase: index * 1.7 + Math.random(),
        flap,
        flapCycle: flap && visual.mixer ? measureBeatCycle(visual.mixer, flap, visual.model) : { start: 0, length: 1 },
        flapPhase: Math.random(),
        wingJoints,
        glide,
        initialized: false,
      });
    }
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    this.gulls.forEach((gull, index) => {
      if (!gull.initialized) this.initialize(gull, physics, index);
      if (gull.root.position.distanceToSquared(physics.position) > 190 * 190) {
        gull.initialized = false;
        this.initialize(gull, physics, index);
      }
      gull.age += delta;
      gull.center.lerp(physics.position, 1 - Math.exp(-0.06 * delta));

      const offsetX = gull.root.position.x - gull.center.x;
      const offsetZ = gull.root.position.z - gull.center.z;
      const radialAngle = Math.atan2(offsetX, offsetZ);
      const tangentHeading = radialAngle + gull.direction * Math.PI * 0.5;
      const radialError = Math.hypot(offsetX, offsetZ) - gull.radius;
      const desiredHeading = tangentHeading + gull.direction * THREE.MathUtils.clamp(radialError * 0.045, -0.42, 0.42);
      gull.heading = dampAngle(gull.heading, desiredHeading, 2.1, delta);
      gull.root.position.x += Math.sin(gull.heading) * gull.speed * delta;
      gull.root.position.z += Math.cos(gull.heading) * gull.speed * delta;
      gull.root.position.y = gull.altitude + Math.sin(gull.age * 0.34 + gull.phase) * 1.8;

      // Mostly working flight with short glides: a gull is rarely still in the air.
      const glide = THREE.MathUtils.smoothstep(Math.sin(gull.age * 0.42 + gull.phase), 0.35, 0.9) * 0.85;
      if (gull.flap) {
        // The clip is driven by its own beat phase: about two beats a second,
        // a little slower as the bird eases into a glide.
        gull.flapPhase = (gull.flapPhase + delta * GULL_BEAT_FREQUENCY * (1 - glide * 0.35)) % 1;
        gull.flap.time = gull.flapCycle.start + gull.flapPhase * gull.flapCycle.length;
        gull.flap.setEffectiveWeight(1 - glide * 0.7);
      }
      gull.glide?.setEffectiveWeight(glide);
      if (animationDelta > 0) {
        gull.visual.mixer?.update(animationDelta);
        gull.wingJoints.forEach(({ joint }) => joint.capture());
      }
      // A full up-and-down stroke from the shoulder on top of the clip, with
      // the hand following a beat later; mostly stilled while gliding.
      const stroke = Math.PI * 2 * gull.flapPhase;
      const strength = 1 - glide * 0.85;
      gull.wingJoints.forEach(({ joint, side, elbow }) => {
        joint.restore();
        const angle = elbow
          ? Math.sin(stroke - 0.9) * GULL_HAND_SWING * strength
          : (Math.sin(stroke) * GULL_SHOULDER_SWING + 0.08) * strength;
        joint.rotate("roll", side * angle);
      });
      gull.root.rotation.y = gull.heading;
      gull.root.rotation.x = Math.sin(gull.age * 0.21 + gull.phase) * 0.035;
      gull.root.rotation.z = -gull.direction * (0.16 + Math.abs(radialError) * 0.005);
    });
  }

  dispose(): void {
    this.gulls.forEach((gull) => {
      gull.visual.mixer?.stopAllAction();
      this.group.remove(gull.root);
    });
    this.gulls.length = 0;
    this.owned.forEach(({ geometry, material }) => {
      geometry.dispose();
      material.dispose();
    });
    this.owned.length = 0;
  }

  private initialize(gull: Gull, physics: VesselPhysics, index: number): void {
    gull.center.copy(physics.position).add(new THREE.Vector3(index % 2 === 0 ? 18 : -18, 0, 25));
    const angle = index / Math.max(1, this.gulls.length) * Math.PI * 2;
    gull.root.position.set(
      gull.center.x + Math.sin(angle) * gull.radius,
      gull.altitude,
      gull.center.z + Math.cos(angle) * gull.radius,
    );
    gull.heading = angle + gull.direction * Math.PI * 0.5;
    gull.root.rotation.y = gull.heading;
    gull.initialized = true;
  }
}
