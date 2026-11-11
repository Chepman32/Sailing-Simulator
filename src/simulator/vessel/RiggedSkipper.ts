import * as THREE from "three";
import { RiggedFigure } from "../economy/RiggedFigure";
import { createLeapPose, leapPose, type LeapPose } from "../diver/LeapMath";
import { stepSkipperLean, type LeanState, type SkipperStand } from "./Skipper";

/** The hands hold the rim at about ten and two; they ride the wheel this far before sliding. */
const GRIP_OFFSET = 0.95;
const MAX_HAND_RIDE = 0.8;

type GestureKind = "cap" | "shade" | "wave" | "lookBack";
type Gesture = { kind: GestureKind; start: number; duration: number; side: "Left" | "Right" };

function envelope(t: number, duration: number): number {
  if (t <= 0 || t >= duration) return 0;
  const k = Math.min(1, t / 0.5, (duration - t) / 0.55);
  return k * k * (3 - 2 * k);
}

function random(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The skipper at the wheel as the rigged character model (the same man as
 * the island trader, `trader-man.glb`), posed procedurally like the traders
 * (`RiggedFigure`): both hands on the rim riding the wheel, feet planted on
 * the deck by leg IK and the knees giving to the heave, his weight shifting
 * from foot to foot, a balance spring against the heel, breathing, quick
 * glances that settle (ahead, up at the sail, along the horizon, down at the
 * instruments) and now and then a gesture: a hand to the brow, shading the
 * eyes, a wave, a look astern. Over the side he springs, tucks and dives
 * (`LeapMath`), seen from his own eyes with his head folded away.
 *
 * The same face to the vessel as the procedural `Skipper`, which stands in
 * when the model is missing.
 */
export class RiggedSkipper {
  private readonly rig: RiggedFigure;
  private readonly lean: LeanState = { lean: 0, velocity: 0 };
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private readonly rim = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private gazeYaw = 0;
  private gazePitch = 0;
  private gazeTargetYaw = 0;
  private gazeTargetPitch = 0;
  private nextGaze = 1.5;
  private gesture: Gesture | null = null;
  private nextGesture = 12;
  private gestureCount = 0;
  private lastY = Number.NaN;
  private heaveVelocity = 0;
  private dip = 0;
  private leapTime: number | null = null;
  private readonly leapState: LeapPose = createLeapPose();
  /** The figure's own size against a 1.8 m man, for distances in its frame. */
  private readonly s: number;

  constructor(
    private readonly vesselRoot: THREE.Object3D,
    private readonly stand: SkipperStand,
    model: THREE.Object3D,
  ) {
    // Measured once at its own size, then scaled so his eyes are where the helm camera is.
    const probe = new RiggedFigure(model);
    const eyes = probe.restPoint.get("Head")!.y + probe.height * 0.045;
    probe.root.remove(model);
    model.scale.multiplyScalar(stand.eyeHeight / eyes);
    model.updateMatrixWorld(true);
    this.rig = new RiggedFigure(model);
    this.s = this.rig.height / 1.8;
    this.rig.root.name = "Skipper_At_Helm";
    this.rig.root.position.copy(stand.feet);
    vesselRoot.add(this.rig.root);
  }

  /** The figure itself (for the screen-size levels of detail). */
  get object(): THREE.Object3D {
    return this.rig.root;
  }

  get visible(): boolean {
    return this.rig.root.visible;
  }

  set visible(value: boolean) {
    this.rig.root.visible = value;
  }

  leap(t: number | null): void {
    if (t === null) {
      if (this.leapTime !== null) {
        this.leapTime = null;
        this.rig.root.position.copy(this.stand.feet);
        this.rig.root.rotation.set(0, 0, 0);
      }
      return;
    }
    this.leapTime = t;
  }

  get leapTurn(): number {
    return this.leapTime === null ? 0 : this.leapState.turn;
  }

  get leapPoseNow(): Readonly<LeapPose> {
    return this.leapState;
  }

  /** His eyes in the world (call after `update`). */
  eyes(out: THREE.Vector3): THREE.Vector3 {
    const head = this.rig.bone("Head");
    head.getWorldPosition(out);
    const s = this.s;
    return out
      .addScaledVector(this.rig.axis(0, 1, 0, this.world), 0.075 * s)
      .addScaledVector(this.rig.axis(0, 0, 1, this.local), 0.1 * s);
  }

  update(time: number, delta: number, heel: number, pitch: number, yawRate: number, forwardSpeed: number, _apparentWind = 6): void {
    if (!this.rig.root.visible) return;
    if (this.leapTime !== null) {
      this.poseLeap(this.leapTime);
      return;
    }
    const rig = this.rig;
    const step = Math.min(0.05, Math.max(0, delta));
    const s = this.s;
    rig.resetPose();
    const up = this.up;
    const forward = rig.axis(0, 0, 1, this.forward);
    const left = rig.axis(1, 0, 0, this.left);

    // --- Balance, heave and weight -------------------------------------------
    const turnLoad = Math.max(-0.1, Math.min(0.1, -yawRate * Math.abs(forwardSpeed) * 0.05));
    const lean = stepSkipperLean(this.lean, heel, turnLoad, step);
    this.vesselRoot.getWorldPosition(this.world);
    if (Number.isNaN(this.lastY) || step <= 0) {
      this.lastY = this.world.y;
    } else {
      const velocity = (this.world.y - this.lastY) / step;
      const acceleration = (velocity - this.heaveVelocity) / step;
      this.heaveVelocity = velocity;
      this.lastY = this.world.y;
      const wanted = Math.max(-0.05, Math.min(0.05, -acceleration * 0.006));
      this.dip += (wanted - this.dip) * Math.min(1, step * 6);
    }
    const shift = Math.sin(time * 0.6 + Math.sin(time * 0.17) * 1.5);
    const breath = Math.sin(time * 1.5);
    this.offset.copy(left).multiplyScalar(shift * 0.028 * s).addScaledVector(up, (Math.min(0, this.dip) - 0.012 - Math.abs(shift) * 0.008) * s);
    rig.shiftBone("Hips", this.offset);
    // The upper body counters the heel and pitch; the hips sway over the loaded foot.
    rig.turnBone("Hips", forward, lean * 0.55 + shift * 0.04);
    rig.turnBone("Hips", left, -pitch * 0.4 + 0.02);
    rig.turnBone("Spine02", forward, lean * 0.3 - shift * 0.03);
    rig.turnBone("Spine02", left, 0.05 + forwardSpeed * 0.003);
    rig.turnBone("Spine01", left, breath * 0.012);
    rig.turnBone("Spine", forward, lean * 0.12);

    // --- Gestures ---------------------------------------------------------------
    if (!this.gesture && time >= this.nextGesture) {
      this.gestureCount += 1;
      const roll = random(this.gestureCount * 3.1 + 0.7);
      const kind: GestureKind = roll < 0.3 ? "cap" : roll < 0.55 ? "shade" : roll < 0.75 ? "wave" : "lookBack";
      const side = random(this.gestureCount * 5.3 + 1.1) < 0.5 ? "Left" : "Right";
      this.gesture = { kind, start: time, duration: kind === "wave" ? 2.6 : kind === "lookBack" ? 2.8 : 2.1, side };
    }
    let weight = 0;
    const gesture = this.gesture;
    if (gesture) {
      const t = time - gesture.start;
      weight = envelope(t, gesture.duration);
      if (t >= gesture.duration || t < 0) {
        this.gesture = null;
        this.nextGesture = time + 16 + random(this.gestureCount * 7.7) * 20;
      }
    }

    // --- Gaze ----------------------------------------------------------------------
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
      yawGoal += (gesture.side === "Left" ? 1 : -1) * 1.9 * weight;
      pitchGoal *= 1 - weight;
    } else if (gesture?.kind === "shade") {
      yawGoal = yawGoal * (1 - weight) + (gesture.side === "Left" ? 0.4 : -0.4) * weight;
      pitchGoal = pitchGoal * (1 - weight) - 0.05 * weight;
    } else if (gesture?.kind === "cap") {
      pitchGoal += 0.18 * weight;
    }
    const ease = 1 - Math.exp(-step * 7);
    this.gazeYaw += (yawGoal - this.gazeYaw) * ease;
    this.gazePitch += (pitchGoal - this.gazePitch) * ease;
    // Pitch: positive looks down (about his left axis).
    rig.turnBone("Spine", up, Math.max(-0.45, Math.min(0.45, this.gazeYaw * 0.22)));
    rig.turnBone("neck", up, this.gazeYaw * 0.32);
    rig.turnBone("Head", up, this.gazeYaw * 0.46);
    rig.turnBone("neck", rig.axis(1, 0, 0, this.local), this.gazePitch * 0.4 - 0.02);
    rig.turnBone("Head", rig.axis(1, 0, 0, this.local), this.gazePitch * 0.6);
    rig.turnBone("Head", rig.axis(0, 0, 1, this.local), -lean * 0.15 + Math.sin(time * 0.37) * 0.02);

    // --- Legs: soles flat on the deck --------------------------------------------
    this.plantFeet(0, 0);

    // --- Arms: on the wheel, unless one is busy with a gesture ---------------------
    this.gripPoints();
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      this.target.copy(this.rimFor(side));
      const shoulder = rig.restPoint.get(`${side}Arm`)!;
      // Elbows out and down, behind the hands.
      this.local.set(shoulder.x + sign * 0.55 * s, shoulder.y - 0.45 * s, shoulder.z - 0.35 * s);
      rig.toWorld(this.local, this.pole);
      if (gesture && gesture.side === side && gesture.kind !== "lookBack" && weight > 0) {
        this.gestureHand(gesture, side, time, this.world);
        this.target.lerp(this.world, weight);
        this.local.set(shoulder.x + sign * 0.5 * s, shoulder.y - 0.15 * s, shoulder.z - 0.3 * s);
        rig.toWorld(this.local, this.world);
        this.pole.lerp(this.world, weight);
      }
      rig.solveLimb(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, this.target, this.pole);
    }
  }

  /** The two grip points on the rim, riding the wheel as it turns. */
  private gripPoints(): void {
    const ride = Math.max(-MAX_HAND_RIDE, Math.min(MAX_HAND_RIDE, this.stand.wheelAngle()));
    this.stand.rimPoint(Math.PI / 2 + GRIP_OFFSET + ride, this.rim[0]!);
    this.stand.rimPoint(Math.PI / 2 - GRIP_OFFSET + ride, this.rim[1]!);
  }

  /** The rim point on his left (+X of the vessel, as he faces the bow) or right side. */
  private rimFor(side: "Left" | "Right"): THREE.Vector3 {
    const firstX = this.vesselRoot.worldToLocal(this.local.copy(this.rim[0]!)).x;
    const secondX = this.vesselRoot.worldToLocal(this.local.copy(this.rim[1]!)).x;
    const leftIndex = firstX >= secondX ? 0 : 1;
    return this.rim[side === "Left" ? leftIndex : 1 - leftIndex]!;
  }

  /** Feet where they stand at rest (lifted `lift`, drawn forward `tuck`, in his frame). */
  private plantFeet(lift: number, tuck: number): void {
    const rig = this.rig;
    const s = this.s;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      const foot = rig.restPoint.get(`${side}Foot`)!;
      this.local.set(foot.x + sign * 0.02 * s, foot.y + lift, foot.z + tuck);
      rig.toWorld(this.local, this.target);
      const knee = rig.restPoint.get(`${side}Leg`)!;
      this.local.set(knee.x + sign * 0.05 * s, knee.y, knee.z + 0.6);
      rig.toWorld(this.local, this.pole);
      rig.solveLimb(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, this.target, this.pole);
      rig.levelFoot(`${side}Foot`);
    }
  }

  private gestureHand(gesture: Gesture, side: "Left" | "Right", time: number, out: THREE.Vector3): void {
    const sign = side === "Left" ? 1 : -1;
    const s = this.s;
    const rig = this.rig;
    if (gesture.kind === "wave") {
      // High and out to the side, waving from the elbow.
      const shoulder = rig.restPoint.get(`${side}Arm`)!;
      this.local.set(shoulder.x + sign * (0.22 + Math.sin(time * 8.5) * 0.07) * s, shoulder.y + 0.42 * s, shoulder.z + 0.12 * s);
      rig.toWorld(this.local, out);
      return;
    }
    // A hand to the brow (to the cap's peak, or flat over the eyes against the glare).
    rig.bone("Head").getWorldPosition(out);
    out.addScaledVector(rig.axis(0, 1, 0, this.local), (gesture.kind === "cap" ? 0.11 : 0.08) * s);
    out.addScaledVector(rig.axis(0, 0, 1, this.local), 0.13 * s);
    out.addScaledVector(rig.axis(1, 0, 0, this.local), sign * 0.03 * s);
  }

  /** A moment of the leap over the side (see `LeapMath`). */
  private poseLeap(t: number): void {
    const rig = this.rig;
    const s = this.s;
    const pose = leapPose(t, this.leapState);
    const { feet } = this.stand;
    rig.root.position.set(feet.x + pose.x, feet.y + pose.y, feet.z + pose.z);
    rig.root.rotation.set(0, pose.turn, 0);
    rig.resetPose();
    const up = this.up;
    const forward = rig.axis(0, 0, 1, this.forward);
    const left = rig.axis(1, 0, 0, this.left);
    // Knees bend for the spring, he leans into it, then stretches.
    this.offset.copy(up).multiplyScalar(-pose.crouch * 0.3 * s);
    rig.shiftBone("Hips", this.offset);
    rig.turnBone("Hips", left, pose.crouch * 0.38 - Math.max(0, pose.arms) * 0.06);
    rig.turnBone("Spine02", left, pose.crouch * 0.22);
    rig.turnBone("Spine02", up, pose.lookYaw * 0.3);
    rig.turnBone("Spine01", left, pose.crouch * 0.1);
    rig.turnBone("Spine01", up, pose.lookYaw * 0.2);
    rig.turnBone("neck", rig.axis(1, 0, 0, this.local), -pose.lookPitch * 0.35);
    rig.turnBone("neck", up, pose.lookYaw * 0.3);
    rig.turnBone("Head", rig.axis(1, 0, 0, this.local), -pose.lookPitch * 0.5);
    rig.turnBone("Head", up, pose.lookYaw * 0.4);
    void forward;
    // Seen from his own eyes: the head folded away so it never fills the view.
    const head = rig.bone("Head");
    head.scale.setScalar(0.001);
    head.updateMatrixWorld(true);
    // Legs: soles on the deck, or drawn up in the air.
    this.plantFeet(pose.tuck * 0.42 * s, pose.tuck * 0.28 * s);
    // Arms: off the rim, at his sides, back for the spring, up as he goes.
    this.gripPoints();
    const swing = pose.arms;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      const shoulder = rig.restPoint.get(`${side}Arm`)!;
      const atSide = this.world.set(shoulder.x + sign * 0.04 * s, shoulder.y - 0.55 * s, shoulder.z + 0.06 * s);
      if (swing < 0) atSide.lerp(this.local.set(shoulder.x + sign * 0.02 * s, shoulder.y - 0.45 * s, shoulder.z - 0.45 * s), -swing);
      else atSide.lerp(this.local.set(shoulder.x, shoulder.y + 0.55 * s, shoulder.z + 0.1 * s), swing);
      const lift = Math.sin(pose.release * Math.PI) * (1 - Math.abs(swing));
      atSide.y += lift * 0.3 * s;
      atSide.z += lift * 0.12 * s;
      rig.toWorld(atSide, this.offset);
      this.target.copy(this.rimFor(side)).lerp(this.offset, pose.release);
      this.local.set(shoulder.x + sign * 0.6 * s, shoulder.y - 0.3 * s, shoulder.z - 0.45 * s);
      rig.toWorld(this.local, this.pole);
      rig.solveLimb(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, this.target, this.pole);
    }
    rig.root.updateMatrixWorld(true);
  }

  dispose(): void {
    this.rig.dispose();
  }
}
