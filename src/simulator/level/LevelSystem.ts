import * as THREE from "three";
import { LevelBuilder, type BuiltLevel, type LevelAnchors, type LevelFrame, type LP, type WorldPoint } from "./LevelBuilder";
import { STANDING_HEIGHT, type Floor, type RayHit, type Solid } from "./LevelCollision";
import { setTerrainPads, type TerrainPad } from "../environment/TerrainPads";

/**
 * The story's built places in the world: each a `LevelDefinition` (its
 * frame, the ground it levels, and how it is built), standing while the
 * story wants it and the camera is near enough; and the queries over all
 * of them a walker, a guard and a bullet make.
 */

/** A pad in the level's frame (see `TerrainPad`): its centre, size, turn, and the height of the levelled ground. */
export type LevelPad = { at: LP; w: number; d: number; turn?: number; height: number; blend?: number; clear?: number; cutOnly?: boolean };

export type LevelDefinition = {
  id: string;
  frame: LevelFrame;
  pads?: readonly LevelPad[];
  /** Built when wanted and the camera is within this range, m (and kept until well beyond it). */
  range?: number;
  build: (builder: LevelBuilder) => void;
};

export type LevelQuery = {
  floorAt(x: number, z: number, feetY?: number): number;
  blocked(x: number, z: number, feetY: number, radius?: number, height?: number): boolean;
  headroom(x: number, z: number, feetY: number): number;
  canSee(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  raycast(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, length: number, filter?: (solid: Solid) => boolean): RayHit | null;
  floorUnder(x: number, z: number, feetY: number): Floor | null;
};

type Standing = { definition: LevelDefinition; built: BuiltLevel };

/** The pads of the given levels in the world's terms (registered before the islands are built). */
export function levelPads(definitions: readonly LevelDefinition[]): TerrainPad[] {
  const pads: TerrainPad[] = [];
  for (const definition of definitions) {
    const heading = (-definition.frame.bearing * Math.PI) / 180;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (const [index, pad] of (definition.pads ?? []).entries()) {
      // Level (right, forward) → group-local (x = −right, z = forward) → world.
      const lx = -pad.at[0];
      const lz = pad.at[1];
      const turn = ((pad.turn ?? 0) * Math.PI) / 180;
      pads.push({
        id: `${definition.id}:${index}`,
        x: definition.frame.x + lx * cos + lz * sin,
        z: definition.frame.z - lx * sin + lz * cos,
        halfX: pad.w / 2,
        halfZ: pad.d / 2,
        angle: -(heading - turn),
        height: pad.height,
        blend: pad.blend ?? 6,
        clear: pad.clear,
        cutOnly: pad.cutOnly,
      });
    }
  }
  return pads;
}

export class LevelSystem implements LevelQuery {
  readonly group = new THREE.Group();
  private readonly definitions = new Map<string, LevelDefinition>();
  private readonly standing = new Map<string, Standing>();
  private wanted = new Set<string>();

  constructor(
    definitions: readonly LevelDefinition[],
    private readonly ground: (x: number, z: number) => number,
    private readonly onBuilt: (object: THREE.Object3D) => void = () => undefined,
  ) {
    this.group.name = "StoryLevels";
    for (const definition of definitions) this.definitions.set(definition.id, definition);
    setTerrainPads(levelPads(definitions));
  }

  /** The levels the story wants standing now. */
  want(ids: Iterable<string>): void {
    this.wanted = new Set(ids);
  }

  isStanding(id: string): boolean {
    return this.standing.has(id);
  }

  /** A level's named points (null while it is not built). */
  anchors(id: string): LevelAnchors | null {
    return this.standing.get(id)?.built.anchors ?? null;
  }

  /** A named spot of any standing level (`level:spot` or just `spot`). */
  spot(name: string): WorldPoint | null {
    const [levelId, spotName] = name.includes(":") ? name.split(":") : [null, name];
    for (const [id, standing] of this.standing) {
      if (levelId && id !== levelId) continue;
      const spot = standing.built.anchors.spots.get(spotName!);
      if (spot) return spot;
    }
    return null;
  }

  route(name: string): WorldPoint[] | null {
    const [levelId, routeName] = name.includes(":") ? name.split(":") : [null, name];
    for (const [id, standing] of this.standing) {
      if (levelId && id !== levelId) continue;
      const route = standing.built.anchors.routes.get(routeName!);
      if (route) return route;
    }
    return null;
  }

  /** Throws a level's switch (`level:name` or `name`), if the level stands. */
  signal(name: string, value: string): boolean {
    const [levelId, switchName] = name.includes(":") ? name.split(":") : [null, name];
    for (const [id, standing] of this.standing) {
      if (levelId && id !== levelId) continue;
      const apply = standing.built.anchors.switches.get(switchName!);
      if (apply) {
        apply(value);
        return true;
      }
    }
    return false;
  }

  /**
   * A way through the standing levels from (ax, az) to (bx, bz): the
   * way-points between (A* over the levels' graphs, entered and left at the
   * points nearest each end); empty when the two are better walked straight.
   */
  path(ax: number, ay: number, az: number, bx: number, by: number, bz: number): { x: number; y: number; z: number }[] {
    for (const standing of this.standing.values()) {
      const { points, links } = standing.built.anchors.nav;
      if (points.length < 2) continue;
      const nearest = (x: number, y: number, z: number): number => {
        let best = -1;
        let bestDistance = 25;
        for (let index = 0; index < points.length; index += 1) {
          const p = points[index]!;
          const d = Math.hypot(p.x - x, p.z - z) + Math.abs(p.y - y) * 3;
          if (d < bestDistance) {
            bestDistance = d;
            best = index;
          }
        }
        return best;
      };
      const start = nearest(ax, ay, az);
      const goal = nearest(bx, by, bz);
      if (start < 0 || goal < 0 || start === goal) continue;
      // A*: the way-points are few.
      const cost = new Map<number, number>([[start, 0]]);
      const from = new Map<number, number>();
      const open = new Set<number>([start]);
      const h = (index: number) => {
        const p = points[index]!;
        const g = points[goal]!;
        return Math.hypot(p.x - g.x, p.z - g.z, p.y - g.y);
      };
      while (open.size > 0) {
        let current = -1;
        let best = Number.POSITIVE_INFINITY;
        for (const index of open) {
          const f = cost.get(index)! + h(index);
          if (f < best) {
            best = f;
            current = index;
          }
        }
        if (current === goal) break;
        open.delete(current);
        for (const next of links[current]!) {
          const p = points[current]!;
          const q = points[next]!;
          const g = cost.get(current)! + Math.hypot(p.x - q.x, p.z - q.z, p.y - q.y);
          if (g < (cost.get(next) ?? Number.POSITIVE_INFINITY)) {
            cost.set(next, g);
            from.set(next, current);
            open.add(next);
          }
        }
      }
      if (!from.has(goal)) continue;
      const way: { x: number; y: number; z: number }[] = [];
      for (let at: number | undefined = goal; at !== undefined && at !== start; at = from.get(at)) way.unshift(points[at]!);
      way.unshift(points[start]!);
      return way;
    }
    return [];
  }

  /** Every cover point of the standing levels within `radius` of (x, z). */
  coversNear(x: number, z: number, radius: number): WorldPoint[] {
    const near: WorldPoint[] = [];
    for (const standing of this.standing.values()) {
      for (const cover of standing.built.anchors.covers) if (Math.hypot(cover.x - x, cover.z - z) < radius) near.push(cover);
    }
    return near;
  }

  /** Whether (x, y, z) is inside a named area of a standing level. */
  inArea(name: string, x: number, y: number, z: number): boolean {
    const [levelId, areaName] = name.includes(":") ? name.split(":") : [null, name];
    for (const [id, standing] of this.standing) {
      if (levelId && id !== levelId) continue;
      const area = standing.built.anchors.areas.get(areaName!);
      if (!area) continue;
      if (y < area.bottom || y > area.top) continue;
      const dx = x - area.x;
      const dz = z - area.z;
      const cos = Math.cos(area.angle);
      const sin = Math.sin(area.angle);
      if (Math.abs(dx * cos + dz * sin) <= area.halfX && Math.abs(-dx * sin + dz * cos) <= area.halfZ) return true;
    }
    return false;
  }

  /** The interactable named `id` of any standing level, or null. */
  interactable(id: string): { x: number; y: number; z: number; radius: number } | null {
    for (const standing of this.standing.values()) {
      const found = standing.built.anchors.interactables.get(id);
      if (found) return found;
    }
    return null;
  }

  /** Builds what is wanted and near, takes down what is not. */
  update(delta: number, elapsed: number, focusX: number, focusZ: number): void {
    for (const [id, definition] of this.definitions) {
      const distance = Math.hypot(definition.frame.x - focusX, definition.frame.z - focusZ);
      const range = definition.range ?? 900;
      const standing = this.standing.get(id);
      const wanted = this.wanted.has(id);
      if (!standing && wanted && distance < range) this.build(definition);
      else if (standing && (!wanted || distance > range + 400)) this.takeDown(id);
    }
    for (const standing of this.standing.values()) standing.built.update(delta, elapsed);
  }

  private build(definition: LevelDefinition): void {
    const builder = new LevelBuilder(definition.frame, this.ground, definition.id);
    definition.build(builder);
    const built = builder.build();
    this.group.add(built.group);
    this.standing.set(definition.id, { definition, built });
    this.onBuilt(built.group);
  }

  private takeDown(id: string): void {
    const standing = this.standing.get(id);
    if (!standing) return;
    standing.built.dispose();
    this.standing.delete(id);
  }

  /** Builds a wanted level at once wherever the camera is (a checkpoint restored on its doorstep). */
  ensure(id: string): void {
    const definition = this.definitions.get(id);
    if (definition && !this.standing.has(id)) this.build(definition);
  }

  // --- Queries over every standing level -----------------------------------

  floorAt(x: number, z: number, feetY?: number): number {
    let best = Number.NEGATIVE_INFINITY;
    for (const standing of this.standing.values()) best = Math.max(best, standing.built.collision.floorAt(x, z, feetY));
    return best;
  }

  floorUnder(x: number, z: number, feetY: number): Floor | null {
    for (const standing of this.standing.values()) {
      const floor = standing.built.collision.floorUnder(x, z, feetY);
      if (floor) return floor;
    }
    return null;
  }

  blocked(x: number, z: number, feetY: number, radius = 0.3, height = STANDING_HEIGHT): boolean {
    for (const standing of this.standing.values()) if (standing.built.collision.blocked(x, z, feetY, radius, height)) return true;
    return false;
  }

  headroom(x: number, z: number, feetY: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const standing of this.standing.values()) best = Math.min(best, standing.built.collision.headroom(x, z, feetY));
    return best;
  }

  canSee(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const standing of this.standing.values()) if (!standing.built.collision.canSee(ax, ay, az, bx, by, bz)) return false;
    return true;
  }

  raycast(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, length: number, filter?: (solid: Solid) => boolean): RayHit | null {
    let best: RayHit | null = null;
    for (const standing of this.standing.values()) {
      const hit = standing.built.collision.raycast(ax, ay, az, dx, dy, dz, best ? best.t : length, filter);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }

  dispose(): void {
    for (const id of [...this.standing.keys()]) this.takeDown(id);
    this.group.removeFromParent();
  }
}
