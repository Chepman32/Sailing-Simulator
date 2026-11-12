import * as THREE from "three";
import type { LevelDefinition } from "../../level/LevelSystem";
import type { LevelBuilder, LP } from "../../level/LevelBuilder";
import { PatrolBoatTemplate } from "../../combat/PatrolBoatModel";
import {
  antennaMast,
  bollard,
  bougainvillea,
  chainFence,
  chair,
  containerCell,
  crate,
  desk,
  drum,
  fan,
  floodlight,
  generator,
  jerrycan,
  laundry,
  sandbags,
  jeep,
  sheetFence,
  shelves,
  tent,
  waterTank,
} from "../../level/LevelProps";

/**
 * «Створ-9»: the old harbour checkpoint on the north-east shore of the outer
 * island of Мёртвый прилив, now Vanguard Naval's outpost (M01). Its frame:
 * forward is north-east, to the sea and the jetty; right is south-east.
 *
 * - The yard: a concrete apron (its top 1.25 m) behind a quay, a corrugated
 *   fence on the land side with the gate and its checkpoint (route A), a
 *   chain-link fence on the south-east side with a dry storm drain passing
 *   under it to the generator (route B), and behind the white block the
 *   hill, where a narrow ledge path runs above the fence to the comms
 *   room's service balcony (route C).
 * - The white block: two storeys. Below, the comms room (a console at the
 *   window), the stair hall, the archive (shelves, a table, the terminal).
 *   Above, the radio room and its balcony, the office, the glass meeting
 *   room, and the administrative gallery along the front.
 * - The yard: the cell (a container with bars), the generator, a cook tent,
 *   a water tank, parking for the reinforcements' jeeps, crates, drums and
 *   sandbags; the jetty with the skiff; the white road to the north tip,
 *   where the patrol boat lies at its own pier.
 * - Up the hill behind, the limestone ledge Mark looks down from (S03).
 */

/** The island's centre on the chart, and the outpost's origin from it. */
const ISLAND = { east: -7111.77, north: -5043.04 };
export const STVOR9_ORIGIN = { east: ISLAND.east + 45, north: ISLAND.north + 88 };

/** A point of the outpost's frame (`right`, `forward`) on the chart, [east, north]. */
export function stvor9Chart(right: number, forward: number): readonly [number, number] {
  // Forward is north-east (bearing 45), right south-east.
  const s = Math.SQRT1_2;
  return [STVOR9_ORIGIN.east + (forward + right) * s, STVOR9_ORIGIN.north + (forward - right) * s];
}

const Y = 1.25;
const UP = 4.65;
const ROOF = 7.95;
const WHITE = 0xf0ece2;
const MINT = 0x8fb5a0;
const RUST_RED = 0x9a4a32;

export type TerminalPage = { kind: "idle" } | { kind: "copy"; stage: number } | { kind: "doc"; lang: "ru" | "en" };

/** The archive terminal's screen, drawn on a canvas. */
function drawTerminal(context: CanvasRenderingContext2D, page: TerminalPage, blink: boolean): void {
  const w = context.canvas.width;
  const h = context.canvas.height;
  context.fillStyle = "#0b1a22";
  context.fillRect(0, 0, w, h);
  context.fillStyle = "#123342";
  context.fillRect(0, 0, w, 34);
  context.fillStyle = "#9fd8e8";
  context.font = "bold 18px monospace";
  context.fillText("VANGUARD NAVAL · STVOR-9 · LOG SYSTEM v4.2", 14, 23);
  context.font = "16px monospace";
  if (page.kind === "idle") {
    const rows = ["AQ-L/1183  16:05  PATROL S-2   ROUTINE", "AQ-L/1184  16:12  BOAT CHECK   CLEARED", "AQ-L/1185  16:21  RADIO        NO CONTACT", "AQ-L/1186  16:33  PATROL S-1   INTERCEPT", "AQ-L/1187  16:40  PATROL S-1   TARGET / ATTACH."];
    rows.forEach((row, index) => {
      context.fillStyle = index === 4 ? "#ffd27a" : "#7fb7c8";
      context.fillText(row, 18, 70 + index * 30);
    });
    context.fillStyle = "#5d8a99";
    context.fillText(blink ? "> _" : ">", 18, h - 24);
    return;
  }
  if (page.kind === "copy") {
    const stages = ["MEDIA CHECK", "COPYING LOG", "AVAILABLE"];
    stages.forEach((stage, index) => {
      const done = page.stage > index;
      const now = Math.floor(page.stage) === index;
      context.fillStyle = done ? "#8fe3a2" : now ? "#ffd27a" : "#3f6673";
      context.fillText(`${done ? "[OK]" : now ? "[..]" : "[  ]"}  ${stage}`, 40, 90 + index * 40);
    });
    context.strokeStyle = "#3f6673";
    context.strokeRect(40, h - 70, w - 80, 18);
    context.fillStyle = "#8fe3a2";
    context.fillRect(42, h - 68, (w - 84) * Math.min(1, page.stage / 3), 14);
    return;
  }
  // The order: no name of who gave it, a photo of the one it is about.
  const ru = page.lang === "ru";
  context.fillStyle = "#ffd27a";
  context.font = "bold 17px monospace";
  context.fillText(ru ? "ИЗВЛЕЧЕНИЕ ИЗ МОРСКОГО ЖУРНАЛА / СТВОР-9" : "EXTRACT FROM THE SEA LOG / STVOR-9", 14, 62);
  context.font = "15px monospace";
  const fields = ru
    ? [["Номер", "AQ-L/1187"], ["Объект", "Маломерное судно. Кормовая чёрная полоса"], ["Идентиф.", "Фотография субъекта подтверждена"], ["Дата", "За 36 ч до оформления рейса"], ["Действие", "ЛИКВИДАЦИЯ / ПОДТВЕРЖДЕНИЕ НЕ ТРЕБУЕТСЯ"], ["Санкция", "Группа доступа скрыта ██████"]]
    : [["No.", "AQ-L/1187"], ["Object", "Small craft. Black stripe at the stern"], ["Ident.", "Photograph of the subject confirmed"], ["Date", "36 h before the trip was booked"], ["Action", "LIQUIDATE / NO CONFIRMATION NEEDED"], ["Authorised", "Access group hidden ██████"]];
  fields.forEach(([label, value], index) => {
    context.fillStyle = "#6fa3b3";
    context.fillText(`${label}:`, 150, 96 + index * 28);
    context.fillStyle = index === 4 ? "#ff8a7a" : "#d6eef4";
    context.fillText(value!, 250, 96 + index * 28);
  });
  // A grainy ID photo: a man's head and shoulders.
  context.fillStyle = "#c9c2b0";
  context.fillRect(18, 80, 116, 140);
  context.fillStyle = "#6c6255";
  context.beginPath();
  context.ellipse(76, 130, 26, 32, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.ellipse(76, 214, 50, 40, 0, Math.PI, 0);
  context.fill();
  context.fillStyle = "rgba(0,0,0,0.25)";
  for (let y = 80; y < 220; y += 3) context.fillRect(18, y, 116, 1);
  // The yacht's outline, the black stripe at her stern.
  context.strokeStyle = "#9fd8e8";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(150, 290);
  context.lineTo(420, 290);
  context.lineTo(470, 270);
  context.lineTo(180, 270);
  context.closePath();
  context.stroke();
  context.fillStyle = "#0b0b0b";
  context.fillRect(150, 276, 34, 12);
}

export const STVOR9: LevelDefinition = {
  id: "stvor9",
  frame: { x: -STVOR9_ORIGIN.east, z: STVOR9_ORIGIN.north, y: 0, bearing: 45 },
  range: 1100,
  pads: [
    // The yard, levelled (the apron is laid on top).
    { at: [-1, -1], w: 52, d: 32, height: 0.95, blend: 6, clear: 3 },
    // The parking and the road out of the gate.
    { at: [-36, 2], w: 18, d: 10, height: 0.5, blend: 5, clear: 2 },
    // The north tip: the shed and the patrol boat's pier.
    { at: [-68, -9], w: 16, d: 12, height: 0.45, blend: 5, clear: 2 },
    // The overlook's ledge, cleared of scrub in front.
    { at: [8, -57], w: 9, d: 7, height: 11.4, blend: 4, clear: 1, cutOnly: true },
  ],
  build: (b) => buildStvor9(b),
};

function buildStvor9(b: LevelBuilder): void {
  // --- The apron and the quay ------------------------------------------------
  // Laid in pieces round the storm drain's trench (r +19…+24, f −15…−13).
  b.slab([-3.5, 2], 45, 36, Y, { thick: 0.6, mat: "concrete", color: 0xd8d4ca });
  b.slab([21.5, 3.5], 5, 33, Y, { thick: 0.6, mat: "concrete", color: 0xd8d4ca });
  b.slab([21.5, -15.5], 5, 1, Y, { thick: 0.6, mat: "concrete", color: 0xd8d4ca });
  // The quay's face down to the water, and its kerb.
  b.box({ at: [-1, 20.15, -1.2], size: [50, 2.45, 0.3], mat: "concrete", color: 0xbfb9ab });
  b.box({ at: [-1, 19.9, Y], size: [50, 0.15, 0.3], mat: "concrete", color: 0xe3dfd4, solid: false });
  // Faded painted bays and a painted line.
  for (let index = 0; index < 4; index += 1) b.box({ at: [-19 + index * 3.4, 11, Y], size: [0.12, 0.01, 6], mat: "paint", color: 0xf3e9b5, solid: false });

  // --- The white block ---------------------------------------------------------
  buildHq(b);

  // --- Fences, the gate and the checkpoint --------------------------------------
  // The land side (left): corrugated sheet, the gate in it.
  sheetFence(b, [-26, -16], [-26, 18], Y, 2.4, MINT, [{ at: 17, width: 6.2 }]);
  // Behind the block (back): corrugated, either side of it.
  sheetFence(b, [-26, -16], [-14.2, -16], Y, 2.4, MINT);
  sheetFence(b, [2.2, -16], [24, -16], Y, 2.4, MINT);
  // The south-east side (right): chain link with barbed wire; the drain under it.
  chainFence(b, [24, -16], [24, 18], Y, 2.1, [{ at: 2, width: 2.6 }]);
  b.box({ at: [24, 2.6, Y], size: [0.3, 0.35, 30.8], mat: "concrete", color: 0xc9c4b8 });
  for (const f of [-8, 0, 7, 13]) bougainvillea(b, [25.2, f, b.groundAt(25.2, f)], 1.3 + Math.random() * 0.5);
  // The gate's two leaves, standing open, and the checkpoint.
  b.box({ at: [-28.6, 3.4, Y], size: [0.06, 2.3, 3.1], turn: 25, mat: "corrugated", color: 0x7d8f86 });
  b.box({ at: [-28.6, -3.4, Y], size: [0.06, 2.3, 3.1], turn: -25, mat: "corrugated", color: 0x7d8f86 });
  buildCheckpoint(b);

  // --- The cell, the generator, the drain ---------------------------------------
  const cell = containerCell(b, [8.2, -9, Y], 0, RUST_RED);
  b.switch("cell-door", (value) => {
    const open = value === "open";
    cell.door.rotation.y = open ? -1.9 : 0;
    if (cell.bars) cell.bars.off = open;
  });
  b.interact("cell-door", [8.2, -5.3, Y], 1.8);
  b.spot("cell-front", [8.3, -4.6, Y], 180);
  b.spot("luis", [8.0, -10.5, Y + 0.12], 0);
  b.spot("luis-out", [8.4, -3.6, Y], 20);
  // Inside: a mattress, bottles, a child's old drawing on the door.
  b.box({ at: [7.6, -10.5, Y + 0.12], size: [0.9, 0.12, 1.9], mat: "fabric", color: 0x7d8a96, solid: false });
  for (let index = 0; index < 5; index += 1) b.cylinder([8.9 - index * 0.1, -7.5 - index * 0.25, Y + 0.12], 0.035, 0.24, "glass", 0xffffff, { segments: 8, solid: false });

  generator(b, [16.5, -12, Y], 90);
  b.spot("p03", [15.2, -9.6, Y], 120);
  b.spot("p03-water", [14, 17.6, Y], 30);
  b.spot("p04", [18.6, -9.5, Y], -60);
  b.route("p04", [[18.6, -9.5, Y], [20.5, -4, Y], [14.5, -2, Y], [13.4, -12.5, Y]]);
  for (let index = 0; index < 6; index += 1) jerrycan(b, [18.8 + (index % 3) * 0.24, -14.2 + Math.floor(index / 3) * 0.4, Y], 90);
  drum(b, [20.2, -11.4, Y], 0x6a2c22);
  drum(b, [20.4, -10.6, Y], 0x2f5d8a);
  b.area("generator", [16.5, -11], 12, 12, { height: 6 });
  buildDrain(b);

  // --- The yard ---------------------------------------------------------------
  tent(b, [-19, -11, Y], 0, 4, 5, 0x6a7a52);
  b.cylinder([-19, -11.5, Y], 0.3, 0.45, "rust", 0xffffff, { segments: 12 });
  b.spot("kitchen-smoke", [-19, -11.5, Y + 0.5]);
  waterTank(b, [-21, -2, Y]);
  laundry(b, [-23.5, -14.5], [-17.5, -14.5], Y, [0x4a6a8a, 0xe0d8c4, 0x6f7550, 0xc95a3a]);
  // Parking for the jeeps (empty until the reinforcements come).
  b.spot("jeep1", [-15, 8, Y], 135);
  b.spot("jeep2", [-19, 13, Y], 135);
  b.spot("jeep-enter", [-30, 1.5, Y], 90);
  // The flag of the company.
  b.cylinder([-3, 3, Y], 0.05, 9, "paint", 0xc8ccce, { segments: 8 });
  const flag = new THREE.Mesh(b.own(new THREE.PlaneGeometry(1.8, 1.1, 8, 4)), b.own(new THREE.MeshStandardMaterial({ map: companyFlag(), side: THREE.DoubleSide, roughness: 0.9 })));
  flag.position.set(-0.9, 0, 0);
  const flagHolder = new THREE.Group();
  flagHolder.add(flag);
  b.object(flagHolder, [-3, 3, Y + 8.4], 60);
  b.animate((_delta, elapsed) => {
    const position = flag.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      position.setZ(index, Math.sin(elapsed * 4 + x * 3) * 0.08 * (x + 0.9));
    }
    position.needsUpdate = true;
  });
  // Cover: crates, drums, sandbags round the yard.
  crate(b, [-12, 4, Y], 15);
  crate(b, [-11.2, 4.9, Y], -10, 0.85);
  crate(b, [-11.6, 4.4, Y + 0.85], 30, 0.8);
  crate(b, [10, 6, Y], 5);
  crate(b, [11.2, 6.3, Y], 40, 0.9);
  crate(b, [4, 12, Y], 10);
  drum(b, [5.2, 12.6, Y]);
  drum(b, [5.6, 11.8, Y], 0x7a7a2a);
  drum(b, [-8, 14.8, Y], 0x2f5d8a);
  drum(b, [-7.3, 15.2, Y], 0x2f5d8a, true);
  sandbags(b, [-22.5, 7.5, Y], 3.2, 90);
  sandbags(b, [-22.5, -3.5, Y], 3.2, 90);
  sandbags(b, [-1, 16.8, Y], 3.6, 0);
  sandbags(b, [14.5, 14, Y], 3, 30);
  for (const [r, f, turn] of [
    [-12, 2.6, 180], [-10.2, 6.2, 0], [10, 4.6, 180], [11.8, 7.6, 0], [4, 10.6, 180], [5.5, 14, 0], [-22.0, 7.5, 90], [-23.0, 7.5, -90], [-22, -3.5, 90],
    [-1, 16.2, 180], [-1, 17.4, 0], [14.2, 13.4, 210], [16.6, -14.2, 0], [9.6, -4.6, 180], [-8, 13.8, 180], [6.8, -12.8, 90], [-17, -7.5, 0],
  ] as const) b.cover([r, f, Y], turn);
  floodlight(b, [-25, -15, Y], 45);
  floodlight(b, [23, -15, Y], -45);
  floodlight(b, [23, 18, Y], -135);
  floodlight(b, [-25, 18, Y], 135);

  // --- The jetty and the skiff's berth ----------------------------------------------
  b.slab([-4, 30.5], 4, 21, Y, { thick: 0.35, mat: "concrete", color: 0xcdc8bc });
  b.slab([-4, 41.5], 9, 3, Y, { thick: 0.35, mat: "concrete", color: 0xcdc8bc });
  for (let f = 22; f <= 42; f += 4) for (const r of [-5.7, -2.3]) b.cylinder([r, f, -2.5], 0.22, 3.4, "concrete", 0xa8a294, { segments: 10, solid: false });
  bollard(b, [-2.4, 27.5, Y]);
  bollard(b, [-2.4, 35.5, Y]);
  bollard(b, [-8, 41.5, Y]);
  for (const r of [-6, -2]) b.railing([r, 20.2], [r, 21.6], Y);
  // A lamp post at the jetty's end, its glass broken (D11 at it).
  b.cylinder([-6.8, 42.4, Y], 0.06, 4, "paint", 0x5a6266, { segments: 8 });
  b.box({ at: [-6.8, 42.4, Y + 3.9], size: [0.4, 0.25, 0.4], mat: "paint", color: 0x2a2d2f, solid: false });
  b.spot("skiff", [-0.6, 31.5, 0], 0);
  b.spot("mooring", [-2.3, 31.2, Y], 90);
  b.interact("mooring", [-2.4, 31.4, Y], 1.6);
  b.spot("mooring-mark", [-2.2, 29.6, Y], 90);
  b.spot("mooring-luis", [-2.4, 33.4, Y], 90);
  b.spot("d10", [-2.8, 27, Y], 90);
  b.spot("d11", [-6.3, 41.6, Y], -30);
  b.area("dock", [-4, 31], 12, 24, { height: 4 });
  // A lifebuoy on its post.
  b.cylinder([-5.8, 21.4, Y], 0.04, 1.4, "paint", 0xe8e8e2, { segments: 6, solid: false });
  const buoy = new THREE.TorusGeometry(0.3, 0.07, 8, 18);
  b.mesh(buoy, "paint", [-5.8, 21.47, Y + 1.15], 0, 0xf06a22);
  buoy.dispose();

  // --- The road and the north tip ----------------------------------------------------
  road(b, [[-27, 1], [-33, 0.5], [-41, -1], [-50, -4], [-58, -7], [-66, -9]], 4.2);
  buildNorthTip(b);

  // --- The ridge path (route C) and the overlook --------------------------------------
  buildRidge(b);
  buildOverlook(b);

  // --- The guards' posts and rounds ----------------------------------------------------
  b.spot("p01", [-28.6, 0.4, Y], -90);
  b.spot("p02", [-24.2, 7.2, Y], -60);
  b.spot("p05", [-12.5, -3.2, UP], 180);
  b.route("p05", [[-12.5, -3.2, UP], [0.8, -3.2, UP]]);
  b.spot("p06", [-20, -5.5, Y], 200);
  b.spot("p06-post", [-9.6, -5.6, Y], 0);
  b.spot("i07", [-11, -5.7, Y], 0);
  b.spot("i08", [1.2, -11.2, Y], 90);
  b.spot("i08-terminal", [-1, -13.6, Y], 180);
  b.spot("i09", [-2.2, -8.4, Y], 90);
  // Where the reinforcements take their places, and the commander.
  b.spot("e12", [-7, 2.5, Y], 180);
  b.spot("e13", [-6, -2.6, Y], 0);
  b.spot("e14", [3.4, 2.6, Y], 160);
  b.spot("e15", [-1.5, -3.1, UP], 0);
  b.spot("e16", [-3.8, 15.6, Y], 0);
  b.spot("k17", [-9, 3.5, Y], 200);
  b.spot("e12-arrive", [-13.6, 5.8, Y], 135);
  b.spot("k17-gallery", [-10, -3.1, UP], 0);
  b.spot("hq-door", [-6, -3.2, Y], 180);
  // Areas the mission listens for.
  b.area("yard", [-1, 2], 52, 38, { height: 9 });
  b.area("hq", [-6, -10], 16, 12, { height: 8 });
  b.area("archive", [-1, -10], 6, 12, { height: 3.5 });
  b.area("checkpoint", [-27, 3], 24, 22, { height: 6 });
  b.area("gate", [-26, 1], 6, 8, { height: 5 });
  b.area("drain-in", [21.5, -14], 6, 3, { height: 3 });
  b.area("ridge", [-4, -23], 22, 14, { height: 10 });
  b.area("balcony", [-11, -17.1], 4, 2.6, { height: 4 });

  // --- The ways the walkers walk ------------------------------------------------------
  // The yard's ring and its spokes.
  const ring: LP[] = [[-22, 10], [-22, -2], [-14, -1.5], [-6, -1.8], [4, -1.5], [12, -2], [20, -2], [20, 10], [10, 16], [-2, 16.5], [-12, 12], [-22, 10]];
  b.way(ring);
  b.way([[-22, 10], [-28.6, 1.2]]);
  b.way([[-6, -1.8], [-6, -3.2], [-6, -5.4]]);
  b.way([[-6, -5.4], [-9.6, -5.6], [-11, -6.2]]);
  b.way([[-6, -5.4], [-2.6, -5.8], [0, -8.4], [-1, -13.2]]);
  b.way([[0, -8.4], [1.2, -11.2]]);
  b.way([[-6, -5.4], [-6, -6.5], [-6, -13.4, UP], [-6, -14.8, UP], [-3.2, -14.8, UP], [-1, -12, UP], [-1, -9.5, UP], [0.5, -6.5, UP], [0.5, -3.1, UP]]);
  b.way([[-6, -14.8, UP], [-9.4, -14.8, UP], [-11, -13, UP], [-11, -15.5, UP], [-11, -17.1, UP]]);
  b.way([[0.5, -3.1, UP], [-12.5, -3.2, UP]]);
  b.way([[0.5, -3.1, UP], [3.1, -3.1, UP], [3.4, -2.6, UP], [3.4, 2.4], [4, -1.5]]);
  b.way([[12, -2], [9.4, -3.8], [8.4, -3.6]]);
  b.way([[20, -2], [18.6, -9.5], [16.5, -9.2], [13.4, -12.5]]);
  b.way([[-2, 16.5], [-4, 20.5], [-4, 31], [-4, 40.5], [-6.3, 41.6]]);
  b.way([[-22, -2], [-20, -5.5], [-17, -7.5]]);
}

function buildHq(b: LevelBuilder): void {
  const wall = { mat: "render" as const, color: WHITE, frames: 0x6f8f8a };
  const h0 = UP - 0.25 - Y;
  // Ground floor: front (f −4), back (f −16), sides (r −14, r +2), the inner walls.
  b.wall([-14, -4], [2, -4], { y: Y, height: h0, ...wall, openings: [{ at: 2.5, width: 2.6, bottom: 0.95, top: 2.25 }, { at: 8, width: 1.25, bottom: 0, top: 2.3 }, { at: 13, width: 2, bottom: 0.95, top: 2.25 }] });
  b.wall([-14, -16], [2, -16], { y: Y, height: h0, ...wall, openings: [{ at: 4, width: 1.2, bottom: 1.4, top: 2.2 }, { at: 14, width: 1.2, bottom: 1.4, top: 2.2 }] });
  b.wall([-14, -16], [-14, -4], { y: Y, height: h0, ...wall, openings: [{ at: 6, width: 1.6, bottom: 0.95, top: 2.25 }] });
  b.wall([2, -16], [2, -4], { y: Y, height: h0, ...wall, openings: [{ at: 4, width: 1.1, bottom: 0, top: 2.2 }, { at: 8.2, width: 1.6, bottom: 0.95, top: 2.25 }] });
  b.wall([-8, -16], [-8, -4], { y: Y, height: h0, thick: 0.15, mat: "render", color: 0xe6e1d4, openings: [{ at: 10.4, width: 1, bottom: 0, top: 2.2 }] });
  b.wall([-4, -16], [-4, -4], { y: Y, height: h0, thick: 0.15, mat: "render", color: 0xe6e1d4, openings: [{ at: 10.4, width: 1, bottom: 0, top: 2.2 }] });
  // Floors inside: tiles over the apron.
  b.slab([-6, -10], 15.8, 11.8, Y + 0.04, { thick: 0.04, mat: "paint", color: 0xa9a59a, solid: false });
  // The upper floor's slab, with the stair's well left open (r −7.6…−4.4, f −13.5…−4).
  b.slab([-11, -10], 6.2, 12, UP, { thick: 0.25, mat: "concrete", color: 0xdcd7cb });
  b.slab([-1, -10], 6.2, 12, UP, { thick: 0.25, mat: "concrete", color: 0xdcd7cb });
  b.slab([-6, -14.75], 3.6, 2.5, UP, { thick: 0.25, mat: "concrete", color: 0xdcd7cb });
  b.slab([-7.8, -8.75], 0.4, 9.5, UP, { thick: 0.25, mat: "concrete", color: 0xdcd7cb });
  b.slab([-4.2, -8.75], 0.4, 9.5, UP, { thick: 0.25, mat: "concrete", color: 0xdcd7cb });
  b.stairs([-6, -6.4], [-6, -13.5], Y, UP, 1.4, { mat: "concrete", color: 0xc4bfb3 });
  b.railing([-7.6, -13.5], [-6.8, -13.5], UP);
  b.railing([-5.2, -13.5], [-4.4, -13.5], UP);
  // Upper storey.
  const h1 = ROOF - 0.25 - UP;
  b.wall([-14, -4], [-4, -4], { y: UP, height: h1, ...wall, openings: [{ at: 2.5, width: 2.6, bottom: 0.95, top: 2.25 }, { at: 8, width: 2.4, bottom: 1.1, top: 2.4 }] });
  b.wall([1.1, -4], [2, -4], { y: UP, height: h1, ...wall });
  // The meeting room's front is glass (r −4…0), its door onto the gallery beside it (r 0…1.1).
  b.box({ at: [-2, -4, UP], size: [4, h1, 0.04], mat: "glass", solid: { opaque: false, material: "glass" } });
  b.box({ at: [0.55, -4, UP + 2.3], size: [1.1, h1 - 2.3, 0.2], mat: "render", color: WHITE });
  b.wall([-14, -16], [2, -16], { y: UP, height: h1, ...wall, openings: [{ at: 3, width: 1.05, bottom: 0, top: 2.25 }, { at: 13, width: 1.4, bottom: 1.0, top: 2.2 }] });
  b.wall([-14, -16], [-14, -4], { y: UP, height: h1, ...wall, openings: [{ at: 6, width: 1.6, bottom: 0.95, top: 2.25 }] });
  b.wall([2, -16], [2, -4], { y: UP, height: h1, ...wall, openings: [{ at: 3, width: 1.4, bottom: 1.0, top: 2.2 }, { at: 9, width: 1.4, bottom: 1.0, top: 2.2 }] });
  b.wall([-8, -16], [-8, -4], { y: UP, height: h1, thick: 0.15, mat: "render", color: 0xe6e1d4, openings: [{ at: 1.2, width: 1, bottom: 0, top: 2.2 }] });
  b.wall([-4, -16], [-4, -4], { y: UP, height: h1, thick: 0.15, mat: "render", color: 0xe6e1d4, openings: [{ at: 1.2, width: 1, bottom: 0, top: 2.2 }] });
  // The glass partition between the office and the meeting room, its door.
  b.box({ at: [-2.6, -10, UP], size: [2.6, h1 - 0.4, 0.04], mat: "glass", solid: { opaque: false, material: "glass" } });
  b.box({ at: [1.25, -10, UP], size: [1.5, h1 - 0.4, 0.04], mat: "glass", solid: { opaque: false, material: "glass" } });
  // The roof, its parapet, its kit.
  b.slab([-6, -10], 16.4, 12.4, ROOF, { thick: 0.25, mat: "concrete", color: 0xd8d3c6 });
  for (const [a, c] of [[[-14.2, -3.8], [2.2, -3.8]], [[-14.2, -16.2], [2.2, -16.2]], [[-14.2, -16.2], [-14.2, -3.8]], [[2.2, -16.2], [2.2, -3.8]]] as const) {
    b.wall(a, c, { y: ROOF, height: 0.6, thick: 0.2, mat: "render", color: WHITE });
  }
  antennaMast(b, [-11, -13, ROOF], 8);
  for (const r of [-3, 0]) {
    b.box({ at: [r, -14.6, ROOF], size: [1, 0.7, 0.8], mat: "paint", color: 0xc9c9c2 });
    b.cylinder([r, -14.6, ROOF + 0.7], 0.3, 0.05, "rubber", 0x333333, { solid: false });
  }
  // AC units on the walls, dripping.
  b.box({ at: [2.35, -13, Y + 2.2], size: [0.5, 0.55, 0.8], turn: 90, mat: "paint", color: 0xd4d2ca });
  b.box({ at: [-14.35, -12, UP + 1.9], size: [0.5, 0.55, 0.8], turn: 90, mat: "paint", color: 0xd4d2ca });
  // The sign over the door.
  const sign = new THREE.Mesh(b.own(new THREE.PlaneGeometry(2.6, 0.55)), b.own(new THREE.MeshStandardMaterial({ map: signTexture("СТВОР-9", "VANGUARD NAVAL"), roughness: 0.8 })));
  b.object(sign, [-6, -3.85, Y + 2.75], 180);
  // The gallery along the front, upstairs, and the stair down to the yard at its right end.
  b.slab([-6, -3.05], 16.4, 1.9, UP, { thick: 0.22, mat: "concrete", color: 0xd8d3c6 });
  b.railing([-14.2, -2.1], [2.0, -2.1], UP);
  b.railing([-14.2, -2.1], [-14.2, -4.0], UP);
  b.slab([3.4, -3.05], 2.6, 1.9, UP, { thick: 0.22, mat: "paint", color: 0x7a8682, surface: "metal" });
  b.stairs([3.4, 3], [3.4, -2.1], Y, UP, 1.2, { mat: "paint", color: 0x7a8682 });
  for (const [r, f] of [[-14, -2.2], [-8, -2.2], [-2, -2.2], [2, -2.2]] as const) b.cylinder([r, f, Y], 0.12, UP - Y - 0.22, "concrete", 0xd8d3c6, { segments: 10 });

  // Furniture.
  // The comms room: the console at the front window, its chair, I07's place; radios on the shelf.
  desk(b, [-11, -4.6, Y], 0, 2.6);
  chair(b, [-11, -5.7, Y], 180);
  for (const [r, colour] of [[-12, 0x22282c], [-11, 0x1c2226], [-10, 0x22282c]] as const) {
    b.box({ at: [r, -4.5, Y + 0.76], size: [0.6, 0.38, 0.06], mat: "paint", color: colour, solid: false });
  }
  shelves(b, [-13.6, -10, Y], 90, 2.4);
  fan(b, [-11, -8, Y + h0 - 0.45], true);
  // The archive: shelves along the walls, the table, the terminal at the back.
  shelves(b, [1.6, -12.5, Y], -90, 2.6);
  shelves(b, [1.6, -9.2, Y], -90, 2);
  shelves(b, [-3.6, -11.5, Y], 90, 3);
  desk(b, [-1, -14.6, Y], 180, 1.8);
  chair(b, [-1, -13.6, Y], 0);
  desk(b, [-1.8, -8.4, Y], 90, 1.4);
  chair(b, [-2.6, -8.4, Y], 270);
  fan(b, [-0.5, -14.5, Y + 0.76], false);
  // A plastic cup of melted ice; papers.
  b.cylinder([-1.5, -8.0, Y + 0.76], 0.04, 0.11, "glass", 0xffffff, { segments: 10, solid: false });
  for (let index = 0; index < 4; index += 1) b.box({ at: [-1.9 + index * 0.05, -8.8 + index * 0.08, Y + 0.765 + index * 0.003], size: [0.21, 0.003, 0.3], turn: index * 9, mat: "paint", color: 0xf4f1e8, solid: false });
  // The hydrographic chart on its shelf (the lore piece).
  b.box({ at: [1.35, -9.2, Y + 1.08], size: [0.03, 0.42, 0.32], turn: -90, mat: "paint", color: 0x2e4a6a, solid: false });
  b.interact("hydro-doc", [0.9, -9.2, Y], 1.3);
  // The terminal's screen.
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const context = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let page: TerminalPage = { kind: "idle" };
  drawTerminal(context, page, false);
  const screen = new THREE.Mesh(b.own(new THREE.PlaneGeometry(0.62, 0.39)), b.own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })));
  b.object(screen, [-1, -14.85, Y + 1.03], 0);
  b.box({ at: [-1, -14.9, Y + 0.78], size: [0.68, 0.48, 0.05], mat: "paint", color: 0x1c1f22, solid: false });
  b.own(texture);
  let blinkClock = 0;
  b.animate((delta) => {
    blinkClock += delta;
    if (page.kind === "idle" && Math.floor(blinkClock * 2) !== Math.floor((blinkClock - delta) * 2)) {
      drawTerminal(context, page, Math.floor(blinkClock * 2) % 2 === 0);
      texture.needsUpdate = true;
    }
  });
  b.switch("terminal", (value) => {
    const [kind, arg] = value.split(":");
    page = kind === "copy" ? { kind: "copy", stage: Number(arg) || 0 } : kind === "doc" ? { kind: "doc", lang: arg === "en" ? "en" : "ru" } : { kind: "idle" };
    drawTerminal(context, page, false);
    texture.needsUpdate = true;
  });
  b.interact("terminal", [-1, -13.7, Y], 1.3);
  // The same keyboard, worked three times over (the log, the drive, the attachment).
  b.interact("terminal-copy", [-1, -13.7, Y], 1.3);
  b.interact("terminal-order", [-1, -13.7, Y], 1.3);
  b.spot("terminal-eye", [-1, -14.2, Y + 1.2], 180);
  b.spot("terminal-stand", [-1, -13.2, Y], 180);
  b.spot("mark-terminal", [-2.1, -13.3, Y], 150);
  b.spot("hq-in", [-6, -6.2, Y], 180);
  // Out of the archive's front window, at the yard and the gate.
  b.spot("window", [-1, -4.5, Y + 1.6], 0);
  // The office: a desk, a map on the wall; the meeting room: a long table.
  desk(b, [-1, -14.4, UP], 180, 1.8);
  chair(b, [-1, -13.4, UP], 0);
  b.box({ at: [-1, -15.9, UP + 1.0], size: [2.4, 1.3, 0.02], mat: "paint", color: 0xd8cfb0, solid: false });
  desk(b, [-1, -7, UP], 90, 2.6);
  for (const f of [-7.8, -6.2]) {
    chair(b, [-2, f, UP], 90);
    chair(b, [0, f, UP], 270);
  }
  // The radio room: sets on a bench, a stool.
  desk(b, [-12.8, -10, UP], 90, 2.4);
  for (const f of [-10.8, -9.6]) b.box({ at: [-12.8, f, UP + 0.76], size: [0.45, 0.3, 0.35], mat: "paint", color: 0x2e3a2e, solid: false });
  // The service balcony behind the radio room (route C comes in here).
  b.slab([-11, -17.1], 3.6, 2.2, UP, { thick: 0.2, mat: "paint", color: 0x6d7a76, surface: "metal" });
  b.railing([-12.8, -18.2], [-9.2, -18.2], UP);
  b.railing([-12.8, -16.1], [-12.8, -18.2], UP);
}

function buildCheckpoint(b: LevelBuilder): void {
  // The booth: a little white box with a window, its awning, the barrier across the road.
  b.box({ at: [-23.8, 7.2, Y], size: [1.8, 2.4, 1.8], mat: "render", color: WHITE });
  b.box({ at: [-24.75, 7.2, Y + 1], size: [0.04, 0.8, 1.4], mat: "glass", solid: { opaque: false } });
  b.box({ at: [-23.8, 7.2, Y + 2.4], size: [2.4, 0.08, 2.4], mat: "corrugated", color: 0x8a9a92, solid: false });
  const awning = new THREE.BoxGeometry(3, 0.03, 2.2);
  awning.rotateX(0.12);
  b.mesh(awning, "fabric", [-24.4, 5.4, Y + 2.25], 0, 0x5e7d8e);
  awning.dispose();
  for (const f of [4.4, 6.4]) b.cylinder([-25.8, f, Y], 0.035, 2.25, "paint", 0x5a5e58, { segments: 6, solid: false });
  chair(b, [-24.4, 5.6, Y], 220);
  // The barrier: a post and a red-and-white arm across the road, outside the gate.
  b.box({ at: [-30.2, 4.6, b.groundAt(-30.2, 4.6)], size: [0.3, 1.1, 0.3], mat: "paint", color: 0x8a8f90 });
  for (let index = 0; index < 6; index += 1) {
    b.box({ at: [-30.2, 3.85 - index * 0.75, b.groundAt(-30.2, 4.6) + 0.95], size: [0.08, 0.08, 0.75], mat: "paint", color: index % 2 ? 0xffffff : 0xc8322a, solid: false });
  }
  // The sign.
  const sign = new THREE.Mesh(b.own(new THREE.PlaneGeometry(1.6, 0.6)), b.own(new THREE.MeshStandardMaterial({ map: signTexture("КПП · СТОП", "ПРЕДЪЯВИТЕ ПРОПУСК"), roughness: 0.8 })));
  b.object(sign, [-26.15, 9.6, Y + 1.6], -90);
  b.cover([-23.8, 9.0, Y], 0);
  b.cover([-30.6, 5.4, b.groundAt(-30.6, 5.4)], 90);
}

function buildDrain(b: LevelBuilder): void {
  // The trench inside the yard (r +19…+24, f −15…−13), its floor 0.25 m up, steps out at its inner end.
  const floor = 0.25;
  b.slab([21.5, -14], 5, 2, floor, { thick: 0.3, mat: "concrete", color: 0xa59f92 });
  for (const f of [-15.1, -12.9]) b.box({ at: [21.5, f, floor], size: [5, Y - floor, 0.2], mat: "concrete", color: 0xb7b1a4, floor: true });
  b.stairs([20.6, -14], [19.0, -14], floor, Y, 2, { mat: "concrete", color: 0xb7b1a4, rails: false });
  // The culvert under the fence: a concrete box section, its roof low (a crouch).
  b.slab([25, -14], 3, 2.6, floor, { thick: 0.3, mat: "concrete", color: 0x9e988a });
  b.box({ at: [25, -14, floor + 1.25], size: [3, 0.35, 2.6], mat: "concrete", color: 0xb2ac9e, floor: true });
  for (const f of [-15.2, -12.8]) b.box({ at: [25, f, floor], size: [3, 1.25, 0.2], mat: "concrete", color: 0xb2ac9e });
  // Outside: the channel running out to the low ground, a film of water in it.
  const outside = b.groundAt(32, -14);
  b.stairs([26.5, -14], [33, -14], floor, Math.max(floor + 0.1, outside), 2.2, { mat: "concrete", color: 0xa59f92, rails: false });
  for (const f of [-15.2, -12.8]) b.box({ at: [29.8, f, floor], size: [6.6, Math.max(0.4, outside - floor + 0.3), 0.2], mat: "concrete", color: 0xb2ac9e });
  b.box({ at: [27.5, -14, floor + 0.02], size: [3, 0.04, 2.2], mat: "glass", color: 0x6a8a7a, solid: false });
  b.area("drain", [27, -14], 9, 3, { height: 3 });
  b.spot("drain-mouth", [33.5, -14, outside], -90);
  b.spot("mark-drain", [35.5, -16.5, b.groundAt(35.5, -16.5)], -80);
  b.cover([34.5, -12.2, b.groundAt(34.5, -12.2)], -90);
  b.way([[33.5, -14], [27.5, -14, floor], [21.5, -14, floor], [19, -14], [16.5, -9.2]]);
}

function buildRidge(b: LevelBuilder): void {
  // A narrow path of limestone ledges along the slope above the fence, down
  // to a plank bridge onto the comms room's balcony; one short step up on the way.
  const ledges: [number, number, number][] = [
    [6, -31, 6.4],
    [3.2, -28.4, 6.1],
    [0.4, -26.2, 5.6],
    [-2.4, -24.2, 5.5],
    [-5.0, -22.5, 4.65],
    [-7.6, -21.0, 4.65],
  ];
  for (const [r, f, top] of ledges) {
    const ground = b.groundAt(r, f);
    const base = Math.min(ground - 0.4, top - 1);
    b.box({ at: [r, f, base], size: [2.6, top - base, 2.6], turn: 35, mat: "rock", color: 0xd8d2c2, floor: { surface: "concrete" } });
  }
  // The step: from the ledge at 5.5 up and over a lip to the last two (a jump down going in, a hop up coming out).
  b.box({ at: [-9.6, -19.4, 4.2], size: [1.4, 0.45, 2.4], turn: 35, mat: "rock", color: 0xcfc8b6, floor: true });
  // Planks over the fence to the balcony.
  b.slab([-10.6, -18.75], 1.1, 1.1, UP, { thick: 0.08, mat: "wood", color: 0x9a7a52, surface: "wood" });
  b.spot("mark-ridge", [3.2, -28.4, 6.1], 20);
  b.area("ridge-path", [-1, -25], 16, 12, { height: 12 });
  b.way([[8, -36], [6, -31, 6.4], [3.2, -28.4, 6.1], [0.4, -26.2, 5.6], [-2.4, -24.2, 5.5], [-5.0, -22.5, 4.65], [-7.6, -21.0, 4.65], [-9.6, -19.4, 4.65], [-10.6, -18.75, UP], [-11, -17.1, UP]]);
}

function buildOverlook(b: LevelBuilder): void {
  // A shelf of pale limestone with a flat boulder at its lip, two palms' shade.
  const top = 11.4;
  b.box({ at: [8, -57, top - 1.6], size: [6, 1.6, 4.4], turn: 10, mat: "rock", color: 0xe0dbcc, floor: true });
  b.box({ at: [7.6, -55.3, top], size: [2.2, 0.55, 1.2], turn: -8, mat: "rock", color: 0xd6d0c0, floor: true, solid: { cover: true } });
  b.spot("overlook", [8, -57.8, top], 0);
  b.spot("mark-overlook", [6.4, -56.6, top], 10);
  b.spot("overlook-view", [8.2, -55.6, top + 1.55], 0);
  b.area("overlook", [8, -57], 9, 8, { height: 4 });
  b.interact("binoculars", [7.2, -56.8, top], 2.4);
  // The routes as Mark shows them: down to the gate, along to the drain, over the ridge.
  b.spot("route-a", [-27, 2, Y], 0);
  b.spot("route-b", [30, -14, 0.5], 0);
  b.spot("route-c", [-2.4, -24.2, 5.5], 0);
  // The ways down: to the gate road, round to the drain, along the ridge.
  b.way([[8, -57.8, top], [4, -52], [-10, -42], [-24, -30], [-34, -14], [-38, -2], [-30, 1.4], [-28.6, 1.2]]);
  b.way([[8, -57.8, top], [14, -50], [24, -40], [32, -28], [36, -18], [33.5, -14]]);
  b.way([[8, -57.8, top], [9, -45], [8, -36]]);
}

function buildNorthTip(b: LevelBuilder): void {
  // A tin shed for the jeeps, and a short concrete pier where the patrol boat lies.
  const ground = b.groundAt(-66, -12);
  b.slab([-66, -12], 9, 7, ground + 0.15, { thick: 0.3, mat: "concrete", color: 0xc9c4b8 });
  for (const [a, c] of [[[-70.5, -15.5], [-61.5, -15.5]], [[-70.5, -15.5], [-70.5, -8.5]], [[-61.5, -15.5], [-61.5, -8.5]]] as const) {
    b.wall(a, c, { y: ground + 0.15, height: 3, thick: 0.05, mat: "corrugated", color: 0x9aa79c });
  }
  const roof = new THREE.BoxGeometry(9.6, 0.05, 7.6);
  roof.rotateX(-0.08);
  b.mesh(roof, "corrugated", [-66, -12, ground + 3.3], 0, 0x9aa79c);
  roof.dispose();
  b.spot("jeep-start1", [-66, -11, ground + 0.15], 160);
  b.spot("jeep-start2", [-64, -7, ground + 0.15], 160);
  // The pier out from the tip, into the sea toward the north-west.
  b.slab([-80, -4], 3, 14, 1.15, { thick: 0.3, mat: "concrete", color: 0xc9c4b8, turn: -60 });
  for (let s = -6; s <= 6; s += 3) {
    const radians = (-60 * Math.PI) / 180;
    b.cylinder([-80 + s * Math.sin(radians), -4 + s * Math.cos(radians), -2.5], 0.2, 3.5, "concrete", 0xa8a294, { segments: 8, solid: false });
  }
  b.spot("chase-boat", [-84.5, -1.2, 0], -60);
  // The patrol boat lying at the pier, her crew ashore: seen from the ledge before she goes.
  const template = b.own(new PatrolBoatTemplate());
  const boat = template.build("VN-31");
  boat.root.position.y = -0.05;
  b.object(boat.root, [-84.5, -1.2, 0], -60);
  b.switch("chase-boat", (value) => {
    boat.root.visible = value !== "gone";
  });
  // The two jeeps in the shed, until the commander comes in them.
  const cars = [jeep(b), jeep(b, 0xa8987a)];
  const route: LP[] = [[-66, -11], [-62, -8.5], [-58, -7], [-50, -4], [-41, -1], [-33, 0.5], [-27, 1], [-22, 3.2]];
  const parked: [LP, number][] = [
    [[-15, 8, Y], 135],
    [[-19, 13, Y], 135],
  ];
  const starts: [LP, number][] = [
    [[-66, -11, ground + 0.15], 160],
    [[-64, -7, ground + 0.15], 160],
  ];
  cars.forEach((car, index) => b.object(car.group, starts[index]![0], starts[index]![1]));
  let driving = -1;
  const at = new THREE.Vector3();
  const place = (index: number, point: LP, turn: number) => {
    b.local(point, at);
    cars[index]!.group.position.copy(at);
    cars[index]!.group.rotation.y = (-turn * Math.PI) / 180;
  };
  /** Where a car is `t` seconds into the drive: along the road, then into its bay. */
  const along = (index: number, t: number): void => {
    const path: LP[] = [...route, parked[index]![0]];
    const lengths = path.slice(1).map((point, step) => Math.hypot(point[0] - path[step]![0], point[1] - path[step]![1]));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    // Easing in from the shed and braking into the bay: about 11 m/s on the road.
    const u = Math.min(1, Math.max(0, t / 8.5));
    let distance = total * (u * u * (3 - 2 * u));
    for (let step = 0; step < lengths.length; step += 1) {
      const length = lengths[step]!;
      if (distance > length && step < lengths.length - 1) {
        distance -= length;
        continue;
      }
      const a = path[step]!;
      const c = path[step + 1]!;
      const k = Math.min(1, distance / length);
      const r = a[0] + (c[0] - a[0]) * k;
      const f = a[1] + (c[1] - a[1]) * k;
      const heading = (Math.atan2(c[0] - a[0], c[1] - a[1]) * 180) / Math.PI;
      const y = u >= 1 ? Y : Math.max(b.groundAt(r, f) + 0.06, r > -27 ? Y : 0);
      place(index, [r, f, y], u >= 1 ? parked[index]![1] : heading);
      for (const wheel of cars[index]!.wheels) wheel.rotation.x += 0.35 * (1 - u);
      return;
    }
  };
  b.animate((delta) => {
    if (driving < 0) return;
    driving += delta;
    along(0, driving);
    along(1, driving - 1.6);
  });
  b.switch("jeeps", (value) => {
    if (value === "arrive") {
      driving = 0;
    } else if (value === "parked") {
      driving = -1;
      parked.forEach(([point, turn], index) => place(index, point, turn));
    }
  });
  b.spot("w18", [-82, -2.6, 1.15], 120);
  b.spot("w19", [-81, -3.4, 1.15], 100);
}

/** A white limestone road laid on the ground along a line of points, `width` wide. */
function road(b: LevelBuilder, points: readonly [number, number][], width: number): void {
  const positions: number[] = [];
  const uvs: number[] = [];
  let along = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [r0, f0] = points[index]!;
    const [r1, f1] = points[index + 1]!;
    const length = Math.hypot(r1 - r0, f1 - f0);
    const steps = Math.max(1, Math.ceil(length / 2));
    const nr = (-(f1 - f0) / length) * (width / 2);
    const nf = ((r1 - r0) / length) * (width / 2);
    for (let step = 0; step < steps; step += 1) {
      const t0 = step / steps;
      const t1 = (step + 1) / steps;
      const corner = (t: number, side: number): number[] => {
        const r = r0 + (r1 - r0) * t + nr * side;
        const f = f0 + (f1 - f0) * t + nf * side;
        const point = b.local([r, f, b.groundAt(r, f) + 0.06]);
        return [point.x, point.y, point.z];
      };
      const a = corner(t0, -1);
      const c = corner(t0, 1);
      const d = corner(t1, 1);
      const e = corner(t1, -1);
      const v0 = along + length * t0;
      const v1 = along + length * t1;
      positions.push(...a, ...c, ...d, ...a, ...d, ...e);
      uvs.push(0, v0, width, v0, width, v1, 0, v0, width, v1, 0, v1);
    }
    along += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  b.mesh(geometry, "road", [0, 0, 0]);
  geometry.dispose();
}

function signTexture(title: string, subtitle: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#1f3b4a";
  context.fillRect(0, 0, 512, 128);
  context.fillStyle = "#e9e4d6";
  context.font = "bold 54px sans-serif";
  context.textAlign = "center";
  context.fillText(title, 256, 62);
  context.font = "26px sans-serif";
  context.fillStyle = "#b9c9cc";
  context.fillText(subtitle, 256, 104);
  // Salt and sun on the paint.
  for (let index = 0; index < 400; index += 1) {
    context.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
    context.fillRect(Math.random() * 512, Math.random() * 128, 2 + Math.random() * 6, 1 + Math.random() * 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The company's flag: a grey field, a chevron over a wave. */
function companyFlag(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#3b4a52";
  context.fillRect(0, 0, 256, 160);
  context.fillStyle = "#d9d4c4";
  context.beginPath();
  context.moveTo(70, 50);
  context.lineTo(128, 95);
  context.lineTo(186, 50);
  context.lineTo(186, 70);
  context.lineTo(128, 115);
  context.lineTo(70, 70);
  context.closePath();
  context.fill();
  context.strokeStyle = "#d9d4c4";
  context.lineWidth = 6;
  context.beginPath();
  for (let x = 60; x <= 196; x += 4) context.lineTo(x, 132 + Math.sin(x * 0.12) * 5);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
