import * as THREE from "three";
import { FOREARM_LENGTH, HumanFigure, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM_LENGTH } from "./HumanFigure";

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

/**
 * The skipper at the wheel: both hands on the rim (riding the wheel as it
 * turns, sliding when it turns far), feet planted on the deck through leg IK,
 * a balance spring against the heel, a head that scans the horizon and the
 * sails, and slow breathing. One skinned mesh, so one draw call.
 */
export class Skipper {
  readonly figure = new HumanFigure();
  private readonly lean: LeanState = { lean: 0, velocity: 0 };
  private readonly scale: number;
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly localPoint = new THREE.Vector3();

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

  update(time: number, delta: number, heel: number, pitch: number, yawRate: number, forwardSpeed: number): void {
    if (!this.figure.mesh.visible) return;
    const figure = this.figure;
    figure.resetPose();
    const turnLoad = Math.max(-0.1, Math.min(0.1, -yawRate * Math.abs(forwardSpeed) * 0.05));
    const lean = stepSkipperLean(this.lean, heel, turnLoad, delta);
    const scan = Math.sin(time * 0.11) * 0.42 + Math.sin(time * 0.29 + 1.3) * 0.22;
    const lookUp = Math.pow(Math.max(0, Math.sin(time * 0.073 + 0.5)), 8) * 0.4;

    figure.bone("hips").rotation.set(0.02 - pitch * 0.4, 0, lean * 0.55);
    figure.bone("spine").rotation.set(0.07, Math.sin(time * 0.21) * 0.05, lean * 0.3);
    figure.bone("chest").rotation.set(0.03 + Math.sin(time * 1.55) * 0.012, 0, lean * 0.12);
    figure.bone("neck").rotation.set(-0.04, Math.max(-0.5, Math.min(0.5, scan * 0.45)), -lean * 0.15);
    figure.bone("head").rotation.set(-lookUp - 0.03, Math.max(-0.6, Math.min(0.6, scan * 0.55)), 0);

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

    const ride = Math.max(-MAX_HAND_RIDE, Math.min(MAX_HAND_RIDE, this.stand.wheelAngle()));
    const rimPoints: THREE.Vector3[] = [];
    for (const angle of [Math.PI / 2 + GRIP_OFFSET + ride, Math.PI / 2 - GRIP_OFFSET + ride]) {
      const point = this.stand.rimPoint(angle, new THREE.Vector3());
      rimPoints.push(point);
    }
    // The left hand (+X side of the figure) takes whichever rim point is on that side.
    const sideX = rimPoints.map((point) => this.root.worldToLocal(this.localPoint.copy(point)).x);
    const leftIndex = sideX[0]! >= sideX[1]! ? 0 : 1;
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      this.target.copy(rimPoints[side === "L" ? leftIndex : 1 - leftIndex]!);
      this.pole.set(feet.x + sign * 0.6, feet.y + 0.9 * this.scale, feet.z - 0.5);
      this.root.localToWorld(this.pole);
      figure.solveTwoBone(`upperArm${side}`, `forearm${side}`, UPPER_ARM_LENGTH * this.scale, FOREARM_LENGTH * this.scale, this.target, this.pole);
      figure.bone(`hand${side}`).rotation.set(0.3, 0, sign * 0.4);
    }
  }

  dispose(): void {
    this.root.remove(this.figure.mesh);
    this.figure.dispose();
  }

  /** Keep each sole flat on the deck whatever the leg bones do. */
  private levelFoot(side: "L" | "R"): void {
    const foot = this.figure.bone(`foot${side}`);
    const inverse = new THREE.Quaternion();
    const parent = new THREE.Quaternion();
    this.root.getWorldQuaternion(inverse).invert();
    (foot.parent as THREE.Object3D).getWorldQuaternion(parent);
    parent.premultiply(inverse).invert();
    foot.quaternion.copy(parent);
  }
}
