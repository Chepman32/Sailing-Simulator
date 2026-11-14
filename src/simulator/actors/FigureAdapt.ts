import * as THREE from "three";
import { FIGURE_BONES, type FigureBone } from "../economy/RiggedFigure";

/**
 * Makes an authored character (any humanoid rig whose body bones carry the
 * game's names, `FIGURE_BONES`) usable where the islanders' model is:
 *
 * - `standFigure` turns it to face +Z, puts its feet on y = 0 and scales it
 *   to a person's height, on its top node (so everything measured from the
 *   skeleton afterwards is in metres, in the game's frame);
 * - `retargetGait` plays the islanders' walk and run on their own skeleton
 *   and writes the same motion for this one. Bones are matched by what they
 *   do to the world, not by their local axes, which differ from rig to rig:
 *   each frame a bone is turned from its rest by the rotation the source
 *   bone has made from its rest. The two rests are first brought to the
 *   same stance (limb by limb, each made to point where the source's
 *   does), so an A-pose rig walks with its arms where a T-pose one has them.
 *
 * Both run once per model, when it has loaded.
 */

/** The joint a bone points at (its limb's direction at rest). */
const POINTS_AT: Partial<Record<FigureBone, FigureBone>> = {
  Spine02: "Spine01", Spine01: "Spine", Spine: "neck", neck: "Head",
  LeftShoulder: "LeftArm", LeftArm: "LeftForeArm", LeftForeArm: "LeftHand",
  RightShoulder: "RightArm", RightArm: "RightForeArm", RightForeArm: "RightHand",
  LeftUpLeg: "LeftLeg", LeftLeg: "LeftFoot", LeftFoot: "LeftToeBase",
  RightUpLeg: "RightLeg", RightLeg: "RightFoot", RightFoot: "RightToeBase",
};

/** Height of a standing figure, sole to crown, m. */
const BODY_HEIGHT = 1.8;
const SAMPLE_RATE = 30;

function bonesOf(root: THREE.Object3D): Map<FigureBone, THREE.Object3D> {
  const found = new Map<FigureBone, THREE.Object3D>();
  root.traverse((object) => {
    if ((FIGURE_BONES as readonly string[]).includes(object.name) && !found.has(object.name as FigureBone)) found.set(object.name as FigureBone, object);
  });
  for (const name of FIGURE_BONES) if (!found.has(name)) throw new Error(`The figure has no bone ${name}.`);
  return found;
}

/** Faces the figure along +Z, feet on the ground, a person's height (`scale` × the usual). */
export function standFigure(scene: THREE.Object3D, scale = 1): void {
  scene.position.set(0, 0, 0);
  scene.rotation.set(0, 0, 0);
  scene.scale.setScalar(1);
  scene.updateMatrixWorld(true);
  const bones = bonesOf(scene);
  const at = (name: FigureBone) => bones.get(name)!.getWorldPosition(new THREE.Vector3());
  // His left is +X when he faces +Z.
  const left = at("LeftUpLeg").sub(at("RightUpLeg"));
  scene.rotation.y = Math.atan2(left.z, left.x);
  scene.updateMatrixWorld(true);
  // Measured on the skin, not the joints: rigs differ in what they hang
  // below the feet and above the head (roots, helper and end bones).
  const span = (): THREE.Box3 => {
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    scene.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.visible) return;
      mesh.skeleton.update();
      mesh.computeBoundingBox();
      if (mesh.boundingBox) box.union(part.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld));
    });
    if (box.isEmpty()) for (const bone of bones.values()) box.expandByPoint(bone.getWorldPosition(new THREE.Vector3()));
    return box;
  };
  const height = span().max.y - span().min.y;
  scene.scale.setScalar(height > 1e-6 ? (BODY_HEIGHT * scale) / height : 1);
  scene.updateMatrixWorld(true);
  const hips = at("Hips");
  scene.position.set(-hips.x, -span().min.y, -hips.z);
  scene.updateMatrixWorld(true);
}

const parentQuaternion = new THREE.Quaternion();
const worldQuaternion = new THREE.Quaternion();

/** Turns `bone` so that its world orientation is `world`. */
function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion): void {
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentQuaternion);
    bone.quaternion.copy(parentQuaternion.invert()).multiply(world);
  } else {
    bone.quaternion.copy(world);
  }
  bone.updateMatrixWorld(true);
}

/**
 * The source's clips (`names`) written for the target's skeleton. Both must
 * stand in the game's frame (`standFigure`), the source in its rest pose.
 * The target is left as it was.
 */
export function retargetGait(
  source: { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] },
  target: THREE.Object3D,
  names: readonly string[] = ["walk", "run"],
): THREE.AnimationClip[] {
  source.scene.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const from = bonesOf(source.scene);
  const to = bonesOf(target);
  const original = new Map<FigureBone, THREE.Quaternion>();
  for (const name of FIGURE_BONES) original.set(name, to.get(name)!.quaternion.clone());
  const hipsPosition = to.get("Hips")!.position.clone();

  // The source's rest, and the target's rest brought to the same stance.
  const sourceRest = new Map<FigureBone, THREE.Quaternion>();
  for (const name of FIGURE_BONES) sourceRest.set(name, from.get(name)!.getWorldQuaternion(new THREE.Quaternion()));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  // The head keeps its own rest: straightening the neck must not tip the face up or down.
  const headRest = to.get("Head")!.getWorldQuaternion(new THREE.Quaternion());
  for (const name of FIGURE_BONES) {
    const child = POINTS_AT[name];
    if (!child) continue;
    const wanted = from.get(child)!.getWorldPosition(a).sub(from.get(name)!.getWorldPosition(b)).normalize().clone();
    const has = to.get(child)!.getWorldPosition(a).sub(to.get(name)!.getWorldPosition(b)).normalize();
    turn.setFromUnitVectors(has, wanted);
    const bone = to.get(name)!;
    setWorldQuaternion(bone, turn.multiply(bone.getWorldQuaternion(worldQuaternion)));
  }
  setWorldQuaternion(to.get("Head")!, headRest);
  const targetRest = new Map<FigureBone, THREE.Quaternion>();
  for (const name of FIGURE_BONES) targetRest.set(name, to.get(name)!.getWorldQuaternion(new THREE.Quaternion()));
  const sourceHips = from.get("Hips")!.getWorldPosition(new THREE.Vector3());
  const targetHips = to.get("Hips")!.getWorldPosition(new THREE.Vector3());
  const reach = sourceHips.y > 1e-6 ? targetHips.y / sourceHips.y : 1;

  const mixer = new THREE.AnimationMixer(source.scene);
  const clips: THREE.AnimationClip[] = [];
  const delta = new THREE.Quaternion();
  const world = new THREE.Quaternion();
  const last = new THREE.Quaternion();
  for (const clipName of names) {
    const clip = source.animations.find((candidate) => candidate.name === clipName);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.play();
    const frames = Math.max(2, Math.round(clip.duration * SAMPLE_RATE) + 1);
    const times = new Float32Array(frames);
    const rotations = new Map<FigureBone, Float32Array>();
    for (const name of FIGURE_BONES) rotations.set(name, new Float32Array(frames * 4));
    const positions = new Float32Array(frames * 3);
    for (let frame = 0; frame < frames; frame += 1) {
      const time = (frame / (frames - 1)) * clip.duration;
      times[frame] = time;
      // Just short of the end, so a looping clip's last frame is not wrapped to its first.
      mixer.setTime(Math.min(time, clip.duration - 1e-4));
      source.scene.updateMatrixWorld(true);
      // The hips first: where they are, then every bone's turn from rest, parents before children.
      const hips = to.get("Hips")!;
      from.get("Hips")!.getWorldPosition(a).sub(sourceHips).multiplyScalar(reach).add(targetHips);
      if (hips.parent) hips.parent.worldToLocal(a);
      hips.position.copy(a);
      positions[frame * 3] = a.x;
      positions[frame * 3 + 1] = a.y;
      positions[frame * 3 + 2] = a.z;
      for (const name of FIGURE_BONES) {
        const bone = to.get(name)!;
        delta.copy(from.get(name)!.getWorldQuaternion(world)).multiply(turn.copy(sourceRest.get(name)!).invert());
        setWorldQuaternion(bone, delta.multiply(targetRest.get(name)!));
        const values = rotations.get(name)!;
        const q = bone.quaternion;
        // Keep to one side of the double cover, so the interpolation never goes the long way round.
        if (frame > 0) {
          last.fromArray(values, (frame - 1) * 4);
          if (last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        }
        q.toArray(values, frame * 4);
      }
    }
    action.stop();
    mixer.uncacheClip(clip);
    const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack("Hips.position", times, positions)];
    for (const name of FIGURE_BONES) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, rotations.get(name)!));
    clips.push(new THREE.AnimationClip(clipName, clip.duration, tracks));
  }
  // The target back in its own rest.
  for (const name of FIGURE_BONES) to.get(name)!.quaternion.copy(original.get(name)!);
  to.get("Hips")!.position.copy(hipsPosition);
  target.updateMatrixWorld(true);
  return clips;
}
