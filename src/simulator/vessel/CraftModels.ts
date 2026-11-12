import * as THREE from "three";

/**
 * The boats the skipper drives besides the catamaran, built in code: the
 * prologue's sport yacht (a fast single-deck motor yacht, white, with the
 * black carbon stripe along her quarters by which the order describes her)
 * and the skiff from Створ-9 (an open 4.4 m aluminium boat with a tired
 * outboard, salt-streaked, an orange lifebuoy on her thwart). And the sport
 * yacht's wreck, as it lies on the reef afterwards.
 *
 * Frame: bow +Z, up +Y, x to port (the vessel's own), origin at the
 * waterline amidships. `Vessel` lowers the group to the water.
 */

export type CraftSeat = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Seated (a thwart, a helm seat) rather than standing. */
  sit: boolean;
  /** The seat's height above `y`, for the figure's sit. */
  seat: number;
};

export type CraftModel = {
  group: THREE.Group;
  /** The helmsman's eyes, for the view from the wheel. */
  eye: THREE.Vector3;
  /** The helmsman's place first, then the passengers'. */
  seats: readonly CraftSeat[];
  /** The outboard turned with the helm, the propeller spinning with the shaft. */
  update(delta: number, rudder: number, shaft: number): void;
  dispose(): void;
};

type Station = { beam: number; sheerY: number; chine: number; chineY: number; keelY: number };

/** Lofts a hull from stations: topsides and bottom, a cockpit (sole at `soleY`) aft of `deckFrom`, a closed foredeck forward of it. */
function loftHull(
  length: number,
  station: (s: number) => Station,
  soleY: number,
  deckFrom: number,
  steps = 22,
): { topsides: THREE.BufferGeometry; bottom: THREE.BufferGeometry; deck: THREE.BufferGeometry; liner: THREE.BufferGeometry } {
  const half = length / 2;
  const topsides: number[] = [];
  const bottom: number[] = [];
  const deck: number[] = [];
  const liner: number[] = [];
  const quad = (into: number[], a: number[], b: number[], c: number[], d: number[]) => into.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let index = 0; index < steps; index += 1) {
    const s0 = index / steps;
    const s1 = (index + 1) / steps;
    const a = station(s0);
    const b = station(s1);
    const z0 = -half + s0 * length;
    const z1 = -half + s1 * length;
    for (const side of [1, -1]) {
      const p = (x: number, y: number, z: number) => [side * x, y, z];
      const order = (into: number[], w: number[], x: number[], y: number[], v: number[]) => (side > 0 ? quad(into, w, x, y, v) : quad(into, w, v, y, x));
      order(topsides, p(a.beam, a.sheerY, z0), p(b.beam, b.sheerY, z1), p(b.chine, b.chineY, z1), p(a.chine, a.chineY, z0));
      order(bottom, p(a.chine, a.chineY, z0), p(b.chine, b.chineY, z1), [0, b.keelY, z1], [0, a.keelY, z0]);
      const capA = p(a.beam - 0.1, a.sheerY, z0);
      const capB = p(b.beam - 0.1, b.sheerY, z1);
      order(deck, capA, capB, p(b.beam, b.sheerY, z1), p(a.beam, a.sheerY, z0));
      if (s0 >= deckFrom) {
        order(deck, [0, a.sheerY + 0.06, z0], [0, b.sheerY + 0.06, z1], capB, capA);
      } else {
        const lowA = p(a.beam - 0.13, soleY, z0);
        const lowB = p(b.beam - 0.13, soleY, z1);
        order(liner, capB, capA, lowA, lowB);
        order(liner, [0, soleY, z0], [0, soleY, z1], lowB, lowA);
      }
    }
  }
  // The cockpit's forward bulkhead and the transom.
  const d = station(deckFrom);
  const zd = -half + deckFrom * length;
  const t = station(0);
  for (const side of [1, -1]) {
    const bulk = [
      [0, d.sheerY + 0.06, zd],
      [side * (d.beam - 0.1), d.sheerY, zd],
      [side * (d.beam - 0.13), soleY, zd],
      [0, soleY, zd],
    ];
    if (side > 0) quad(liner, bulk[0]!, bulk[1]!, bulk[2]!, bulk[3]!);
    else quad(liner, bulk[0]!, bulk[3]!, bulk[2]!, bulk[1]!);
    const stern = [
      [0, t.sheerY, -half],
      [side * t.beam, t.sheerY, -half],
      [side * t.chine, t.chineY, -half],
      [0, t.keelY, -half],
    ];
    if (side > 0) quad(topsides, stern[0]!, stern[3]!, stern[2]!, stern[1]!);
    else quad(topsides, stern[0]!, stern[1]!, stern[2]!, stern[3]!);
  }
  const build = (positions: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  return { topsides: build(topsides), bottom: build(bottom), deck: build(deck), liner: build(liner) };
}

/** A band along a hull's side between two heights, from `s0` to `s1` (a stripe), just proud of the skin. */
function hullBand(length: number, station: (s: number) => Station, s0: number, s1: number, upper: number, lower: number, steps = 14): THREE.BufferGeometry {
  const half = length / 2;
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const point = (side: number, s: number, f: number) => {
    const at = station(s);
    const x = at.beam + (at.chine - at.beam) * f + 0.012;
    const y = at.sheerY + (at.chineY - at.sheerY) * f;
    return [side * x, y, -half + s * length];
  };
  for (let index = 0; index < steps; index += 1) {
    const a = s0 + ((s1 - s0) * index) / steps;
    const b = s0 + ((s1 - s0) * (index + 1)) / steps;
    for (const side of [1, -1]) {
      const pa = point(side, a, upper);
      const pb = point(side, b, upper);
      const qa = point(side, a, lower);
      const qb = point(side, b, lower);
      if (side > 0) quad(pa, pb, qb, qa);
      else quad(pa, qa, qb, pb);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Brushed aluminium with salt streaks running down from the gunwale. */
function saltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#b9bfc2";
  context.fillRect(0, 0, 256, 128);
  for (let index = 0; index < 900; index += 1) {
    const y = Math.random() * 128;
    context.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "90,96,100"},${0.05 + Math.random() * 0.06})`;
    context.fillRect(0, y, 256, 1);
  }
  for (let index = 0; index < 70; index += 1) {
    const x = Math.random() * 256;
    const length = 20 + Math.random() * 70;
    const gradient = context.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, "rgba(250,250,246,0.55)");
    gradient.addColorStop(1, "rgba(250,250,246,0)");
    context.fillStyle = gradient;
    context.fillRect(x, 0, 1 + Math.random() * 3, length);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Box-projected UVs (x/z along the length, y down the side) for a lofted skin. */
function sideUvs(geometry: THREE.BufferGeometry, length: number, height: number): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uv[index * 2] = (position.getZ(index) / length + 0.5) * 3;
    uv[index * 2 + 1] = 1 - (position.getY(index) + 0.4) / height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

class Kit {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];
  geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }
  material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
  mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometries.includes(geometry) ? geometry : this.geometry(geometry), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  tube(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points);
    return this.mesh(parent, new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, 6, false), material, 0, 0, 0, false);
  }
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}

// --- The sport yacht -------------------------------------------------------------

const SPORT_LENGTH = 11.6;
const SPORT_SOLE = 0.82;

function sportStation(s: number): Station {
  const fore = Math.max(0, (s - 0.38) / 0.62);
  const taper = Math.sqrt(Math.max(0, 1 - fore * fore));
  const beam = 1.64 * taper + 0.03;
  return {
    beam,
    sheerY: 1.18 + 0.3 * s * s,
    chine: beam * 0.95,
    chineY: 0.16 + 0.5 * Math.pow(s, 2.4),
    keelY: -0.56 + 0.16 * s + 0.86 * Math.pow(fore, 3),
  };
}

/** The sport yacht: whole, or as the wreck on the reef (`wrecked`). */
export function sportYacht(wrecked = false): CraftModel {
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = wrecked ? "SportYachtWreck" : "SportYacht";
  const gelcoat = kit.material(new THREE.MeshStandardMaterial({ color: wrecked ? 0xc9c6c0 : 0xf3f3f0, roughness: wrecked ? 0.6 : 0.18, metalness: 0, envMapIntensity: 1.2, side: THREE.DoubleSide }));
  const carbon = kit.material(new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.32, metalness: 0.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  const antifoul = kit.material(new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.7, side: THREE.DoubleSide }));
  const teak = kit.material(new THREE.MeshStandardMaterial({ color: 0xa0764a, roughness: 0.78 }));
  const cushion = kit.material(new THREE.MeshStandardMaterial({ color: 0xd8ccb4, roughness: 0.92 }));
  const glass = kit.material(new THREE.MeshStandardMaterial({ color: 0x0b1820, roughness: 0.04, metalness: 0.6, transparent: true, opacity: 0.8, envMapIntensity: 1.8 }));
  const steel = kit.material(new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.15, metalness: 1, envMapIntensity: 1.3 }));
  const dark = kit.material(new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.5, metalness: 0.4 }));
  const char = kit.material(new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.95 }));
  const hull = loftHull(SPORT_LENGTH, sportStation, SPORT_SOLE, 0.56);
  kit.mesh(group, kit.geometry(hull.topsides), gelcoat);
  kit.mesh(group, kit.geometry(hull.bottom), antifoul);
  kit.mesh(group, kit.geometry(hull.deck), wrecked ? char : gelcoat);
  kit.mesh(group, kit.geometry(hull.liner), wrecked ? char : gelcoat);
  // The black carbon stripe along her quarters, and a thin one forward.
  kit.mesh(group, hullBand(SPORT_LENGTH, sportStation, 0.0, 0.42, 0.18, 0.62), carbon, 0, 0, 0, false);
  kit.mesh(group, hullBand(SPORT_LENGTH, sportStation, 0.42, 0.82, 0.22, 0.32), carbon, 0, 0, 0, false);
  const half = SPORT_LENGTH / 2;
  const zAt = (s: number) => -half + s * SPORT_LENGTH;
  // The deckhouse: a low, raked shell of tinted glass under a white hardtop.
  const house = new THREE.Group();
  house.position.set(0, sportStation(0.5).sheerY, zAt(0.5));
  group.add(house);
  const shell = kit.geometry(new THREE.CylinderGeometry(1.0, 1.32, 0.78, 4, 1, false, Math.PI / 4));
  shell.scale(1.28, 1, 1.25);
  const glassHouse = kit.mesh(house, shell, wrecked ? char : glass, 0, 0.36, 0.25);
  glassHouse.rotation.x = -0.08;
  const roof = kit.geometry(new THREE.BoxGeometry(2.62, 0.09, 3.6));
  const top = kit.mesh(house, roof, gelcoat, 0, 0.82, -0.95);
  if (wrecked) top.rotation.set(0.1, 0.05, 0.22);
  for (const x of [1.18, -1.18]) {
    const post = kit.mesh(house, kit.geometry(new THREE.BoxGeometry(0.07, 0.86, 0.07)), steel, x, 0.42, -2.55);
    post.rotation.x = 0.08;
  }
  // The helm under it: console, wheel, a seat.
  const helmX = -0.55;
  kit.mesh(group, kit.geometry(new THREE.BoxGeometry(0.8, 0.85, 0.6)), gelcoat, helmX, SPORT_SOLE + 0.42, zAt(0.47) + 0.75);
  const wheel = kit.mesh(group, kit.geometry(new THREE.TorusGeometry(0.2, 0.025, 6, 20)), dark, helmX, SPORT_SOLE + 0.98, zAt(0.47) + 0.42);
  wheel.rotation.x = -0.9;
  kit.mesh(group, kit.geometry(new THREE.BoxGeometry(0.62, 0.5, 0.55)), cushion, helmX, SPORT_SOLE + 0.25, zAt(0.47) - 0.55);
  kit.mesh(group, kit.geometry(new THREE.BoxGeometry(0.62, 0.5, 0.55)), cushion, 0.55, SPORT_SOLE + 0.25, zAt(0.47) - 0.55);
  // The aft sun pad and the swim platform.
  kit.mesh(group, kit.geometry(new THREE.BoxGeometry(2.5, 0.32, 1.9)), wrecked ? char : cushion, 0, SPORT_SOLE + 0.16, zAt(0.12));
  kit.mesh(group, kit.geometry(new THREE.BoxGeometry(3.1, 0.08, 0.75)), teak, 0, 0.42, -half - 0.36);
  // Rails along the foredeck.
  for (const side of [1, -1]) {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 8; index += 1) {
      const s = 0.55 + (index / 8) * 0.42;
      const at = sportStation(s);
      points.push(new THREE.Vector3(side * (at.beam - 0.08), at.sheerY + 0.3, zAt(s)));
    }
    kit.tube(group, points, 0.016, steel);
  }
  // Stern drives below the platform.
  for (const x of [0.62, -0.62]) kit.mesh(group, kit.geometry(new THREE.BoxGeometry(0.22, 0.55, 0.42)), dark, x, -0.1, -half - 0.18);
  if (wrecked) {
    // Torn open aft: the transom stove in, a black scorch over the quarter.
    kit.mesh(group, kit.geometry(new THREE.BoxGeometry(2.8, 1.1, 1.6)), char, 0, 0.75, -half + 1.0);
  }
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  const eye = new THREE.Vector3(helmX, SPORT_SOLE + 1.62, zAt(0.47) - 0.1);
  return {
    group,
    eye,
    seats: [{ x: helmX, y: SPORT_SOLE, z: zAt(0.47) - 0.42, yaw: 0, sit: false, seat: 0.5 }],
    update: () => undefined,
    dispose: () => kit.dispose(),
  };
}

// --- The skiff -------------------------------------------------------------------

const SKIFF_LENGTH = 4.4;
const SKIFF_SOLE = 0.08;

function skiffStation(s: number): Station {
  const fore = Math.max(0, (s - 0.5) / 0.5);
  const taper = Math.sqrt(Math.max(0, 1 - fore * fore * 0.92));
  const beam = 0.82 * taper + 0.04;
  return {
    beam,
    sheerY: 0.5 + 0.2 * Math.pow(s, 2.2),
    chine: beam * 0.86,
    chineY: -0.02 + 0.14 * Math.pow(s, 2),
    keelY: -0.16 + 0.04 * s + 0.4 * Math.pow(fore, 2.6),
  };
}

export function skiff(): CraftModel {
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = "Skiff";
  const salt = saltTexture();
  kit.textures.push(salt);
  const aluminium = kit.material(new THREE.MeshStandardMaterial({ color: 0xffffff, map: salt, roughness: 0.42, metalness: 0.72, envMapIntensity: 1.1, side: THREE.DoubleSide }));
  const inside = kit.material(new THREE.MeshStandardMaterial({ color: 0xa7adb0, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }));
  const wood = kit.material(new THREE.MeshStandardMaterial({ color: 0x8a6b48, roughness: 0.86 }));
  const orange = kit.material(new THREE.MeshStandardMaterial({ color: 0xf06a1e, roughness: 0.62 }));
  const white = kit.material(new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.7 }));
  const engine = kit.material(new THREE.MeshStandardMaterial({ color: 0x2f3437, roughness: 0.38, metalness: 0.3 }));
  const decal = kit.material(new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.4 }));
  const rope = kit.material(new THREE.MeshStandardMaterial({ color: 0xd9cfb2, roughness: 0.95 }));
  const hull = loftHull(SKIFF_LENGTH, skiffStation, SKIFF_SOLE, 0.86, 16);
  sideUvs(hull.topsides, SKIFF_LENGTH, 0.7);
  kit.mesh(group, kit.geometry(hull.topsides), aluminium);
  kit.mesh(group, kit.geometry(hull.bottom), aluminium);
  kit.mesh(group, kit.geometry(hull.deck), inside);
  kit.mesh(group, kit.geometry(hull.liner), inside);
  const half = SKIFF_LENGTH / 2;
  const zAt = (s: number) => -half + s * SKIFF_LENGTH;
  // Three thwarts across her.
  for (const s of [0.13, 0.48, 0.76]) {
    const at = skiffStation(s);
    kit.mesh(group, kit.geometry(new THREE.BoxGeometry(at.beam * 2 - 0.2, 0.05, 0.26)), wood, 0, at.sheerY - 0.14, zAt(s));
  }
  // The lifebuoy on the middle thwart, a coil of line in the bows.
  const buoy = kit.mesh(group, kit.geometry(new THREE.TorusGeometry(0.26, 0.075, 10, 24)), orange, 0.38, skiffStation(0.48).sheerY - 0.04, zAt(0.48) + 0.35);
  buoy.rotation.x = Math.PI / 2;
  for (let index = 0; index < 4; index += 1) {
    const band = kit.mesh(buoy, kit.geometry(new THREE.TorusGeometry(0.075, 0.012, 4, 10)), white, Math.cos((index * Math.PI) / 2) * 0.26, Math.sin((index * Math.PI) / 2) * 0.26, 0, false);
    band.rotation.y = Math.PI / 2;
    band.rotation.z = (index * Math.PI) / 2;
  }
  const coil = kit.mesh(group, kit.geometry(new THREE.TorusGeometry(0.17, 0.03, 6, 16)), rope, -0.15, SKIFF_SOLE + 0.04, zAt(0.88));
  coil.rotation.x = Math.PI / 2;
  // The outboard on the transom: clamp, cowling, leg, the tiller forward.
  const outboard = new THREE.Group();
  outboard.position.set(0, skiffStation(0).sheerY, -half - 0.05);
  group.add(outboard);
  kit.mesh(outboard, kit.geometry(new THREE.BoxGeometry(0.16, 0.18, 0.12)), engine, 0, -0.02, 0.02);
  const cowl = kit.mesh(outboard, kit.geometry(new THREE.BoxGeometry(0.34, 0.42, 0.5)), engine, 0, 0.26, -0.22);
  cowl.scale.set(1, 1, 1);
  kit.mesh(outboard, kit.geometry(new THREE.BoxGeometry(0.36, 0.05, 0.52)), decal, 0, 0.18, -0.22);
  kit.mesh(outboard, kit.geometry(new THREE.BoxGeometry(0.11, 0.72, 0.18)), engine, 0, -0.32, -0.2);
  const tiller = kit.mesh(outboard, kit.geometry(new THREE.CylinderGeometry(0.025, 0.03, 0.75, 8)), engine, 0, 0.24, 0.3);
  tiller.rotation.x = Math.PI / 2 - 0.25;
  const prop = new THREE.Group();
  prop.position.set(0, -0.64, -0.24);
  outboard.add(prop);
  for (let index = 0; index < 3; index += 1) {
    const blade = kit.mesh(prop, kit.geometry(new THREE.BoxGeometry(0.03, 0.19, 0.06)), engine, 0, 0.09, 0, false);
    blade.geometry.translate(0, 0, 0);
    blade.rotation.z = (index * Math.PI * 2) / 3;
    blade.position.set(Math.sin((index * Math.PI * 2) / 3) * 0.08, Math.cos((index * Math.PI * 2) / 3) * 0.08, 0);
  }
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  const driverZ = zAt(0.13) + 0.02;
  return {
    group,
    eye: new THREE.Vector3(0.32, skiffStation(0.13).sheerY + 0.92, driverZ - 0.05),
    seats: [
      // The helmsman on the aft thwart, the tiller in his hand.
      { x: 0.3, y: SKIFF_SOLE, z: driverZ, yaw: 0, sit: true, seat: skiffStation(0.13).sheerY - 0.12 - SKIFF_SOLE },
      // Mark on the middle thwart, facing aft to watch astern.
      { x: -0.12, y: SKIFF_SOLE, z: zAt(0.48), yaw: Math.PI, sit: true, seat: skiffStation(0.48).sheerY - 0.12 - SKIFF_SOLE },
      // A third low in the bows.
      { x: 0, y: SKIFF_SOLE, z: zAt(0.76), yaw: Math.PI * 0.9, sit: true, seat: skiffStation(0.76).sheerY - 0.12 - SKIFF_SOLE },
    ],
    update: (delta, rudder, shaft) => {
      outboard.rotation.y = rudder * 0.5;
      prop.rotation.z += shaft * delta * 70;
      outboard.rotation.x = -0.06 - Math.abs(shaft) * 0.06;
    },
    dispose: () => kit.dispose(),
  };
}

/** The craft's model by id. */
export function buildCraft(craft: "sport" | "skiff"): CraftModel {
  return craft === "sport" ? sportYacht() : skiff();
}
