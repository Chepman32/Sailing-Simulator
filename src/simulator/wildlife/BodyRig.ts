import * as THREE from "three";

/**
 * Procedural articulation on top of authored skeletal clips.
 *
 * The imported rigs each use their own bone axes, so procedural bends are
 * expressed in the animal's own frame (+Z forward, +Y up, +X starboard) and
 * converted once, at load, into each bone's parent space. A bend is then a
 * rotation about that converted axis, applied on top of whatever the
 * animation mixer last wrote, without ever accumulating between frames.
 */

/** Rotation axes in the animal frame. */
export type BodyAxis = "pitch" | "yaw" | "roll";

const AXES: Record<BodyAxis, THREE.Vector3> = {
  // Positive pitch turns +Z toward −Y: nose down, tail up.
  pitch: new THREE.Vector3(1, 0, 0),
  // Positive yaw turns +Z toward +X.
  yaw: new THREE.Vector3(0, 1, 0),
  roll: new THREE.Vector3(0, 0, 1),
};

const scratchQuaternion = new THREE.Quaternion();
const scratchInverse = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();
const scratchScale = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();

/** Rotation of `object` relative to `frame`, from their world matrices. */
function relativeQuaternion(object: THREE.Object3D, frame: THREE.Object3D, target: THREE.Quaternion): THREE.Quaternion {
  scratchMatrix.copy(frame.matrixWorld).invert().multiply(object.matrixWorld);
  scratchMatrix.decompose(scratchPosition, target, scratchScale);
  return target;
}

export class ProceduralBone {
  private readonly base = new THREE.Quaternion();
  private readonly axes: Record<BodyAxis, THREE.Vector3>;

  /**
   * @param bone the bone to drive
   * @param frame the animal's root, whose local axes define pitch/yaw/roll;
   *   both must have current world matrices in their rest pose
   */
  constructor(
    readonly bone: THREE.Object3D,
    frame: THREE.Object3D,
  ) {
    const parent = bone.parent ?? frame;
    relativeQuaternion(parent, frame, scratchQuaternion);
    scratchInverse.copy(scratchQuaternion).invert();
    this.axes = {
      pitch: AXES.pitch.clone().applyQuaternion(scratchInverse).normalize(),
      yaw: AXES.yaw.clone().applyQuaternion(scratchInverse).normalize(),
      roll: AXES.roll.clone().applyQuaternion(scratchInverse).normalize(),
    };
    this.base.copy(bone.quaternion);
  }

  /** Puts back the pose the mixer last wrote, discarding procedural bends. */
  restore(): void {
    this.bone.quaternion.copy(this.base);
  }

  /** Remembers the pose the mixer has just written. */
  capture(): void {
    this.base.copy(this.bone.quaternion);
  }

  /** Bends the bone about an animal-frame axis, in its parent's space. */
  rotate(axis: BodyAxis, angle: number): void {
    if (angle === 0) return;
    scratchQuaternion.setFromAxisAngle(this.axes[axis], angle);
    this.bone.quaternion.premultiply(scratchQuaternion);
  }
}

/**
 * A point on the body that follows the skeleton, such as a fluke tip or a
 * blowhole. Defined once from its rest position in the animal frame.
 */
export class BodyPoint {
  private readonly local = new THREE.Vector3();

  constructor(
    readonly bone: THREE.Object3D,
    frame: THREE.Object3D,
    restPositionInFrame: THREE.Vector3,
  ) {
    const world = restPositionInFrame.clone().applyMatrix4(frame.matrixWorld);
    this.local.copy(world).applyMatrix4(scratchMatrix.copy(bone.matrixWorld).invert());
  }

  /** World position; the bone's world matrix must be current. */
  world(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.local).applyMatrix4(this.bone.matrixWorld);
  }
}

/** Finds a bone by name, tolerating the loader's sanitised names. */
export function findBone(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const exact = root.getObjectByName(name);
  if (exact) return exact;
  const wanted = name.replace(/[^A-Za-z0-9_]/gu, "");
  let found: THREE.Object3D | undefined;
  root.traverse((object) => {
    if (!found && object.name.replace(/[^A-Za-z0-9_]/gu, "") === wanted) found = object;
  });
  return found;
}

/**
 * A copy of `clip` without the tracks that animate `excludedNodes`. Used to
 * keep an authored clip's secondary motion (fins, flippers) while the body
 * and tail are driven procedurally.
 */
export function filterClip(clip: THREE.AnimationClip, excludedNodes: readonly string[]): THREE.AnimationClip {
  const excluded = new Set(excludedNodes.map((name) => name.replace(/[^A-Za-z0-9_]/gu, "")));
  const tracks = clip.tracks.filter((track) => {
    const node = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
    return !excluded.has(node.replace(/[^A-Za-z0-9_]/gu, ""));
  });
  return new THREE.AnimationClip(`${clip.name}_secondary`, clip.duration, tracks);
}

/**
 * Seconds between skeletal animation updates at a given camera distance.
 * Movement and procedural bends still run every frame; only the authored
 * secondary motion is sampled less often far away.
 */
export function animationInterval(cameraDistance: number): number {
  if (cameraDistance < 45) return 1 / 30;
  if (cameraDistance < 100) return 1 / 20;
  if (cameraDistance < 180) return 1 / 12;
  return 1 / 6;
}
