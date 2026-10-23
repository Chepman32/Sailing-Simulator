import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { gripAngles, helmsmanLean, solveTwoBone, type Vec3 } from "./HelmsmanPose";

/**
 * The helmsman: a man in a polo shirt, shorts, deck shoes, cap and
 * sunglasses, standing behind the starboard wheel with both hands on the rim.
 * His legs stand with the deck; above the waist he leans against the heel and
 * pitch to stay near upright, and his arms follow the wheel through two-bone
 * inverse kinematics so the hands never leave the rim.
 *
 * Built from smooth lathed shapes (no asset download), merged per material:
 * sixteen small draw calls. Coordinates are in helm station space (+Z bow,
 * +X starboard, metres); the figure faces the bow, so his left is +X.
 */

/** Body landmarks above the deck, metres (a 1.78 m man; eyes at 1.6 m, as `HELM_EYE`). */
const HIP_Y = 0.93;
const WAIST_Y = 1.0;
const SHOULDER_Y = 1.45;
const SHOULDER_HALF = 0.19;
const UPPER_ARM = 0.29;
/** Elbow to the middle of the grip (forearm plus hand). */
const LOWER_ARM = 0.35;
const HAND_START = 0.26;

const SKIN = 0xc99069;
const SHIRT = 0x29506f;
const SHORTS = 0xb9a582;
const SHOE = 0x4a3528;
const SOLE = 0xe8e2d6;
const CAP = 0xe7e2d6;
const CAP_BAND = 0x29506f;
const HAIR = 0x3a2a1f;

/** A smooth body of revolution along +Y from a [radius, height] profile, optionally flattened front to back. */
function lathe(profile: readonly (readonly [number, number])[], segments: number, depthScale = 1): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), segments);
  if (depthScale !== 1) geometry.scale(1, 1, depthScale);
  return geometry;
}

/** A tapered limb segment along +Y, `length` long, rounded at both ends. */
function limb(length: number, top: number, bottom: number, bulge = 0): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0, 0],
    [top * 0.72, length * 0.02],
    [top, length * 0.1],
    [(top + bottom) / 2 + bulge, length * 0.42],
    [bottom * 1.02, length * 0.8],
    [bottom, length * 0.92],
    [bottom * 0.7, length * 0.985],
    [0, length],
  ];
  return lathe(profile, 14);
}

function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotation?: THREE.Euler): THREE.BufferGeometry {
  if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
  geometry.translate(x, y, z);
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((part) => {
    const plain = part.index ? part.toNonIndexed() : part;
    if (plain !== part) part.dispose();
    for (const name of Object.keys(plain.attributes)) if (name !== "position" && name !== "normal") plain.deleteAttribute(name);
    return plain;
  });
  const merged = mergeGeometries(prepared, false);
  for (const part of prepared) part.dispose();
  if (!merged) throw new Error("Helmsman geometry could not be merged.");
  merged.computeBoundingSphere();
  return merged;
}

const UP = new THREE.Vector3(0, 1, 0);

type Arm = {
  readonly side: 1 | -1;
  readonly upper: THREE.Group;
  readonly lower: THREE.Group;
};

export class Helmsman {
  readonly group = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: Arm[];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly shoulder = new THREE.Vector3();
  private readonly grip = new THREE.Vector3();
  private readonly elbow: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly pole = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private headYaw = 0;

  /**
   * @param standing where his feet are (station space, on the deck)
   * @param wheelMount the wheel's mount: rim points are given in its frame, the rim's top on +Y
   * @param wheelRadius rim radius, metres
   */
  constructor(standing: THREE.Vector3, private readonly wheelMount: THREE.Object3D, private readonly wheelRadius: number) {
    this.group.name = "Helmsman";
    this.group.position.copy(standing);
    const material = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const made = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
      this.materials.push(made);
      return made;
    };
    const skin = material(SKIN, 0.58);
    const shirt = material(SHIRT, 0.86);
    const shorts = material(SHORTS, 0.9);
    const shoes = material(SHOE, 0.6);
    const cap = material(CAP, 0.82);
    const hair = material(HAIR, 0.75);
    const lenses = material(0x0b0d10, 0.08, { metalness: 0.6, envMapIntensity: 1.6 });
    const mesh = (geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, name: string) => {
      const made = new THREE.Mesh(geometry, mat);
      made.name = name;
      made.castShadow = true;
      made.receiveShadow = true;
      this.geometries.push(geometry);
      parent.add(made);
      return made;
    };

    // --- Legs: they stand with the deck, knees soft, feet a little apart ----------------
    const shortsParts: THREE.BufferGeometry[] = [
      // Seat of the shorts around the pelvis.
      at(lathe([[0, -0.02], [0.12, 0], [0.15, 0.05], [0.158, 0.12], [0.152, 0.17], [0, 0.17]], 18, 0.7), 0, HIP_Y - 0.06, 0),
    ];
    const legSkin: THREE.BufferGeometry[] = [];
    const shoeParts: THREE.BufferGeometry[] = [];
    const soleParts: THREE.BufferGeometry[] = [];
    const knee: Vec3 = { x: 0, y: 0, z: 0 };
    for (const side of [1, -1] as const) {
      const hip = { x: side * 0.095, y: HIP_Y, z: 0 };
      const ankle = { x: side * 0.15, y: 0.085, z: -0.02 };
      solveTwoBone(hip, ankle, 0.45, 0.43, { x: side * 0.12, y: 0.5, z: 1 }, knee);
      const thigh = new THREE.Vector3(knee.x - hip.x, knee.y - hip.y, knee.z - hip.z);
      const shin = new THREE.Vector3(ankle.x - knee.x, ankle.y - knee.y, ankle.z - knee.z);
      const shinTurn = new THREE.Quaternion().setFromUnitVectors(UP, shin.clone().normalize());
      // Shorts leg to just above the knee, then the bare knee and calf.
      const shortsLeg = new THREE.CylinderGeometry(0.085, 0.095, thigh.length() * 0.64, 16, 1, true).translate(0, -thigh.length() * 0.32, 0);
      shortsLeg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), thigh.clone().normalize()));
      shortsParts.push(shortsLeg.translate(hip.x, hip.y, hip.z));
      shortsParts.push(at(new THREE.SphereGeometry(0.095, 14, 10), hip.x, hip.y, hip.z));
      // Thigh to the knee (mostly inside the shorts), then the calf.
      const thighGeometry = limb(thigh.length(), 0.075, 0.07, 0.008);
      thighGeometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, thigh.clone().normalize()));
      legSkin.push(thighGeometry.translate(hip.x, hip.y, hip.z));
      const calf = limb(shin.length(), 0.056, 0.042, 0.01);
      calf.applyQuaternion(shinTurn);
      legSkin.push(calf.translate(knee.x, knee.y, knee.z));
      // Deck shoe: a rounded last with a pale sole, toes toward the bow.
      const shoe = new THREE.SphereGeometry(1, 18, 10);
      shoe.scale(0.05, 0.045, 0.135).translate(0, 0.045, 0.06);
      shoeParts.push(shoe.translate(ankle.x, 0, ankle.z));
      const sole = new THREE.CylinderGeometry(1, 1, 0.02, 18);
      sole.scale(0.052, 1, 0.14).translate(ankle.x, 0.01, ankle.z + 0.06);
      soleParts.push(sole);
    }
    mesh(merge(shortsParts), shorts, this.group, "HelmsmanShorts");
    mesh(merge(legSkin), skin, this.group, "HelmsmanLegs");
    mesh(merge(shoeParts), shoes, this.group, "HelmsmanShoes");
    mesh(merge(soleParts), material(SOLE, 0.7), this.group, "HelmsmanSoles");

    // --- Upper body: leans about the waist ------------------------------------------------
    this.torso.position.set(0, WAIST_Y, 0);
    this.torso.rotation.order = "XZY";
    this.group.add(this.torso);
    const chest = lathe(
      [
        [0, -0.06],
        [0.155, -0.05],
        [0.152, 0.06],
        [0.16, 0.17],
        [0.178, 0.29],
        [0.182, 0.37],
        [0.165, 0.43],
        [0.12, 0.47],
        [0.07, 0.49],
        [0, 0.49],
      ],
      24,
      0.66,
    );
    const collar = new THREE.TorusGeometry(0.062, 0.014, 8, 20).rotateX(Math.PI / 2 + 0.25).translate(0, 0.49, 0.005);
    const shoulders = [1, -1].map((side) =>
      at(new THREE.SphereGeometry(0.066, 14, 10), side * (SHOULDER_HALF - 0.01), SHOULDER_Y - WAIST_Y - 0.01, 0),
    );
    mesh(merge([chest, collar, ...shoulders]), shirt, this.torso, "HelmsmanShirt");

    this.head.position.set(0, SHOULDER_Y - WAIST_Y + 0.07, 0.01);
    this.torso.add(this.head);
    const neck = limb(0.12, 0.058, 0.055).translate(0, -0.04, 0);
    const skull = new THREE.SphereGeometry(1, 24, 18).scale(0.088, 0.112, 0.1).translate(0, 0.15, 0.008);
    const jaw = new THREE.SphereGeometry(1, 18, 12).scale(0.07, 0.06, 0.075).translate(0, 0.095, 0.03);
    const nose = new THREE.ConeGeometry(0.016, 0.042, 10).rotateX(Math.PI / 2 + 0.35).translate(0, 0.143, 0.108);
    const ears = [1, -1].map((side) => new THREE.SphereGeometry(1, 10, 8).scale(0.012, 0.028, 0.02).translate(side * 0.089, 0.145, 0));
    mesh(merge([neck, skull, jaw, nose, ...ears]), skin, this.head, "HelmsmanHead");
    // Short hair showing under the cap at the back and sides.
    const hairShell = new THREE.SphereGeometry(1, 22, 14, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.33)
      .scale(0.092, 0.116, 0.104)
      .rotateX(-0.45)
      .translate(0, 0.154, -0.004);
    mesh(merge([hairShell]), hair, this.head, "HelmsmanHair");
    // Cap: crown, a band, and a brim over the eyes.
    const crown = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.097, 0.075, 0.108).translate(0, 0.188, 0.004);
    const brim = new THREE.CylinderGeometry(1, 1, 0.008, 22, 1, false, -Math.PI * 0.42, Math.PI * 0.84)
      .scale(0.1, 1, 0.13)
      .rotateX(0.16)
      .translate(0, 0.186, 0.03);
    mesh(merge([crown, brim]), cap, this.head, "HelmsmanCap");
    const band = new THREE.TorusGeometry(1, 0.06, 6, 28).scale(0.098, 0.109, 0.11).rotateX(Math.PI / 2).translate(0, 0.191, 0.004);
    const bandMaterial = material(CAP_BAND, 0.8);
    mesh(merge([band]), bandMaterial, this.head, "HelmsmanCapBand");
    // Wrap-around sunglasses.
    const glasses = new THREE.CylinderGeometry(1, 1, 0.032, 24, 1, true, -Math.PI * 0.36, Math.PI * 0.72)
      .scale(0.094, 1, 0.104)
      .translate(0, 0.158, 0.012);
    mesh(merge([glasses]), lenses, this.head, "HelmsmanSunglasses");

    // --- Arms: placed every frame by inverse kinematics ---------------------------------
    this.arms = ([1, -1] as const).map((side) => {
      const upper = new THREE.Group();
      const lower = new THREE.Group();
      upper.name = side > 0 ? "HelmsmanLeftUpperArm" : "HelmsmanRightUpperArm";
      lower.name = side > 0 ? "HelmsmanLeftForearm" : "HelmsmanRightForearm";
      // Short sleeve over the top half of the upper arm.
      mesh(new THREE.CylinderGeometry(0.06, 0.064, UPPER_ARM * 0.55, 14, 1, true).translate(0, UPPER_ARM * 0.27, 0), shirt, upper, "HelmsmanSleeve");
      mesh(limb(UPPER_ARM, 0.052, 0.042, 0.006), skin, upper, "HelmsmanUpperArm");
      const forearm = limb(HAND_START + 0.01, 0.042, 0.03, 0.006);
      // Hand closed around the rim: a flattened palm and a thumb across it.
      const palm = new THREE.SphereGeometry(1, 14, 10).scale(0.036, 0.055, 0.024).translate(0, HAND_START + 0.045, 0.004);
      const thumb = limb(0.05, 0.012, 0.01).rotateZ(side * 0.9).translate(side * 0.01, HAND_START + 0.02, 0.018);
      const fist = new THREE.SphereGeometry(1, 12, 8).scale(0.038, 0.03, 0.03).translate(0, HAND_START + 0.085, 0.01);
      mesh(merge([forearm, palm, thumb, fist]), skin, lower, "HelmsmanForearm");
      this.group.add(upper, lower);
      return { side, upper, lower };
    });
  }

  /** Hidden for the first-person helm view, where the camera is his eyes. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * @param wheelAngle the wheel's current rotation about its axle, radians
   * @param roll hull heel, radians (as `VesselPhysics.roll`)
   * @param pitch hull pitch, radians
   * @param rudder normalised rudder, −1…1 (he glances where he steers)
   */
  update(delta: number, time: number, wheelAngle: number, roll: number, pitch: number, rudder: number): void {
    if (!this.group.visible) return;
    const lean = helmsmanLean(roll, pitch, time);
    this.torso.rotation.set(lean.pitch, 0, lean.roll);
    this.headYaw = THREE.MathUtils.damp(this.headYaw, -rudder * 0.45, 2.5, delta);
    // The head steadies the gaze a little against the body's sway.
    this.head.rotation.set(-lean.pitch * 0.4, this.headYaw, -lean.roll * 0.35, "YXZ");
    this.torso.updateMatrix();
    this.wheelMount.updateMatrix();
    const grips = gripAngles(wheelAngle);
    for (const arm of this.arms) {
      // Shoulder in figure space, carried by the leaning torso.
      this.shoulder.set(arm.side * SHOULDER_HALF, SHOULDER_Y - WAIST_Y - 0.03, 0.0).applyMatrix4(this.torso.matrix);
      const angle = arm.side > 0 ? grips.left : grips.right;
      // Rim point in the wheel's frame (its top on +Y; positive angles toward his left), then figure space.
      this.grip
        .set(-Math.sin(angle) * this.wheelRadius, Math.cos(angle) * this.wheelRadius, -0.01)
        .applyMatrix4(this.wheelMount.matrix)
        .sub(this.group.position);
      // Elbows bend down, out and a little back, as on a wheel held at ten to two.
      this.pole.set(this.shoulder.x + arm.side * 0.45, this.shoulder.y - 0.55, this.shoulder.z - 0.25);
      solveTwoBone(this.shoulder, this.grip, UPPER_ARM, LOWER_ARM, this.pole, this.elbow);
      arm.upper.position.copy(this.shoulder);
      this.direction.set(this.elbow.x - this.shoulder.x, this.elbow.y - this.shoulder.y, this.elbow.z - this.shoulder.z).normalize();
      arm.upper.quaternion.setFromUnitVectors(UP, this.direction);
      arm.lower.position.set(this.elbow.x, this.elbow.y, this.elbow.z);
      this.direction.set(this.grip.x - this.elbow.x, this.grip.y - this.elbow.y, this.grip.z - this.elbow.z).normalize();
      arm.lower.quaternion.setFromUnitVectors(UP, this.direction);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
