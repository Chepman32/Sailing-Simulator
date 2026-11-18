/**
 * What a built level is to a body, a glance and a bullet, in world metres:
 *
 * - **floors**: rectangles a walker stands on (a yard's concrete, a
 *   storey's boards, a dock), flat or rising along one axis (a stair, a
 *   ramp); several may lie one over another, and a walker stands on the
 *   highest one not above his feet (a step's height above them at most);
 * - **solids**: boxes (walls, slabs, crates, fences, a container) with a
 *   bottom and a top. A body is kept out of a solid wherever the solid
 *   overlaps the height of the body (feet to head: so he walks under an
 *   upper storey, and stoops under a culvert's roof);
 *   a solid can let the eye through (`opaque: false`, glass, a wire fence)
 *   and the bullet (`stopsRounds: false`, a wire fence or a tent's cloth).
 *
 * Everything is an oriented rectangle in plan (centre, half extents, an
 * angle), indexed on a coarse grid. Pure: the meshes are built elsewhere
 * (`LevelBuilder`).
 */

export type PlanRect = {
  /** Centre, world metres. */
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  /** The rectangle's own +x axis, radians from world +x toward world +z. */
  angle: number;
};

export type Floor = PlanRect & {
  /** Height of the surface at its centre line (a ramp: at its low end, see `rise`). */
  y: number;
  /** A ramp rises by this much from its −x end to its +x end (its own axes), m. */
  rise?: number;
  /** What footsteps sound like on it. */
  surface?: "concrete" | "metal" | "wood" | "sand";
};

export type Solid = PlanRect & {
  bottom: number;
  top: number;
  /** Lets the eye through (glass, a wire fence). Default: opaque. */
  opaque?: boolean;
  /** Stops a bullet (default true; a wire fence, a tent's cloth do not). */
  stopsRounds?: boolean;
  /** Is something a crouching body can hide behind (a low wall, a crate). */
  cover?: boolean;
  /** What a round striking it throws up. */
  material?: "concrete" | "metal" | "wood" | "glass" | "fabric" | "rock";
  /** Not there just now (a door swung open). */
  off?: boolean;
};

export type RayHit = { t: number; x: number; y: number; z: number; normalX: number; normalZ: number; solid: Solid };

/** Body heights, m: standing and crouched. */
export const STANDING_HEIGHT = 1.8;
export const CROUCHED_HEIGHT = 1.15;
/** How high a floor above the feet still counts as underfoot (a step, a kerb), m. */
export const STEP_UP = 0.42;
/** Solids lower than this above the feet are stepped over, not walked into, m. */
const KNEE = 0.3;

const CELL = 6;

function local(rect: PlanRect, x: number, z: number): { u: number; v: number } {
  const dx = x - rect.x;
  const dz = z - rect.z;
  const cos = Math.cos(rect.angle);
  const sin = Math.sin(rect.angle);
  return { u: dx * cos + dz * sin, v: -dx * sin + dz * cos };
}

/** Distance from (x, z) to the rectangle in plan (0 inside). */
export function rectDistance(rect: PlanRect, x: number, z: number): number {
  const { u, v } = local(rect, x, z);
  return Math.hypot(Math.max(Math.abs(u) - rect.halfX, 0), Math.max(Math.abs(v) - rect.halfZ, 0));
}

export function insideRect(rect: PlanRect, x: number, z: number, margin = 0): boolean {
  const { u, v } = local(rect, x, z);
  return Math.abs(u) <= rect.halfX + margin && Math.abs(v) <= rect.halfZ + margin;
}

/** The floor's height at (x, z) (inside it). */
export function floorHeightAt(floor: Floor, x: number, z: number): number {
  if (!floor.rise) return floor.y;
  const { u } = local(floor, x, z);
  const t = Math.min(1, Math.max(0, (u + floor.halfX) / (2 * floor.halfX)));
  return floor.y + floor.rise * t;
}

function bounds(rect: PlanRect): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cos = Math.abs(Math.cos(rect.angle));
  const sin = Math.abs(Math.sin(rect.angle));
  const ex = rect.halfX * cos + rect.halfZ * sin;
  const ez = rect.halfX * sin + rect.halfZ * cos;
  return { minX: rect.x - ex, maxX: rect.x + ex, minZ: rect.z - ez, maxZ: rect.z + ez };
}

class Grid<T extends PlanRect> {
  private readonly cells = new Map<string, T[]>();
  readonly all: T[] = [];

  add(item: T): void {
    this.all.push(item);
    const box = bounds(item);
    for (let cx = Math.floor(box.minX / CELL); cx <= Math.floor(box.maxX / CELL); cx += 1) {
      for (let cz = Math.floor(box.minZ / CELL); cz <= Math.floor(box.maxZ / CELL); cz += 1) {
        const key = `${cx},${cz}`;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(item);
      }
    }
  }

  at(x: number, z: number): readonly T[] {
    return this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? EMPTY;
  }

  /** Items in the cells a segment crosses (each once). */
  along(ax: number, az: number, bx: number, bz: number, out: Set<T>): Set<T> {
    out.clear();
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)));
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          for (const item of this.cells.get(`${Math.floor(x / CELL) + ox},${Math.floor(z / CELL) + oz}`) ?? EMPTY) out.add(item);
        }
      }
    }
    return out;
  }
}

const EMPTY: never[] = [];

/** A level's floors and solids, queried by the walker, the guards' eyes and the bullets. */
export class LevelCollision {
  private readonly floors = new Grid<Floor>();
  private readonly solids = new Grid<Solid>();
  private readonly scratch = new Set<Solid>();

  addFloor(floor: Floor): void {
    this.floors.add(floor);
  }

  addSolid(solid: Solid): void {
    this.solids.add(solid);
  }

  get floorList(): readonly Floor[] {
    return this.floors.all;
  }

  get solidList(): readonly Solid[] {
    return this.solids.all;
  }

  /**
   * The highest floor under (x, z) no higher than a step above `feetY`
   * (−Infinity where there is none). With `feetY` omitted, the highest floor
   * of all (placing something from above).
   */
  floorAt(x: number, z: number, feetY = Number.POSITIVE_INFINITY): number {
    let best = Number.NEGATIVE_INFINITY;
    for (const floor of this.floors.at(x, z)) {
      if (!insideRect(floor, x, z)) continue;
      const y = floorHeightAt(floor, x, z);
      if (y <= feetY + STEP_UP && y > best) best = y;
    }
    return best;
  }

  /** The floor's own record under (x, z) at the walker's height (for footsteps), or null. */
  floorUnder(x: number, z: number, feetY: number): Floor | null {
    let best: Floor | null = null;
    let bestY = Number.NEGATIVE_INFINITY;
    for (const floor of this.floors.at(x, z)) {
      if (!insideRect(floor, x, z)) continue;
      const y = floorHeightAt(floor, x, z);
      if (y <= feetY + STEP_UP && y > bestY) {
        bestY = y;
        best = floor;
      }
    }
    return best;
  }

  /**
   * Whether a body of `radius` standing at (x, z) with its feet at `feetY`
   * and `height` tall would be inside a solid.
   */
  blocked(x: number, z: number, feetY: number, radius = 0.3, height = STANDING_HEIGHT): boolean {
    for (const solid of this.solids.at(x, z)) {
      if (solid.off || solid.top <= feetY + KNEE || solid.bottom >= feetY + height) continue;
      if (rectDistance(solid, x, z) < radius) return true;
    }
    return false;
  }

  /**
   * Room overhead at (x, z) for a body with its feet at `feetY`: the
   * distance to the lowest solid above the knees, m (Infinity: open sky).
   */
  headroom(x: number, z: number, feetY: number, radius = 0.3): number {
    let best = Number.POSITIVE_INFINITY;
    for (const solid of this.solids.at(x, z)) {
      if (solid.off || solid.bottom <= feetY + KNEE) continue;
      if (rectDistance(solid, x, z) < radius) best = Math.min(best, solid.bottom - feetY);
    }
    return best;
  }

  /**
   * The first solid a ray from (ax, ay, az) along (dx, dy, dz) strikes within
   * `length` (`filter` picks which count), or null.
   */
  raycast(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, length: number, filter: (solid: Solid) => boolean = () => true): RayHit | null {
    const bx = ax + dx * length;
    const bz = az + dz * length;
    let best: RayHit | null = null;
    for (const solid of this.solids.along(ax, az, bx, bz, this.scratch)) {
      if (solid.off || !filter(solid)) continue;
      const hit = rayBox(solid, ax, ay, az, dx, dy, dz, best ? best.t : length);
      if (hit) best = hit;
    }
    return best;
  }

  /** Whether the line from a to b passes clear of every opaque solid. */
  canSee(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / length, dy / length, dz / length, length - 0.05, (solid) => solid.opaque !== false);
  }

  /**
   * How well a body at (x, z) crouching would be screened from a shooter at
   * (fromX, fromZ): true when a cover solid lies between, within 1.6 m of him.
   */
  covered(x: number, z: number, feetY: number, fromX: number, fromZ: number): boolean {
    const dx = fromX - x;
    const dz = fromZ - z;
    const length = Math.hypot(dx, dz);
    if (length < 1) return false;
    const reach = Math.min(1.6, length);
    const hit = this.raycast(x, feetY + 0.75, z, dx / length, 0, dz / length, reach, (solid) => solid.stopsRounds !== false);
    return hit !== null;
  }
}

/** Ray against a solid (an oriented box between bottom and top); null if missed or beyond `limit`. */
export function rayBox(solid: Solid, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, limit: number): RayHit | null {
  const cos = Math.cos(solid.angle);
  const sin = Math.sin(solid.angle);
  // Into the box's frame: u along its x, v along its z, y as is.
  const ox = ax - solid.x;
  const oz = az - solid.z;
  const ou = ox * cos + oz * sin;
  const ov = -ox * sin + oz * cos;
  const du = dx * cos + dz * sin;
  const dv = -dx * sin + dz * cos;
  let near = 0;
  let far = limit;
  let axis = -1;
  let sign = 0;
  const slabs: [number, number, number, number][] = [
    [ou, du, -solid.halfX, solid.halfX],
    [ov, dv, -solid.halfZ, solid.halfZ],
    [ay, dy, solid.bottom, solid.top],
  ];
  for (let index = 0; index < 3; index += 1) {
    const [origin, direction, min, max] = slabs[index]!;
    if (Math.abs(direction) < 1e-9) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let t0 = (min - origin) / direction;
    let t1 = (max - origin) / direction;
    let entering = -1;
    if (t0 > t1) {
      [t0, t1] = [t1, t0];
      entering = 1;
    }
    if (t0 > near) {
      near = t0;
      axis = index;
      sign = entering;
    }
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  if (axis < 0) {
    // Starting inside: a hit at once (a shot from within a wall goes nowhere).
    return { t: 0, x: ax, y: ay, z: az, normalX: -dx, normalZ: -dz, solid };
  }
  // The face's outward normal in the world.
  let nu = 0;
  let nv = 0;
  if (axis === 0) nu = sign;
  else if (axis === 1) nv = sign;
  const normalX = nu * cos - nv * sin;
  const normalZ = nu * sin + nv * cos;
  return { t: near, x: ax + dx * near, y: ay + dy * near, z: az + dz * near, normalX, normalZ, solid };
}
