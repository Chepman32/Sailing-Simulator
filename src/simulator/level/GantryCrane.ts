import * as THREE from "three";

/**
 * A rail-mounted gantry crane of a loading yard (M03, Лагуна-4): its two
 * A-frame legs run on rails along the yard (`travel`), the trolley runs
 * across the girder (`cross`), the hook block hangs on its falls
 * (`hoist`). All three move together, each with its own top speed, its
 * own slow take-up and its own braking: nothing starts or stops at once.
 * A load on the hook swings under it, pendulum-like, when the crane speeds
 * up or brakes, and a heavy one swings more.
 *
 * Loads lie in the yard (a container, a pump platform on a truck's bed);
 * the hook takes the one under it when it is lowered onto it, and lets it
 * go where it hangs: it settles on what is under it (the ground or another
 * load). A load let go inside one of the yard's marked zones is reported
 * (`onPlaced`): the story reads its goals from that.
 *
 * Everything is in the level's frame (`[right, forward, up]` as the
 * builder's points), the crane's own group put there by the level.
 */

export type CraneLoad = {
  id: string;
  object: THREE.Object3D;
  /** Footprint and height, m (across, up, along). */
  size: readonly [number, number, number];
  /** Tonnes: how much it swings and slows the crane. */
  mass: number;
  /** Where it lies (level frame, its foot's centre) and which way it lies (rad). */
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export type CraneZone = { id: string; x: number; z: number; halfX: number; halfZ: number; accepts: readonly string[] };

export type CraneInput = { travel: number; cross: number; hoist: number };

const TRAVEL_SPEED = 2.4;
const TRAVEL_ACCEL = 0.7;
const CROSS_SPEED = 1.8;
const CROSS_ACCEL = 0.9;
const HOIST_SPEED = 1.3;
const HOIST_ACCEL = 1.4;
/** How near over a load the hook must come down to take it, m. */
const GRAB_REACH = 1.6;

export class GantryCrane {
  /** The crane standing in the level now (for the simulator to drive), if any. */
  static active: GantryCrane | null = null;

  readonly group = new THREE.Group();
  /** Along the rails (forward), across the girder (right), the hook's height over the yard. */
  travel: number;
  cross: number;
  hook: number;
  private travelSpeed = 0;
  private crossSpeed = 0;
  private hoistSpeed = 0;
  /** The load's swing under the trolley (m off plumb), and its rate. */
  private swingX = 0;
  private swingZ = 0;
  private swingVX = 0;
  private swingVZ = 0;
  private carried: CraneLoad | null = null;
  private readonly gantry = new THREE.Group();
  private readonly trolley = new THREE.Group();
  private readonly block = new THREE.Group();
  private readonly falls: THREE.Mesh;
  private readonly owned: { dispose(): void }[] = [];
  /** A load let go in a zone. */
  onPlaced: ((load: string, zone: string) => void) | null = null;
  /** The first movement of all, and a load taken. */
  onEvent: ((event: string) => void) | null = null;
  private moved = false;

  constructor(
    readonly loads: CraneLoad[],
    readonly zones: readonly CraneZone[],
    /** The rails' run along the yard, the girder's span across it, the hook's travel up (m). */
    readonly range: { travel: readonly [number, number]; cross: readonly [number, number]; hook: readonly [number, number] },
    /** Height of the yard's floor, and of the girder over it. */
    readonly floor: number,
    readonly height = 15,
    readonly span = 26,
    start = { travel: 0, cross: 0 },
    /** The rails' centre line across the yard (the legs stand `span / 2` either side of it). */
    readonly axis = 0,
  ) {
    this.travel = start.travel;
    this.cross = start.cross;
    this.hook = range.hook[1];
    const steel = this.material(new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.55, metalness: 0.35 }));
    const dark = this.material(new THREE.MeshStandardMaterial({ color: 0x2c2f31, roughness: 0.6, metalness: 0.5 }));
    const glass = this.material(new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.6 }));
    const cable = this.material(new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.8 }));
    const box = (parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      this.owned.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // The gantry: two legs each side (an A on each rail), the girder over the yard, the cab under it on the right leg.
    this.group.add(this.gantry);
    const half = span / 2;
    for (const side of [-1, 1]) {
      for (const along of [-1, 1]) {
        const leg = box(this.gantry, 0.7, height, 0.7, steel, axis + side * half, floor + height / 2, along * 2.4);
        leg.rotation.x = -along * 0.16;
      }
      box(this.gantry, 0.9, 0.9, 6.4, steel, axis + side * half, floor + 0.45, 0);
      box(this.gantry, 1.0, 0.5, 6.0, dark, axis + side * half, floor + 0.25, 0);
    }
    box(this.gantry, span + 2, 1.6, 1.4, steel, axis, floor + height + 0.8, -0.9);
    box(this.gantry, span + 2, 1.6, 1.4, steel, axis, floor + height + 0.8, 0.9);
    box(this.gantry, 2.2, 2.4, 2.6, dark, axis + half - 1.6, floor + height - 1.6, 2.2);
    box(this.gantry, 2.0, 1.4, 0.05, glass, axis + half - 1.6, floor + height - 1.4, 3.52);
    // The trolley on the girder, its drums.
    this.gantry.add(this.trolley);
    box(this.trolley, 3.0, 1.2, 3.4, steel, 0, floor + height + 2.2, 0);
    box(this.trolley, 2.2, 0.8, 0.8, dark, 0, floor + height + 1.4, 0);
    // The falls and the hook block with its spreader.
    const fallGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
    fallGeometry.translate(0, -0.5, 0);
    this.owned.push(fallGeometry);
    this.falls = new THREE.Mesh(fallGeometry, cable);
    this.trolley.add(this.falls);
    this.group.add(this.block);
    box(this.block, 1.0, 0.7, 0.6, steel, 0, 0.35, 0);
    box(this.block, 2.6, 0.16, 0.5, dark, 0, -0.08, 0);
    for (const load of loads) this.place(load);
    this.update(0, { travel: 0, cross: 0, hoist: 0 });
  }

  private material<T extends THREE.Material>(material: T): T {
    this.owned.push(material);
    return material;
  }

  private place(load: CraneLoad): void {
    load.object.position.set(load.x, load.y, load.z);
    load.object.rotation.set(0, load.yaw, 0);
  }

  /** The hook's point in the level frame (out). */
  hookPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.cross + this.swingX, this.floor + this.hook, this.travel + this.swingZ);
  }

  get holding(): string | null {
    return this.carried?.id ?? null;
  }

  /** Takes the load under the lowered hook, or lets go of the one on it. True if something happened. */
  toggle(): boolean {
    if (this.carried) {
      const load = this.carried;
      this.carried = null;
      // It settles on what is under it: the floor, or the top of a load it is let down on.
      let ground = this.floor;
      for (const other of this.loads) {
        if (other === load) continue;
        if (Math.abs(other.x - load.x) < (other.size[0] + load.size[0]) / 2 - 0.3 && Math.abs(other.z - load.z) < (other.size[2] + load.size[2]) / 2 - 0.3) {
          ground = Math.max(ground, other.y + other.size[1]);
        }
      }
      load.y = ground;
      this.place(load);
      for (const zone of this.zones) {
        if (!zone.accepts.includes(load.id)) continue;
        if (Math.abs(load.x - zone.x) <= zone.halfX && Math.abs(load.z - zone.z) <= zone.halfZ) this.onPlaced?.(load.id, zone.id);
      }
      this.onEvent?.(`released:${load.id}`);
      return true;
    }
    const hookX = this.cross + this.swingX;
    const hookZ = this.travel + this.swingZ;
    let best: CraneLoad | null = null;
    let distance = GRAB_REACH;
    for (const load of this.loads) {
      const away = Math.hypot(load.x - hookX, load.z - hookZ);
      const top = load.y + load.size[1];
      if (away < distance && Math.abs(this.floor + this.hook - top) < 1.4) {
        distance = away;
        best = load;
      }
    }
    if (!best) return false;
    this.carried = best;
    this.onEvent?.(`taken:${best.id}`);
    return true;
  }

  /** Lowered near enough over a load to take it. */
  get canTake(): boolean {
    if (this.carried) return true;
    const hookX = this.cross + this.swingX;
    const hookZ = this.travel + this.swingZ;
    return this.loads.some((load) => Math.hypot(load.x - hookX, load.z - hookZ) < GRAB_REACH && Math.abs(this.floor + this.hook - (load.y + load.size[1])) < 1.4);
  }

  update(delta: number, input: CraneInput): void {
    const mass = this.carried ? this.carried.mass : 0;
    const heavy = 1 / (1 + mass * 0.05);
    const approach = (speed: number, wanted: number, accel: number) => {
      const step = accel * delta;
      return speed + Math.max(-step, Math.min(step, wanted - speed));
    };
    const travelBefore = this.travelSpeed;
    const crossBefore = this.crossSpeed;
    this.travelSpeed = approach(this.travelSpeed, input.travel * TRAVEL_SPEED * heavy, TRAVEL_ACCEL * heavy);
    this.crossSpeed = approach(this.crossSpeed, input.cross * CROSS_SPEED * heavy, CROSS_ACCEL * heavy);
    this.hoistSpeed = approach(this.hoistSpeed, input.hoist * HOIST_SPEED * heavy, HOIST_ACCEL);
    if (!this.moved && (input.travel || input.cross || input.hoist)) {
      this.moved = true;
      this.onEvent?.("first-motion");
    }
    this.travel += this.travelSpeed * delta;
    this.cross += this.crossSpeed * delta;
    this.hook += this.hoistSpeed * delta;
    const clampTo = (value: number, [low, high]: readonly [number, number], speed: "travelSpeed" | "crossSpeed" | "hoistSpeed") => {
      if (value < low || value > high) this[speed] = 0;
      return Math.min(high, Math.max(low, value));
    };
    this.travel = clampTo(this.travel, this.range.travel, "travelSpeed");
    this.cross = clampTo(this.cross, this.range.cross, "crossSpeed");
    // The hook stops on what is under it.
    let lowest = this.range.hook[0];
    const hookX = this.cross + this.swingX;
    const hookZ = this.travel + this.swingZ;
    const hanging = this.carried ? this.carried.size[1] : 0;
    for (const load of this.loads) {
      if (load === this.carried) continue;
      const reachX = (load.size[0] + (this.carried?.size[0] ?? 0.6)) / 2;
      const reachZ = (load.size[2] + (this.carried?.size[2] ?? 0.6)) / 2;
      if (Math.abs(load.x - hookX) < reachX && Math.abs(load.z - hookZ) < reachZ) lowest = Math.max(lowest, load.y - this.floor + load.size[1] + hanging);
    }
    if (this.carried) lowest = Math.max(lowest, hanging);
    this.hook = clampTo(this.hook, [lowest, this.range.hook[1]], "hoistSpeed");
    // The swing: driven by the trolley's and the gantry's take-up and braking, damped.
    if (delta > 0) {
      const length = Math.max(1, this.range.hook[1] + 2 - this.hook);
      const stiffness = 9.81 / length;
      const accelX = (this.crossSpeed - crossBefore) / delta;
      const accelZ = (this.travelSpeed - travelBefore) / delta;
      const weight = this.carried ? 1 + mass * 0.04 : 0.6;
      this.swingVX += (-stiffness * this.swingX - accelX * weight * 0.5 - this.swingVX * 0.55) * delta;
      this.swingVZ += (-stiffness * this.swingZ - accelZ * weight * 0.5 - this.swingVZ * 0.55) * delta;
      this.swingX += this.swingVX * delta;
      this.swingZ += this.swingVZ * delta;
      const limit = 2.2;
      this.swingX = Math.max(-limit, Math.min(limit, this.swingX));
      this.swingZ = Math.max(-limit, Math.min(limit, this.swingZ));
    }
    // Drawn where it is.
    this.gantry.position.set(0, 0, this.travel);
    this.trolley.position.set(this.cross, 0, 0);
    const blockY = this.floor + this.hook;
    this.block.position.set(this.cross + this.swingX, blockY + 0.16, this.travel + this.swingZ);
    const top = this.floor + this.height + 1.4;
    this.falls.position.set(0, top, 0);
    const dx = this.swingX;
    const dz = this.swingZ;
    const dy = top - blockY - 0.86;
    const fall = Math.hypot(dx, dy, dz);
    this.falls.scale.set(1, fall, 1);
    this.falls.rotation.set(Math.atan2(dz, dy), 0, -Math.atan2(dx, dy));
    if (this.carried) {
      const load = this.carried;
      load.x = this.cross + this.swingX;
      load.z = this.travel + this.swingZ;
      load.y = blockY - load.size[1];
      this.place(load);
    }
  }

  dispose(): void {
    for (const thing of this.owned) thing.dispose();
    if (GantryCrane.active === this) GantryCrane.active = null;
  }
}
