import * as THREE from "three";
import { clamp } from "../math";
import {
  FOREARM_LENGTH,
  HumanFigure,
  SHIN_LENGTH,
  THIGH_LENGTH,
  UPPER_ARM_LENGTH,
} from "./HumanFigure";

export type HelmGeometry = {
  /** Wheel hub in vessel space. The wheel turns about the vessel Z axis. */
  wheelCenter: THREE.Vector3;
  wheelRadius: number;
  /** Top of the helm seat cushion in vessel space. */
  seatTop: THREE.Vector3;
  /** Cockpit sole height under the helmsman's feet. */
  floorY: number;
};

/** Figure scale chosen to match the proportions of the normalised catamaran. */
export const HELMSMAN_SCALE = 0.9;
/** Hands follow the spokes up to this wheel angle, then slide along the rim. */
const MAX_HAND_TRAVEL = 0.75;
const FLARE_POSE_SECONDS = 2.6;

export type LeanState = { lean: number; velocity: number };

/**
 * Damped spring for the skipper's balance. The target counter-rotates the
 * yacht's heel so the upper body stays near vertical; the spring adds the small
 * lag and overshoot a seated person shows when the boat rolls.
 */
export function stepHelmsmanLean(state: LeanState, heel: number, turnLoad: number, delta: number): number {
  const target = clamp(heel * 0.82 + turnLoad, -0.42, 0.42);
  const stiffness = 26;
  const damping = 6.5;
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const step = delta / steps;
  for (let index = 0; index < steps; index += 1) {
    state.velocity += (stiffness * (target - state.lean) - damping * state.velocity) * step;
    state.lean += state.velocity * step;
  }
  state.lean = clamp(state.lean, -0.5, 0.5);
  return state.lean;
}

/**
 * Seated skipper at the starboard helm. Both hands hold the wheel rim and turn
 * with it, feet stay planted on the cockpit sole through leg IK, the torso
 * counter-leans against heel, the head scans the horizon and the sails, and
 * the right arm raises a flare pistol when a signal flare is fired.
 */
export class Helmsman {
  readonly figure = new HumanFigure();
  private readonly lean: LeanState = { lean: 0, velocity: 0 };
  private readonly pistol: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly meshInverse = new THREE.Quaternion();
  private readonly parentQuaternion = new THREE.Quaternion();
  private flareTimer = 0;
  private previousHeave = 0;
  private heaveNod = 0;

  constructor(private readonly root: THREE.Object3D, private readonly helm: HelmGeometry) {
    const mesh = this.figure.mesh;
    mesh.name = "Skipper_At_Helm";
    mesh.scale.setScalar(HELMSMAN_SCALE);
    mesh.position.set(helm.seatTop.x, helm.seatTop.y + 0.075 - 0.96 * HELMSMAN_SCALE, helm.seatTop.z);
    root.add(mesh);

    const pistolGeometry = new THREE.BoxGeometry(0.035, 0.05, 0.16);
    pistolGeometry.translate(0, -0.11, 0.045);
    const barrel = new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10).rotateX(Math.PI / 2).translate(0, -0.085, 0.1);
    const geometry = mergeTwo(pistolGeometry, barrel);
    this.pistol = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.45 }));
    this.pistol.name = "Flare_Pistol";
    this.pistol.visible = false;
    this.pistol.castShadow = true;
    this.figure.bone("handR").add(this.pistol);
  }

  /** Raise the flare pistol; returns the world-space muzzle position after posing. */
  startFlarePose(): void {
    this.flareTimer = FLARE_POSE_SECONDS;
  }

  muzzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.figure.mesh.updateMatrixWorld(true);
    return this.pistol.localToWorld(target.set(0, -0.06, 0.17));
  }

  update(time: number, delta: number, wheelAngle: number, heel: number, pitch: number, heave: number, turnLoad: number): void {
    const figure = this.figure;
    figure.resetPose();
    this.flareTimer = Math.max(0, this.flareTimer - delta);
    const lean = stepHelmsmanLean(this.lean, heel, turnLoad, delta);
    const heaveVelocity = delta > 0 ? (heave - this.previousHeave) / delta : 0;
    this.previousHeave = heave;
    this.heaveNod += (clamp(heaveVelocity * 0.08, -0.12, 0.12) - this.heaveNod) * Math.min(1, delta * 4);

    // Torso: slight forward lean toward the wheel, counter-heel, breathing.
    figure.bone("hips").rotation.set(0.06 - pitch * 0.45, 0, lean * 0.62);
    figure.bone("spine").rotation.set(0.14 + this.heaveNod * 0.4, Math.sin(time * 0.21) * 0.05, lean * 0.3);
    figure.bone("chest").rotation.set(0.05 + Math.sin(time * 1.55) * 0.012, 0, lean * 0.12);
    const scan = Math.sin(time * 0.11) * 0.42 + Math.sin(time * 0.29 + 1.3) * 0.22;
    const lookUp = Math.pow(Math.max(0, Math.sin(time * 0.073 + 0.5)), 8) * 0.45;
    figure.bone("neck").rotation.set(-0.05 - this.heaveNod, clamp(scan * 0.45, -0.5, 0.5), -lean * 0.15);
    figure.bone("head").rotation.set(-lookUp - 0.04, clamp(scan * 0.55, -0.6, 0.6), 0);

    this.root.updateMatrixWorld(true);
    const scale = HELMSMAN_SCALE;
    const { wheelCenter, wheelRadius } = this.helm;
    const handTravel = clamp(wheelAngle, -MAX_HAND_TRAVEL, MAX_HAND_TRAVEL);

    // Legs: feet planted on the sole, knees bend up and slightly apart.
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      this.toWorld(this.target, this.helm.seatTop.x + sign * 0.15, this.helm.floorY + 0.05, wheelCenter.z - 0.05);
      this.toWorld(this.pole, this.helm.seatTop.x + sign * 0.3, this.helm.seatTop.y + 0.8, wheelCenter.z + 0.6);
      figure.solveTwoBone(`thigh${side}`, `shin${side}`, THIGH_LENGTH * scale, SHIN_LENGTH * scale, this.target, this.pole);
      this.levelFoot(side);
    }

    // Arms: grip the rim at ten and two o'clock, following the wheel.
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      if (side === "R" && this.flareTimer > 0) {
        this.raiseFlareArm();
        continue;
      }
      // Rim angle measured clockwise from the top as the skipper sees it; his
      // right hand is on the -X side.
      const angle = -sign * 0.95 + handTravel;
      this.toWorld(
        this.target,
        wheelCenter.x - Math.sin(angle) * wheelRadius,
        wheelCenter.y + Math.cos(angle) * wheelRadius,
        wheelCenter.z - 0.03,
      );
      this.toWorld(this.pole, wheelCenter.x + sign * 0.55, wheelCenter.y - 0.25, wheelCenter.z - 0.55);
      figure.solveTwoBone(`upperArm${side}`, `forearm${side}`, UPPER_ARM_LENGTH * scale, FOREARM_LENGTH * scale, this.target, this.pole);
      figure.bone(`hand${side}`).rotation.set(0.35, 0, sign * 0.5);
    }
    this.pistol.visible = this.flareTimer > 0;
  }

  dispose(): void {
    this.root.remove(this.figure.mesh);
    this.pistol.geometry.dispose();
    this.pistol.material.dispose();
    this.figure.dispose();
  }

  private raiseFlareArm(): void {
    // Point the pistol up and slightly outboard, well clear of the sails.
    const shoulder = this.figure.bone("upperArmR").getWorldPosition(this.local);
    this.target.copy(shoulder);
    this.toWorldDirection(this.pole, -0.32, 0.92, 0.18);
    this.target.addScaledVector(this.pole, 0.6);
    this.toWorld(this.pole, this.helm.seatTop.x - 0.8, this.helm.seatTop.y + 0.3, this.helm.seatTop.z - 0.3);
    this.figure.solveTwoBone("upperArmR", "forearmR", UPPER_ARM_LENGTH * HELMSMAN_SCALE, FOREARM_LENGTH * HELMSMAN_SCALE, this.target, this.pole);
    this.figure.bone("handR").rotation.set(-1.45, 0, 0);
  }

  private levelFoot(side: "L" | "R"): void {
    const foot = this.figure.bone(`foot${side}`);
    this.figure.mesh.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this.meshInverse).invert();
    (foot.parent as THREE.Object3D).getWorldQuaternion(this.parentQuaternion);
    // Express the parent in vessel space, then cancel it so the sole stays flat.
    this.parentQuaternion.premultiply(this.meshInverse).invert();
    foot.quaternion.copy(this.parentQuaternion);
  }

  private toWorld(target: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return this.root.localToWorld(target.set(x, y, z));
  }

  private toWorldDirection(target: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return target.set(x, y, z).normalize().transformDirection(this.root.matrixWorld);
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const first = a.index ? a.toNonIndexed() : a;
  const second = b.index ? b.toNonIndexed() : b;
  const positions = new Float32Array([...first.getAttribute("position").array, ...second.getAttribute("position").array]);
  const normals = new Float32Array([...first.getAttribute("normal").array, ...second.getAttribute("normal").array]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  [a, b, first, second].forEach((source) => {
    if (source !== geometry) source.dispose();
  });
  return geometry;
}
