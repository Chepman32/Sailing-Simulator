import * as THREE from "three";

/**
 * The skipper at the wheel: a figure of simple solids (lathed torso, tapered
 * limbs, cap and sunglasses) in sailing clothes. Standing on the helm
 * station's deck he keeps himself upright as she heels and pitches, a little
 * late and with a sway (a damped spring on each axis), so he visibly leans
 * against the heel. His hands stay on the rim: each arm is a two-bone chain
 * solved every frame to a grip on the wheel that turns with it, sliding round
 * when the helm goes hard over as a helmsman shifts his grip. He looks about
 * now and then, up at the sails and out to sea.
 */

const SKIN = 0xc68d6c;
const SHIRT = 0x7fa9cf;
const SHORTS = 0xb39d7a;
const CAP = 0x1d2b44;
const SHOES = 0x5e432c;

/** Upper arm and forearm (with the hand), metres. */
const UPPER_ARM = 0.3;
const FOREARM = 0.31;

type Bone = { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3 };

/** A limb segment: a tapered tube one metre long along +Y, centred, scaled to length when placed. */
function limb(radiusTop: number, radiusBottom: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 10, 1, false);
  return geometry;
}

export class Skipper {
  readonly group = new THREE.Group();
  /** The upper body (above the hips) and head, posed against the lean. */
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly arms: { upper: Bone; fore: Bone; hand: THREE.Mesh; shoulder: THREE.Vector3; side: number }[] = [];
  private lean = { x: 0, z: 0, vx: 0, vz: 0 };
  private readonly target = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly grip = new THREE.Vector3();

  /**
   * @param feet where he stands (vessel space), facing +Z (forward).
   * @param wheelFrame the wheel's mount (not turning), whose local XY plane is the rim's.
   * @param wheelRadius the rim's radius.
   */
  constructor(
    feet: THREE.Vector3,
    private readonly wheelFrame: THREE.Object3D,
    private readonly wheelRadius: number,
  ) {
    this.group.name = "Skipper";
    this.group.position.copy(feet);
    const skin = this.material(SKIN, 0.62);
    const shirt = this.material(SHIRT, 0.86);
    const shorts = this.material(SHORTS, 0.9);
    const cap = this.material(CAP, 0.7);
    const shoes = this.material(SHOES, 0.6);
    const glasses = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.08, metalness: 0.6 });
    this.materials.push(glasses);

    // Legs, a little apart for balance; deck shoes.
    for (const side of [-1, 1]) {
      const foot = this.add(new THREE.BoxGeometry(0.1, 0.075, 0.27), shoes, this.group);
      foot.position.set(side * 0.16, 0.04, 0.05);
      foot.rotation.y = side * 0.12;
      const ankle = new THREE.Vector3(side * 0.16, 0.08, 0);
      const knee = new THREE.Vector3(side * 0.135, 0.49, 0.025);
      const hip = new THREE.Vector3(side * 0.1, 0.9, 0);
      this.place(this.add(limb(0.052, 0.04), skin, this.group), ankle, knee);
      this.place(this.add(limb(0.078, 0.062), shorts, this.group), knee.clone().add(new THREE.Vector3(0, -0.05, 0)), hip);
      const kneeCap = this.add(new THREE.SphereGeometry(0.055, 10, 8), skin, this.group);
      kneeCap.position.copy(knee);
    }
    // Hips (shorts) and the torso (shirt), lathed and flattened front to back.
    this.body.position.set(0, 0.9, 0);
    this.group.add(this.body);
    const pelvis = this.add(
      new THREE.LatheGeometry(
        [new THREE.Vector2(0.001, -0.08), new THREE.Vector2(0.16, -0.06), new THREE.Vector2(0.175, 0.04), new THREE.Vector2(0.16, 0.12), new THREE.Vector2(0.001, 0.13)],
        18,
      ),
      shorts,
      this.body,
    );
    pelvis.scale.set(1, 1, 0.68);
    const torso = this.add(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.001, 0.06),
          new THREE.Vector2(0.158, 0.08),
          new THREE.Vector2(0.15, 0.2),
          new THREE.Vector2(0.168, 0.34),
          new THREE.Vector2(0.192, 0.44),
          new THREE.Vector2(0.2, 0.5),
          new THREE.Vector2(0.17, 0.545),
          new THREE.Vector2(0.075, 0.575),
          new THREE.Vector2(0.001, 0.58),
        ],
        20,
      ),
      shirt,
      this.body,
    );
    torso.scale.set(1, 1, 0.62);
    const neck = this.add(limb(0.048, 0.055), skin, this.body);
    neck.position.set(0, 0.62, 0.005);
    neck.scale.set(1, 0.12, 1);
    // Head: face forward (+Z), eyes about 1.6 m above the deck.
    this.head.position.set(0, 0.7, 0.01);
    this.body.add(this.head);
    const skull = this.add(new THREE.SphereGeometry(0.1, 18, 14), skin, this.head);
    skull.scale.set(0.92, 1.1, 1);
    skull.position.y = 0.03;
    const nose = this.add(new THREE.ConeGeometry(0.018, 0.045, 8), skin, this.head);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.015, 0.105);
    for (const side of [-1, 1]) {
      const ear = this.add(new THREE.SphereGeometry(0.024, 8, 6), skin, this.head);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(side * 0.093, 0.025, 0);
    }
    const shades = this.add(new THREE.BoxGeometry(0.17, 0.035, 0.02), glasses, this.head);
    shades.position.set(0, 0.045, 0.094);
    const crown = this.add(new THREE.SphereGeometry(0.106, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), cap, this.head);
    crown.scale.set(0.95, 0.85, 1.02);
    crown.position.y = 0.075;
    const brim = this.add(new THREE.CylinderGeometry(0.075, 0.08, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), cap, this.head);
    brim.position.set(0, 0.078, 0.07);
    brim.rotation.x = 0.12;
    // Arms: shoulder sockets on the torso; the segments are posed every frame.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.205, 0.49, 0);
      const ball = this.add(new THREE.SphereGeometry(0.06, 10, 8), shirt, this.body);
      ball.position.copy(shoulder);
      const upper: Bone = { mesh: this.add(limb(0.05, 0.044), shirt, this.body), from: shoulder.clone(), to: new THREE.Vector3() };
      const fore: Bone = { mesh: this.add(limb(0.04, 0.032), skin, this.body), from: new THREE.Vector3(), to: new THREE.Vector3() };
      const hand = this.add(new THREE.SphereGeometry(0.042, 10, 8), skin, this.body);
      hand.scale.set(0.8, 1.15, 0.7);
      this.arms.push({ upper, fore, hand, shoulder, side });
    }
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }

  private material(color: number, roughness: number): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.materials.push(material);
    return material;
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  /** Lays a unit-length limb mesh from `a` to `b`. */
  private place(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    this.axis.subVectors(b, a);
    const length = Math.max(1e-4, this.axis.length());
    mesh.position.copy(a).addScaledVector(this.axis, 0.5);
    mesh.quaternion.setFromUnitVectors(this.up, this.axis.multiplyScalar(1 / length));
    mesh.scale.set(1, length, 1);
  }

  /**
   * @param roll, pitch the hull's heel and trim (radians, as the vessel root is posed).
   * @param wheelTurn the wheel's rotation about its axis (radians).
   */
  update(time: number, delta: number, roll: number, pitch: number, wheelTurn: number): void {
    const dt = Math.min(0.05, Math.max(0, delta));
    // He stands up to gravity: lean against the hull's tilt, a little late.
    const lean = this.lean;
    const targetZ = roll * 0.82;
    const targetX = -pitch * 0.6;
    const stiffness = 30;
    const damping = 7.5;
    lean.vz += ((targetZ - lean.z) * stiffness - lean.vz * damping) * dt;
    lean.vx += ((targetX - lean.x) * stiffness - lean.vx * damping) * dt;
    lean.z += lean.vz * dt;
    lean.x += lean.vx * dt;
    // From the ankles the whole figure leans; the upper body adds a little more, and breathes.
    this.group.rotation.set(lean.x * 0.55, 0, lean.z * 0.6);
    this.body.rotation.set(lean.x * 0.45 + 0.04, 0, lean.z * 0.4);
    this.body.scale.y = 1 + Math.sin(time * 1.6) * 0.006;
    // A look round: mostly ahead, now and then up the sails or out to the side.
    const glance = Math.sin(time * 0.21) * 0.5 + Math.sin(time * 0.083 + 1.3) * 0.35;
    const look = Math.max(-0.9, Math.min(0.9, glance * Math.abs(glance) * 1.4));
    const tilt = Math.max(0, Math.sin(time * 0.17 + 2)) * 0.32;
    this.head.rotation.set(-tilt, look, -lean.z * 0.25);
    this.group.updateMatrixWorld(true);

    const grips = Math.max(-0.75, Math.min(0.75, wheelTurn));
    for (const arm of this.arms) {
      // Hands at ten to two, turning with the rim until the grip has to shift.
      // (A turn of +r about the rim's axis moves a grip at angle a, from the top, to a − r.)
      const angle = -arm.side * 1.0 - grips;
      this.grip.set(Math.sin(angle) * this.wheelRadius, Math.cos(angle) * this.wheelRadius, 0);
      this.wheelFrame.localToWorld(this.grip);
      this.body.worldToLocal(this.target.copy(this.grip));
      // Two-bone chain: shoulder to the grip, the elbow out and down.
      const shoulder = arm.shoulder;
      this.axis.subVectors(this.target, shoulder);
      let distance = this.axis.length();
      const reach = UPPER_ARM + FOREARM - 0.005;
      if (distance > reach) {
        this.target.copy(shoulder).addScaledVector(this.axis, reach / distance);
        distance = reach;
      }
      this.axis.normalize();
      const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + distance * distance) / (2 * distance);
      const out = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
      this.pole.set(arm.side * 0.8, -1, -0.25);
      this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis)).normalize();
      this.elbow.copy(shoulder).addScaledVector(this.axis, along).addScaledVector(this.pole, out);
      this.place(arm.upper.mesh, shoulder, this.elbow);
      this.place(arm.fore.mesh, this.elbow, this.target);
      arm.hand.position.copy(this.target);
      arm.hand.quaternion.copy(arm.fore.mesh.quaternion);
    }
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
  }
}
