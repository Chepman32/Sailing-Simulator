import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * A procedurally modelled, articulated adult (1.78 m at scale 1) built as one
 * SkinnedMesh so the whole figure costs a single draw call and a single shadow
 * call. Every vertex is rigidly bound to one bone; overlapping joint spheres
 * hide the seams. Bones start in a neutral standing pose with identity
 * rotations, which keeps procedural animation and IK straightforward.
 *
 * Axes: the figure faces +Z, +Y is up and its left side is +X (three.js is
 * right-handed, so an observer facing +Z has +X on their left).
 */

export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "clavicleL"
  | "upperArmL"
  | "forearmL"
  | "handL"
  | "clavicleR"
  | "upperArmR"
  | "forearmR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR";

type BoneDefinition = { name: BoneName; parent: BoneName | null; offset: [number, number, number] };

const BONES: readonly BoneDefinition[] = [
  { name: "hips", parent: null, offset: [0, 0.96, 0] },
  { name: "spine", parent: "hips", offset: [0, 0.1, 0] },
  { name: "chest", parent: "spine", offset: [0, 0.22, 0] },
  { name: "neck", parent: "chest", offset: [0, 0.21, -0.005] },
  { name: "head", parent: "neck", offset: [0, 0.09, 0.01] },
  { name: "clavicleL", parent: "chest", offset: [0.055, 0.155, -0.01] },
  { name: "upperArmL", parent: "clavicleL", offset: [0.135, 0, 0] },
  { name: "forearmL", parent: "upperArmL", offset: [0, -0.29, 0] },
  { name: "handL", parent: "forearmL", offset: [0, -0.255, 0] },
  { name: "clavicleR", parent: "chest", offset: [-0.055, 0.155, -0.01] },
  { name: "upperArmR", parent: "clavicleR", offset: [-0.135, 0, 0] },
  { name: "forearmR", parent: "upperArmR", offset: [0, -0.29, 0] },
  { name: "handR", parent: "forearmR", offset: [0, -0.255, 0] },
  { name: "thighL", parent: "hips", offset: [0.098, -0.055, 0] },
  { name: "shinL", parent: "thighL", offset: [0, -0.44, 0] },
  { name: "footL", parent: "shinL", offset: [0, -0.43, 0] },
  { name: "thighR", parent: "hips", offset: [-0.098, -0.055, 0] },
  { name: "shinR", parent: "thighR", offset: [0, -0.44, 0] },
  { name: "footR", parent: "shinR", offset: [0, -0.43, 0] },
];

export const UPPER_ARM_LENGTH = 0.29;
export const FOREARM_LENGTH = 0.255;
export const THIGH_LENGTH = 0.44;
export const SHIN_LENGTH = 0.43;

export type FigureOutfit = {
  skin: THREE.ColorRepresentation;
  shirt: THREE.ColorRepresentation;
  shorts: THREE.ColorRepresentation;
  shoes: THREE.ColorRepresentation;
  hair: THREE.ColorRepresentation;
  /** Cap colour; null for bare hair. */
  cap: THREE.ColorRepresentation | null;
  sunglasses: boolean;
  /** Fraction of the upper arm covered by the sleeve (0 = sleeveless). */
  sleeve: number;
};

export const SKIPPER_OUTFIT: FigureOutfit = {
  skin: 0xb98060,
  shirt: 0x1f3d63,
  shorts: 0xc9b58c,
  shoes: 0x5b3a24,
  hair: 0x3a2a1c,
  cap: 0xf1efe8,
  sunglasses: true,
  sleeve: 0.5,
};

type Part = { geometry: THREE.BufferGeometry; bone: BoneName };

function paint(geometry: THREE.BufferGeometry, colorAt: (y: number) => THREE.Color): THREE.BufferGeometry {
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    const color = colorAt(positions.getY(index));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function solid(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const value = new THREE.Color(color);
  return paint(geometry, () => value);
}

/** Lathe a limb that hangs from y=0 down to y=-length through the given radii. */
function limb(length: number, radii: readonly number[], segments = 10): THREE.BufferGeometry {
  const points = radii.map((radius, index) => new THREE.Vector2(radius, -length * (index / (radii.length - 1))));
  // Close both ends so the lathe has no open rims.
  points.unshift(new THREE.Vector2(0.0001, 0.004));
  points.push(new THREE.Vector2(0.0001, -length - 0.004));
  return new THREE.LatheGeometry(points, segments);
}

function ellipsoid(rx: number, ry: number, rz: number, widthSegments = 14, heightSegments = 10): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  geometry.scale(rx, ry, rz);
  return geometry;
}

export class HumanFigure {
  readonly mesh: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly bones = new Map<BoneName, THREE.Bone>();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchD = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly meshQuaternionInverse = new THREE.Quaternion();
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);

  constructor(outfit: FigureOutfit = SKIPPER_OUTFIT) {
    const restPositions = new Map<BoneName, THREE.Vector3>();
    for (const definition of BONES) {
      const bone = new THREE.Bone();
      bone.name = `Figure_${definition.name}`;
      bone.position.fromArray(definition.offset);
      this.bones.set(definition.name, bone);
      const parentRest = definition.parent ? restPositions.get(definition.parent)! : new THREE.Vector3();
      restPositions.set(definition.name, parentRest.clone().add(bone.position));
      if (definition.parent) this.bones.get(definition.parent)!.add(bone);
    }

    const parts: Part[] = [];
    const at = (geometry: THREE.BufferGeometry, bone: BoneName, offset = new THREE.Vector3()): void => {
      const rest = restPositions.get(bone)!;
      geometry.translate(rest.x + offset.x, rest.y + offset.y, rest.z + offset.z);
      parts.push({ geometry, bone });
    };
    const skin = new THREE.Color(outfit.skin);
    const shirt = new THREE.Color(outfit.shirt);
    const shorts = new THREE.Color(outfit.shorts);

    // Pelvis and shorts.
    const pelvis = ellipsoid(0.165, 0.12, 0.115, 16, 10);
    at(solid(pelvis, shorts), "hips", new THREE.Vector3(0, -0.02, -0.005));
    // Abdomen.
    const abdomen = new THREE.LatheGeometry(
      [[0.0001, -0.02], [0.138, -0.01], [0.142, 0.08], [0.15, 0.2], [0.0001, 0.23]].map(([x, y]) => new THREE.Vector2(x, y)),
      16,
    );
    abdomen.scale(1, 1, 0.74);
    at(solid(abdomen, shirt), "spine");
    // Chest with shoulders: wide and flattened front to back.
    const chest = new THREE.LatheGeometry(
      [[0.0001, -0.02], [0.15, 0], [0.165, 0.09], [0.168, 0.15], [0.14, 0.2], [0.07, 0.235], [0.0001, 0.24]].map(([x, y]) => new THREE.Vector2(x, y)),
      18,
    );
    chest.scale(1.12, 1, 0.66);
    at(solid(chest, shirt), "chest");
    // Neck.
    at(solid(new THREE.CylinderGeometry(0.047, 0.054, 0.12, 10).translate(0, 0.04, 0), skin), "neck");
    // Head: cranium, jaw, nose, ears, hair, optional cap and sunglasses.
    at(solid(ellipsoid(0.094, 0.112, 0.104), skin), "head", new THREE.Vector3(0, 0.1, 0.008));
    at(solid(ellipsoid(0.072, 0.05, 0.075), skin), "head", new THREE.Vector3(0, 0.035, 0.03));
    at(solid(new THREE.ConeGeometry(0.017, 0.045, 6).rotateX(Math.PI / 2), skin), "head", new THREE.Vector3(0, 0.085, 0.112));
    at(solid(ellipsoid(0.014, 0.027, 0.012, 6, 5), skin), "head", new THREE.Vector3(0.094, 0.095, 0));
    at(solid(ellipsoid(0.014, 0.027, 0.012, 6, 5), skin), "head", new THREE.Vector3(-0.094, 0.095, 0));
    at(solid(ellipsoid(0.098, 0.1, 0.106), outfit.hair), "head", new THREE.Vector3(0, 0.125, -0.008));
    if (outfit.cap !== null) {
      const crown = new THREE.SphereGeometry(0.104, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      crown.scale(1, 0.82, 1.06);
      at(solid(crown, outfit.cap), "head", new THREE.Vector3(0, 0.14, 0.004));
      const brim = new THREE.CylinderGeometry(0.075, 0.075, 0.009, 14, 1, false, -Math.PI / 2, Math.PI);
      brim.scale(1.15, 1, 1.25);
      at(solid(brim, outfit.cap), "head", new THREE.Vector3(0, 0.143, 0.085));
    }
    if (outfit.sunglasses) {
      at(solid(new THREE.BoxGeometry(0.17, 0.034, 0.014), 0x111417), "head", new THREE.Vector3(0, 0.107, 0.097));
    }

    // Arms: sleeve on the upper arm, skin below.
    const arm = (side: "L" | "R"): void => {
      const sign = side === "L" ? 1 : -1;
      at(solid(ellipsoid(0.062, 0.058, 0.06), shirt), `upperArm${side}`, new THREE.Vector3(sign * 0.005, -0.01, 0));
      const sleeveEnd = -UPPER_ARM_LENGTH * outfit.sleeve;
      const upper = paint(limb(UPPER_ARM_LENGTH, [0.05, 0.047, 0.043, 0.038]), (y) => (y > sleeveEnd ? shirt : skin));
      if (outfit.sleeve > 0) upper.scale(1.04, 1, 1.04);
      at(upper, `upperArm${side}`);
      at(solid(ellipsoid(0.039, 0.04, 0.039, 8, 6), skin), `forearm${side}`);
      at(solid(limb(FOREARM_LENGTH, [0.038, 0.04, 0.033, 0.027]), skin), `forearm${side}`);
      const hand = ellipsoid(0.026, 0.07, 0.044, 8, 6);
      at(solid(hand, skin), `hand${side}`, new THREE.Vector3(0, -0.065, 0.005));
      const thumb = ellipsoid(0.013, 0.032, 0.013, 6, 4).rotateZ(sign * 0.6);
      at(solid(thumb, skin), `hand${side}`, new THREE.Vector3(0, -0.035, 0.04));
    };
    arm("L");
    arm("R");

    // Legs: shorts to mid-thigh, then skin, boat shoes.
    const leg = (side: "L" | "R"): void => {
      const shortsEnd = -THIGH_LENGTH * 0.58;
      at(paint(limb(THIGH_LENGTH, [0.088, 0.083, 0.074, 0.06, 0.052]), (y) => (y > shortsEnd ? shorts : skin)), `thigh${side}`);
      at(solid(ellipsoid(0.053, 0.055, 0.056, 8, 6), skin), `shin${side}`);
      at(solid(limb(SHIN_LENGTH, [0.052, 0.05, 0.04, 0.032]), skin), `shin${side}`);
      at(solid(ellipsoid(0.046, 0.04, 0.124, 10, 6), outfit.shoes), `foot${side}`, new THREE.Vector3(0, -0.03, 0.06));
    };
    leg("L");
    leg("R");

    const boneIndex = new Map<BoneName, number>(BONES.map((definition, index) => [definition.name, index]));
    const prepared = parts.map(({ geometry, bone }) => {
      geometry.deleteAttribute("uv");
      const count = geometry.getAttribute("position").count;
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      const index = boneIndex.get(bone)!;
      for (let vertex = 0; vertex < count; vertex += 1) {
        skinIndex[vertex * 4] = index;
        skinWeight[vertex * 4] = 1;
      }
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      return flat;
    });
    const merged = mergeGeometries(prepared, false);
    prepared.forEach((geometry) => geometry.dispose());
    if (!merged) throw new Error("Human figure geometry could not be merged.");
    merged.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });
    this.mesh = new THREE.SkinnedMesh(merged, material);
    this.mesh.name = "Procedural_Articulated_Human";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Bones animate procedurally; the rest-pose bounds would cull wrongly.
    this.mesh.frustumCulled = false;
    const root = this.bones.get("hips")!;
    this.mesh.add(root);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(BONES.map((definition) => this.bones.get(definition.name)!)));
  }

  bone(name: BoneName): THREE.Bone {
    return this.bones.get(name)!;
  }

  /** Reset every joint to the neutral standing pose. */
  resetPose(): void {
    this.bones.forEach((bone) => bone.quaternion.identity());
  }

  /**
   * Analytic two-bone IK in the mesh's local space. Rotates `upper` and `lower`
   * so the end of `lower` reaches `targetWorld`, bending toward `poleWorld`.
   * Limbs hang along -Y in their rest pose. Unreachable targets straighten the
   * limb toward the target instead of stretching it.
   */
  solveTwoBone(
    upperName: BoneName,
    lowerName: BoneName,
    upperLength: number,
    lowerLength: number,
    targetWorld: THREE.Vector3,
    poleWorld: THREE.Vector3,
  ): void {
    const upper = this.bones.get(upperName)!;
    const lower = this.bones.get(lowerName)!;
    this.mesh.updateMatrixWorld(true);
    this.mesh.getWorldQuaternion(this.meshQuaternionInverse).invert();

    const start = this.mesh.worldToLocal(upper.getWorldPosition(this.scratchA));
    const target = this.mesh.worldToLocal(this.scratchB.copy(targetWorld));
    const pole = this.mesh.worldToLocal(this.scratchC.copy(poleWorld));
    const toTarget = target.sub(start);
    const distance = THREE.MathUtils.clamp(toTarget.length(), 0.02, upperLength + lowerLength - 0.002);
    const direction = toTarget.normalize();
    const cosine = THREE.MathUtils.clamp(
      (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * upperLength * distance),
      -1,
      1,
    );
    const sine = Math.sqrt(1 - cosine * cosine);
    const bend = pole.sub(start);
    bend.addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    bend.normalize();
    // Elbow / knee position in mesh space.
    const joint = this.scratchD.copy(start).addScaledVector(direction, upperLength * cosine).addScaledVector(bend, upperLength * sine);
    const end = direction.multiplyScalar(distance).add(start);

    this.aimBone(upper, joint.clone().sub(start));
    this.mesh.updateMatrixWorld(true);
    this.aimBone(lower, end.sub(joint));
  }

  /** Rotate a bone so its rest -Y axis points along `directionMesh` (mesh space). */
  private aimBone(bone: THREE.Bone, directionMesh: THREE.Vector3): void {
    const parent = bone.parent as THREE.Object3D;
    parent.getWorldQuaternion(this.scratchQuaternion);
    // Parent orientation relative to the mesh.
    this.scratchQuaternion.premultiply(this.meshQuaternionInverse);
    const local = directionMesh.normalize().applyQuaternion(this.scratchQuaternion.invert());
    bone.quaternion.setFromUnitVectors(HumanFigure.DOWN, local);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.skeleton.dispose();
  }
}
