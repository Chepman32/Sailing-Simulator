import * as THREE from "three";
import { FOREARM_LENGTH, HumanFigure, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM_LENGTH } from "./HumanFigure";
import { createLeapPose, leapPose, type LeapPose } from "../diver/LeapMath";

/** Where the skipper stands and what he holds, from the helm station (vessel space). */
export type SkipperStand = {
  /** Feet on the deck, centred behind the wheel. */
  feet: THREE.Vector3;
  /** Metres from the deck to his eyes (the helm camera sits there). */
  eyeHeight: number;
  /** Rim point of the wheel in the world, at an angle in the wheel mount's frame. */
  rimPoint: (angle: number, target: THREE.Vector3) => THREE.Vector3;
  /** Current wheel turn, radians (positive = anticlockwise in the mount frame). */
  wheelAngle: () => number;
};

/** The skipper's own height scale: his eyes are about 1.68 m up at scale 1. */
const FIGURE_EYE_HEIGHT = 1.68;
/** The hands hold the rim at about ten and two; they ride the wheel this far before sliding. */
const GRIP_OFFSET = 0.95;
const MAX_HAND_RIDE = 0.8;
/** Radians of lean at most, either way. */
const MAX_LEAN = 0.42;

export type LeanState = { lean: number; velocity: number };

/**
 * Damped spring for the skipper's balance. The target counter-rotates the
 * yacht's heel so his upper body stays near the vertical; the spring adds the
 * small lag and overshoot a person shows when the boat rolls.
 */
export function stepSkipperLean(state: LeanState, heel: number, turnLoad: number, delta: number): number {
  const target = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, heel * 0.82 + turnLoad));
  const stiffness = 26;
  const damping = 6.5;
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const step = delta / steps;
  for (let index = 0; index < steps; index += 1) {
    state.velocity += (stiffness * (target - state.lean) - damping * state.velocity) * step;
    state.lean += state.velocity * step;
  }
  state.lean = Math.max(-0.5, Math.min(0.5, state.lean));
  return state.lean;
}

/** Something the skipper does now and then with a hand off the wheel, or a look astern. */
type GestureKind = "cap" | "shade" | "wave" | "lookBack";
type Gesture = { kind: GestureKind; start: number; duration: number; side: "L" | "R" };

/** Weight of a gesture at `t` seconds into it: eases in, holds, eases out. */
function envelope(t: number, duration: number): number {
  if (t <= 0 || t >= duration) return 0;
  const rise = Math.min(1, t / 0.5);
  const fall = Math.min(1, (duration - t) / 0.55);
  const k = Math.min(rise, fall);
  return k * k * (3 - 2 * k);
}

/** Small deterministic generator, so a session's skipper is not a metronome. */
function random(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The skipper at the wheel, alive: both hands on the rim (riding the wheel
 * as it turns, sliding when it turns far), feet planted on the deck through
 * leg IK, knees giving to the yacht's heave, the weight shifting from foot to
 * foot, a balance spring against the heel, breathing, quick glances that
 * settle (ahead, up at the sails, along the horizon, down at the
 * instruments), and now and then a gesture: a hand to the cap's peak, a hand
 * shading the eyes, a wave, a look back over the shoulder. His shirt and
 * shorts flutter in the apparent wind. One skinned mesh, one draw call.
 */
export class Skipper {
  readonly figure = new HumanFigure();
  private readonly lean: LeanState = { lean: 0, velocity: 0 };
  private readonly scale: number;
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly localPoint = new THREE.Vector3();
  private readonly rim = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly gestureTarget = new THREE.Vector3();
  private readonly worldScratch = new THREE.Vector3();
  private readonly rootQuaternion = new THREE.Quaternion();
  private readonly parentQuaternion = new THREE.Quaternion();
  /** Gaze, radians: yaw (left +) and pitch (down +), eased toward a chosen point. */
  private gazeYaw = 0;
  private gazePitch = 0;
  private gazeTargetYaw = 0;
  private gazeTargetPitch = 0;
  private nextGaze = 1.5;
  private gesture: Gesture | null = null;
  private nextGesture = 14;
  private gestureCount = 0;
  /** Heave: the deck's vertical speed and acceleration, for the knees. */
  private lastY = Number.NaN;
  private heaveVelocity = 0;
  private dip = 0;
  /** Seconds into a leap over the side (first person), or null at the wheel. */
  private leapTime: number | null = null;
  private readonly leapState: LeapPose = createLeapPose();
  private readonly freeHand = new THREE.Vector3();

  constructor(private readonly root: THREE.Object3D, private readonly stand: SkipperStand) {
    this.scale = stand.eyeHeight / FIGURE_EYE_HEIGHT;
    const mesh = this.figure.mesh;
    mesh.name = "Skipper_At_Helm";
    mesh.scale.setScalar(this.scale);
    // The figure's origin is at its soles (hips 0.96 m up at scale 1); a hair
    // lower so the knees give a little under the leg IK.
    mesh.position.set(stand.feet.x, stand.feet.y - 0.03 * this.scale, stand.feet.z);
    // Stands facing the bow (+Z), the way the wheel faces him.
    root.add(mesh);
  }

  get visible(): boolean {
    return this.figure.mesh.visible;
  }

  set visible(value: boolean) {
    this.figure.mesh.visible = value;
  }

  /**
   * Plays the leap over the side `t` seconds in (see `LeapMath`), or with
   * null puts him back at the wheel. While leaping the player looks out of
   * his eyes: the head is folded away so it never fills the view, and the
   * rest of him (hands, arms, chest, legs) is seen as one's own body.
   */
  leap(t: number | null): void {
    const head = this.figure.bone("head");
    if (t === null) {
      if (this.leapTime !== null) {
        this.leapTime = null;
        head.scale.setScalar(1);
        const mesh = this.figure.mesh;
        mesh.position.set(this.stand.feet.x, this.stand.feet.y - 0.03 * this.scale, this.stand.feet.z);
        mesh.rotation.set(0, 0, 0);
      }
      return;
    }
    this.leapTime = t;
    head.scale.setScalar(0.001);
  }

  /** His body's heading in the leap, radians from the bow (0 at the wheel). */
  get leapTurn(): number {
    return this.leapTime === null ? 0 : this.leapState.turn;
  }

  /** The leap pose now (valid while leaping). */
  get leapPoseNow(): Readonly<LeapPose> {
    return this.leapState;
  }

  /** Where his eyes are, in the world (call after `update`). */
  eyes(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0.16, 0.13);
    return this.figure.bone("neck").localToWorld(out);
  }

  update(time: number, delta: number, heel: number, pitch: number, yawRate: number, forwardSpeed: number, apparentWind = 6): void {
    if (!this.figure.mesh.visible) return;
    if (this.leapTime !== null) {
      this.poseLeap(this.leapTime, time, apparentWind);
      return;
    }
    const figure = this.figure;
    const step = Math.min(0.05, Math.max(0, delta));
    figure.uniforms.uFigureTime.value = time;
    figure.uniforms.uFigureWind.value = Math.min(1.4, Math.max(0.15, apparentWind / 9));
    figure.resetPose();

    // --- Balance, heave and weight ---------------------------------------------
    const turnLoad = Math.max(-0.1, Math.min(0.1, -yawRate * Math.abs(forwardSpeed) * 0.05));
    const lean = stepSkipperLean(this.lean, heel, turnLoad, step);
    this.root.getWorldPosition(this.worldScratch);
    if (Number.isNaN(this.lastY) || step <= 0) {
      this.lastY = this.worldScratch.y;
    } else {
      const velocity = (this.worldScratch.y - this.lastY) / step;
      const acceleration = (velocity - this.heaveVelocity) / step;
      this.heaveVelocity = velocity;
      this.lastY = this.worldScratch.y;
      // The knees soak up the deck rising under him, then stand tall again.
      const wanted = Math.max(-0.05, Math.min(0.05, -acceleration * 0.006));
      this.dip += (wanted - this.dip) * Math.min(1, step * 6);
    }
    // Weight from foot to foot every ten seconds or so, hips swaying with it.
    const shift = Math.sin(time * 0.6 + Math.sin(time * 0.17) * 1.5) * 0.022;
    const hips = figure.bone("hips");
    hips.position.set(shift, 0.96 + Math.min(0, this.dip) - Math.abs(shift) * 0.25, 0);
    const breath = Math.sin(time * 1.5);
    hips.rotation.set(0.02 - pitch * 0.4, 0, lean * 0.55 - shift * 1.6);
    figure.bone("spine").rotation.set(0.07 + forwardSpeed * 0.004, Math.sin(time * 0.21) * 0.05, lean * 0.3 + shift * 1.1);
    figure.bone("chest").rotation.set(0.03 + breath * 0.014, 0, lean * 0.12 + shift * 0.4);
    figure.bone("clavicleL").rotation.set(0, 0, breath * 0.018);
    figure.bone("clavicleR").rotation.set(0, 0, -breath * 0.018);

    // --- Gestures ------------------------------------------------------------------
    if (!this.gesture && time >= this.nextGesture) {
      this.gestureCount += 1;
      const roll = random(this.gestureCount * 3.1 + 0.7);
      const kind: GestureKind = roll < 0.3 ? "cap" : roll < 0.55 ? "shade" : roll < 0.75 ? "wave" : "lookBack";
      const side = random(this.gestureCount * 5.3 + 1.1) < 0.5 ? "L" : "R";
      this.gesture = { kind, start: time, duration: kind === "wave" ? 2.6 : kind === "lookBack" ? 2.8 : 2.1, side };
    }
    let gestureWeight = 0;
    const gesture = this.gesture;
    if (gesture) {
      const t = time - gesture.start;
      gestureWeight = envelope(t, gesture.duration);
      if (t >= gesture.duration || t < 0) {
        this.gesture = null;
        this.nextGesture = time + 16 + random(this.gestureCount * 7.7) * 20;
      }
    }

    // --- Gaze: quick turns that settle, like a person keeping watch -----------------
    if (time >= this.nextGaze) {
      const pick = random(Math.floor(time * 10) * 0.37 + 2.3);
      const spread = random(Math.floor(time * 10) * 0.71 + 5.9) - 0.5;
      if (pick < 0.35) [this.gazeTargetYaw, this.gazeTargetPitch] = [spread * 0.3, 0.02];
      else if (pick < 0.55) [this.gazeTargetYaw, this.gazeTargetPitch] = [0.35 + spread * 0.3, -0.42];
      else if (pick < 0.85) [this.gazeTargetYaw, this.gazeTargetPitch] = [Math.sign(spread || 1) * (0.55 + Math.abs(spread) * 0.6), 0.0];
      else [this.gazeTargetYaw, this.gazeTargetPitch] = [spread * 0.2, 0.32];
      this.nextGaze = time + 1.6 + random(time * 1.3) * 3.8;
    }
    let yawGoal = this.gazeTargetYaw;
    let pitchGoal = this.gazeTargetPitch;
    if (gesture?.kind === "lookBack") {
      yawGoal += (gesture.side === "L" ? 1 : -1) * 1.9 * gestureWeight;
      pitchGoal *= 1 - gestureWeight;
    } else if (gesture?.kind === "shade") {
      yawGoal = yawGoal * (1 - gestureWeight) + (gesture.side === "L" ? 0.4 : -0.4) * gestureWeight;
      pitchGoal = pitchGoal * (1 - gestureWeight) - 0.05 * gestureWeight;
    } else if (gesture?.kind === "cap") {
      pitchGoal += 0.18 * gestureWeight;
    }
    // A head turns fast and settles: a stiff, well-damped approach.
    const ease = 1 - Math.exp(-step * 7);
    this.gazeYaw += (yawGoal - this.gazeYaw) * ease;
    this.gazePitch += (pitchGoal - this.gazePitch) * ease;
    const twist = Math.max(-0.45, Math.min(0.45, this.gazeYaw * 0.22));
    const spine = figure.bone("spine");
    spine.rotation.y += twist;
    figure.bone("neck").rotation.set(-0.04 + this.gazePitch * 0.4, this.gazeYaw * 0.32, -lean * 0.15);
    figure.bone("head").rotation.set(-0.03 + this.gazePitch * 0.6, this.gazeYaw * 0.46, Math.sin(time * 0.37) * 0.02);

    // --- Legs: soles flat on the deck ---------------------------------------------
    this.root.updateMatrixWorld(true);
    const { feet } = this.stand;
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      this.target.set(feet.x + sign * 0.14, feet.y + 0.04 * this.scale, feet.z + 0.04);
      this.pole.set(feet.x + sign * 0.2, feet.y + 0.5 * this.scale, feet.z + 0.8);
      this.root.localToWorld(this.target);
      this.root.localToWorld(this.pole);
      figure.solveTwoBone(`thigh${side}`, `shin${side}`, THIGH_LENGTH * this.scale, SHIN_LENGTH * this.scale, this.target, this.pole);
      this.levelFoot(side);
    }

    // --- Arms: on the wheel, unless one is busy with a gesture --------------------
    const ride = Math.max(-MAX_HAND_RIDE, Math.min(MAX_HAND_RIDE, this.stand.wheelAngle()));
    this.stand.rimPoint(Math.PI / 2 + GRIP_OFFSET + ride, this.rim[0]!);
    this.stand.rimPoint(Math.PI / 2 - GRIP_OFFSET + ride, this.rim[1]!);
    // The left hand (+X side of the figure) takes whichever rim point is on that side.
    const firstX = this.root.worldToLocal(this.localPoint.copy(this.rim[0]!)).x;
    const secondX = this.root.worldToLocal(this.localPoint.copy(this.rim[1]!)).x;
    const leftIndex = firstX >= secondX ? 0 : 1;
    figure.mesh.updateMatrixWorld(true);
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      this.target.copy(this.rim[side === "L" ? leftIndex : 1 - leftIndex]!);
      this.pole.set(feet.x + sign * 0.6, feet.y + 0.9 * this.scale, feet.z - 0.5);
      this.root.localToWorld(this.pole);
      let handTilt = 0;
      if (gesture && gesture.side === side && gesture.kind !== "lookBack" && gestureWeight > 0) {
        this.gestureHand(gesture, side, time);
        this.target.lerp(this.gestureTarget, gestureWeight);
        // Elbow out and down while the hand is up.
        this.localPoint.set(sign * 0.55, 1.05, -0.25);
        figure.mesh.localToWorld(this.localPoint);
        this.pole.lerp(this.localPoint, gestureWeight);
        handTilt = gestureWeight;
      }
      figure.solveTwoBone(`upperArm${side}`, `forearm${side}`, UPPER_ARM_LENGTH * this.scale, FOREARM_LENGTH * this.scale, this.target, this.pole);
      figure.bone(`hand${side}`).rotation.set(0.3 - handTilt * 1.2, 0, sign * (0.4 - handTilt * 0.3));
    }
  }

  /** The figure posed for a moment of the leap over the side. */
  private poseLeap(t: number, time: number, apparentWind: number): void {
    const figure = this.figure;
    const mesh = figure.mesh;
    const pose = leapPose(t, this.leapState);
    figure.uniforms.uFigureTime.value = time;
    figure.uniforms.uFigureWind.value = Math.min(1.4, Math.max(0.15, apparentWind / 9));
    figure.resetPose();
    const { feet } = this.stand;
    mesh.position.set(feet.x + pose.x, feet.y + pose.y - 0.03 * this.scale, feet.z + pose.z);
    mesh.rotation.set(0, pose.turn, 0);

    // The body: knees bend for the spring, he leans into it, then stretches.
    const hips = figure.bone("hips");
    hips.position.set(0, 0.96 - pose.crouch * 0.3, 0);
    hips.rotation.set(pose.crouch * 0.38 - Math.max(0, pose.arms) * 0.06, 0, 0);
    figure.bone("spine").rotation.set(0.07 + pose.crouch * 0.22, pose.lookYaw * 0.3, 0);
    figure.bone("chest").rotation.set(0.03 + pose.crouch * 0.1, pose.lookYaw * 0.2, 0);
    figure.bone("neck").rotation.set(-pose.lookPitch * 0.35, pose.lookYaw * 0.3, 0);
    figure.bone("head").rotation.set(-pose.lookPitch * 0.5, pose.lookYaw * 0.4, 0);
    mesh.updateMatrixWorld(true);

    // Legs: soles on the deck (or drawn up in the air).
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      this.target.set(sign * 0.12, 0.04 + pose.tuck * 0.42, 0.04 + pose.tuck * 0.28);
      this.pole.set(sign * 0.18, 0.5, 0.9);
      mesh.localToWorld(this.target);
      mesh.localToWorld(this.pole);
      figure.solveTwoBone(`thigh${side}`, `shin${side}`, THIGH_LENGTH * this.scale, SHIN_LENGTH * this.scale, this.target, this.pole);
      this.levelFoot(side);
    }

    // Arms: off the rim, then at his sides, back for the spring, up as he goes.
    const ride = Math.max(-MAX_HAND_RIDE, Math.min(MAX_HAND_RIDE, this.stand.wheelAngle()));
    this.stand.rimPoint(Math.PI / 2 + GRIP_OFFSET + ride, this.rim[0]!);
    this.stand.rimPoint(Math.PI / 2 - GRIP_OFFSET + ride, this.rim[1]!);
    const firstX = this.root.worldToLocal(this.localPoint.copy(this.rim[0]!)).x;
    const secondX = this.root.worldToLocal(this.localPoint.copy(this.rim[1]!)).x;
    const leftIndex = firstX >= secondX ? 0 : 1;
    const swing = pose.arms;
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      // Where a free hand goes (figure space).
      if (swing < 0) {
        this.freeHand.set(sign * 0.24, 0.86, 0.08).lerp(this.localPoint.set(sign * 0.21, 0.94 - pose.crouch * 0.12, -0.4), -swing);
      } else {
        this.freeHand.set(sign * 0.24, 0.86, 0.08).lerp(this.localPoint.set(sign * 0.24, 1.98, 0.16), swing);
      }
      // A hand just let go rises a little off the rim before it drops.
      // Hands just let go rise off the rim and open, drawn back toward the chest before they drop.
      const lift = Math.sin(pose.release * Math.PI) * (1 - Math.abs(swing));
      this.freeHand.y += lift * 0.3;
      this.freeHand.z += lift * 0.12;
      mesh.localToWorld(this.freeHand);
      this.target.copy(this.rim[side === "L" ? leftIndex : 1 - leftIndex]!).lerp(this.freeHand, pose.release);
      this.pole.set(sign * 0.6, 1.0, -0.45);
      mesh.localToWorld(this.pole);
      figure.solveTwoBone(`upperArm${side}`, `forearm${side}`, UPPER_ARM_LENGTH * this.scale, FOREARM_LENGTH * this.scale, this.target, this.pole);
      figure.bone(`hand${side}`).rotation.set(0.3 - Math.max(0, swing) * 0.6, 0, sign * 0.4);
    }
    mesh.updateMatrixWorld(true);
  }

  dispose(): void {
    this.root.remove(this.figure.mesh);
    this.figure.dispose();
  }

  /** Where the gesturing hand goes, in the world. */
  private gestureHand(gesture: Gesture, side: "L" | "R", time: number): void {
    const sign = side === "L" ? 1 : -1;
    const head = this.figure.bone("head");
    if (gesture.kind === "cap") {
      // Fingers to the cap's peak, a small tug.
      this.gestureTarget.set(sign * 0.03, 0.125 + Math.sin(time * 9) * 0.004, 0.15);
      head.localToWorld(this.gestureTarget);
    } else if (gesture.kind === "shade") {
      // The flat of the hand over the brow.
      this.gestureTarget.set(sign * 0.02, 0.115, 0.13);
      head.localToWorld(this.gestureTarget);
    } else {
      // A wave, high and out to the side.
      this.gestureTarget.set(sign * (0.36 + Math.sin(time * 8.5) * 0.07), 1.82, 0.12);
      this.figure.mesh.localToWorld(this.gestureTarget);
    }
  }

  /** Keep each sole flat on the deck whatever the leg bones do. */
  private levelFoot(side: "L" | "R"): void {
    const foot = this.figure.bone(`foot${side}`);
    this.root.getWorldQuaternion(this.rootQuaternion).invert();
    (foot.parent as THREE.Object3D).getWorldQuaternion(this.parentQuaternion);
    this.parentQuaternion.premultiply(this.rootQuaternion).invert();
    foot.quaternion.copy(this.parentQuaternion);
  }
}
