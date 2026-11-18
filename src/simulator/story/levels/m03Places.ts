import * as THREE from "three";
import type { LevelDefinition } from "../../level/LevelSystem";
import type { LevelBuilder, LP } from "../../level/LevelBuilder";
import { GantryCrane, type CraneLoad } from "../../level/GantryCrane";
import { bougainvillea, chair, crate, drum, jerrycan, jeep, laundry, tent, waterTank } from "../../level/LevelProps";

/**
 * M03's island (docs/campaign/missions/m03.md): the village of Солнечный
 * мыс at its north end, the water station «Лагуна-4» at its south end, the
 * road between.
 *
 * - **The village** (`sc`): the square with its dry street tap and the
 *   "Не пить" sign, Inés's awning of empty canisters, a few houses, the
 *   pier on the north shore;
 * - **Лагуна-4** (`lg4`): the overlook on the slope; the checkpoint at the
 *   gate and the service path along the stone wall; the tech building with
 *   its gallery and the control room behind the blue door, a window to the
 *   sealed reserve tank; the loading yard: rails, the gantry crane
 *   (`GantryCrane`), the empty containers, the pump platform on the truck at
 *   the exit and the control platform under the awning, the blue hangar
 *   with its pad, the stair tower to the cab; the reserve and Daria's tanker.
 *
 * One frame for the island: its origin at the centre, forward north.
 */

export const SUNNY_ISLAND = { east: -3385, north: -4999 };

const ground = (b: LevelBuilder, r: number, f: number, up = 0): LP => [r, f, b.groundAt(r, f) + up];

/** A plank house on short stilts (as the fishing village's). */
function cottage(b: LevelBuilder, at: LP, turn: number, w: number, d: number, colour: number): void {
  const base = at[2] ?? 0;
  const floor = base + 0.45;
  const radians = (turn * Math.PI) / 180;
  const corner = (x: number, z: number): LP => [at[0] + Math.cos(radians) * x + Math.sin(radians) * z, at[1] - Math.sin(radians) * x + Math.cos(radians) * z];
  b.slab([at[0], at[1]], w, d, floor, { thick: 0.5, mat: "wood", color: 0x9a8262, turn, surface: "wood" });
  const walls: [number, number, number, number, boolean][] = [
    [-w / 2, d / 2, w / 2, d / 2, true],
    [w / 2, d / 2, w / 2, -d / 2, false],
    [w / 2, -d / 2, -w / 2, -d / 2, false],
    [-w / 2, -d / 2, -w / 2, d / 2, false],
  ];
  for (const [x0, z0, x1, z1, door] of walls) {
    const length = Math.hypot(x1 - x0, z1 - z0);
    b.wall(corner(x0, z0), corner(x1, z1), {
      y: floor,
      height: 2.5,
      thick: 0.12,
      mat: "paint",
      color: colour,
      openings: door ? [{ at: length / 2, width: 0.95, bottom: 0, top: 2.05 }] : [{ at: length / 2, width: 0.8, bottom: 1.0, top: 1.7 }],
    });
  }
  const roof = new THREE.BoxGeometry(w + 0.7, 0.05, d + 0.9);
  roof.rotateX(-0.12);
  b.mesh(roof, "corrugated", [at[0], at[1], floor + 2.68], turn, 0xb0b6ae);
  roof.dispose();
}

/** A shipping container (closed), its doors on the `forward` end. */
function containerMesh(colour: number, length = 6.06): { object: THREE.Group; dispose: () => void } {
  const object = new THREE.Group();
  const geometry = new THREE.BoxGeometry(2.44, 2.6, length);
  geometry.translate(0, 1.3, 0);
  const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7, metalness: 0.3 });
  const body = new THREE.Mesh(geometry, material);
  body.castShadow = true;
  body.receiveShadow = true;
  object.add(body);
  const ribs = new THREE.BoxGeometry(2.5, 2.4, 0.08);
  const ribMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).multiplyScalar(0.75), roughness: 0.75, metalness: 0.3 });
  for (let z = -length / 2 + 0.6; z < length / 2; z += 0.9) {
    const rib = new THREE.Mesh(ribs, ribMaterial);
    rib.position.set(0, 1.3, z);
    object.add(rib);
  }
  return {
    object,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      ribs.dispose();
      ribMaterial.dispose();
    },
  };
}

/** A pump or control platform: a white skid with the module on it, yellow lifting points. */
function platformMesh(control: boolean): { object: THREE.Group; dispose: () => void } {
  const object = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const add = (geometry: THREE.BufferGeometry, colour: number, x: number, y: number, z: number, metal = 0.2) => {
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: metal });
    owned.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(2.6, 0.3, 3.4), 0xe8e8e2, 0, 0.15, 0);
  if (control) {
    add(new THREE.BoxGeometry(1.6, 1.8, 1.0), 0xdfe3e2, 0, 1.2, -0.8);
    add(new THREE.BoxGeometry(1.2, 0.5, 0.05), 0x2a3640, 0, 1.6, -0.27, 0.4);
    add(new THREE.BoxGeometry(1.8, 1.2, 1.0), 0xdfe3e2, 0, 0.9, 0.9);
  } else {
    const pump = add(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 16), 0x2f6f9a, 0, 0.9, 0, 0.4);
    pump.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.9, 0.9, 0.9), 0x2a2e30, 0, 0.75, 1.4, 0.4);
    const pipe = add(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 10), 0x9aa0a4, 0.7, 1.1, -0.4, 0.8);
    pipe.rotation.z = Math.PI / 2;
  }
  for (const [x, z] of [[-1.15, -1.55], [1.15, -1.55], [-1.15, 1.55], [1.15, 1.55]] as const) add(new THREE.BoxGeometry(0.18, 0.22, 0.18), 0xf2c230, x, 0.4, z);
  return { object, dispose: () => owned.forEach((thing) => thing.dispose()) };
}

// --- The level -------------------------------------------------------------------------------

const SQUARE = 1.6;
const STATION = 1.3;
const YARD = 1.2;
/** The yard's crane: its rails' centre line across, its run along. */
const CRANE = { r: 10 };

export const SUNNY_CAPE_LEVEL: LevelDefinition = {
  id: "sc",
  frame: { x: -SUNNY_ISLAND.east, z: SUNNY_ISLAND.north, y: 0, bearing: 0 },
  range: 1400,
  pads: [
    { at: [0, 82], w: 40, d: 30, height: SQUARE, blend: 6, clear: 3 },
    { at: [0, 30], w: 8, d: 70, height: SQUARE, blend: 5, clear: 2 },
  ],
  build: (b) => buildVillage(b),
};

function buildVillage(b: LevelBuilder): void {
  // The street tap, dry, a sign hung on it.
  b.cylinder([0, 82, SQUARE], 0.08, 1.1, "paint", 0x8a9296, { segments: 8 });
  b.box({ at: [0.2, 82, SQUARE + 0.9], size: [0.35, 0.08, 0.08], mat: "paint", color: 0x8a9296, solid: false });
  b.box({ at: [0, 81.88, SQUARE + 0.45], size: [0.5, 0.32, 0.02], mat: "paint", color: 0xf2efe6, solid: false });
  b.box({ at: [0, 81.86, SQUARE + 0.53], size: [0.42, 0.06, 0.01], mat: "paint", color: 0xc0392b, solid: false });
  b.interact("sc-tap", [0, 81.4, SQUARE], 1.4);
  // Inés's awning, the canisters lined up under it.
  tent(b, [6, 86, SQUARE], 90, 3, 4, 0xd7a13c);
  for (let index = 0; index < 8; index += 1) jerrycan(b, [4.6 + (index % 4) * 0.6, 84.6 + Math.floor(index / 4) * 0.7, SQUARE], 90, index % 3 === 0 ? 0x3d8fb5 : 0xe8e2d0);
  b.spot("ines", [5.4, 86.4, SQUARE], 250);
  b.spot("kenji", [-1.6, 83, SQUARE], 110);
  b.interact("sc-kenji", [-1.6, 83, SQUARE], 2.0);
  b.spot("hero", [1.5, 79, SQUARE], 330);
  b.spot("tiago", [-6, 78, SQUARE], 60);
  b.spot("cook", [-9, 90, SQUARE], 160);
  b.spot("arrive", [0, 70, SQUARE], 0);
  b.spot("tanker-stop", [2.5, 74, SQUARE], 0);
  // Houses round the square, laundry, a fan on a porch.
  ([[-14, 92, 160, 0x4fa3a5], [-14, 76, 70, 0xe2b13c], [14, 94, 200, 0xd7563c], [15, 76, 280, 0x7fb069], [0, 100, 180, 0xb45a8a]] as const).forEach(([r, f, turn, colour]) =>
    cottage(b, [r, f, SQUARE], turn, 5, 4.2, colour),
  );
  bougainvillea(b, [-10, 86, SQUARE], 1.4);
  laundry(b, [9, 98, SQUARE + 1.9], [13, 99, SQUARE + 1.9], 0, [0xe8dcc4, 0x4f7fa8, 0xd16b4a]);
  waterTank(b, [-17, 84, SQUARE]);
  chair(b, [-8.6, 88.6, SQUARE], 20);
  // The pier on the north shore, where his boat comes in.
  b.slab([0, 124], 2.4, 20, 1.15, { thick: 0.14, mat: "wood", color: 0x8f7a5c, surface: "wood" });
  for (let f = 115; f <= 133; f += 3) for (const r of [-1, 1]) b.cylinder([r, f, -2.3], 0.11, 3.4, "wood", 0x5e4c38, { segments: 7, solid: false });
  b.spot("berth", [3, 128, 0], 180);
  b.spot("pier", [0, 120, 1.15], 180);
  b.spot("cam-square", [8, 72, 4.2], 330);
  b.spot("cam-square-look", [0, 83, 2.0], 0);
  b.way([
    [0, 120, 1.15],
    [0, 110, SQUARE],
    [0, 92, SQUARE],
    [0, 70, SQUARE],
    [0, 30, SQUARE],
    [0, -5, STATION],
  ]);
  b.way([
    [0, 92, SQUARE],
    [5, 86, SQUARE],
  ]);
  b.way([
    [0, 92, SQUARE],
    [-6, 80, SQUARE],
  ]);
}

export const LAGUNA4_LEVEL: LevelDefinition = {
  id: "lg4",
  frame: { x: -SUNNY_ISLAND.east, z: SUNNY_ISLAND.north, y: 0, bearing: 0 },
  range: 1400,
  pads: [
    // The approach road and the checkpoint.
    { at: [0, -20], w: 30, d: 20, height: STATION, blend: 6, clear: 3 },
    // The tech building and its yard side.
    { at: [-18, -52], w: 26, d: 22, height: STATION, blend: 5, clear: 3 },
    // The loading yard.
    { at: [12, -76], w: 40, d: 46, height: YARD, blend: 6, clear: 3 },
    // The reserve and the tanker's road.
    { at: [-22, -86], w: 18, d: 16, height: YARD, blend: 5, clear: 2 },
  ],
  build: (b) => buildStation(b),
};

function buildStation(b: LevelBuilder): void {
  // --- The overlook on the slope west of the road --------------------------------------
  b.spot("overlook", [-36, -6, b.groundAt(-36, -6)], 140);
  b.area("overlook", [-36, -6], 8, 8);
  b.spot("kenji-overlook", [-34, -4, b.groundAt(-34, -4)], 140);
  b.spot("cam-overlook", [-38, -2, b.groundAt(-38, -2) + 2.4], 140);
  b.spot("cam-overlook-look", [10, -70, 6], 0);
  // A faded sign on the road: «Лагуна-4».
  b.box({ at: [5, -8, STATION], size: [0.1, 1.8, 0.1], mat: "paint", color: 0x6a6e70 });
  b.box({ at: [5, -7.95, STATION + 1.5], size: [1.8, 0.6, 0.04], mat: "paint", color: 0x2f6f9a, solid: false });

  // --- The checkpoint at the gate, the service path along the wall ---------------------
  b.wall([-30, -30], [-4, -30], { y: STATION, height: 2.6, thick: 0.35, mat: "render", color: 0xd8d0c0, openings: [{ at: 4, width: 1.2, bottom: 0, top: 2.1 }] });
  b.wall([4, -30], [32, -30], { y: STATION, height: 2.6, thick: 0.35, mat: "render", color: 0xd8d0c0 });
  b.box({ at: [-4.5, -29, STATION], size: [1.6, 2.6, 1.6], mat: "render", color: 0xcfc6b4 });
  b.box({ at: [0, -30, STATION + 1.0], size: [8, 0.12, 0.12], mat: "paint", color: 0xd94a3a, solid: false });
  tent(b, [6, -25, STATION], 0, 3, 3, 0x6a7a52);
  for (let index = 0; index < 5; index += 1) b.cylinder([-2 + index * 1.1, -22, STATION], 0.18, 0.7, "paint", 0xe86a2a, { segments: 8, solid: false });
  drum(b, [9, -24, STATION], 0x2f5d8a);
  drum(b, [9.8, -24.6, STATION], 0x2f5d8a);
  b.spot("s01", [-1.5, -27.5, STATION], 0);
  b.spot("s02", [2.5, -27, STATION], 330);
  b.spot("s03", [6, -24, STATION], 300);
  b.spot("s04", [-8, -24, STATION], 30);
  b.spot("gate", [0, -24, STATION], 180);
  b.area("gate", [0, -22], 14, 10);
  // The service path: a door in the wall west, where the stone wall meets the scrub.
  b.spot("service", [-26, -27, STATION], 180);
  b.area("service", [-26, -26], 6, 6);
  b.interact("lg4-service-gate", [-26, -29.4, STATION], 1.6);
  const gateLeaf = new THREE.Group();
  const leafMesh = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x5a6a72, roughness: 0.6, metalness: 0.4 }));
  leafMesh.position.set(0.58, 1.0, 0);
  gateLeaf.add(leafMesh);
  b.own({ dispose: () => {
    leafMesh.geometry.dispose();
    (leafMesh.material as THREE.Material).dispose();
  } });
  b.object(gateLeaf, [-26.6, -30, STATION], 0);
  const gateSolid = b.box({ at: [-26, -30, STATION], size: [1.2, 2.1, 0.12], mat: "paint", color: 0x5a6a72, skip: ["top", "bottom", "front", "back", "left", "right"] });
  b.switch("service-gate", (value) => {
    const open = value === "open";
    gateLeaf.rotation.y = open ? 1.6 : 0;
    if (gateSolid) gateSolid.off = open;
  });
  for (const at of [[-12, -26], [12, -27], [-6, -34]] as const) b.cover([at[0], at[1], STATION], 180);
  crate(b, [-12, -27, STATION], 10, 1.0);
  crate(b, [12, -28, STATION], 40, 1.0);

  // --- The tech building: two storeys, the gallery along its east face, the blue door ---
  const up = STATION + 3.6;
  b.slab([-18, -52], 16, 12, STATION, { thick: 0.3, mat: "concrete", color: 0xcfcac0, surface: "concrete" });
  b.wall([-26, -46], [-10, -46], { y: STATION, height: 7, thick: 0.3, mat: "render", color: 0xe2dccd, openings: [{ at: 8, width: 1.2, bottom: 0, top: 2.2 }, { at: 3, width: 1.6, bottom: 4.6, top: 5.8 }, { at: 13, width: 1.6, bottom: 4.6, top: 5.8 }] });
  b.wall([-26, -58], [-10, -58], { y: STATION, height: 7, thick: 0.3, mat: "render", color: 0xe2dccd, openings: [{ at: 12, width: 1.2, bottom: 0, top: 2.2 }, { at: 4, width: 2.4, bottom: 1.0, top: 2.2 }] });
  b.wall([-26, -46], [-26, -58], { y: STATION, height: 7, thick: 0.3, mat: "render", color: 0xe2dccd });
  b.wall([-10, -46], [-10, -58], { y: STATION, height: 7, thick: 0.3, mat: "render", color: 0xe2dccd, openings: [{ at: 3, width: 1.2, bottom: 0, top: 2.2 }, { at: 9, width: 1.2, bottom: 3.6, top: 5.8 }] });
  b.slab([-18, -52], 16, 12, up, { thick: 0.25, mat: "concrete", color: 0xcfcac0, surface: "concrete" });
  b.slab([-18, -52], 16.6, 12.6, STATION + 7, { thick: 0.25, mat: "concrete", color: 0xbdb8ae });
  b.stairs([-24, -50], [-24, -56], STATION, up, 1.2, { mat: "concrete", color: 0xbdb8ae, rails: true });
  // Inside, ground floor: Luis's desk with the order and the protocol, the window to the reserve.
  b.box({ at: [-14, -55.5, STATION], size: [2.0, 0.78, 0.8], mat: "wood", color: 0x7a5a3a });
  b.box({ at: [-14, -55.5, STATION + 0.78], size: [0.42, 0.01, 0.3], mat: "paint", color: 0xf4f1e8, solid: false });
  b.interact("lg4-order", [-14, -55, STATION + 0.8], 1.4);
  chair(b, [-14, -54.4, STATION], 180);
  b.spot("luis", [-15.5, -54.2, STATION], 90);
  b.spot("asha", [-12.2, -53, STATION], 230);
  b.spot("daria", [-20.5, -56.6, STATION], 30);
  b.spot("hero-tech", [-12.5, -50.5, STATION], 200);
  b.spot("kenji-tech", [-16, -50.6, STATION], 160);
  b.area("tech", [-18, -52], 15, 11, { height: STATION + 3 });
  b.lamp([-18, -52, STATION + 3.1], 0xfff1d8, 5, 10);
  b.spot("cam-tech", [-11.5, -48, STATION + 1.9], 225);
  b.spot("cam-tech-look", [-15, -55, STATION + 1.4], 0);
  b.spot("s05", [-20, -49, STATION], 120);
  b.spot("s06", [-22, -56, STATION], 60);
  b.spot("s07", [-8, -50, STATION], 90);
  b.spot("s08", [-8, -56, STATION], 90);
  // Upstairs: the control room behind the blue door, the gallery outside it.
  b.wall([-18, -46.2], [-18, -58], { y: up, height: 3.2, thick: 0.15, mat: "render", color: 0xe2dccd, openings: [{ at: 6, width: 1.1, bottom: 0, top: 2.1 }] });
  b.box({ at: [-17.92, -52.2, up], size: [0.06, 2.1, 1.1], mat: "paint", color: 0x2f6fb5, solid: false });
  b.box({ at: [-22, -53, up], size: [2.4, 1.0, 0.8], mat: "paint", color: 0x8a9296 });
  b.box({ at: [-22, -53, up + 1.0], size: [2.2, 0.6, 0.1], mat: "paint", color: 0x1b2630, solid: false });
  b.spot("console", [-22, -52.2, up], 180);
  b.area("control", [-22, -52], 7, 10, { height: up - 0.5 });
  b.slab([-7.5, -52], 3.2, 14, up, { thick: 0.18, mat: "rust", color: 0x6a6e70, surface: "metal" });
  b.railing([-6, -45], [-6, -59], up, { height: 1.0, color: 0x6a6e70 });
  b.stairs([-7.5, -60.5], [-7.5, -66], up, YARD, 1.2, { mat: "rust", color: 0x6a6e70, rails: true });
  b.spot("s09", [-7.5, -48, up], 180);
  b.spot("s10", [-7.5, -56, up], 0);
  b.spot("gallery", [-7.5, -52, up], 180);

  // --- The loading yard ------------------------------------------------------------------
  b.slab([12, -76], 36, 42, YARD, { thick: 0.4, mat: "concrete", color: 0xc9c2b2, surface: "concrete", skip: ["bottom"] });
  for (const r of [CRANE.r - 14, CRANE.r + 14]) b.box({ at: [r, -76, YARD], size: [0.3, 0.12, 42], mat: "rust", color: 0x5a5250, solid: false });
  // The yard's north exit (a gate with a road out), where the trucks leave.
  b.spot("exit", [12, -55, YARD], 0);
  // The stair tower to the cab, on the east side; its top.
  b.box({ at: [28, -62, YARD], size: [3, 0.2, 3], mat: "rust", color: 0x6a6e70 });
  b.stairs([28, -66], [28, -62.5], YARD, YARD + 4, 1.2, { mat: "rust", color: 0x6a6e70, rails: true });
  b.slab([28, -61], 3, 3, YARD + 4, { thick: 0.15, mat: "rust", color: 0x6a6e70, surface: "metal" });
  b.stairs([28, -59.5], [28, -63.5], YARD + 4, YARD + 8, 1.2, { mat: "rust", color: 0x6a6e70, rails: true });
  b.slab([28, -64.8], 3, 2.6, YARD + 8, { thick: 0.15, mat: "rust", color: 0x6a6e70, surface: "metal" });
  b.interact("lg4-cab", [28, -64.8, YARD + 8], 1.8);
  b.spot("cab", [28, -64.8, YARD + 8], 270);
  b.spot("tower-foot", [28, -68, YARD], 0);
  for (const at of [[22, -70], [2, -62], [-2, -88], [24, -86]] as const) b.cover([at[0], at[1], YARD], 0);
  crate(b, [22, -70, YARD], 0, 1.2);
  crate(b, [2, -62, YARD], 30, 1.1);
  b.spot("s11", [-4, -66, YARD], 120);
  b.spot("s12", [4, -72, YARD], 90);
  b.spot("s13", [18, -92, YARD], 0);
  b.spot("s14", [-2, -90, YARD], 60);
  b.spot("s15", [24, -66, YARD], 270);
  b.spot("s16", [30, -70, YARD], 300);
  b.spot("s17", [28, -61, YARD + 4], 270);
  b.spot("s18", [20, -60, YARD], 200);
  // The reserve's six come down the north road when the crane moves.
  ["s19", "s20", "s21", "s22", "s23", "s24"].forEach((name, index) => {
    b.spot(name, [4 + index * 2.4, -12 - (index % 2) * 3, STATION], 180);
    b.spot(`${name}-yard`, [2 + index * 3.2, -57 - (index % 3) * 1.5, YARD], 180);
  });
  // The awning on the yard's east side, where the control platform stands.
  tent(b, [20, -72, YARD], 0, 6, 7, 0x8a9a72);
  // The truck T01 at the exit, the pump platform on its bed.
  const truck = jeep(b, 0x9aa0a4);
  truck.group.scale.set(1.25, 1.2, 1.7);
  b.object(truck.group, [12, -58, YARD], 0);
  // The blue hangar on the south side, its pad marked in yellow.
  b.wall([20, -100], [36, -100], { y: YARD, height: 6, thick: 0.25, mat: "corrugated", color: 0x2f6fb5 });
  b.wall([36, -100], [36, -86], { y: YARD, height: 6, thick: 0.25, mat: "corrugated", color: 0x2f6fb5 });
  b.wall([20, -100], [20, -94], { y: YARD, height: 6, thick: 0.25, mat: "corrugated", color: 0x2f6fb5 });
  const roof = new THREE.BoxGeometry(17, 0.08, 15);
  roof.rotateX(0.06);
  b.mesh(roof, "corrugated", [28, -93, YARD + 6.2], 0, 0x2a5f9a);
  roof.dispose();
  b.box({ at: [12, -88, YARD], size: [7, 0.02, 6], mat: "paint", color: 0xf2c230, solid: false });
  b.box({ at: [12, -88, YARD + 0.005], size: [6.6, 0.02, 5.6], mat: "concrete", color: 0xc9c2b2, solid: false });
  b.spot("hangar", [28, -94, YARD], 0);
  b.spot("kenji-hangar", [24, -96, YARD], 330);
  b.spot("workers", [30, -95, YARD], 300);
  ["w1", "w2", "w3"].forEach((name, index) => b.spot(name, [26 + index * 1.6, -97, YARD], 330 + index * 10));
  b.area("yard", [12, -76], 34, 40);
  // The side exit by the stair tower, for the tanker.
  b.interact("lg4-side-gate", [34, -74, YARD], 1.8);
  b.spot("side-gate", [33, -74, YARD], 90);

  // --- The crane, its loads and its marks --------------------------------------------------
  const owned: { dispose(): void }[] = [];
  const c1 = containerMesh(0x2f6fb5);
  const c2 = containerMesh(0x8a3a2a);
  const p1 = platformMesh(false);
  const p2 = platformMesh(true);
  owned.push(c1, c2, p1, p2);
  const loads: CraneLoad[] = [
    { id: "c1", object: c1.object, size: [2.44, 2.6, 6.06], mass: 4, x: 2, y: YARD, z: -68, yaw: 0 },
    { id: "c2", object: c2.object, size: [2.44, 2.6, 6.06], mass: 4, x: -1, y: YARD, z: -80, yaw: 0 },
    // The pump module on the truck's bed at the exit, the control module under the awning.
    { id: "p1", object: p1.object, size: [2.6, 1.9, 3.4], mass: 9, x: 12, y: YARD + 1.4, z: -59.5, yaw: 0 },
    { id: "p2", object: p2.object, size: [2.6, 2.1, 3.4], mass: 7, x: 20, y: YARD, z: -73, yaw: 0 },
  ];
  // Positions above are in the level's frame; the crane's group stands at its origin, so they are its own.
  const crane = new GantryCrane(
    loads,
    [
      { id: "exit", x: 12, z: -53.5, halfX: 5.5, halfZ: 3.2, accepts: ["c1", "c2"] },
      { id: "hangar", x: 12, z: -88, halfX: 4, halfZ: 3.6, accepts: ["p1", "p2"] },
    ],
    { travel: [-96, -53], cross: [-2, 22], hook: [0, 11] },
    YARD,
    14,
    28,
    { travel: -70, cross: 6 },
    CRANE.r,
  );
  for (const load of loads) crane.group.add(load.object);
  b.object(crane.group, [0, 0, 0], 0);
  GantryCrane.active = crane;
  b.own(crane);
  owned.forEach((thing) => b.own(thing));

  // --- The reserve and Daria's tanker -------------------------------------------------------
  b.cylinder([-24, -88, YARD], 3.2, 5.5, "paint", 0xe6e6e0, { segments: 20 });
  b.box({ at: [-24, -84.6, YARD + 2.4], size: [1.4, 0.8, 0.05], mat: "paint", color: 0x2f6fb5, solid: false });
  const tanker = jeep(b, 0xd8d8d0);
  tanker.group.scale.set(1.3, 1.3, 2.0);
  b.object(tanker.group, [-16, -88, YARD], 90);
  b.cylinder([-16, -88.5, YARD + 1.6], 0.9, 4.2, "paint", 0xc8ccd0, { segments: 16, solid: false });
  b.interact("lg4-hose", [-20, -87, YARD], 1.8);
  b.spot("reserve", [-19.5, -85.5, YARD], 220);
  b.spot("kenji-reserve", [-21, -84.2, YARD], 200);
  b.spot("daria-reserve", [-17.5, -85.8, YARD], 250);
  b.spot("luis-reserve", [-20, -82.8, YARD], 190);
  b.spot("asha-reserve", [-22.5, -83, YARD], 160);
  b.spot("cam-reserve", [-12, -80, YARD + 2.6], 230);
  b.spot("cam-reserve-look", [-20, -86, YARD + 1.6], 0);
  b.area("reserve", [-20, -86], 12, 10);
  // A sign for the workers to take down: «Демонтаж».
  b.box({ at: [-12, -80, YARD], size: [0.08, 1.5, 0.08], mat: "paint", color: 0x6a6e70 });
  b.box({ at: [-12, -79.95, YARD + 1.2], size: [1.4, 0.5, 0.03], mat: "paint", color: 0xe86a2a, solid: false });

  // --- Ways -------------------------------------------------------------------------------
  b.way([
    [0, 30, STATION],
    [0, -5, STATION],
    [0, -24, STATION],
    [0, -34, STATION],
    [-10, -40, STATION],
    [-10, -48.5, STATION],
    [-14, -51, STATION],
    [-24, -48, STATION],
  ]);
  b.way([
    [0, -5, STATION],
    [-20, -16, STATION],
    [-26, -24, STATION],
    [-26, -27, STATION],
    [-26, -33, STATION],
    [-18, -40, STATION],
    [-10, -40, STATION],
  ]);
  b.way([
    [-20, -16, STATION],
    [-34, -4, b.groundAt(-34, -4)],
  ]);
  b.way([
    [-10, -55.5, STATION],
    [-6, -62, YARD],
    [4, -66, YARD],
    [20, -66, YARD],
    [28, -68, YARD],
  ]);
  b.way([
    [4, -66, YARD],
    [4, -84, YARD],
    [-14, -84, YARD],
    [-20, -84, YARD],
  ]);
  b.way([
    [4, -84, YARD],
    [24, -96, YARD],
    [30, -95, YARD],
  ]);
  b.way([
    [20, -66, YARD],
    [33, -74, YARD],
  ]);
  b.way([
    [-7.5, -66, YARD],
    [-6, -62, YARD],
  ]);
  void ground;
}

export const M03_PLACES: readonly LevelDefinition[] = [SUNNY_CAPE_LEVEL, LAGUNA4_LEVEL];
