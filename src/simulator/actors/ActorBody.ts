import * as THREE from "three";
import { RiggedFigure, type FigureBone } from "../economy/RiggedFigure";
import { gunModel, recolourFigure, wornPieces, type ActorLook, type GunKind, type GunModel } from "./ActorLooks";

/**
 * A story person's body: the rigged base figure in his look, walking and
 * running on the model's own clips (their forward drift taken out: the
 * system moves him), and posed on top of them, every frame, by hand:
 * crouching (hips down, legs bent to keep the feet where the clip puts
 * them), the gun carried low or raised to the shoulder at a mark, the
 * recoil, a flinch at a hit, sitting, hands up, and lying where he fell.
 */

export type BodyPose = {
  /** Ground speed, m/s (picks and paces the walk or the run). */
  speed: number;
  /** 0 standing … 1 crouched. */
  crouch: number;
  /** Where he looks and points (world), or null. */
  aim: THREE.Vector3 | null;
  /** 0 the gun carried low … 1 at the shoulder. */
  ready: number;
  /** 0…1 a moment after a shot. */
  recoil: number;
  /** 0…1 a moment after a hit. */
  flinch: number;
  /** 0 up … 1 lying down; `fallYaw` the way he falls (his own heading + this). */
  down: number;
  fallBack: boolean;
  /** 0…1 hands raised. */
  surrender: number;
  /** 0…1 sitting (a chair's seat at `seat` m). */
  sit: number;
  seat: number;
  /** A word with someone: the head turned to `aim`, small gestures. */
  talking: boolean;
};

export function restPose(): BodyPose {
  return { speed: 0, crouch: 0, aim: null, ready: 0, recoil: 0, flinch: 0, down: 0, fallBack: true, surrender: 0, sit: 0, seat: 0.48, talking: false };
}

const WALK_SPEED = 1.35;
const RUN_SPEED = 3.7;

const v0 = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const m0 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();

/** Takes the clip's forward travel out of its hips (the body is moved by the system, not the clip). */
function inPlace(clip: THREE.AnimationClip): THREE.AnimationClip {
  const copy = clip.clone();
  for (const track of copy.tracks) {
    if (!track.name.endsWith("Hips.position")) continue;
    const values = track.values;
    const count = track.times.length;
    if (count < 2) continue;
    const firstX = values[0]!;
    const firstZ = values[2]!;
    const lastX = values[(count - 1) * 3]!;
    const lastZ = values[(count - 1) * 3 + 2]!;
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      values[index * 3] = values[index * 3]! - (firstX + (lastX - firstX) * t) + firstX;
      values[index * 3 + 2] = values[index * 3 + 2]! - (firstZ + (lastZ - firstZ) * t) + firstZ;
    }
  }
  return copy;
}

export class ActorBody {
  readonly rig: RiggedFigure;
  readonly root: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly walk: THREE.AnimationAction | null;
  private readonly run: THREE.AnimationAction | null;
  private readonly gun: GunModel | null;
  private readonly scale: number;
  private phase = 0;
  private dropped = false;
  /** The gun's muzzle in the world (after the last update). */
  readonly muzzle = new THREE.Vector3();
  /** Head and chest centres in the world (for a round's hit), after the last update. */
  readonly head = new THREE.Vector3();
  readonly chest = new THREE.Vector3();
  readonly hips = new THREE.Vector3();
  private readonly footL = new THREE.Vector3();
  private readonly footR = new THREE.Vector3();

  constructor(model: THREE.Object3D, clips: readonly THREE.AnimationClip[], look: ActorLook, gun: GunKind | null) {
    // Its own material, in the look's colours.
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const source = mesh.material as THREE.MeshStandardMaterial;
      const material = source.clone();
      const map = source.map ? recolourFigure(source.map, look) : null;
      if (map) material.map = map;
      mesh.material = material;
    });
    this.rig = new RiggedFigure(model);
    this.root = this.rig.root;
    this.root.name = "Actor";
    this.scale = look.scale ?? 1;
    this.mixer = new THREE.AnimationMixer(model);
    const walkClip = clips.find((clip) => clip.name === "walk");
    const runClip = clips.find((clip) => clip.name === "run");
    this.walk = walkClip ? this.mixer.clipAction(inPlace(walkClip)) : null;
    this.run = runClip ? this.mixer.clipAction(inPlace(runClip)) : null;
    for (const action of [this.walk, this.run]) {
      if (!action) continue;
      action.play();
      action.setEffectiveWeight(0);
    }
    // The kit, ridden on its bones (placed at rest, in the figure's frame).
    const fit = this.rig.height / 1.78;
    this.root.updateMatrixWorld(true);
    for (const piece of wornPieces(look)) {
      const holder = new THREE.Group();
      holder.add(piece.object);
      holder.scale.setScalar(fit);
      holder.updateMatrixWorld(true);
      const bone = this.rig.bone(piece.bone as FigureBone);
      // Child of the bone with the transform that puts it where it is now (at rest).
      m0.copy(bone.matrixWorld).invert().multiply(holder.matrixWorld);
      m0.decompose(holder.position, holder.quaternion, holder.scale);
      bone.add(holder);
    }
    // Sized once the kit is on (the kit was fitted to the figure at its own size).
    this.root.scale.setScalar(this.scale);
    if (gun) {
      this.gun = gunModel(gun);
      this.root.add(this.gun.object);
    } else {
      this.gun = null;
    }
  }

  get hasGun(): boolean {
    return this.gun !== null && !this.dropped;
  }

  /** The gun falls from his hands (he was hit down, or gives up). */
  dropGun(at: THREE.Vector3 | null): void {
    if (!this.gun || this.dropped) return;
    this.dropped = true;
    if (at) {
      this.root.parent?.add(this.gun.object);
      this.gun.object.position.copy(at);
      this.gun.object.rotation.set(Math.PI / 2, Math.random() * Math.PI * 2, 0);
      this.gun.object.position.y += 0.03;
    } else {
      this.gun.object.visible = false;
    }
  }

  /** Back to the start: on his feet, gun in hand. */
  revive(): void {
    if (this.gun && this.dropped) {
      this.root.add(this.gun.object);
      this.gun.object.visible = true;
    }
    this.dropped = false;
  }

  /**
   * One frame: the body placed at (x, y, z) facing `yaw` (forward = (sin, cos)),
   * the clips advanced, the pose laid over them.
   */
  update(dt: number, x: number, y: number, z: number, yaw: number, pose: BodyPose): void {
    const rig = this.rig;
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);
    rig.resetPose();
    // The gait: blend walk into run by speed, each at the pace that keeps the feet from sliding.
    const speed = pose.down > 0.01 || pose.sit > 0.01 ? 0 : pose.speed;
    const moving = Math.min(1, speed / 0.5);
    const runWeight = THREE.MathUtils.clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
    if (this.walk) {
      this.walk.setEffectiveWeight(moving * (1 - runWeight));
      this.walk.timeScale = Math.max(0.4, speed / WALK_SPEED) * (pose.crouch > 0.5 ? 0.8 : 1);
    }
    if (this.run) {
      this.run.setEffectiveWeight(moving * runWeight);
      this.run.timeScale = Math.max(0.6, speed / RUN_SPEED);
    }
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.phase += dt;

    const s = this.scale;
    const left = rig.axis(1, 0, 0, v0.clone());
    const forward = rig.axis(0, 0, 1, v1.clone());

    // Lying where he fell: the whole figure tipped about his feet.
    if (pose.down > 0.001) {
      const tip = pose.down * (Math.PI / 2) * (pose.fallBack ? -1 : 1);
      this.root.rotation.set(tip, yaw, 0, "YXZ");
      this.root.position.y = y + Math.sin(pose.down * Math.PI / 2) * 0.12 * s;
      this.root.updateMatrixWorld(true);
      // Arms loose, out to the sides; knees a little bent.
      rig.turnBone("LeftArm", forward, -0.9 * pose.down);
      rig.turnBone("RightArm", forward, 0.9 * pose.down);
      rig.turnBone("LeftLeg", left, 0.35 * pose.down);
      rig.turnBone("Head", forward, 0.3 * pose.down);
      this.placeGun(pose, true);
      this.measure();
      return;
    }

    // Sitting: hips down onto the seat, feet planted ahead.
    if (pose.sit > 0.001) {
      rig.toWorld(v2.set(0.11, 0.06, 0.42), this.footL);
      rig.toWorld(v2.set(-0.11, 0.06, 0.42), this.footR);
      rig.shiftBone("Hips", v3.set(0, -(0.98 - pose.seat) * pose.sit * s, 0).addScaledVector(forward, -0.08 * pose.sit * s));
      rig.solveLimb("LeftUpLeg", "LeftLeg", "LeftFoot", this.footL, v3.copy(this.footL).addScaledVector(forward, 1).addScaledVector(up, 0.6));
      rig.solveLimb("RightUpLeg", "RightLeg", "RightFoot", this.footR, v3.copy(this.footR).addScaledVector(forward, 1).addScaledVector(up, 0.6));
      rig.levelFoot("LeftFoot");
      rig.levelFoot("RightFoot");
      rig.turnBone("Spine01", left, 0.12 * pose.sit);
    }

    // Crouching: hips lowered and back, the feet kept where the clip has them.
    if (pose.crouch > 0.001 && pose.sit < 0.5) {
      rig.bone("LeftFoot").getWorldPosition(this.footL);
      rig.bone("RightFoot").getWorldPosition(this.footR);
      rig.shiftBone("Hips", v3.set(0, -0.36 * pose.crouch * s, 0).addScaledVector(forward, -0.1 * pose.crouch * s));
      rig.turnBone("Spine01", left, 0.32 * pose.crouch);
      rig.turnBone("Spine02", left, 0.12 * pose.crouch);
      rig.solveLimb("LeftUpLeg", "LeftLeg", "LeftFoot", this.footL, v3.copy(this.footL).addScaledVector(forward, 1).addScaledVector(up, 0.5));
      rig.solveLimb("RightUpLeg", "RightLeg", "RightFoot", this.footR, v3.copy(this.footR).addScaledVector(forward, 1).addScaledVector(up, 0.5));
      rig.levelFoot("LeftFoot");
      rig.levelFoot("RightFoot");
    }

    // Turning the chest and head to the mark (or the person spoken to).
    if (pose.aim) {
      rig.bone("Spine02").getWorldPosition(v2);
      const dx = pose.aim.x - v2.x;
      const dz = pose.aim.z - v2.z;
      let off = Math.atan2(dx, dz) - yaw;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      const twist = THREE.MathUtils.clamp(off, -1.1, 1.1);
      rig.turnBone("Spine01", up, twist * 0.35);
      rig.turnBone("Spine02", up, twist * 0.35);
      const pitch = Math.atan2(pose.aim.y - v2.y, Math.hypot(dx, dz));
      const headTwist = THREE.MathUtils.clamp(off - twist * 0.7, -0.8, 0.8);
      rig.turnBone("Head", up, headTwist);
      rig.turnBone("Head", rig.axis(1, 0, 0, v3), -THREE.MathUtils.clamp(pitch, -0.6, 0.5) * 0.6);
    }
    if (pose.flinch > 0.01) rig.turnBone("Spine02", left, -0.3 * pose.flinch);
    if (pose.talking) rig.turnBone("Head", left, Math.sin(this.phase * 2.3) * 0.04);

    if (pose.surrender > 0.001) {
      // Hands up, open, either side of the head.
      rig.bone("Head").getWorldPosition(v2);
      for (const side of [1, -1]) {
        const target = v3.copy(v2).addScaledVector(up, 0.32 * s).addScaledVector(left, side * 0.26 * s).addScaledVector(forward, 0.05 * s);
        const pole = v0.copy(v2).addScaledVector(left, side * 0.8).addScaledVector(up, -0.3);
        if (side > 0) rig.solveLimb("LeftArm", "LeftForeArm", "LeftHand", target, pole);
        else rig.solveLimb("RightArm", "RightForeArm", "RightHand", target, pole);
      }
    } else {
      this.placeGun(pose, false);
    }
    this.measure();
  }

  /** The gun in the hands: low and across the body, or up at the shoulder at the mark; the arms to it. */
  private placeGun(pose: BodyPose, lying: boolean): void {
    const gun = this.gun;
    if (!gun || this.dropped) return;
    const rig = this.rig;
    const object = gun.object;
    if (lying) {
      object.visible = false;
      return;
    }
    object.visible = true;
    const s = this.scale;
    // In the figure's own frame (+x left, +z forward): the shoulder pocket and the low carry.
    const shoulder = v2.set(-0.17, 1.45, 0.12);
    const low = v3.set(-0.08, 1.05, 0.28);
    const p = THREE.MathUtils.smoothstep(pose.ready, 0, 1);
    const anchor = shoulder.lerp(low, 1 - p);
    anchor.y -= 0.36 * pose.crouch * (1 - pose.sit);
    anchor.z -= 0.1 * pose.crouch;
    object.position.copy(anchor);
    // Pointing: low, down and across to his left; raised, at the mark.
    const carry = q0.setFromEuler(new THREE.Euler(0.65, 0.55, 0, "YXZ"));
    object.quaternion.copy(carry);
    if (pose.aim && p > 0.01) {
      this.root.updateMatrixWorld(true);
      const from = this.root.localToWorld(v0.copy(anchor));
      const to = v1.copy(pose.aim);
      const look = m0.lookAt(to, from, up);
      const worldQuaternion = new THREE.Quaternion().setFromRotationMatrix(look);
      const parent = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const aimed = parent.multiply(worldQuaternion);
      object.quaternion.copy(carry).slerp(aimed, p);
    }
    // Recoil: back and up.
    object.position.addScaledVector(v0.set(0, 0, -1).applyQuaternion(object.quaternion), 0.04 * pose.recoil);
    object.rotateX(-0.12 * pose.recoil);
    object.updateMatrixWorld(true);
    // The hands to the grip and the fore-end; the elbows down and out.
    const grip = object.localToWorld(v0.copy(gun.grip));
    const support = object.localToWorld(v1.copy(gun.support));
    rig.bone("RightArm").getWorldPosition(v2);
    const elbowDown = v3.copy(v2).addScaledVector(up, -0.6).addScaledVector(rig.axis(1, 0, 0, new THREE.Vector3()), -0.35 * s);
    rig.solveLimb("RightArm", "RightForeArm", "RightHand", grip, elbowDown);
    rig.bone("LeftArm").getWorldPosition(v2);
    const elbowL = v3.copy(v2).addScaledVector(up, -0.6).addScaledVector(rig.axis(1, 0, 0, new THREE.Vector3()), 0.25 * s);
    rig.solveLimb("LeftArm", "LeftForeArm", "LeftHand", support, elbowL);
    object.localToWorld(this.muzzle.copy(gun.muzzle));
  }

  private measure(): void {
    this.rig.bone("Head").getWorldPosition(this.head);
    this.rig.bone("Spine02").getWorldPosition(this.chest);
    this.rig.bone("Hips").getWorldPosition(this.hips);
    if (!this.gun || this.dropped) this.muzzle.copy(this.chest);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh.material as THREE.Material).dispose();
    });
    if (this.gun && this.dropped) this.gun.object.removeFromParent();
    this.rig.dispose();
  }
}
