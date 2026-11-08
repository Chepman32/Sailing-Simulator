import * as THREE from "three";
import { RiggedFigure } from "../economy/RiggedFigure";

/** A walk's stride (m per full cycle of both legs) and how high a run lifts the knees. */
const STRIDE = 1.5;

/**
 * The skipper's own shadow ashore. The walker is seen from his eyes, so his
 * body is never drawn; but on a sunny beach a figure with no shadow looks
 * like a ghost. This is the rigged man (the same model as the helmsman),
 * invisible to the camera (it writes neither colour nor depth) but casting
 * a shadow, walking with the walker: legs striding, arms swinging, a little
 * bob, standing still with his weight settled when he stops.
 */
export class WalkerShadow {
  private readonly rig: RiggedFigure;
  private readonly material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private phase = 0;
  private pace = 0;
  private readonly s: number;

  constructor(scene: THREE.Scene, model: THREE.Object3D, eyeHeight = 1.62) {
    const probe = new RiggedFigure(model);
    const eyes = probe.restPoint.get("Head")!.y + probe.height * 0.045;
    probe.root.remove(model);
    model.scale.multiplyScalar(eyeHeight / eyes);
    model.updateMatrixWorld(true);
    this.rig = new RiggedFigure(model);
    this.s = this.rig.height / 1.8;
    this.rig.root.name = "Walker_Shadow";
    // Shadow only: the loaded asset's own materials are shared with the
    // islanders, so the figure gets its own, invisible one.
    this.rig.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.material;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
    });
    this.rig.root.visible = false;
    scene.add(this.rig.root);
  }

  /**
   * Feet at (x, y, z) facing `yaw` (forward = (sin yaw, cos yaw)), moving at
   * `speed` m/s; `show` false hides it (at the helm, swimming, aboard).
   */
  update(show: boolean, x: number, y: number, z: number, yaw: number, speed: number, airborne: boolean, delta: number): void {
    const root = this.rig.root;
    root.visible = show;
    if (!show) return;
    const rig = this.rig;
    const s = this.s;
    const step = Math.min(0.05, Math.max(0, delta));
    this.pace += (Math.min(1.6, speed / 3) - this.pace) * Math.min(1, step * 6);
    this.phase += ((speed * step) / STRIDE) * Math.PI * 2;
    const swing = Math.sin(this.phase);
    const pace = this.pace;
    root.position.set(x, y, z);
    root.rotation.set(0, yaw, 0);
    rig.resetPose();
    const up = rig.axis(0, 1, 0, this.offset.clone());
    const left = rig.axis(1, 0, 0, new THREE.Vector3());
    // A bob through each step, the hips swaying over the loaded foot.
    const bob = Math.abs(Math.cos(this.phase)) * 0.035 * pace * s;
    this.offset.copy(up).multiplyScalar(bob - 0.02 * pace * s).addScaledVector(left, swing * 0.025 * pace * s);
    rig.shiftBone("Hips", this.offset);
    rig.turnBone("Spine02", left, 0.08 * pace);
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      const legSwing = swing * sign;
      // The foot: forward and back along the stride, lifted on its way forward.
      const foot = rig.restPoint.get(`${side}Foot`)!;
      const reach = legSwing * 0.32 * pace * s;
      const lift = airborne ? 0.25 * s : Math.max(0, Math.cos(this.phase + (sign > 0 ? 0 : Math.PI))) * 0.14 * pace * s;
      this.local.set(foot.x, foot.y + lift, foot.z + reach);
      rig.toWorld(this.local, this.target);
      const knee = rig.restPoint.get(`${side}Leg`)!;
      this.local.set(knee.x, knee.y, knee.z + 0.6);
      rig.toWorld(this.local, this.pole);
      rig.solveLimb(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, this.target, this.pole);
      rig.levelFoot(`${side}Foot`);
      // The arm opposite the leg, hanging at his side.
      const shoulder = rig.restPoint.get(`${side}Arm`)!;
      this.local.set(shoulder.x + sign * 0.06 * s, shoulder.y - 0.56 * s, shoulder.z - legSwing * 0.22 * pace * s + 0.04 * s);
      rig.toWorld(this.local, this.target);
      this.local.set(shoulder.x + sign * 0.3 * s, shoulder.y - 0.3 * s, shoulder.z - 0.5 * s);
      rig.toWorld(this.local, this.pole);
      rig.solveLimb(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, this.target, this.pole);
    }
    root.updateMatrixWorld(true);
  }

  dispose(): void {
    this.rig.root.removeFromParent();
    this.material.dispose();
  }
}
