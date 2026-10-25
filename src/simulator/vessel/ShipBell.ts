import * as THREE from "three";

/**
 * The ship's bell on the front of the mast, above the cabin top: a polished
 * bronze bell (about 20 cm across the mouth) hung from a bracket, with its
 * lanyard. It is where the bell's sound comes from (`AudioSystem.bell`), so
 * the ring is beside the helmsman and to one side from the chase camera.
 *
 * When struck it shivers on its bracket and its clapper swings back; at sea
 * the clapper hangs plumb while the yacht rolls about it.
 *
 * Built in vessel space (metres, +Z the bow, +X starboard), parented to
 * `Vessel.root`. Four meshes, one geometry each.
 */
export class ShipBell {
  readonly group = new THREE.Group();
  /** Where the sound comes from (the bell's mouth), vessel space. */
  readonly soundPoint = new THREE.Vector3();
  private readonly bell = new THREE.Group();
  private readonly clapper = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private shiver = 0;
  private shiverVelocity = 0;
  private clapperAngle = 0;
  private clapperVelocity = 0;

  constructor(mastFront: THREE.Vector3, deckHeight: number) {
    const bronze = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.74, 0.5, 0.22, THREE.SRGBColorSpace), metalness: 1, roughness: 0.22, envMapIntensity: 1.2 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1a6, metalness: 0.9, roughness: 0.35 });
    const rope = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, metalness: 0, roughness: 0.9 });
    this.materials.push(bronze, steel, rope);

    // The bell's profile: crown, waist, flare out to a thick lip (a lathe
    // around Y, outside then back up the inside so it reads as cast metal).
    const outside: [number, number][] = [
      [0.0, 0.205], [0.03, 0.204], [0.052, 0.196], [0.06, 0.182], [0.061, 0.15], [0.064, 0.11], [0.072, 0.07], [0.086, 0.035], [0.1, 0.012], [0.104, 0.0],
    ];
    const inside: [number, number][] = [
      [0.092, 0.0], [0.086, 0.012], [0.075, 0.034], [0.062, 0.068], [0.055, 0.11], [0.052, 0.15], [0.045, 0.178], [0.0, 0.188],
    ];
    const profile = [...outside, ...inside].map(([r, y]) => new THREE.Vector2(r, y));
    const bellGeometry = new THREE.LatheGeometry(profile, 40);
    bellGeometry.translate(0, -0.205, 0);
    // A ring for the crown's shackle.
    const crown = new THREE.TorusGeometry(0.018, 0.006, 8, 16);
    crown.translate(0, 0.012, 0);
    const bellMesh = new THREE.Mesh(bellGeometry, bronze);
    const crownMesh = new THREE.Mesh(crown, bronze);
    bellMesh.castShadow = true;
    this.bell.add(bellMesh, crownMesh);

    // The clapper: a rod and a ball, with the lanyard's short tail below.
    const clapperGeometry = new THREE.CylinderGeometry(0.005, 0.005, 0.15, 6);
    clapperGeometry.translate(0, -0.075, 0);
    const ball = new THREE.SphereGeometry(0.019, 12, 8);
    ball.translate(0, -0.155, 0);
    const lanyard = new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6);
    lanyard.translate(0, -0.28, 0);
    const clapperMesh = new THREE.Mesh(clapperGeometry, steel);
    const ballMesh = new THREE.Mesh(ball, bronze);
    const lanyardMesh = new THREE.Mesh(lanyard, rope);
    this.clapper.add(clapperMesh, ballMesh, lanyardMesh);
    this.clapper.position.set(0, -0.02, 0);
    this.bell.add(this.clapper);

    // The bracket: a stainless arm bolted to the mast, the bell hanging from its end.
    const arm = new THREE.BoxGeometry(0.03, 0.03, 0.17);
    arm.translate(0, 0.03, -0.085);
    const plate = new THREE.BoxGeometry(0.08, 0.14, 0.012);
    plate.translate(0, 0.0, -0.17);
    const armMesh = new THREE.Mesh(arm, steel);
    const plateMesh = new THREE.Mesh(plate, steel);
    this.geometries.push(bellGeometry, crown, clapperGeometry, ball, lanyard, arm, plate);

    // About 1.1 m above the cabin top on the mast's forward face, clear of the boom.
    const hangY = deckHeight + 1.15;
    this.group.position.set(mastFront.x, hangY, mastFront.z + 0.17);
    this.group.add(armMesh, plateMesh, this.bell);
    this.soundPoint.set(mastFront.x, hangY - 0.12, mastFront.z + 0.17);
  }

  /** The clapper strikes: the bell shivers and the clapper swings back. */
  strike(force = 1): void {
    this.shiverVelocity += 1.6 * force;
    this.clapperVelocity -= 9 * force;
  }

  /** Swings the clapper (a damped pendulum about the yacht's roll and pitch) and settles the shiver. */
  update(delta: number, roll: number, pitch: number): void {
    let remaining = Math.min(delta, 0.1);
    while (remaining > 1e-5) {
      const step = Math.min(remaining, 1 / 120);
      // Shiver: a stiff, lightly damped spring.
      this.shiverVelocity += (-420 * this.shiver - 9 * this.shiverVelocity) * step;
      this.shiver += this.shiverVelocity * step;
      // Clapper: a pendulum hanging plumb while the hull rolls under it,
      // stopped by the inside of the bell.
      const plumb = roll;
      this.clapperVelocity += (-38 * Math.sin(this.clapperAngle - plumb) - 1.6 * this.clapperVelocity) * step;
      this.clapperAngle += this.clapperVelocity * step;
      const reach = 0.32;
      if (Math.abs(this.clapperAngle) > reach) {
        this.clapperAngle = Math.sign(this.clapperAngle) * reach;
        this.clapperVelocity *= -0.35;
      }
      remaining -= step;
    }
    this.bell.rotation.set(this.shiver * 0.05 - pitch * 0.15, 0, this.shiver * 0.08);
    this.clapper.rotation.z = this.clapperAngle;
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
  }
}
