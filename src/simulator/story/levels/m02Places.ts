import * as THREE from "three";
import type { LevelDefinition } from "../../level/LevelSystem";
import type { LevelBuilder, LP } from "../../level/LevelBuilder";
import { bollard, bougainvillea, chair, crate, drum, jerrycan, laundry, tent, waterTank } from "../../level/LevelProps";
import { PatrolBoatTemplate } from "../../combat/PatrolBoatModel";
import { albatross, skiff } from "../../vessel/CraftModels";

/**
 * M02's places (docs/campaign/missions/m02.md §3):
 *
 * - **Тихий Лист** (`tl`): the fishing village on the south flank of the
 *   island north-west of Mark's cove. The hill is left as it is; the
 *   village lies on the lowland between it and the sea: the stone steps
 *   up from the west landing, the market of four awnings, the smokehouse
 *   and the fish shop, the fishermen's shelter behind it, the back jetty on
 *   the east shore, the company's big pier on the south shore, the yard
 *   with its plank fence. Three ways through, none walled off: the market
 *   lane, the north lane under the hill, the yard;
 * - **Зелёная Коса** (`gs`): the chase's narrows: mangrove clumps standing
 *   in the shallows along the Albatross's way, and the low plank bridge she
 *   must duck under;
 * - **Бухта свободных** (`bay`): the free people's settlement: coloured
 *   houses on stilts, the pier, the market, the bar on its beach deck, the
 *   clinic tent, two workshops, the boat dealer's slip, the well.
 *
 * Frames: the village's and the bay's origins at their islands' centres,
 * forward north (`[right, forward]` are east and north).
 */

/** The village's island centre and the bay's, on the chart (east, north). */
export const TIKHIY_LIST = { east: -7600, north: -2582 };
export const FREE_BAY = { east: -4463, north: -3500 };

const ground = (b: LevelBuilder, r: number, f: number, up = 0): LP => [r, f, b.groundAt(r, f) + up];

// --- Shared pieces ------------------------------------------------------------------------

/** A plank pier out over the water from `a` to `c` (on posts), its deck at `top`. */
function pier(b: LevelBuilder, a: LP, c: LP, top: number, width = 2.4, color = 0x8f7a5c): void {
  const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const turn = (Math.atan2(c[0] - a[0], c[1] - a[1]) * 180) / Math.PI;
  const mid: LP = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  b.slab(mid, width, length, top, { thick: 0.14, mat: "wood", color, turn, surface: "wood" });
  const radians = (turn * Math.PI) / 180;
  for (let s = -length / 2 + 0.6; s <= length / 2; s += 2.6) {
    for (const side of [-1, 1]) {
      const r = mid[0] + Math.sin(radians) * s + Math.cos(radians) * side * (width / 2 - 0.15);
      const f = mid[1] + Math.cos(radians) * s - Math.sin(radians) * side * (width / 2 - 0.15);
      b.cylinder([r, f, -2.4], 0.11, top + 2.3, "wood", 0x5e4c38, { segments: 7, solid: false });
    }
  }
  // Old tyres along her side for fenders.
  for (let s = -length / 2 + 2; s <= length / 2 - 1; s += 4) {
    const r = mid[0] + Math.sin(radians) * s + Math.cos(radians) * (width / 2 + 0.05);
    const f = mid[1] + Math.cos(radians) * s - Math.sin(radians) * (width / 2 + 0.05);
    const tyre = new THREE.TorusGeometry(0.32, 0.11, 6, 14);
    b.mesh(tyre, "rubber", [r, f, top - 0.45], turn + 90, 0x1d1d1d);
    tyre.dispose();
  }
}

/** A plank house on short stilts, its walls painted, its tin roof; a door on the `door` side. */
function house(b: LevelBuilder, at: LP, turn: number, w: number, d: number, colour: number, options: { door?: number; stilts?: number; roof?: number; open?: boolean } = {}): void {
  const floor = (at[2] ?? 0) + (options.stilts ?? 0.6);
  const radians = (turn * Math.PI) / 180;
  const corner = (x: number, z: number): LP => [at[0] + Math.cos(radians) * x + Math.sin(radians) * z, at[1] - Math.sin(radians) * x + Math.cos(radians) * z];
  if ((options.stilts ?? 0.6) > 0.05) {
    for (const [x, z] of [[-w / 2 + 0.2, -d / 2 + 0.2], [w / 2 - 0.2, -d / 2 + 0.2], [-w / 2 + 0.2, d / 2 - 0.2], [w / 2 - 0.2, d / 2 - 0.2]] as const) {
      const p = corner(x, z);
      b.cylinder([p[0], p[1], (at[2] ?? 0) - 0.6], 0.12, floor - (at[2] ?? 0) + 0.6, "wood", 0x5e4c38, { segments: 6 });
    }
  }
  b.slab(at.slice(0, 2) as unknown as LP, w, d, floor, { thick: 0.16, mat: "wood", color: 0x9a8262, turn, surface: "wood" });
  const height = 2.5;
  const door = options.door ?? 0;
  // Four walls; the door's wall has a doorway in its middle (and a window either side).
  const walls: [number, number, number, number, boolean][] = [
    [-w / 2, d / 2, w / 2, d / 2, door === 0],
    [w / 2, d / 2, w / 2, -d / 2, door === 90],
    [w / 2, -d / 2, -w / 2, -d / 2, door === 180],
    [-w / 2, -d / 2, -w / 2, d / 2, door === 270],
  ];
  for (const [x0, z0, x1, z1, hasDoor] of walls) {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const openings = hasDoor
      ? [{ at: length / 2, width: 0.95, bottom: 0, top: 2.05 }, { at: length * 0.18, width: 0.7, bottom: 1.0, top: 1.7 }]
      : options.open
        ? []
        : [{ at: length / 2, width: 0.8, bottom: 1.0, top: 1.7 }];
    b.wall(corner(x0, z0), corner(x1, z1), { y: floor, height, thick: 0.12, mat: "paint", color: colour, openings });
  }
  const roof = new THREE.BoxGeometry(w + 0.7, 0.05, d + 0.9);
  roof.rotateX(-(options.roof ?? 0.12));
  b.mesh(roof, "corrugated", [at[0], at[1], floor + height + 0.18], turn, 0xb0b6ae);
  roof.dispose();
}

/** A market awning on four poles: a striped canvas over a plank counter. */
function awning(b: LevelBuilder, at: LP, turn: number, colour: number): void {
  const base = at[2] ?? 0;
  const radians = (turn * Math.PI) / 180;
  const p = (x: number, z: number): LP => [at[0] + Math.cos(radians) * x + Math.sin(radians) * z, at[1] - Math.sin(radians) * x + Math.cos(radians) * z];
  for (const [x, z] of [[-1.6, -1.3], [1.6, -1.3], [-1.6, 1.3], [1.6, 1.3]] as const) {
    const q = p(x, z);
    b.cylinder([q[0], q[1], base], 0.05, z < 0 ? 2.6 : 2.3, "wood", 0x6a5640, { segments: 6, solid: false });
  }
  const canvas = new THREE.BoxGeometry(3.6, 0.03, 3.0);
  canvas.rotateX(0.1);
  b.mesh(canvas, "fabric", [at[0], at[1], base + 2.48], turn, colour);
  canvas.dispose();
  // The counter: planks on trestles, a crate or two, a scale.
  const counter = p(0, 0.9);
  b.box({ at: [counter[0], counter[1], base], size: [3.0, 0.92, 0.7], turn, mat: "wood", color: 0x8d7556, solid: { cover: true } });
}

/** A fridge chest, its lid up, old ice gone to water in it. */
function iceChest(b: LevelBuilder, at: LP, turn: number): void {
  b.box({ at, size: [1.4, 0.85, 0.75], turn, mat: "paint", color: 0xe8e8e2, solid: { cover: true } });
  b.box({ at: [at[0], at[1], (at[2] ?? 0) + 0.85], size: [1.36, 0.04, 0.7], turn, mat: "paint", color: 0x9fb6c2, solid: false });
}

/** A mangrove clump standing in the shallows: arching roots, a few trunks, a dark green crown. */
function mangrove(b: LevelBuilder, at: LP, size: number, seed: number): void {
  let s = seed;
  const random = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const roots = 7 + Math.floor(random() * 5);
  for (let index = 0; index < roots; index += 1) {
    const angle = (index / roots) * Math.PI * 2 + random() * 0.5;
    const reach = size * (1.1 + random() * 0.7);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(Math.cos(angle) * reach, -0.4, Math.sin(angle) * reach),
      new THREE.Vector3(Math.cos(angle) * reach * 0.7, size * 1.4, Math.sin(angle) * reach * 0.7),
      new THREE.Vector3(0, size * 1.9, 0),
    );
    const root = new THREE.TubeGeometry(curve, 8, 0.06 + size * 0.02, 5, false);
    b.mesh(root, "wood", at, 0, 0x5a4a38);
    root.dispose();
  }
  const trunk = new THREE.CylinderGeometry(0.14 * size, 0.2 * size, size * 2.2, 7);
  trunk.translate(0, size * 2.9, 0);
  b.mesh(trunk, "wood", at, 0, 0x4f4234);
  trunk.dispose();
  for (let index = 0; index < 5; index += 1) {
    const crown = new THREE.IcosahedronGeometry(size * (1.4 + random() * 0.8), 1);
    crown.scale(1, 0.62, 1);
    crown.translate((random() - 0.5) * size * 2.4, size * (3.8 + random() * 1.1), (random() - 0.5) * size * 2.4);
    b.mesh(crown, "leaf", at, 0, index % 2 ? 0x2f5a2c : 0x3c6a30);
    crown.dispose();
  }
  b.obstacle(at, size * 2.2);
}

// --- Тихий Лист ---------------------------------------------------------------------------

/** The ground the village is levelled to (above the sea), m. */
const MARKET = 1.6;
const SMOKE = 1.5;
const SHELTER = 1.1;
const YARD = 1.1;

export const TIKHIY_LIST_LEVEL: LevelDefinition = {
  id: "tl",
  frame: { x: -TIKHIY_LIST.east, z: TIKHIY_LIST.north, y: 0, bearing: 0 },
  range: 1300,
  pads: [
    // The market, the lane north of it under the hill, the yard south-east.
    { at: [0, -86], w: 60, d: 24, height: MARKET, blend: 7, clear: 3 },
    { at: [0, -70], w: 70, d: 8, height: MARKET + 0.4, blend: 6, clear: 2 },
    { at: [24, -101], w: 22, d: 10, height: YARD, blend: 5, clear: 2 },
    // The smokehouse and the fish shop, the fishermen's shelter behind them.
    { at: [40, -60], w: 24, d: 20, height: SMOKE, blend: 6, clear: 3 },
    { at: [60, -48], w: 14, d: 12, height: SHELTER, blend: 5, clear: 2 },
    // The path up from the west landing.
    { at: [-52, -72], w: 34, d: 10, height: 0.9, blend: 6, clear: 2 },
  ],
  build: (b) => buildVillage(b),
};

function buildVillage(b: LevelBuilder): void {
  // --- The west landing: stone steps up from the water, the berth beside them --------
  for (let index = 0; index < 5; index += 1) {
    b.box({ at: [-72 + index * 1.2, -64, -0.6 + index * 0.3], size: [1.3, 0.3 + 0.6, 3.2], mat: "rock", color: 0xb8b0a0, floor: true });
  }
  b.spot("berth", [-80, -64, 0], 270);
  b.spot("landing", [-66, -64, 0.9], 90);
  b.spot("landing-look", [-74, -58, 2.4], 120);
  // A dry palm frond or two, a buoy with the paint stripped.
  drum(b, ground(b, -63, -58), 0xc54b2a, true);

  // --- The market ------------------------------------------------------------------
  const colours = [0xd7563c, 0x3d8fb5, 0xe2b13c, 0x5aa36a];
  [-21, -7, 7, 21].forEach((r, index) => awning(b, [r, -82, MARKET], 180, colours[index]!));
  // Seven rows of crates between them, gaps left to pass and to hide in.
  for (let row = 0; row < 7; row += 1) {
    const r = -26 + row * 8.5;
    crate(b, [r, -91, MARKET], 15 * row, 0.9);
    if (row % 2 === 0) crate(b, [r + 1.1, -91.4, MARKET], 40, 0.7);
    if (row % 3 === 0) crate(b, [r + 0.4, -91.2, MARKET + 0.9], 5, 0.6);
  }
  iceChest(b, [11, -88, MARKET], 10);
  iceChest(b, [14.5, -88.4, MARKET], -6);
  jerrycan(b, [-12, -88, MARKET], 30, 0x2f5d8a);
  jerrycan(b, [-11.4, -88.3, MARKET], 70, 0x2f5d8a);
  waterTank(b, [-32, -77, MARKET]);
  b.spot("g01", [-10, -85.5, MARKET], 80);
  b.spot("g02", [-7.5, -85, MARKET], 260);
  b.spot("g03", [-30, -86, MARKET], 270);
  b.spot("g05", [12, -86.6, MARKET], 200);
  b.spot("g06", [14.5, -85.2, MARKET], 230);
  b.spot("g08", [24, -100, YARD], 260);
  b.route("market-round", [
    [-20, -94, MARKET],
    [20, -94, MARKET],
    [22, -77, MARKET],
    [-20, -77, MARKET],
  ]);
  b.route("west-awnings", [
    [-36, -74, MARKET],
    [-36, -96, MARKET],
  ]);
  b.spot("g04", [-20, -94, MARKET], 90);
  b.spot("g07", [-36, -74, MARKET], 180);
  b.area("market", [0, -86], 56, 22);
  for (const r of [-24, -12, 0, 12, 24]) b.cover([r, -90, MARKET], 180);

  // Mateo's awning by the south shore, from where he watches the boats.
  awning(b, [-30, -100, 0.9], 160, 0x7d9cb0);
  b.spot("mateo", [-30, -101.5, 0.9], 180);
  b.spot("mateo-hero", [-28.5, -98.5, 0.9], 200);
  b.area("mateo", [-30, -100], 8, 8);

  // The shed in the yard with the ordinary rifle and two magazines (S03).
  house(b, [20, -104, YARD], 0, 3.2, 2.6, 0x8aa0a8, { door: 0, stilts: 0.05 });
  b.interact("tl-rifle", [20, -103.6, YARD + 0.05], 1.4);
  // The yard's plank fence along its south side, a gap at each end.
  b.wall([12, -107], [36, -107], { y: YARD, height: 1.4, thick: 0.08, mat: "wood", color: 0x9a8a6c, openings: [{ at: 1.5, width: 2, bottom: 0, top: 1.4 }, { at: 22.5, width: 2, bottom: 0, top: 1.4 }] });
  laundry(b, [26, -97, YARD + 1.9], [33, -95, YARD + 1.9], 0, [0xe8dcc4, 0x4f7fa8, 0xd16b4a]);

  // --- The north lane under the hill: palms' shade, a cart, some nets drying -----------
  drum(b, [-14, -69, MARKET + 0.4], 0x2f5d8a);
  crate(b, [6, -69.5, MARKET + 0.4], 20, 1.0);
  b.cover([6, -71, MARKET + 0.4], 180);

  // --- The smokehouse and the fish shop --------------------------------------------
  // One building, its long side to the market: the smokehouse west, the shop east, a door between.
  house(b, [37, -60, SMOKE], 0, 12, 7, 0xb0886a, { door: 180, stilts: 0.05, roof: 0.18 });
  // Four heavy beams in the smoke room, salt sacks, the shop's tables.
  for (const r of [32.5, 34.5, 36.5, 38.5]) b.box({ at: [r, -60, SMOKE + 2.2], size: [0.22, 0.22, 6.4], mat: "wood", color: 0x3a2e22, solid: false });
  for (const [r, f] of [[33, -62.5], [33.8, -62.4], [33.4, -61.8]] as const) b.box({ at: [r, f, SMOKE + 0.05], size: [0.6, 0.5, 0.45], mat: "fabric", color: 0xd8d0bc });
  b.box({ at: [40.5, -59, SMOKE + 0.05], size: [2.4, 0.9, 1.0], mat: "paint", color: 0xc8ccc8, solid: { cover: true } });
  chair(b, [41, -61.5, SMOKE + 0.05], 20);
  b.area("fishshop", [37, -60], 11, 6);
  b.spot("shop-safe", [39, -61, SMOKE + 0.05], 0);
  b.lamp([37, -60, SMOKE + 2.3], 0xffe2b0, 4, 8);
  // The lookout's platform on the shop's east end, its stairs up from the yard.
  b.slab([45, -55], 3, 3, SMOKE + 3.2, { thick: 0.15, mat: "wood", color: 0x8d7556 });
  b.stairs([45, -61], [45, -57], SMOKE, SMOKE + 3.2, 1.1, { mat: "wood", color: 0x8d7556, rails: true });
  b.spot("g09", [45, -55, SMOKE + 3.2], 120);
  b.spot("g10", [42, -66, SMOKE], 200);
  b.spot("g12", [47, -63, SMOKE], 250);
  b.route("smoke-yard", [
    [44, -67, SMOKE],
    [50, -58, SMOKE],
    [48, -52, SMOKE],
  ]);
  b.spot("g11", [44, -67, SMOKE], 40);
  b.area("smokehouse", [44, -60], 24, 18);
  b.cover([30, -66, SMOKE], 180);
  b.cover([50, -66, SMOKE], 180);

  // --- The fishermen's shelter: a lean-to of planks behind the shop, its door latched ---
  const shelterFloor = SHELTER + 0.05;
  b.slab([60, -47], 7, 6, shelterFloor, { thick: 0.12, mat: "wood", color: 0x8a7558, surface: "wood" });
  b.wall([56.5, -50], [56.5, -44], { y: shelterFloor, height: 2.3, thick: 0.08, mat: "wood", color: 0x7d6a50, openings: [{ at: 3, width: 1.0, bottom: 0, top: 2.0 }] });
  b.wall([56.5, -44], [63.5, -44], { y: shelterFloor, height: 2.3, thick: 0.08, mat: "wood", color: 0x7d6a50 });
  b.wall([63.5, -44], [63.5, -50], { y: shelterFloor, height: 2.3, thick: 0.08, mat: "wood", color: 0x7d6a50 });
  b.wall([63.5, -50], [56.5, -50], { y: shelterFloor, height: 2.3, thick: 0.08, mat: "wood", color: 0x7d6a50, openings: [{ at: 3.5, width: 1.2, bottom: 0.9, top: 1.5 }] });
  const lean = new THREE.BoxGeometry(8, 0.05, 7);
  lean.rotateX(0.14);
  b.mesh(lean, "corrugated", [60, -47, shelterFloor + 2.45], 0, 0xa4a89c);
  lean.dispose();
  // The door in the west wall, latched from inside until he gives Mateo's name.
  const door = new THREE.Group();
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.98, 0.98), new THREE.MeshStandardMaterial({ color: 0x6e5a42, roughness: 0.85 }));
  leaf.position.set(0, 0.99, 0.49);
  leaf.castShadow = true;
  door.add(leaf);
  b.own({ dispose: () => {
    leaf.geometry.dispose();
    (leaf.material as THREE.Material).dispose();
  } });
  b.object(door, [56.5, -47.5, shelterFloor], 0);
  const doorSolid = b.box({ at: [56.5, -47, shelterFloor], size: [0.1, 2.0, 1.0], mat: "wood", color: 0x6e5a42, skip: ["top", "bottom", "front", "back", "left", "right"] });
  b.switch("shelter-door", (value) => {
    const open = value === "open";
    door.rotation.y = open ? -1.7 : 0;
    if (doorSolid) doorSolid.off = open;
  });
  b.interact("tl-shelter-door", [55.6, -47, shelterFloor], 1.6);
  b.interact("tl-radio", [62.4, -48.6, shelterFloor + 0.8], 1.4);
  b.box({ at: [62.6, -48.6, shelterFloor], size: [0.8, 0.78, 0.5], mat: "wood", color: 0x7a644a });
  b.box({ at: [62.6, -48.6, shelterFloor + 0.78], size: [0.32, 0.16, 0.22], mat: "paint", color: 0x2a2e2c, solid: false });
  b.spot("door-out", [54.5, -47, SHELTER], 90);
  b.spot("aliya", [58.2, -45.4, shelterFloor], 200);
  b.spot("luka", [59.8, -45.2, shelterFloor], 180);
  b.spot("juan", [61.8, -46.4, shelterFloor], 250);
  b.spot("rafa", [61.6, -48.8, shelterFloor], 300);
  b.spot("shelter-mateo", [59, -48.4, shelterFloor], 20);
  b.area("shelter", [60, -47], 7, 6, { height: shelterFloor - 0.5 });

  // --- The back jetty on the east shore -----------------------------------------------
  pier(b, [70, -50], [92, -50], 1.15, 2.2);
  b.spot("jetty", [84, -50, 1.15], 90);
  b.spot("jetty-berth", [93.5, -54, 0], 90);
  b.spot("nika", [86, -49.6, 1.15], 270);
  b.area("jetty", [80, -50], 16, 8);
  // Where the five stand to board, and the three of the company take cover when they come.
  ["jetty-1", "jetty-2", "jetty-3", "jetty-4", "jetty-5"].forEach((name, index) => b.spot(name, [74 + index * 2.4, -49.2 + (index % 2) * 1.4, 1.15], 90));
  b.spot("g13-cover", [62, -63, SHELTER], 40);
  b.spot("g14-cover", [68, -38, 0.6], 140);
  b.spot("g15-cover", [52, -58, SMOKE], 70);
  crate(b, [62.5, -61.5, SHELTER], 10, 1.0);
  crate(b, [68.5, -39.4, 0.5], 30, 0.9);
  b.cover([62.5, -60.5, SHELTER], 0);
  b.cover([68.5, -40.5, 0.5], 0);

  // --- The company's big pier on the south shore, two of their boats at it -------------
  pier(b, [4, -110], [4, -134], 1.2, 3.0, 0x7a6a52);
  const template = b.own(new PatrolBoatTemplate());
  const one = template.build("VN-44");
  one.root.position.y = -0.05;
  b.object(one.root, [8, -126, 0], 180);
  const two = template.build("VN-46");
  two.root.position.y = -0.05;
  b.object(two.root, [0, -122, 0], 180);
  b.switch("pier-boats", (value) => {
    one.root.visible = value !== "gone";
    two.root.visible = value !== "gone";
  });
  b.spot("g13", [2.5, -116, 1.2], 0);
  b.spot("g14", [5.5, -118, 1.2], 0);
  b.spot("g15", [3.2, -121, 1.2], 0);
  for (const at of [[3, -113], [5, -115]] as const) bollard(b, [at[0], at[1], 1.2]);

  // --- Camera spots for the scenes -----------------------------------------------------
  b.spot("cam-mateo", [-24.5, -96.5, 2.4], 225);
  b.spot("cam-mateo-look", [-29.5, -101, 1.9], 0);
  b.spot("cam-shelter", [53, -44, SHELTER + 1.7], 120);
  b.spot("cam-shelter-look", [59.5, -47, SHELTER + 1.2], 0);
  b.spot("cam-jetty", [76, -58, 3.8], 50);
  b.spot("cam-jetty-look", [90, -51, 1.6], 0);

  // --- Ways for those who walk the village -----------------------------------------------
  b.way([
    [-66, -64, 0.9],
    [-52, -70, 0.9],
    [-38, -74, MARKET],
    [-30, -86, MARKET],
    [-20, -94, MARKET],
    [0, -94, MARKET],
    [20, -94, MARKET],
    [28, -86, MARKET],
    [30, -72, MARKET],
    [44, -67, SMOKE],
    [52, -60, SMOKE],
    [54.5, -47, SHELTER],
    [66, -48, SHELTER],
    [74, -50, 1.15],
    [84, -50, 1.15],
  ]);
  b.way([
    [-38, -74, MARKET],
    [-14, -70, MARKET + 0.4],
    [10, -70, MARKET + 0.4],
    [30, -72, MARKET],
  ]);
  b.way([
    [-30, -86, MARKET],
    [-30, -98, 0.9],
  ]);
  b.way([
    [20, -94, MARKET],
    [24, -100, YARD],
    [36, -100, YARD],
    [52, -60, SMOKE],
  ]);
  b.way([
    [4, -110, 1.2],
    [0, -94, MARKET],
  ]);
  b.way([
    [52, -60, SMOKE],
    [62, -63, SHELTER],
    [66, -48, SHELTER],
  ]);
  b.way([
    [54.5, -47, SHELTER],
    [57.5, -47, shelterFloor],
    [60, -47, shelterFloor],
  ]);
  // A boat of the village's own pulled up by the landing.
  const dinghy = b.own(skiff());
  dinghy.group.position.y = -0.2;
  b.object(dinghy.group, [-73, -54, 0.1], 200);
}

// --- Зелёная Коса: the chase's narrows ------------------------------------------------------

/** The chase's waypoints (chart east, north): from the back jetty out east, under the bridge, through the narrows, across the spill, into the bay. */
export const CHASE_ROUTE: readonly (readonly [number, number])[] = [
  [-7470, -2570],
  [-7080, -2470],
  [-6800, -2350],
  [-6560, -2210],
  [-6300, -2050],
  [-6080, -1930],
  [-5920, -1850],
  [-5700, -1900],
  [-5300, -2050],
  [-4950, -2200],
  [-4780, -2330],
  [-4600, -2700],
  [-4520, -3050],
  [-4470, -3330],
];

/** The low bridge (its middle) and its bearing across the way. */
const BRIDGE = { east: -6560, north: -2210 };

export const GREEN_SPIT_LEVEL: LevelDefinition = {
  id: "gs",
  frame: { x: -BRIDGE.east, z: BRIDGE.north, y: 0, bearing: 0 },
  range: 2600,
  build: (b) => buildNarrows(b),
};

function buildNarrows(b: LevelBuilder): void {
  // The bridge: planks on pile bents, low over the water, across the way (which runs north-east here).
  const across = 300;
  const radians = (across * Math.PI) / 180;
  const top = 2.9;
  for (let s = -24; s <= 24; s += 4) {
    const r = Math.sin(radians) * s;
    const f = Math.cos(radians) * s;
    if (Math.abs(s) < 5) continue;
    b.cylinder([r, f, -2.5], 0.16, top + 2.4, "wood", 0x4f4234, { segments: 7 });
  }
  b.slab([0, 0], 2.0, 52, top, { thick: 0.22, mat: "wood", color: 0x7d6a50, turn: across, surface: "wood", solid: false });
  b.box({ at: [0, 0, top - 0.6], size: [0.5, 0.5, 52], turn: across, mat: "wood", color: 0x5a4a38, solid: false });
  b.railing([Math.sin(radians) * -26, Math.cos(radians) * -26], [Math.sin(radians) * 26, Math.cos(radians) * 26], top, { height: 0.9, color: 0x6a5640 });
  b.spot("bridge", [0, 0, top], across);
  b.spot("cam-bridge", [Math.sin(radians) * 18 + 6, Math.cos(radians) * 18 - 6, 1.4], 0);
  // Mangroves standing in the shallows along the way, the narrows between the two islets closest.
  const clumps: [number, number, number][] = [
    // Near the bridge, both banks.
    [-30, -14, 1.3], [-36, 6, 1.1], [30, 16, 1.4], [38, -4, 1.0], [-22, 30, 1.2], [26, -32, 1.1],
    // Toward the narrows (north-east of the bridge).
    [180, 120, 1.4], [230, 175, 1.2], [250, 100, 1.5], [330, 230, 1.3], [360, 150, 1.2], [420, 300, 1.5],
    [470, 250, 1.3], [520, 360, 1.1], [560, 300, 1.4], [600, 410, 1.2], [650, 330, 1.5], [700, 420, 1.2],
    // Back toward the village (south-west of the bridge).
    [-180, -120, 1.3], [-260, -150, 1.1], [-320, -230, 1.4], [-400, -220, 1.2], [-500, -300, 1.3], [-640, -330, 1.2],
  ];
  clumps.forEach(([r, f, size], index) => mangrove(b, [r, f, -0.3], size, 977 + index * 31));
}

// --- Бухта свободных -----------------------------------------------------------------------

export const FREE_BAY_LEVEL: LevelDefinition = {
  id: "bay",
  frame: { x: -FREE_BAY.east, z: FREE_BAY.north, y: 0, bearing: 0 },
  range: 1400,
  pads: [
    // The waterfront along the north shore, the square, the workshops' yard.
    { at: [0, 46], w: 70, d: 22, height: 1.4, blend: 7, clear: 3 },
    { at: [0, 20], w: 50, d: 24, height: 2.0, blend: 7, clear: 3 },
    { at: [-30, 30], w: 18, d: 18, height: 1.4, blend: 5, clear: 2 },
  ],
  build: (b) => buildBay(b),
};

function buildBay(b: LevelBuilder): void {
  const front = 1.4;
  const square = 2.0;
  // The pier out north, the Albatross's berth at its head; a second, shorter one for small boats.
  pier(b, [4, 60], [4, 92], 1.25, 3.0, 0x9a8462);
  pier(b, [-18, 60], [-18, 76], 1.2, 2.2);
  b.spot("albatross-berth", [8.2, 86, 0], 180);
  // The Albatross at her berth (the skipper's own boat is his again: she is the captain's).
  const albatrossModel = b.own(albatross());
  albatrossModel.group.position.y = -0.46;
  b.object(albatrossModel.group, [8.2, 84, 0], 180);
  b.switch("albatross", (value) => {
    albatrossModel.group.visible = value !== "away";
  });
  b.spot("skiff-berth", [-14.5, 72, 0], 180);
  b.spot("pier-head", [4, 84, 1.25], 180);
  b.spot("pier-a", [3, 70, 1.25], 0);
  b.spot("pier-b", [5, 78, 1.25], 180);
  // The houses: low, coloured, on stilts, in a loose crescent round the square.
  const houses: [number, number, number, number, number, number][] = [
    [-26, 12, 90, 5, 4, 0x4fa3a5],
    [-22, 2, 60, 5, 4.5, 0xe2b13c],
    [-10, -6, 20, 6, 4.5, 0xd7563c],
    [6, -8, 0, 5.5, 4.5, 0x7fb069],
    [20, -4, -30, 5, 4, 0xb45a8a],
    [28, 8, -70, 5, 4.5, 0x3d8fb5],
  ];
  houses.forEach(([r, f, turn, w, d, colour], index) => {
    house(b, [r, f, b.groundAt(r, f)], turn, w, d, colour, { door: 0, stilts: 0.7 });
    b.spot(`house-${index + 1}`, [r + Math.sin((turn * Math.PI) / 180) * (d / 2 + 1.4), f + Math.cos((turn * Math.PI) / 180) * (d / 2 + 1.4), b.groundAt(r, f)], turn + 180);
    if (index % 2 === 0) bougainvillea(b, [r + 3, f + 2, b.groundAt(r + 3, f + 2)], 1.5);
  });
  // The market: three stalls along the square's north side.
  awning(b, [-8, 24, square], 0, 0xd7563c);
  awning(b, [0, 24, square], 0, 0x3d8fb5);
  awning(b, [8, 24, square], 0, 0xe2b13c);
  for (const r of [-8, 0, 8]) crate(b, [r + 1, 26.4, square], 20, 0.8);
  b.spot("market-1", [-8, 27.5, square], 180);
  b.spot("market-2", [0, 27.5, square], 180);
  b.spot("market-3", [8, 27.5, square], 180);
  b.spot("mila", [0, 22.6, square], 0);
  // The well in the middle of the square.
  b.cylinder([0, 12, square], 0.9, 0.85, "rock", 0xb8b0a0, { segments: 14 });
  b.spot("well", [1.6, 12.5, square], 270);
  // The bar on its beach deck at the west end of the waterfront, a few chairs.
  b.slab([-28, 50], 10, 8, front + 0.4, { thick: 0.2, mat: "wood", color: 0xa48a64, surface: "wood" });
  house(b, [-30, 44, front + 0.4], 0, 6, 3.5, 0xe8d6a8, { door: 0, stilts: 0.05, open: true });
  for (const [r, f] of [[-31, 51], [-27, 52], [-24, 50]] as const) {
    chair(b, [r, f, front + 0.4], r * 13);
    b.box({ at: [r + 0.9, f, front + 0.4], size: [0.7, 0.72, 0.7], mat: "wood", color: 0x7a5a3a });
  }
  b.spot("bar-1", [-26, 49, front + 0.4], 0);
  b.spot("bar-2", [-30, 47.5, front + 0.4], 180);
  b.spot("deck", [-23, 53, front + 0.4], 30);
  b.lamp([-30, 44, front + 2.6], 0xffd8a0, 4, 9);
  // The clinic: a white tent with a red cross on the square's east side.
  tent(b, [22, 22, square], 0, 4, 5, 0xeeeeea);
  b.box({ at: [22, 24.6, square + 1.6], size: [0.9, 0.9, 0.02], mat: "paint", color: 0xd03a2e, solid: false });
  b.spot("med", [22, 19.5, square], 0);
  b.spot("nika", [21, 20.5, square], 300);
  // Two workshops in the yard west of the square: an engine on a stand, tools, a slip for boats.
  house(b, [-32, 30, front], 90, 7, 5, 0x8aa0a8, { door: 90, stilts: 0.05, open: true });
  b.box({ at: [-28, 34, front], size: [0.6, 1.0, 0.6], mat: "paint", color: 0x4a4e52 });
  b.box({ at: [-28, 34.1, front + 1.0], size: [0.45, 0.55, 0.55], mat: "paint", color: 0x2e3438, solid: false });
  b.spot("workshop-1", [-27, 32, front], 0);
  b.spot("workshop-2", [-30, 25, front], 90);
  b.spot("engine", [-27.4, 35.2, front], 180);
  b.spot("oskar", [-26.5, 33.5, front], 210);
  // The boat dealer's slip down to the beach: a hull on blocks, a sign.
  const dealer = b.own(skiff());
  dealer.group.position.y = 0.4;
  b.object(dealer.group, [-40, 42, front], 30);
  b.spot("beach", [-12, 58, 0.4], 0);
  // Nets drying, crates for the catch, the deck by the water.
  laundry(b, [10, 52, front + 1.6], [18, 54, front + 1.6], 0, [0x7a9a84, 0x7a9a84, 0x6a8a74]);
  b.spot("nets", [14, 51, front], 0);
  for (const [r, f] of [[-4, 56], [-2.8, 56.6], [-3.6, 55.2]] as const) crate(b, [r, f, front], r * 9, 0.8);
  b.spot("crates", [-1.6, 54.5, front], 210);
  drum(b, [6.5, 56, front], 0x2f5d8a);
  // Where the captain, Mateo and the hero stand for the arrival.
  b.spot("captain", [5, 63, front], 180);
  b.interact("bay-captain", [5, 63.8, front], 2.2);
  b.spot("mateo", [8, 58, front], 210);
  b.spot("hero", [3.5, 66, 1.25], 180);
  b.spot("cam-arrive", [16, 76, 4.5], 220);
  b.spot("cam-arrive-look", [4, 60, 2.2], 0);
  b.spot("cam-square", [14, 34, 5.5], 210);
  b.spot("cam-square-look", [0, 18, 2.4], 0);
  b.area("bay", [0, 30], 70, 60);
  // The ways.
  b.way([
    [4, 88, 1.25],
    [4, 62, 1.25],
    [4, 54, front],
    [0, 36, square],
    [0, 18, square],
    [-20, 18, square],
    [-27, 30, front],
    [-26, 49, front + 0.4],
  ]);
  b.way([
    [0, 18, square],
    [20, 16, square],
    [22, 19.5, square],
  ]);
  b.way([
    [4, 54, front],
    [-14, 54, front],
    [-26, 49, front + 0.4],
  ]);
  b.way([
    [4, 54, front],
    [14, 51, front],
  ]);
  b.way([
    [0, 18, square],
    [0, 4, square],
    [-10, 0, square],
    [6, -2, square],
    [20, 2, square],
  ]);
  b.way([
    [-18, 62, 1.2],
    [-14, 54, front],
  ]);
}

export const M02_PLACES: readonly LevelDefinition[] = [TIKHIY_LIST_LEVEL, GREEN_SPIT_LEVEL, FREE_BAY_LEVEL];
