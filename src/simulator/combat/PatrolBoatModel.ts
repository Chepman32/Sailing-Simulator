import * as THREE from "three";
import { DRONE_LENGTH } from "./CombatMath";
import type { DroneParts } from "./DroneModel";

/**
 * A Vanguard Naval patrol boat: a crewed 8.6 m open centre-console
 * interceptor, built in code. A grey deep-V hull with a dark foam collar
 * round the gunwale and a sand stripe along her sides; an open cockpit
 * with a console and windscreen under a T-top carrying a radar and a light
 * bar; a machine gun on a pintle in the bows; twin outboards on the
 * transom; her number and the company's name on both bows.
 *
 * She shares the drone's frame and parts (`DroneParts`), so `DroneSystem`
 * sails, fights and wrecks her the same way: bow +Z, x to port, origin at
 * the waterline amidships. Her crew stand at `seats` (see `CrewSeat`).
 */

export type CrewSeat = {
  /** In the boat's frame. */
  x: number;
  y: number;
  z: number;
  /** Facing, about y (0: forward). */
  yaw: number;
  role: "helm" | "gunner" | "lookout";
};

export type PatrolBoatParts = DroneParts & { seats: readonly CrewSeat[] };

const HALF = DRONE_LENGTH / 2;
/** The cockpit's floor, the gunwale's top. */
export const SOLE_Y = 0.52;
const SHEER = 1.04;

function station(s: number): { beam: number; sheerY: number; chine: number; chineY: number; keelY: number } {
  const fore = Math.max(0, (s - 0.45) / 0.55);
  const taper = Math.sqrt(Math.max(0, 1 - fore * fore));
  const beam = 1.24 * taper + 0.02;
  return {
    beam,
    sheerY: SHEER + 0.26 * s * s,
    chine: beam * 0.94,
    chineY: 0.2 + 0.46 * Math.pow(s, 2.2),
    keelY: -0.34 + 0.12 * s + 0.78 * Math.pow(fore, 3),
  };
}

/** The hull: outer skin, gunwale, inner liner, cockpit sole and a closed foredeck. */
function hullGeometry(): { outer: THREE.BufferGeometry; inner: THREE.BufferGeometry } {
  const outer: number[] = [];
  const inner: number[] = [];
  const tri = (into: number[], a: number[], b: number[], c: number[]) => into.push(...a, ...b, ...c);
  const quad = (into: number[], a: number[], b: number[], c: number[], d: number[]) => {
    tri(into, a, b, c);
    tri(into, a, c, d);
  };
  const STEPS = 16;
  const DECK_FROM = 0.78;
  for (let index = 0; index < STEPS; index += 1) {
    const s0 = index / STEPS;
    const s1 = (index + 1) / STEPS;
    const a = station(s0);
    const b = station(s1);
    const z0 = -HALF + s0 * DRONE_LENGTH;
    const z1 = -HALF + s1 * DRONE_LENGTH;
    for (const side of [1, -1]) {
      const p = (x: number, y: number, z: number) => [side * x, y, z];
      const sheerA = p(a.beam, a.sheerY, z0);
      const sheerB = p(b.beam, b.sheerY, z1);
      const chineA = p(a.chine, a.chineY, z0);
      const chineB = p(b.chine, b.chineY, z1);
      const keelA = [0, a.keelY, z0];
      const keelB = [0, b.keelY, z1];
      const capA = p(a.beam - 0.13, a.sheerY, z0);
      const capB = p(b.beam - 0.13, b.sheerY, z1);
      const order = (w: number[], x: number[], y: number[], v: number[], into: number[]) => (side > 0 ? quad(into, w, x, y, v) : quad(into, w, v, y, x));
      order(sheerA, sheerB, chineB, chineA, outer);
      order(chineA, chineB, keelB, keelA, outer);
      // The gunwale's cap.
      order(capA, capB, sheerB, sheerA, outer);
      if (s0 >= DECK_FROM) {
        // The foredeck, closed to the centreline.
        const midA = [0, a.sheerY + 0.05, z0];
        const midB = [0, b.sheerY + 0.05, z1];
        order(midA, midB, capB, capA, outer);
      } else {
        // The liner down to the sole, and the sole to the centreline.
        const lowA = p(a.beam - 0.16, SOLE_Y, z0);
        const lowB = p(b.beam - 0.16, SOLE_Y, z1);
        order(capB, capA, lowA, lowB, inner);
        const midA = [0, SOLE_Y, z0];
        const midB = [0, SOLE_Y, z1];
        order(midA, midB, lowB, lowA, inner);
      }
    }
  }
  // The foredeck's after face (the cockpit's forward bulkhead).
  const d = station(DECK_FROM);
  const zd = -HALF + DECK_FROM * DRONE_LENGTH;
  for (const side of [1, -1]) {
    const pts = [
      [0, d.sheerY + 0.05, zd],
      [side * (d.beam - 0.13), d.sheerY, zd],
      [side * (d.beam - 0.16), SOLE_Y, zd],
      [0, SOLE_Y, zd],
    ];
    if (side > 0) quad(inner, pts[0]!, pts[1]!, pts[2]!, pts[3]!);
    else quad(inner, pts[0]!, pts[3]!, pts[2]!, pts[1]!);
  }
  // The transom, inside and out.
  const t = station(0);
  const z = -HALF;
  for (const side of [1, -1]) {
    const pts = [
      [0, t.sheerY, z],
      [side * t.beam, t.sheerY, z],
      [side * t.chine, t.chineY, z],
      [0, t.keelY, z],
    ];
    if (side > 0) {
      tri(outer, pts[0]!, pts[2]!, pts[1]!);
      tri(outer, pts[0]!, pts[3]!, pts[2]!);
    } else {
      tri(outer, pts[0]!, pts[1]!, pts[2]!);
      tri(outer, pts[0]!, pts[2]!, pts[3]!);
    }
  }
  const build = (positions: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  return { outer: build(outer), inner: build(inner) };
}

/** The foam collar along the gunwale, from the transom round the bow. */
function collarGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const s = 0.02 + (index / 24) * 0.95;
    const at = station(s);
    points.push(new THREE.Vector3(at.beam + 0.1, at.sheerY - 0.14, -HALF + s * DRONE_LENGTH));
  }
  const mirrored = points.map((point) => new THREE.Vector3(-point.x, point.y, point.z)).reverse();
  const tip = station(0.985);
  const path = new THREE.CatmullRomCurve3([...points, new THREE.Vector3(0, tip.sheerY - 0.12, -HALF + 0.995 * DRONE_LENGTH), ...mirrored]);
  return new THREE.TubeGeometry(path, 90, 0.17, 8, false);
}

function nameTexture(number: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 512, 96);
  context.fillStyle = "rgba(196, 170, 118, 0.95)";
  context.fillRect(0, 70, 512, 10);
  context.fillStyle = "rgba(240, 240, 236, 0.95)";
  context.font = "bold 46px 'Inter', 'Segoe UI', sans-serif";
  context.textBaseline = "middle";
  context.fillText(number, 10, 34);
  context.font = "600 26px 'Inter', 'Segoe UI', sans-serif";
  context.fillStyle = "rgba(240, 240, 236, 0.8)";
  context.fillText("VANGUARD NAVAL", 190, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Shared geometry and materials, built once; each boat is a light clone. */
export class PatrolBoatTemplate {
  private readonly hull = hullGeometry();
  private readonly collar = collarGeometry();
  private readonly console = new THREE.BoxGeometry(0.95, 1.0, 0.78);
  private readonly screen = new THREE.BoxGeometry(1.0, 0.42, 0.03);
  private readonly post = new THREE.CylinderGeometry(0.035, 0.035, 1.85, 8);
  private readonly canopy = new THREE.BoxGeometry(1.7, 0.07, 2.0);
  private readonly radome = new THREE.CylinderGeometry(0.28, 0.3, 0.2, 18);
  private readonly array = new THREE.BoxGeometry(0.95, 0.07, 0.1);
  private readonly lightBar = new THREE.BoxGeometry(0.9, 0.08, 0.08);
  private readonly leaning = new THREE.BoxGeometry(1.1, 0.75, 0.42);
  private readonly bench = new THREE.BoxGeometry(1.9, 0.42, 0.5);
  private readonly pintle = new THREE.CylinderGeometry(0.05, 0.07, 0.75, 8);
  private readonly receiver = new THREE.BoxGeometry(0.16, 0.2, 0.75);
  private readonly barrel = new THREE.CylinderGeometry(0.028, 0.034, 0.85, 8);
  private readonly shield = new THREE.BoxGeometry(0.62, 0.36, 0.03);
  private readonly boxMag = new THREE.BoxGeometry(0.16, 0.16, 0.22);
  private readonly cowling = new THREE.BoxGeometry(0.46, 0.62, 0.62);
  private readonly leg = new THREE.BoxGeometry(0.11, 0.55, 0.2);
  private readonly lamp = new THREE.SphereGeometry(0.06, 8, 6);
  private readonly decal = new THREE.PlaneGeometry(2.4, 0.45);
  private readonly hullMaterial = new THREE.MeshStandardMaterial({ color: 0x8d969c, roughness: 0.5, metalness: 0.18, side: THREE.DoubleSide });
  private readonly linerMaterial = new THREE.MeshStandardMaterial({ color: 0xb9bcb8, roughness: 0.78, metalness: 0.05, side: THREE.DoubleSide });
  private readonly collarMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.85, metalness: 0.02 });
  private readonly darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a4047, roughness: 0.45, metalness: 0.65 });
  private readonly gunMetal = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.4, metalness: 0.8 });
  private readonly glass = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.55 });
  private readonly cushion = new THREE.MeshStandardMaterial({ color: 0x4a4f45, roughness: 0.9 });
  private readonly engineMaterial = new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.35, metalness: 0.35 });
  /** Kept for `DroneParts`: she has no diodes to light (the drone's show its mood). */
  private readonly radarMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.35, metalness: 0.1 });
  private readonly portLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.1, 0.1), toneMapped: false });
  private readonly starboardLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 2.2, 0.4), toneMapped: false });
  private readonly whiteLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2), toneMapped: false });
  private readonly blueLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.6, 2.6), toneMapped: false });
  private readonly decals = new Map<string, THREE.MeshBasicMaterial>();

  build(number: string): PatrolBoatParts {
    const root = new THREE.Group();
    root.name = `VanguardPatrol ${number}`;
    const hull = new THREE.Mesh(this.hull.outer, this.hullMaterial);
    hull.castShadow = true;
    hull.receiveShadow = true;
    const liner = new THREE.Mesh(this.hull.inner, this.linerMaterial);
    liner.receiveShadow = true;
    const collar = new THREE.Mesh(this.collar, this.collarMaterial);
    collar.castShadow = true;
    root.add(hull, liner, collar);
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // The console, its windscreen, the leaning post behind it and a bench aft.
    add(this.console, this.linerMaterial, 0, SOLE_Y + 0.5, -0.35);
    const screen = add(this.screen, this.glass, 0, SOLE_Y + 1.18, -0.02);
    screen.rotation.x = -0.35;
    add(this.leaning, this.cushion, 0, SOLE_Y + 0.38, -1.5);
    add(this.bench, this.cushion, 0, SOLE_Y + 0.21, -3.55);
    // The T-top on its four posts, the radar and the light bar on it.
    for (const [x, z] of [
      [0.62, -0.05],
      [-0.62, -0.05],
      [0.62, -1.7],
      [-0.62, -1.7],
    ] as const) {
      add(this.post, this.darkMetal, x, SOLE_Y + 0.92, z);
    }
    add(this.canopy, this.collarMaterial, 0, SOLE_Y + 1.88, -0.88);
    add(this.radome, this.radarMaterial, 0, SOLE_Y + 2.02, -1.3);
    const eye = new THREE.Group();
    eye.position.set(0, SOLE_Y + 2.16, -1.3);
    const scanner = add(this.array, this.radarMaterial, 0, 0.02, 0, eye);
    root.add(eye);
    const bar = add(this.lightBar, this.blueLamp, 0, SOLE_Y + 1.96, -0.02);
    bar.castShadow = false;
    // The machine gun on its pintle in the bows (turned toward the target).
    const turret = new THREE.Group();
    turret.position.set(0, SOLE_Y + 0.75, 2.75);
    add(this.pintle, this.darkMetal, 0, -0.1, 0, turret);
    const gun = new THREE.Group();
    gun.position.set(0, 0.32, 0);
    turret.add(gun);
    add(this.receiver, this.gunMetal, 0, 0, 0.05, gun);
    const barrel = add(this.barrel, this.gunMetal, 0, 0.03, 0.78, gun);
    barrel.rotation.x = Math.PI / 2;
    add(this.shield, this.darkMetal, 0, 0.1, 0.32, gun);
    add(this.boxMag, this.darkMetal, 0.15, -0.04, 0.02, gun);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, 1.22);
    gun.add(muzzle);
    root.add(turret);
    // Twin outboards on the transom.
    for (const x of [0.48, -0.48]) {
      add(this.cowling, this.engineMaterial, x, 1.18, -HALF - 0.32);
      add(this.leg, this.engineMaterial, x, 0.62, -HALF - 0.28);
    }
    // Her number and the company's name on both bows.
    let decal = this.decals.get(number);
    if (!decal) {
      decal = new THREE.MeshBasicMaterial({ map: nameTexture(number), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.decals.set(number, decal);
    }
    for (const side of [1, -1]) {
      const s = 0.62;
      const at = station(s);
      const plate = new THREE.Mesh(this.decal, decal);
      plate.position.set(side * (at.beam * 0.985 + 0.012), (at.sheerY + at.chineY) * 0.5 - 0.06, -HALF + s * DRONE_LENGTH);
      plate.rotation.y = side > 0 ? Math.PI / 2 - 0.12 : -Math.PI / 2 + 0.12;
      plate.rotation.z = side > 0 ? -0.02 : 0.02;
      root.add(plate);
    }
    // Navigation lights.
    const lights = new THREE.Group();
    const port = new THREE.Mesh(this.lamp, this.portLamp);
    port.position.set(0.82, SOLE_Y + 1.92, -0.1);
    const starboard = new THREE.Mesh(this.lamp, this.starboardLamp);
    starboard.position.set(-0.82, SOLE_Y + 1.92, -0.1);
    const mastLamp = new THREE.Mesh(this.lamp, this.whiteLamp);
    mastLamp.position.set(0, SOLE_Y + 2.32, -1.3);
    lights.add(port, starboard, mastLamp);
    lights.visible = false;
    root.add(lights);
    const seats: CrewSeat[] = [
      { x: 0, y: SOLE_Y, z: -1.08, yaw: 0, role: "helm" },
      { x: 0, y: SOLE_Y, z: 2.08, yaw: 0, role: "gunner" },
      { x: 0.45, y: SOLE_Y, z: -2.7, yaw: Math.PI * 0.62, role: "lookout" },
    ];
    return { root, turret, eye, scanner, hullMesh: hull, domeMesh: hull, ledMeshes: [], muzzle, lights, seats };
  }

  dispose(): void {
    for (const geometry of [
      this.hull.outer,
      this.hull.inner,
      this.collar,
      this.console,
      this.screen,
      this.post,
      this.canopy,
      this.radome,
      this.array,
      this.lightBar,
      this.leaning,
      this.bench,
      this.pintle,
      this.receiver,
      this.barrel,
      this.shield,
      this.boxMag,
      this.cowling,
      this.leg,
      this.lamp,
      this.decal,
    ]) {
      geometry.dispose();
    }
    for (const material of [
      this.hullMaterial,
      this.linerMaterial,
      this.collarMaterial,
      this.darkMetal,
      this.gunMetal,
      this.glass,
      this.cushion,
      this.engineMaterial,
      this.radarMaterial,
      this.portLamp,
      this.starboardLamp,
      this.whiteLamp,
      this.blueLamp,
    ]) {
      material.dispose();
    }
    for (const material of this.decals.values()) {
      material.map?.dispose();
      material.dispose();
    }
  }
}
