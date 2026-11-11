import * as THREE from "three";
import { DOME_CENTRE, DOME_RADIUS, DRONE_LENGTH, JET_CENTRES, JET_RADIUS, TURRET_CENTRE } from "./CombatMath";

/**
 * Aquilon's interceptor: an uncrewed planing craft of 8.6 m, built in code.
 * A faceted gunmetal hull with tumblehome sides and a deep-V bottom; a low
 * windowless superstructure; the sensor dome on its mast — black glass with
 * a ring of red diodes and a scanning bar turning inside; a remote weapon
 * station on the foredeck; twin water-jet nozzles in the transom; a whip
 * aerial; its hull number in white on both bows.
 *
 * Its own frame matches `CombatMath`: bow +Z, up +Y, origin at the
 * waterline amidships, so the hit zones there lie on the parts drawn here.
 */

export type DroneParts = {
  root: THREE.Group;
  /** Turned toward the target (about y). */
  turret: THREE.Group;
  /** The diodes and the scanning bar (dark once blinded). */
  eye: THREE.Group;
  scanner: THREE.Object3D;
  /**
   * The meshes whose look changes with the drone's state. Their materials are
   * the template's shared ones, swapped, never this drone's own: a material
   * disposed while the renderer compiles the scene in the background breaks
   * that compile, and drones come and go.
   */
  hullMesh: THREE.Mesh;
  domeMesh: THREE.Mesh;
  ledMeshes: THREE.Mesh[];
  /** World-frame points the effects come from: the muzzle, the dome, the jets. */
  muzzle: THREE.Object3D;
  /** Navigation lights (shown at night). */
  lights: THREE.Group;
};

const HALF = DRONE_LENGTH / 2;

/** Half-widths and heights of a hull station, `s` from the transom (0) to the stem (1). */
function station(s: number): { deck: number; chine: number; deckY: number; chineY: number; keelY: number } {
  const fore = Math.max(0, (s - 0.5) / 0.5);
  const taper = Math.sqrt(Math.max(0, 1 - fore * fore));
  const beam = 1.26 * taper;
  return {
    deck: beam * 0.8,
    chine: beam,
    deckY: 0.92 + 0.22 * s * s,
    chineY: 0.22 + 0.42 * Math.pow(s, 2.2),
    keelY: -0.36 + 0.12 * s + 0.75 * Math.pow(fore, 3),
  };
}

function hullGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  const STEPS = 14;
  for (let index = 0; index < STEPS; index += 1) {
    const s0 = index / STEPS;
    const s1 = (index + 1) / STEPS;
    const a = station(s0);
    const b = station(s1);
    const z0 = -HALF + s0 * DRONE_LENGTH;
    const z1 = -HALF + s1 * DRONE_LENGTH;
    for (const side of [1, -1]) {
      // Deck (one strip per side to the centreline).
      const deckA = [side * a.deck, a.deckY, z0];
      const deckB = [side * b.deck, b.deckY, z1];
      const midA = [0, a.deckY + 0.04, z0];
      const midB = [0, b.deckY + 0.04, z1];
      // Upper side: from the deck edge out and down to the chine (tumblehome).
      const chineA = [side * a.chine, a.chineY, z0];
      const chineB = [side * b.chine, b.chineY, z1];
      const keelA = [0, a.keelY, z0];
      const keelB = [0, b.keelY, z1];
      if (side > 0) {
        quad(midA, midB, deckB, deckA);
        quad(deckA, deckB, chineB, chineA);
        quad(chineA, chineB, keelB, keelA);
      } else {
        quad(midA, deckA, deckB, midB);
        quad(deckA, chineA, chineB, deckB);
        quad(chineA, keelA, keelB, chineB);
      }
    }
  }
  // The transom.
  const t = station(0);
  const z = -HALF;
  for (const side of [1, -1]) {
    const pts = [
      [0, t.deckY + 0.04, z],
      [side * t.deck, t.deckY, z],
      [side * t.chine, t.chineY, z],
      [0, t.keelY, z],
    ];
    if (side > 0) {
      tri(pts[0]!, pts[2]!, pts[1]!);
      tri(pts[0]!, pts[3]!, pts[2]!);
    } else {
      tri(pts[0]!, pts[1]!, pts[2]!);
      tri(pts[0]!, pts[2]!, pts[3]!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A low, faceted, windowless deckhouse: a frustum with chamfered corners. */
function cabinGeometry(): THREE.BufferGeometry {
  const bottom = [
    [0.78, -2.3],
    [0.82, 0.6],
    [0.45, 1.35],
    [-0.45, 1.35],
    [-0.82, 0.6],
    [-0.78, -2.3],
  ];
  const top = bottom.map(([x, z]) => [x! * 0.66, z! * 0.82 - 0.15]);
  const base = 1.0;
  const height = 0.62;
  const positions: number[] = [];
  const n = bottom.length;
  for (let index = 0; index < n; index += 1) {
    const next = (index + 1) % n;
    const a = [bottom[index]![0]!, base, bottom[index]![1]!];
    const b = [bottom[next]![0]!, base, bottom[next]![1]!];
    const c = [top[next]![0]!, base + height, top[next]![1]!];
    const d = [top[index]![0]!, base + height, top[index]![1]!];
    positions.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  for (let index = 1; index < n - 1; index += 1) {
    positions.push(top[0]![0]!, base + height, top[0]![1]!, top[index]![0]!, base + height, top[index]![1]!, top[index + 1]![0]!, base + height, top[index + 1]![1]!);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function hullNumberTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 256, 64);
  context.fillStyle = "rgba(229, 72, 77, 0.95)";
  context.fillRect(0, 50, 256, 7);
  context.fillStyle = "rgba(236, 238, 240, 0.92)";
  context.font = "bold 40px 'Inter', 'Segoe UI', sans-serif";
  context.textBaseline = "middle";
  context.fillText(text, 8, 26);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Shared geometry and materials, built once; each drone is a light clone. */
export class DroneTemplate {
  private readonly hull = hullGeometry();
  private readonly cabin = cabinGeometry();
  private readonly dome = new THREE.SphereGeometry(DOME_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  private readonly ring = new THREE.TorusGeometry(DOME_RADIUS * 0.93, 0.035, 6, 32);
  private readonly bar = new THREE.BoxGeometry(DOME_RADIUS * 1.5, 0.05, 0.08);
  private readonly mast = new THREE.CylinderGeometry(0.16, 0.24, 0.42, 10);
  private readonly turretBase = new THREE.BoxGeometry(0.62, 0.32, 0.66);
  private readonly barrel = new THREE.CylinderGeometry(0.045, 0.055, 1.15, 8);
  private readonly ammo = new THREE.BoxGeometry(0.22, 0.22, 0.38);
  private readonly nozzle = new THREE.CylinderGeometry(JET_RADIUS, JET_RADIUS * 0.82, 0.55, 14, 1, true);
  private readonly nozzleCap = new THREE.CircleGeometry(JET_RADIUS * 0.8, 14);
  private readonly aerial = new THREE.CylinderGeometry(0.012, 0.02, 1.7, 5);
  private readonly lamp = new THREE.SphereGeometry(0.07, 8, 6);
  private readonly decal = new THREE.PlaneGeometry(1.5, 0.375);
  private readonly rail = new THREE.BoxGeometry(0.05, 0.05, 3.2);
  private readonly hullMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3239, roughness: 0.58, metalness: 0.32, flatShading: true, side: THREE.DoubleSide });
  private readonly cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2227, roughness: 0.32, metalness: 0.45, flatShading: true, side: THREE.DoubleSide });
  private readonly darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a4047, roughness: 0.45, metalness: 0.7 });
  private readonly gunMetal = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.4, metalness: 0.8 });
  private readonly domeMaterial = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.08, metalness: 0.65, envMapIntensity: 1.4 });
  /** The diodes: glowing at rest, pulsing fast in a fight, dark once blinded (colours set each frame by `DroneSystem`). */
  readonly ledCalm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.18, 0.16), toneMapped: false });
  readonly ledAlert = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.18, 0.16), toneMapped: false });
  readonly ledDead = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.02, 0.02) });
  readonly domeBroken = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.6, metalness: 0.5 });
  readonly hullBurnt = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.8, metalness: 0.2, flatShading: true, side: THREE.DoubleSide });
  private readonly portLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.1, 0.1), toneMapped: false });
  private readonly starboardLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 2.2, 0.4), toneMapped: false });
  private readonly whiteLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2), toneMapped: false });
  private readonly decals = new Map<string, THREE.MeshBasicMaterial>();

  build(number: string): DroneParts {
    const root = new THREE.Group();
    root.name = `AquilonDrone ${number}`;
    const hull = new THREE.Mesh(this.hull, this.hullMaterial);
    hull.castShadow = true;
    root.add(hull);
    const cabin = new THREE.Mesh(this.cabin, this.cabinMaterial);
    cabin.castShadow = true;
    root.add(cabin);
    // Grab rails along the deck edges.
    for (const side of [1, -1]) {
      const rail = new THREE.Mesh(this.rail, this.darkMetal);
      rail.position.set(side * 0.95, 1.08, -0.9);
      root.add(rail);
    }
    // The sensor mast and its dome.
    const mast = new THREE.Mesh(this.mast, this.darkMetal);
    mast.position.set(DOME_CENTRE.x, 1.62 + 0.21 - 0.1, DOME_CENTRE.z);
    root.add(mast);
    const dome = new THREE.Mesh(this.dome, this.domeMaterial);
    dome.position.set(DOME_CENTRE.x, DOME_CENTRE.y - DOME_RADIUS * 0.35, DOME_CENTRE.z);
    root.add(dome);
    const eye = new THREE.Group();
    eye.position.copy(dome.position);
    const ring = new THREE.Mesh(this.ring, this.ledCalm);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    eye.add(ring);
    const scanner = new THREE.Mesh(this.bar, this.ledCalm);
    scanner.position.y = DOME_RADIUS * 0.45;
    eye.add(scanner);
    root.add(eye);
    // The weapon station.
    const turret = new THREE.Group();
    turret.position.set(TURRET_CENTRE.x, TURRET_CENTRE.y - 0.12, TURRET_CENTRE.z);
    const base = new THREE.Mesh(this.turretBase, this.cabinMaterial);
    base.castShadow = true;
    turret.add(base);
    const barrel = new THREE.Mesh(this.barrel, this.gunMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.06, 0.62);
    turret.add(barrel);
    const ammo = new THREE.Mesh(this.ammo, this.darkMetal);
    ammo.position.set(0.38, 0.02, -0.05);
    turret.add(ammo);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.06, 1.2);
    turret.add(muzzle);
    root.add(turret);
    // The jets.
    for (const jet of JET_CENTRES) {
      const nozzle = new THREE.Mesh(this.nozzle, this.darkMetal);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(jet.x, jet.y, jet.z);
      root.add(nozzle);
      const cap = new THREE.Mesh(this.nozzleCap, this.gunMetal);
      cap.rotation.y = Math.PI;
      cap.position.set(jet.x, jet.y, jet.z - 0.2);
      root.add(cap);
    }
    // The aerial.
    const aerial = new THREE.Mesh(this.aerial, this.gunMetal);
    aerial.position.set(-0.4, 2.35, -1.7);
    aerial.rotation.x = -0.18;
    root.add(aerial);
    // Hull numbers on both bows.
    let decal = this.decals.get(number);
    if (!decal) {
      decal = new THREE.MeshBasicMaterial({ map: hullNumberTexture(number), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.decals.set(number, decal);
    }
    for (const side of [1, -1]) {
      // On the flared upper side, tilted up with it and turned in with the bow's taper.
      const s = 0.66;
      const at = station(s);
      const ahead = station(s + 0.05);
      const holder = new THREE.Group();
      const outX = at.chine - at.deck;
      const downY = at.deckY - at.chineY;
      const tilt = Math.atan2(outX, downY);
      holder.position.set(side * (at.deck + at.chine) * 0.5, (at.deckY + at.chineY) * 0.5, -HALF + s * DRONE_LENGTH);
      const taper = Math.atan2((at.chine + at.deck) * 0.5 - (ahead.chine + ahead.deck) * 0.5, 0.05 * DRONE_LENGTH);
      holder.rotation.y = side > 0 ? Math.PI / 2 - taper : -Math.PI / 2 + taper;
      const plate = new THREE.Mesh(this.decal, decal);
      plate.rotation.x = -tilt;
      plate.position.z = 0.012;
      holder.add(plate);
      root.add(holder);
    }
    // Navigation lights.
    const lights = new THREE.Group();
    const port = new THREE.Mesh(this.lamp, this.portLamp);
    port.position.set(0.72, 1.12, 1.2);
    const starboard = new THREE.Mesh(this.lamp, this.starboardLamp);
    starboard.position.set(-0.72, 1.12, 1.2);
    const mastLamp = new THREE.Mesh(this.lamp, this.whiteLamp);
    mastLamp.position.set(-0.4, 3.18, -1.85);
    lights.add(port, starboard, mastLamp);
    lights.visible = false;
    root.add(lights);
    return { root, turret, eye, scanner, hullMesh: hull, domeMesh: dome, ledMeshes: [ring, scanner], muzzle, lights };
  }

  dispose(): void {
    for (const geometry of [this.hull, this.cabin, this.dome, this.ring, this.bar, this.mast, this.turretBase, this.barrel, this.ammo, this.nozzle, this.nozzleCap, this.aerial, this.lamp, this.decal, this.rail]) geometry.dispose();
    for (const material of [this.hullMaterial, this.cabinMaterial, this.darkMetal, this.gunMetal, this.domeMaterial, this.ledCalm, this.ledAlert, this.ledDead, this.domeBroken, this.hullBurnt, this.portLamp, this.starboardLamp, this.whiteLamp]) material.dispose();
    for (const material of this.decals.values()) {
      material.map?.dispose();
      material.dispose();
    }
  }
}
