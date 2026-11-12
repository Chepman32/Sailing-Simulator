import * as THREE from "three";
import { LevelCollision, type Floor, type Solid } from "./LevelCollision";
import { levelMaterials, type LevelMaterialKey } from "./LevelMaterials";

/**
 * Builds a story level (an outpost, a camp, a beach strewn with wreckage)
 * from a few architectural primitives, in the level's own frame, and turns
 * it into the world's: merged meshes (one per material), the collision a
 * walker, a guard's eye and a bullet meet (`LevelCollision`), and the named
 * points the mission script and the guards use (spots, routes, areas, cover,
 * things to interact with).
 *
 * The level's frame: its origin on the world, its `bearing` (compass
 * degrees) the way "forward" points. Authored points are `[right, forward,
 * up]` metres in that frame; a part's `turn` is degrees clockwise from
 * forward, as a bearing is.
 */

export type LevelFrame = { x: number; z: number; y: number; bearing: number };

/** A point in the level's frame: metres to the right of the origin, forward of it, and up. */
export type LP = readonly [right: number, forward: number, up?: number];

export type SolidFlags = Partial<Pick<Solid, "opaque" | "stopsRounds" | "cover" | "material">>;

export type BoxOptions = {
  /** Centre of the box's foot (its bottom face), level frame. */
  at: LP;
  /** Width (across, right), height, depth (along forward), m. */
  size: readonly [width: number, height: number, depth: number];
  turn?: number;
  mat: LevelMaterialKey;
  color?: number;
  /** Collision: a solid unless false; with flags to tune it. */
  solid?: false | SolidFlags;
  /** Its top is a floor (a slab, a step, a crate stood on). */
  floor?: boolean | { surface?: Floor["surface"] };
  /** Texture scale multiplier. */
  uv?: number;
  /** Faces left out (a slab hidden under another): "top", "bottom", "front", "back", "left", "right". */
  skip?: readonly string[];
};

export type Opening = { at: number; width: number; bottom: number; top: number };

export type WorldPoint = { x: number; y: number; z: number; yaw: number };

export type LevelAnchors = {
  spots: Map<string, WorldPoint>;
  routes: Map<string, WorldPoint[]>;
  areas: Map<string, { x: number; z: number; halfX: number; halfZ: number; angle: number; bottom: number; top: number }>;
  covers: WorldPoint[];
  interactables: Map<string, { x: number; y: number; z: number; radius: number }>;
  /** Things the story changes in a standing level (a door opened, a screen's page): by name, given a value. */
  switches: Map<string, (value: string) => void>;
  /** The level's way-points for those who walk it (guards, a companion): a graph of points and the links walkable between them. */
  nav: { points: { x: number; y: number; z: number }[]; links: number[][] };
};

export type BuiltLevel = {
  group: THREE.Group;
  collision: LevelCollision;
  anchors: LevelAnchors;
  /** Called every frame while the level stands (fans turning, a generator shaking). */
  update: (delta: number, elapsed: number) => void;
  dispose: () => void;
};

type Buffers = { positions: number[]; normals: number[]; uvs: number[]; colors: number[] };

const tmp = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();
const color = new THREE.Color();

export class LevelBuilder {
  readonly collision = new LevelCollision();
  readonly anchors: LevelAnchors = { spots: new Map(), routes: new Map(), areas: new Map(), covers: [], interactables: new Map(), switches: new Map(), nav: { points: [], links: [] } };
  private readonly navPairs: [LP, LP][] = [];
  readonly group = new THREE.Group();
  private readonly buffers = new Map<LevelMaterialKey, Buffers>();
  private readonly extra: THREE.Object3D[] = [];
  private readonly animators: ((delta: number, elapsed: number) => void)[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly heading: number;
  private seed = 1;

  constructor(
    readonly frame: LevelFrame,
    /** Height of the natural ground at a world point (terrain, sea floor), for things set on it. */
    readonly ground: (x: number, z: number) => number,
    name: string,
  ) {
    this.heading = (-frame.bearing * Math.PI) / 180;
    this.group.name = `Level_${name}`;
    this.group.position.set(frame.x, frame.y, frame.z);
    this.group.rotation.y = this.heading;
  }

  // --- Frames -------------------------------------------------------------

  /** A level point in the group's own coordinates (three.js: +x left, +z forward). */
  local(point: LP, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-point[0], point[2] ?? 0, point[1]);
  }

  /** A level point in the world. */
  world(point: LP, out = new THREE.Vector3()): THREE.Vector3 {
    this.local(point, out);
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const x = out.x * cos + out.z * sin;
    const z = -out.x * sin + out.z * cos;
    return out.set(this.frame.x + x, this.frame.y + out.y, this.frame.z + z);
  }

  /** The natural ground under a level point, in the level's heights (above its origin). */
  groundAt(right: number, forward: number): number {
    const point = this.world([right, forward, 0], tmp);
    return this.ground(point.x, point.z) - this.frame.y;
  }

  /** A turn (degrees clockwise from the level's forward) as a world heading (radians, forward = (sin, cos)). */
  worldYaw(turn = 0): number {
    return this.heading - (turn * Math.PI) / 180;
  }

  /** A world plan angle for a part turned by `turn` (its own +x axis, from world +x toward +z). */
  private planAngle(turn: number): number {
    return -(this.heading - (turn * Math.PI) / 180);
  }

  // --- Geometry -------------------------------------------------------------

  private buffer(key: LevelMaterialKey): Buffers {
    let buffer = this.buffers.get(key);
    if (!buffer) this.buffers.set(key, (buffer = { positions: [], normals: [], uvs: [], colors: [] }));
    return buffer;
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * A box: its foot at `at`, `size` = width × height × depth, turned by
   * `turn`. Adds its collision unless told not to.
   */
  box(options: BoxOptions): Solid | null {
    const { at, size, mat } = options;
    const turn = options.turn ?? 0;
    const [w, h, d] = size;
    const rotation = (-turn * Math.PI) / 180;
    const centre = this.local(at, new THREE.Vector3());
    centre.y += h / 2;
    this.addBoxGeometry(mat, centre, w, h, d, rotation, options.color ?? 0xffffff, options.uv ?? 1, options.skip);
    const worldFoot = this.world(at, new THREE.Vector3());
    const rect = { x: worldFoot.x, z: worldFoot.z, halfX: w / 2, halfZ: d / 2, angle: this.planAngle(turn) };
    let solid: Solid | null = null;
    if (options.solid !== false) {
      solid = { ...rect, bottom: worldFoot.y, top: worldFoot.y + h, material: materialOf(mat), ...(options.solid ?? {}) };
      this.collision.addSolid(solid);
    }
    if (options.floor) {
      const surface = typeof options.floor === "object" ? options.floor.surface : undefined;
      this.collision.addFloor({ ...rect, y: worldFoot.y + h, surface: surface ?? floorSurfaceOf(mat) });
    }
    return solid;
  }

  /** Raw box geometry in the group's frame (no collision): centre, size, rotation about y (radians). */
  addBoxGeometry(mat: LevelMaterialKey, centre: THREE.Vector3, w: number, h: number, d: number, rotation: number, tint: number, uvScale = 1, skip?: readonly string[]): void {
    const buffer = this.buffer(mat);
    color.setHex(tint);
    // A little variation from box to box: paint is never quite even.
    const shade = 0.94 + this.random() * 0.1;
    const r = color.r * shade;
    const g = color.g * shade;
    const b = color.b * shade;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const offsetU = this.random() * 7;
    const offsetV = this.random() * 7;
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    // Each face: normal, the two in-plane axes (u along, v up/across) and their half lengths.
    const faces: [string, [number, number, number], [number, number, number], [number, number, number], number, number, number][] = [
      // (u × v = the normal: each face wound counter-clockwise seen from outside.)
      ["right", [-1, 0, 0], [0, 0, 1], [0, 1, 0], hz, hy, hx],
      ["left", [1, 0, 0], [0, 0, -1], [0, 1, 0], hz, hy, hx],
      ["top", [0, 1, 0], [1, 0, 0], [0, 0, -1], hx, hz, hy],
      ["bottom", [0, -1, 0], [1, 0, 0], [0, 0, 1], hx, hz, hy],
      ["front", [0, 0, 1], [1, 0, 0], [0, 1, 0], hx, hy, hz],
      ["back", [0, 0, -1], [-1, 0, 0], [0, 1, 0], hx, hy, hz],
    ];
    for (const [name, n, u, v, hu, hv, depth] of faces) {
      if (skip?.includes(name)) continue;
      const corners: [number, number][] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, -1],
        [1, 1],
        [-1, 1],
      ];
      for (const [su, sv] of corners) {
        const lx = n[0] * depth + u[0] * hu * su + v[0] * hv * sv;
        const ly = n[1] * depth + u[1] * hu * su + v[1] * hv * sv;
        const lz = n[2] * depth + u[2] * hu * su + v[2] * hv * sv;
        buffer.positions.push(centre.x + lx * cos + lz * sin, centre.y + ly, centre.z - lx * sin + lz * cos);
        buffer.normals.push(n[0] * cos + n[2] * sin, n[1], -n[0] * sin + n[2] * cos);
        buffer.uvs.push((offsetU + hu * su) * uvScale, (offsetV + hv * sv + (name === "top" || name === "bottom" ? 0 : centre.y)) * uvScale);
        buffer.colors.push(r, g, b);
      }
    }
  }

  /**
   * Any geometry merged into a material's mesh, placed at a level point,
   * turned and scaled (vertex colours default to `tint`).
   */
  mesh(geometry: THREE.BufferGeometry, mat: LevelMaterialKey, at: LP, turn = 0, tint = 0xffffff, scale: number | THREE.Vector3 = 1): void {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute("position");
    const normal = source.getAttribute("normal");
    const uv = source.getAttribute("uv");
    const colours = source.getAttribute("color");
    const buffer = this.buffer(mat);
    const matrix = new THREE.Matrix4().compose(
      this.local(at, new THREE.Vector3()),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-turn * Math.PI) / 180),
      typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : scale,
    );
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    color.setHex(tint);
    for (let index = 0; index < position.count; index += 1) {
      tmp.fromBufferAttribute(position, index).applyMatrix4(matrix);
      buffer.positions.push(tmp.x, tmp.y, tmp.z);
      if (normal) tmpNormal.fromBufferAttribute(normal, index).applyMatrix3(normalMatrix).normalize();
      else tmpNormal.set(0, 1, 0);
      buffer.normals.push(tmpNormal.x, tmpNormal.y, tmpNormal.z);
      buffer.uvs.push(uv ? uv.getX(index) : 0, uv ? uv.getY(index) : 0);
      if (colours) buffer.colors.push(colours.getX(index) * color.r, colours.getY(index) * color.g, colours.getZ(index) * color.b);
      else buffer.colors.push(color.r, color.g, color.b);
    }
    if (source !== geometry) source.dispose();
  }

  /** An object kept apart (animated, or with its own material); placed at a level point. */
  object(object: THREE.Object3D, at: LP, turn = 0): THREE.Object3D {
    this.local(at, object.position);
    object.rotation.y = (-turn * Math.PI) / 180;
    this.group.add(object);
    this.extra.push(object);
    return object;
  }

  /** A geometry, material or texture this level owns (disposed with it). */
  own<T extends { dispose(): void }>(thing: T): T {
    this.owned.push(thing);
    return thing;
  }

  animate(update: (delta: number, elapsed: number) => void): void {
    this.animators.push(update);
  }

  // --- Architecture ---------------------------------------------------------

  /**
   * A straight wall from `a` to `b` (level plan points), standing on `y`,
   * `height` tall and `thick` thick, with openings (doors, windows) cut in it:
   * each `at` metres from `a`, `width` wide, from `bottom` to `top` above the
   * wall's foot.
   */
  wall(a: LP, b: LP, options: { y: number; height: number; thick?: number; mat: LevelMaterialKey; color?: number; openings?: readonly Opening[]; solid?: SolidFlags; frames?: number }): void {
    const thick = options.thick ?? 0.22;
    const dx = b[0] - a[0];
    const df = b[1] - a[1];
    const length = Math.hypot(dx, df);
    if (length < 0.01) return;
    // Bearing of the wall's run, so its width runs along it.
    const turn = (Math.atan2(dx, df) * 180) / Math.PI - 90;
    const along = (s: number): LP => [a[0] + (dx * s) / length, a[1] + (df * s) / length, options.y];
    const openings = [...(options.openings ?? [])].sort((p, q) => p.at - q.at);
    const piece = (from: number, to: number, bottom: number, top: number) => {
      if (to - from < 0.01 || top - bottom < 0.01) return;
      const mid = along((from + to) / 2);
      this.box({ at: [mid[0], mid[1], options.y + bottom], size: [to - from, top - bottom, thick], turn, mat: options.mat, color: options.color, solid: options.solid });
    };
    let cursor = 0;
    for (const opening of openings) {
      const start = Math.max(cursor, opening.at - opening.width / 2);
      const end = Math.min(length, opening.at + opening.width / 2);
      piece(cursor, start, 0, options.height);
      // Below a window, above a door or window.
      piece(start, end, 0, opening.bottom);
      piece(start, end, opening.top, options.height);
      // A frame round the opening, painted.
      if (options.frames !== undefined) {
        const frame = options.frames;
        const midOpen = along((start + end) / 2);
        const t = 0.06;
        for (const side of [start, end]) {
          const at = along(side);
          this.box({ at: [at[0], at[1], options.y + opening.bottom], size: [t, opening.top - opening.bottom, thick + 0.05], turn, mat: "paint", color: frame, solid: false });
        }
        this.box({ at: [midOpen[0], midOpen[1], options.y + opening.top - t], size: [end - start + t, t, thick + 0.05], turn, mat: "paint", color: frame, solid: false });
        if (opening.bottom > 0.05) {
          this.box({ at: [midOpen[0], midOpen[1], options.y + opening.bottom - 0.04], size: [end - start + 0.12, 0.05, thick + 0.14], turn, mat: "concrete", color: 0xe6e2d8, solid: false });
        }
      }
      cursor = end;
    }
    piece(cursor, length, 0, options.height);
  }

  /** A flat slab you can stand on: its top at `top`, `thick` thick, `w` × `d` (centre at `at`). */
  slab(at: LP, w: number, d: number, top: number, options: { thick?: number; mat?: LevelMaterialKey; color?: number; turn?: number; surface?: Floor["surface"]; solid?: false | SolidFlags; skip?: readonly string[] } = {}): void {
    const thick = options.thick ?? 0.25;
    this.box({
      at: [at[0], at[1], top - thick],
      size: [w, thick, d],
      turn: options.turn ?? 0,
      mat: options.mat ?? "concrete",
      color: options.color,
      solid: options.solid,
      floor: { surface: options.surface },
      skip: options.skip,
    });
  }

  /** A walkable floor with no mesh (the ground made flat by a pad, a deck already modelled). */
  floorOnly(at: LP, w: number, d: number, y: number, turn = 0, surface?: Floor["surface"]): void {
    const point = this.world([at[0], at[1], y]);
    this.collision.addFloor({ x: point.x, z: point.z, halfX: w / 2, halfZ: d / 2, angle: this.planAngle(turn), y: point.y, surface });
  }

  /**
   * A flight of stairs from `a` (the foot, at height `y0`) to `b` (the head,
   * at `y1`), `width` wide: steps drawn, a ramp underfoot, a rail each side
   * unless `rails` is false.
   */
  stairs(a: LP, b: LP, y0: number, y1: number, width: number, options: { mat?: LevelMaterialKey; color?: number; rails?: boolean; railColor?: number } = {}): void {
    const dx = b[0] - a[0];
    const df = b[1] - a[1];
    const run = Math.hypot(dx, df);
    const rise = y1 - y0;
    const steps = Math.max(2, Math.round(rise / 0.18));
    const turn = (Math.atan2(dx, df) * 180) / Math.PI;
    for (let index = 0; index < steps; index += 1) {
      const s = (index + 0.5) / steps;
      const top = y0 + (rise * (index + 1)) / steps;
      this.box({
        at: [a[0] + dx * s, a[1] + df * s, y0 + (rise * index) / steps - 0.05],
        size: [width, top - (y0 + (rise * index) / steps) + 0.05, run / steps + 0.02],
        turn,
        mat: options.mat ?? "concrete",
        color: options.color,
        solid: false,
      });
    }
    // The ramp the feet follow: rising along its own +x, which is a → b.
    const foot = this.world([a[0], a[1], y0]);
    const head = this.world([b[0], b[1], y1]);
    this.collision.addFloor({
      x: (foot.x + head.x) / 2,
      z: (foot.z + head.z) / 2,
      halfX: run / 2,
      halfZ: width / 2,
      angle: Math.atan2(head.z - foot.z, head.x - foot.x),
      y: foot.y,
      rise: head.y - foot.y,
      surface: options.mat === "paint" || options.mat === "rust" ? "metal" : "concrete",
    });
    if (options.rails !== false) {
      const side = width / 2 + 0.03;
      const nx = (df / run) * side;
      const nf = (-dx / run) * side;
      for (const sign of [-1, 1]) {
        // Posts and a sloped hand rail.
        for (const s of [0, 0.5, 1]) {
          this.box({ at: [a[0] + dx * s + nx * sign, a[1] + df * s + nf * sign, y0 + rise * s], size: [0.05, 1, 0.05], mat: "paint", color: options.railColor ?? 0x6d7472, solid: false });
        }
        const centre = this.local([a[0] + dx / 2 + nx * sign, a[1] + df / 2 + nf * sign, y0 + rise / 2 + 0.98]);
        const slope = Math.atan2(rise, run);
        const rail = new THREE.BoxGeometry(0.05, 0.05, Math.hypot(run, rise));
        rail.rotateX(-slope);
        this.mesh(rail, "paint", [a[0] + dx / 2 + nx * sign, a[1] + df / 2 + nf * sign, centre.y], turn, options.railColor ?? 0x6d7472);
        rail.dispose();
        // And the walker kept off the drop.
        this.box({ at: [a[0] + dx / 2 + nx * sign, a[1] + df / 2 + nf * sign, y0], size: [0.08, rise + 1, run], turn, mat: "paint", solid: { opaque: false, stopsRounds: false }, skip: ["right", "left", "top", "bottom", "front", "back"] });
      }
    }
  }

  /** A railing along a run (a balcony's edge, a quay): posts, two rails, solid to a walker, open to the eye. */
  railing(a: LP, b: LP, y: number, options: { height?: number; color?: number } = {}): void {
    const height = options.height ?? 1.05;
    const dx = b[0] - a[0];
    const df = b[1] - a[1];
    const length = Math.hypot(dx, df);
    const turn = (Math.atan2(dx, df) * 180) / Math.PI - 90;
    const posts = Math.max(2, Math.ceil(length / 1.4) + 1);
    for (let index = 0; index < posts; index += 1) {
      const s = index / (posts - 1);
      this.box({ at: [a[0] + dx * s, a[1] + df * s, y], size: [0.05, height, 0.05], mat: "paint", color: options.color ?? 0x7a8480, solid: false });
    }
    for (const level of [0.5, height - 0.04]) {
      this.box({ at: [a[0] + dx / 2, a[1] + df / 2, y + level], size: [length, 0.045, 0.045], turn, mat: "paint", color: options.color ?? 0x7a8480, solid: false });
    }
    this.box({ at: [a[0] + dx / 2, a[1] + df / 2, y], size: [length, height, 0.1], turn, mat: "paint", solid: { opaque: false, stopsRounds: false }, skip: ["right", "left", "top", "bottom", "front", "back"] });
  }

  /** A vertical cylinder (a post, a barrel, a bollard, a tank) standing on `at`. */
  cylinder(at: LP, radius: number, height: number, mat: LevelMaterialKey, tint = 0xffffff, options: { segments?: number; solid?: false | SolidFlags; top?: number } = {}): void {
    const geometry = new THREE.CylinderGeometry(options.top ?? radius, radius, height, options.segments ?? 14, 1);
    geometry.translate(0, height / 2, 0);
    // UVs in metres round and up.
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < uv.count; index += 1) uv.setXY(index, uv.getX(index) * Math.PI * 2 * radius, uv.getY(index) * height);
    this.mesh(geometry, mat, at, 0, tint);
    geometry.dispose();
    if (options.solid !== false) {
      const foot = this.world(at);
      this.collision.addSolid({ x: foot.x, z: foot.z, halfX: radius * 0.9, halfZ: radius * 0.9, angle: 0, bottom: foot.y, top: foot.y + height, material: materialOf(mat), ...(options.solid ?? {}) });
    }
  }

  // --- Named points ---------------------------------------------------------

  spot(name: string, at: LP, turn = 0): void {
    const point = this.world(at);
    this.anchors.spots.set(name, { x: point.x, y: point.y, z: point.z, yaw: this.worldYaw(turn) });
  }

  route(name: string, points: readonly LP[]): void {
    this.anchors.routes.set(
      name,
      points.map((point, index) => {
        const world = this.world(point);
        const next = points[Math.min(points.length - 1, index + 1)]!;
        const previous = points[Math.max(0, index - 1)]!;
        const yaw = Math.atan2(-(next[0] - previous[0]), next[1] - previous[1]);
        return { x: world.x, y: world.y, z: world.z, yaw: this.heading + yaw };
      }),
    );
  }

  area(name: string, at: LP, w: number, d: number, options: { turn?: number; height?: number } = {}): void {
    const point = this.world(at);
    this.anchors.areas.set(name, { x: point.x, z: point.z, halfX: w / 2, halfZ: d / 2, angle: this.planAngle(options.turn ?? 0), bottom: point.y - 1, top: point.y + (options.height ?? 6) });
  }

  cover(at: LP, turn = 0): void {
    const point = this.world(at);
    this.anchors.covers.push({ x: point.x, y: point.y, z: point.z, yaw: this.worldYaw(turn) });
  }

  /** A switch the story can throw in this level (see `LevelAnchors.switches`). */
  switch(name: string, apply: (value: string) => void): void {
    this.anchors.switches.set(name, apply);
  }

  /**
   * Way-points for walkers: a chain of points (each linked to the next), on
   * the level's floors or the ground (`up` omitted: on whatever is there).
   */
  way(points: readonly LP[]): void {
    for (let index = 1; index < points.length; index += 1) this.navPairs.push([points[index - 1]!, points[index]!]);
  }

  interact(id: string, at: LP, radius = 1.6): void {
    const point = this.world(at);
    this.anchors.interactables.set(id, { x: point.x, y: point.y, z: point.z, radius });
  }

  // --- Done -----------------------------------------------------------------

  build(): BuiltLevel {
    // The walkers' graph: the chains given, joined where their points meet (within half a metre).
    const nav = this.anchors.nav;
    const index = (point: LP): number => {
      const world = this.world([point[0], point[1], point[2] ?? 0]);
      if (point[2] === undefined) world.y = this.collision.floorAt(world.x, world.z) > -1e9 ? this.collision.floorAt(world.x, world.z) : this.ground(world.x, world.z);
      for (let existing = 0; existing < nav.points.length; existing += 1) {
        const p = nav.points[existing]!;
        if (Math.hypot(p.x - world.x, p.z - world.z) < 0.5 && Math.abs(p.y - world.y) < 1) return existing;
      }
      nav.points.push({ x: world.x, y: world.y, z: world.z });
      nav.links.push([]);
      return nav.points.length - 1;
    };
    for (const [a, c] of this.navPairs) {
      const ia = index(a);
      const ic = index(c);
      if (ia === ic) continue;
      if (!nav.links[ia]!.includes(ic)) nav.links[ia]!.push(ic);
      if (!nav.links[ic]!.includes(ia)) nav.links[ic]!.push(ia);
    }
    const kit = levelMaterials();
    const meshes: THREE.Mesh[] = [];
    for (const [key, buffer] of this.buffers) {
      if (buffer.positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffer.normals, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffer.uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffer.colors, 3));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, kit[key]);
      mesh.name = `${this.group.name}_${key}`;
      mesh.castShadow = key !== "glass" && key !== "road";
      mesh.receiveShadow = key !== "glass";
      if (key === "glass") mesh.renderOrder = 2;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.group.updateMatrixWorld(true);
    const animators = this.animators;
    const owned = [...this.owned];
    const extra = this.extra;
    return {
      group: this.group,
      collision: this.collision,
      anchors: this.anchors,
      update: (delta, elapsed) => {
        for (const animate of animators) animate(delta, elapsed);
      },
      dispose: () => {
        for (const mesh of meshes) mesh.geometry.dispose();
        for (const thing of owned) thing.dispose();
        for (const object of extra) object.removeFromParent();
        this.group.removeFromParent();
      },
    };
  }
}

function materialOf(key: LevelMaterialKey): Solid["material"] {
  switch (key) {
    case "corrugated":
    case "paint":
    case "rust":
      return "metal";
    case "wood":
      return "wood";
    case "glass":
      return "glass";
    case "fabric":
      return "fabric";
    case "rock":
      return "rock";
    default:
      return "concrete";
  }
}

function floorSurfaceOf(key: LevelMaterialKey): Floor["surface"] {
  if (key === "wood") return "wood";
  if (key === "corrugated" || key === "paint" || key === "rust") return "metal";
  if (key === "sand") return "sand";
  return "concrete";
}
