import * as THREE from "three";

/**
 * A rigged character model (glTF, a humanoid skeleton with Mixamo-style
 * bone names) posed procedurally, frame by frame, from its rest pose:
 *
 * - every frame starts again from the bind pose, so poses never drift;
 * - the hips are moved and tilted, the spine, neck and head turned, in the
 *   character's own frame (whatever axes the rig's bones happen to use);
 * - arms and legs are placed by two-bone IK on a target and a pole (elbow or
 *   knee direction), and the feet are kept flat on the ground.
 *
 * All rotations are applied as world-space deltas, so the code needs no
 * knowledge of each bone's local axes; only the bone names and that the
 * model stands on y = 0 facing +z.
 */

/** The bones the poser drives (the model must have them, by these names). */
export const FIGURE_BONES = [
  "Hips", "Spine02", "Spine01", "Spine", "neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
] as const;
export type FigureBone = (typeof FIGURE_BONES)[number];

type Rest = { bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

const v0 = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();

export class RiggedFigure {
  /** Stands on y = 0, faces +z; place and turn this. */
  readonly root = new THREE.Group();
  /** Height of the figure, m (top of the head). */
  readonly height: number;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly rest: Rest[] = [];
  /** Bone lengths at rest (upper arm, forearm, thigh, shin), m. */
  private readonly lengths = new Map<string, number>();
  /** Each foot's rest rotation relative to the root (kept while the legs move). */
  private readonly footRest = new Map<string, THREE.Quaternion>();
  /** Rest positions in the root's frame (for the IK targets). */
  readonly restPoint = new Map<string, THREE.Vector3>();
  readonly meshes: THREE.SkinnedMesh[] = [];

  constructor(model: THREE.Object3D) {
    this.root.add(model);
    model.traverse((object) => {
      if ((object as THREE.Bone).isBone || FIGURE_BONES.includes(object.name as FigureBone)) this.bones.set(object.name, object);
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = object as THREE.SkinnedMesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Posed far from its bind pose, the mesh's bounds are not its own: never culled by them.
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
      }
    });
    for (const name of FIGURE_BONES) {
      if (!this.bones.has(name)) throw new Error(`The figure has no bone ${name}.`);
    }
    for (const bone of this.bones.values()) {
      this.rest.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() });
    }
    this.root.updateMatrixWorld(true);
    const at = (name: FigureBone) => this.bone(name).getWorldPosition(new THREE.Vector3());
    for (const name of FIGURE_BONES) this.restPoint.set(name, at(name));
    const span = (a: FigureBone, b: FigureBone) => this.lengths.set(a, at(a).distanceTo(at(b)));
    span("LeftArm", "LeftForeArm");
    span("LeftForeArm", "LeftHand");
    span("RightArm", "RightForeArm");
    span("RightForeArm", "RightHand");
    span("LeftUpLeg", "LeftLeg");
    span("LeftLeg", "LeftFoot");
    span("RightUpLeg", "RightLeg");
    span("RightLeg", "RightFoot");
    for (const foot of ["LeftFoot", "RightFoot"] as const) this.footRest.set(foot, this.bone(foot).getWorldQuaternion(new THREE.Quaternion()));
    // The height from the skeleton (the top of the head is the highest joint;
    // a skinned mesh's own matrix says nothing of where its vertices are drawn).
    let top = 0;
    for (const bone of this.bones.values()) top = Math.max(top, bone.getWorldPosition(v0).y);
    this.height = top > 0.5 ? top : 1.8;
  }

  bone(name: FigureBone): THREE.Object3D {
    return this.bones.get(name)!;
  }

  /** Back to the bind pose (call first every frame). */
  resetPose(): void {
    for (const rest of this.rest) {
      rest.bone.position.copy(rest.position);
      rest.bone.quaternion.copy(rest.quaternion);
      rest.bone.scale.copy(rest.scale);
    }
    this.root.updateMatrixWorld(true);
  }

  /** A point given in the figure's own frame (x its left, y up, z forward), to world. */
  toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  /** A direction in the figure's own frame, to world. */
  axis(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y, z).applyQuaternion(this.root.getWorldQuaternion(q2)).normalize();
  }

  /** Moves a bone by `offset` in world space (the hips, swaying). */
  shiftBone(name: FigureBone, offset: THREE.Vector3): void {
    const bone = this.bone(name);
    const world = bone.getWorldPosition(v0).add(offset);
    bone.parent!.updateMatrixWorld(true);
    bone.position.copy(bone.parent!.worldToLocal(world));
    bone.updateMatrixWorld(true);
  }

  /** Turns a bone by `angle` about a world-space axis through its own pivot (it carries its children). */
  turnBone(name: FigureBone, worldAxis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-5) return;
    const bone = this.bone(name);
    q0.setFromAxisAngle(worldAxis, angle);
    bone.getWorldQuaternion(q1).premultiply(q0);
    bone.parent!.getWorldQuaternion(q2).invert();
    bone.quaternion.copy(q2.multiply(q1));
    bone.updateMatrixWorld(true);
  }

  /** Gives a bone a world-space rotation outright. */
  setBoneWorldQuaternion(name: FigureBone, world: THREE.Quaternion): void {
    const bone = this.bone(name);
    bone.parent!.getWorldQuaternion(q2).invert();
    bone.quaternion.copy(q2.multiply(q1.copy(world)));
    bone.updateMatrixWorld(true);
  }

  /** Swings a bone about its pivot so the point `from` (world, carried by it) moves toward `to`. */
  private aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    const pivot = bone.getWorldPosition(v3);
    const current = v1.subVectors(from, pivot);
    const wanted = v2.subVectors(to, pivot);
    if (current.lengthSq() < 1e-10 || wanted.lengthSq() < 1e-10) return;
    q0.setFromUnitVectors(current.normalize(), wanted.normalize());
    bone.getWorldQuaternion(q1).premultiply(q0);
    bone.parent!.getWorldQuaternion(q2).invert();
    bone.quaternion.copy(q2.multiply(q1));
    bone.updateMatrixWorld(true);
  }

  private readonly ikA = new THREE.Vector3();
  private readonly ikT = new THREE.Vector3();
  private readonly ikN = new THREE.Vector3();
  private readonly ikM = new THREE.Vector3();
  private readonly ikK = new THREE.Vector3();
  private readonly ikB = new THREE.Vector3();
  private readonly ikC = new THREE.Vector3();

  /**
   * Places a two-bone limb: `upper`'s far end (the joint `lower`) bends
   * toward `pole`, `end` reaches for `target` (as near as the limb's length
   * allows). Targets and pole in world space.
   */
  solveLimb(upper: FigureBone, lower: FigureBone, end: FigureBone, target: THREE.Vector3, pole: THREE.Vector3): void {
    const a = this.lengths.get(upper)!;
    const b = this.lengths.get(lower)!;
    const upperBone = this.bone(upper);
    const lowerBone = this.bone(lower);
    const endBone = this.bone(end);
    const A = upperBone.getWorldPosition(this.ikA);
    const toTarget = this.ikN.subVectors(target, A);
    const reach = toTarget.length();
    if (reach < 1e-5) return;
    const d = Math.min(Math.max(reach, Math.abs(a - b) + 1e-3), (a + b) * 0.9995);
    const n = toTarget.multiplyScalar(1 / reach);
    // The bend's direction: toward the pole, square to the limb's line.
    const m = this.ikM.subVectors(pole, A);
    m.addScaledVector(n, -m.dot(n));
    if (m.lengthSq() < 1e-8) m.set(0, 0, 1).addScaledVector(n, -n.z);
    m.normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const knee = this.ikK.copy(A).addScaledVector(n, x).addScaledVector(m, h);
    this.aim(upperBone, lowerBone.getWorldPosition(this.ikB), knee);
    const reached = this.ikT.copy(A).addScaledVector(n, d);
    this.aim(lowerBone, endBone.getWorldPosition(this.ikC), reached);
  }

  /** Keeps a foot as it was at rest relative to the figure: flat on the ground. */
  levelFoot(foot: "LeftFoot" | "RightFoot"): void {
    this.root.getWorldQuaternion(q0);
    this.setBoneWorldQuaternion(foot, q0.multiply(this.footRest.get(foot)!));
  }

  dispose(): void {
    this.root.removeFromParent();
    // The geometry and materials belong to the loaded asset (shared by every clone).
  }
}
