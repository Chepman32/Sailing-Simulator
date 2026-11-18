import * as THREE from "three";

/**
 * The story's things in the world: a pickup (the repair kit in its
 * waterproof orange case) with a beacon that pulses so a diver finds it,
 * and the wreck it came from (the raiders' Zodiac, deflated on the sand).
 * Built in code, a handful of meshes, shared materials.
 */

const CASE_COLOR = 0xf26a1b;

export type StoryProp = { group: THREE.Group; beacon: THREE.Mesh | null; phase: number };

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class StoryProps {
  readonly group = new THREE.Group();
  private readonly caseGeometry = new THREE.BoxGeometry(0.62, 0.3, 0.42);
  private readonly lidGeometry = new THREE.BoxGeometry(0.64, 0.06, 0.44);
  private readonly handleGeometry = new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI);
  private readonly latchGeometry = new THREE.BoxGeometry(0.06, 0.08, 0.03);
  private readonly beaconGeometry = new THREE.SphereGeometry(0.05, 8, 6);
  private readonly ringGeometry = new THREE.RingGeometry(0.55, 0.75, 32);
  private readonly tubeGeometry = new THREE.CapsuleGeometry(0.24, 3.2, 4, 10);
  private readonly bowGeometry = new THREE.TorusGeometry(0.62, 0.24, 8, 16, Math.PI);
  private readonly floorGeometry = new THREE.BoxGeometry(1.25, 0.06, 3.4);
  private readonly motorGeometry = new THREE.BoxGeometry(0.36, 0.6, 0.42);
  private readonly caseMaterial = new THREE.MeshStandardMaterial({ color: CASE_COLOR, roughness: 0.45, metalness: 0.05, emissive: new THREE.Color(0x401600) });
  private readonly darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 });
  private readonly rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x555b62, roughness: 0.85, metalness: 0 });
  private readonly floorMaterial = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.95 });
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.6, 0.4), toneMapped: false });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  // Flotsam and tracks.
  private readonly spar = new THREE.CylinderGeometry(0.07, 0.08, 3.6, 10);
  private readonly sparEnd = new THREE.ConeGeometry(0.08, 0.35, 7);
  private readonly can = new THREE.BoxGeometry(0.34, 0.46, 0.17);
  private readonly canHandle = new THREE.BoxGeometry(0.2, 0.05, 0.05);
  private readonly cloth = new THREE.PlaneGeometry(2.6, 1.7, 8, 6);
  private readonly print = new THREE.PlaneGeometry(0.13, 0.3);
  private readonly casing = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 6);
  private readonly sparMaterial = new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.35, metalness: 0.85 });
  private readonly redCan = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.55, metalness: 0.2 });
  private readonly blueCan = new THREE.MeshStandardMaterial({ color: 0x2457a6, roughness: 0.55, metalness: 0.15 });
  private readonly sailCloth = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.9, side: THREE.DoubleSide });
  private readonly printMaterial = new THREE.MeshBasicMaterial({ color: 0x3b2f22, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private readonly brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 0.9, emissive: new THREE.Color(0x2a1d05) });
  private readonly props = new Map<string, StoryProp>();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = "StoryProps";
    scene.add(this.group);
  }

  /** The kit's case at (x, y, z) on the bottom or the sand; `wreck`: the Zodiac it came from lies beside it. */
  place(key: string, x: number, y: number, z: number, wreck: boolean): void {
    this.remove(key);
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const box = new THREE.Group();
    box.rotation.set(0.12, Math.random() * Math.PI * 2, -0.08);
    const body = new THREE.Mesh(this.caseGeometry, this.caseMaterial);
    body.position.y = 0.15;
    const lid = new THREE.Mesh(this.lidGeometry, this.caseMaterial);
    lid.position.y = 0.32;
    const handle = new THREE.Mesh(this.handleGeometry, this.darkMaterial);
    handle.position.y = 0.35;
    for (const side of [-0.2, 0.2]) {
      const latch = new THREE.Mesh(this.latchGeometry, this.darkMaterial);
      latch.position.set(side, 0.28, 0.215);
      box.add(latch);
    }
    const beacon = new THREE.Mesh(this.beaconGeometry, this.beaconMaterial);
    beacon.position.set(0.24, 0.37, 0.12);
    box.add(body, lid, handle, beacon);
    group.add(box);
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);
    if (wreck) {
      // The raiders' boat, holed and deflated, half buried in the sand.
      const boat = new THREE.Group();
      // Beside the case, not under it: the case was thrown clear as she went down.
      boat.position.set(3.1, 0.02, 1.6);
      boat.rotation.set(0.04, 0.55, 0.12);
      for (const side of [-0.62, 0.62]) {
        const tube = new THREE.Mesh(this.tubeGeometry, this.rubberMaterial);
        tube.rotation.x = Math.PI / 2;
        tube.scale.set(1, 1, side < 0 ? 0.42 : 0.68);
        tube.position.set(side, 0.12, -0.2);
        boat.add(tube);
      }
      const bow = new THREE.Mesh(this.bowGeometry, this.rubberMaterial);
      bow.rotation.x = -Math.PI / 2;
      bow.scale.z = 0.7;
      bow.position.set(0, 0.12, 1.4);
      const floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
      floor.position.y = 0.02;
      const motor = new THREE.Mesh(this.motorGeometry, this.darkMaterial);
      motor.position.set(0, 0.2, -1.95);
      motor.rotation.z = 1.2;
      boat.add(bow, floor, motor);
      group.add(boat);
    }
    this.group.add(group);
    this.props.set(key, { group, beacon, phase: Math.random() * 6 });
  }

  /**
   * A set of things lying about (x, z) on the ground: `flotsam` (a length
   * of the broken mast, fuel and water cans, a heap of torn sail) or
   * `tracks` (boot prints leading to the spot, spent cases round it).
   */
  placeSet(key: string, set: "flotsam" | "tracks", x: number, z: number, ground: (x: number, z: number) => number): void {
    this.remove(key);
    const group = new THREE.Group();
    group.position.set(x, ground(x, z), z);
    const random = mulberry(Math.round(x * 13 + z * 7));
    const lay = (object: THREE.Object3D, dx: number, dz: number, lift = 0) => {
      object.position.set(dx, ground(x + dx, z + dz) - group.position.y + lift, dz);
      group.add(object);
    };
    if (set === "flotsam") {
      const spar = new THREE.Group();
      const pole = new THREE.Mesh(this.spar, this.sparMaterial);
      pole.rotation.z = Math.PI / 2;
      const jag = new THREE.Mesh(this.sparEnd, this.sparMaterial);
      jag.rotation.z = -Math.PI / 2;
      jag.position.x = 1.95;
      spar.add(pole, jag);
      spar.rotation.y = random() * Math.PI;
      spar.rotation.z = 0.05;
      lay(spar, 2.2, -1.2, 0.08);
      for (let index = 0; index < 6; index += 1) {
        const can = new THREE.Group();
        const body = new THREE.Mesh(this.can, index % 2 === 0 ? this.redCan : this.blueCan);
        const handle = new THREE.Mesh(this.canHandle, this.sparMaterial);
        handle.position.y = 0.26;
        can.add(body, handle);
        const angle = random() * Math.PI * 2;
        const reach = 2.5 + random() * 6;
        // Some upright, most tumbled on their sides.
        can.rotation.set(random() < 0.6 ? Math.PI / 2 : 0, random() * Math.PI * 2, random() * 0.3);
        lay(can, Math.cos(angle) * reach, Math.sin(angle) * reach, can.rotation.x !== 0 ? 0.09 : 0.23);
        body.castShadow = true;
      }
      const cloth = new THREE.Mesh(this.cloth, this.sailCloth);
      cloth.rotation.x = -Math.PI / 2;
      cloth.rotation.z = random() * Math.PI;
      // Crumpled: the plane's vertices lifted unevenly, once.
      const position = cloth.geometry.getAttribute("position");
      if (!cloth.geometry.userData.crumpled) {
        for (let index = 0; index < position.count; index += 1) position.setZ(index, Math.abs(Math.sin(index * 1.7) * 0.12 + Math.sin(index * 0.37) * 0.08));
        position.needsUpdate = true;
        cloth.geometry.computeVertexNormals();
        cloth.geometry.userData.crumpled = true;
      }
      lay(cloth, -1.6, 1.9, 0.02);
    } else {
      // Prints coming up the path from the west, and spent cases round the spot.
      for (let step = 0; step < 12; step += 1) {
        const print = new THREE.Mesh(this.print, this.printMaterial);
        print.rotation.x = -Math.PI / 2;
        print.rotation.z = Math.PI / 2 + (random() - 0.5) * 0.25;
        lay(print, -1.2 - step * 0.62, (step % 2 === 0 ? 0.13 : -0.13) + (random() - 0.5) * 0.06, 0.012);
      }
      for (let index = 0; index < 7; index += 1) {
        const casing = new THREE.Mesh(this.casing, this.brass);
        casing.rotation.set(Math.PI / 2, random() * Math.PI * 2, 0);
        const angle = random() * Math.PI * 2;
        const reach = 0.3 + random() * 1.4;
        lay(casing, Math.cos(angle) * reach, Math.sin(angle) * reach, 0.006);
      }
    }
    this.group.add(group);
    this.props.set(key, { group, beacon: null, phase: 0 });
  }

  has(key: string): boolean {
    return this.props.has(key);
  }

  position(key: string): THREE.Vector3 | null {
    return this.props.get(key)?.group.position ?? null;
  }

  remove(key: string): void {
    const prop = this.props.get(key);
    if (!prop) return;
    prop.group.removeFromParent();
    this.props.delete(key);
  }

  keys(): string[] {
    return [...this.props.keys()];
  }

  update(delta: number): void {
    this.time += delta;
    for (const prop of this.props.values()) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + prop.phase);
      prop.beacon?.scale.setScalar(0.7 + pulse * 0.9);
    }
    this.ringMaterial.opacity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 2.2));
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of [this.caseGeometry, this.lidGeometry, this.handleGeometry, this.latchGeometry, this.beaconGeometry, this.ringGeometry, this.tubeGeometry, this.bowGeometry, this.floorGeometry, this.motorGeometry, this.spar, this.sparEnd, this.can, this.canHandle, this.cloth, this.print, this.casing]) geometry.dispose();
    for (const material of [this.caseMaterial, this.darkMaterial, this.rubberMaterial, this.floorMaterial, this.beaconMaterial, this.ringMaterial, this.sparMaterial, this.redCan, this.blueCan, this.sailCloth, this.printMaterial, this.brass]) material.dispose();
  }
}
