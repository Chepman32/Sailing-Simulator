import * as THREE from "three";
import type { OceanSystem } from "../environment/OceanSystem";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { LOOT_RANGE, lootAround, withinReach, type LootItem, type LootKind } from "./LootMath";
import { createFlamingo, createLootMaterials, type LootMaterials } from "./LootModels";

/**
 * Things afloat: bottles that glow with the message inside, wooden crates,
 * inflatable pink flamingos. Each rides the waves where `LootMath` put it,
 * drifts a little with the wind and turns slowly; sailing alongside hauls it
 * aboard (it lifts out of the water toward the yacht and is gone).
 *
 * A small pool of visuals per kind is reused as the yacht moves on.
 */

/** Visuals kept per kind. */
const POOL = 6;
/** The set of things in range is recomputed after the yacht has moved this far. */
const RESCAN_STEP = 40;
/** Seconds a picked-up thing takes to be hauled aboard. */
const HAUL_SECONDS = 0.7;

type Visual = {
  kind: LootKind;
  root: THREE.Group;
  /** The part that glows (bottle) and its halo. */
  glow?: THREE.Sprite;
  item: LootItem | null;
  /** Drift since it came into range, metres. */
  driftX: number;
  driftZ: number;
  /** Seconds since hauled aboard (−1 while afloat). */
  hauled: number;
};

export type LootPickup = { item: LootItem; x: number; y: number; z: number };

export class LootSystem {
  readonly group = new THREE.Group();
  private readonly visuals: Visual[] = [];
  private readonly materials: LootMaterials;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly pickups: LootPickup[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly lie = new THREE.Quaternion();
  private readonly haulFrom = new THREE.Vector3();
  private inRange: LootItem[] = [];
  private scanX = Number.NaN;
  private scanZ = Number.NaN;
  private clock = 0;
  /** Lights up the glowing bottles at night. */
  private night = 0;

  constructor(
    scene: THREE.Scene,
    private readonly ocean: OceanSystem,
    underwater: UnderwaterLight,
    private readonly collected: Set<string>,
    private readonly isOpen: (x: number, z: number) => boolean,
  ) {
    this.group.name = "FloatingLoot";
    this.materials = createLootMaterials();
    for (const material of this.materials.lit) underwater.apply(material);
    const kinds: LootKind[] = ["bottle", "crate", "flamingo"];
    for (const kind of kinds) {
      for (let index = 0; index < POOL; index += 1) this.visuals.push(this.createVisual(kind));
    }
    scene.add(this.group);
  }

  /** For models built elsewhere from the same parts (the flamingo on deck). */
  get sharedMaterials(): LootMaterials {
    return this.materials;
  }

  get sharedGeometries(): THREE.BufferGeometry[] {
    return this.geometries;
  }

  setNight(night: number): void {
    this.night = night;
  }

  /** Things hauled aboard since the last call. */
  consumePickups(): LootPickup[] {
    if (this.pickups.length === 0) return [];
    const taken = this.pickups.slice();
    this.pickups.length = 0;
    return taken;
  }

  /** Forget the scan (after a restart that cleared `collected`). */
  refresh(): void {
    this.scanX = Number.NaN;
    for (const visual of this.visuals) {
      visual.item = null;
      visual.root.visible = false;
    }
  }

  /**
   * The nearest thing afloat within `range`, with its distance and bearing
   * off the bow (+ to starboard), or null.
   */
  nearest(x: number, z: number, heading: number, range: number): { kind: LootKind; distance: number; bearing: number } | null {
    let best: Visual | null = null;
    let bestDistance = range;
    for (const visual of this.visuals) {
      if (!visual.item || visual.hauled >= 0) continue;
      const distance = Math.hypot(visual.root.position.x - x, visual.root.position.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = visual;
      }
    }
    if (!best) return null;
    const dx = best.root.position.x - x;
    const dz = best.root.position.z - z;
    // Heading is clockwise from +Z seen from above; starboard is −X at heading 0.
    let bearing = heading - Math.atan2(dx, dz);
    bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    return { kind: best.kind, distance: bestDistance, bearing };
  }

  update(delta: number, x: number, z: number, heading: number, windX: number, windZ: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.clock += dt;
    if (!(Math.hypot(x - this.scanX, z - this.scanZ) < RESCAN_STEP)) this.rescan(x, z);

    for (const visual of this.visuals) {
      const item = visual.item;
      if (!item) continue;
      if (visual.hauled >= 0) {
        this.haul(visual, dt, x, z);
        continue;
      }
      // Drifts slowly downwind (a fraction of a knot).
      visual.driftX += windX * 0.012 * dt;
      visual.driftZ += windZ * 0.012 * dt;
      const px = item.x + visual.driftX;
      const pz = item.z + visual.driftZ;
      const surface = this.ocean.sample(px, pz);
      const draft = visual.kind === "crate" ? 0.36 : visual.kind === "flamingo" ? 0.08 : 0.06;
      const bob = Math.sin(this.clock * 1.7 + item.seed * 40) * 0.04;
      visual.root.position.set(px, surface.height - draft + bob, pz);
      // Rides the slope of the wave, turning slowly.
      this.normal.set(surface.normalX, surface.normalY, surface.normalZ).normalize();
      this.tilt.setFromUnitVectors(this.up, this.normal);
      this.spin.setFromAxisAngle(this.up, item.seed * 6.283 + this.clock * (0.05 + item.seed * 0.06));
      visual.root.quaternion.copy(this.tilt).multiply(this.spin);
      if (visual.kind === "bottle") visual.root.quaternion.multiply(this.lie);
      if (visual.glow) {
        // The message glows inside: a soft pulse, much brighter at night.
        const pulse = 0.75 + 0.25 * Math.sin(this.clock * 2.4 + item.seed * 17);
        const level = (0.18 + 0.82 * this.night) * pulse;
        visual.glow.material.opacity = level;
        visual.glow.scale.setScalar(1.5 + 2.3 * this.night);
      }
      if (withinReach(x, z, heading, px, pz)) {
        visual.hauled = 0;
        this.collected.add(item.key);
        this.haulFrom.copy(visual.root.position);
        this.pickups.push({ item, x: px, y: visual.root.position.y, z: pz });
      }
    }
  }

  /** The finds afloat within range of the yacht (for the chart). */
  get items(): readonly LootItem[] {
    return this.inRange.filter((item) => !this.collected.has(item.key));
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.all.forEach((material) => material.dispose());
    this.group.removeFromParent();
  }

  private rescan(x: number, z: number): void {
    this.scanX = x;
    this.scanZ = z;
    this.inRange = lootAround(x, z, LOOT_RANGE, this.collected, this.isOpen);
    const wanted = new Set(this.inRange.map((item) => item.key));
    // Release visuals whose item left the range (or was picked up meanwhile).
    for (const visual of this.visuals) {
      if (visual.item && visual.hauled < 0 && !wanted.has(visual.item.key)) {
        visual.item = null;
        visual.root.visible = false;
      }
    }
    const shown = new Set(this.visuals.filter((visual) => visual.item).map((visual) => visual.item!.key));
    for (const item of this.inRange) {
      if (shown.has(item.key)) continue;
      const visual = this.visuals.find((candidate) => candidate.kind === item.kind && !candidate.item);
      if (!visual) continue;
      visual.item = item;
      visual.driftX = 0;
      visual.driftZ = 0;
      visual.hauled = -1;
      visual.root.visible = true;
      shown.add(item.key);
    }
  }

  /** Lifted out of the water toward the yacht, shrinking, and gone. */
  private haul(visual: Visual, dt: number, x: number, z: number): void {
    visual.hauled += dt;
    const t = Math.min(1, visual.hauled / HAUL_SECONDS);
    const ease = t * t * (3 - 2 * t);
    visual.root.position.set(
      this.haulFrom.x + (x - this.haulFrom.x) * ease * 0.7,
      this.haulFrom.y + Math.sin(t * Math.PI) * 1.6 + ease * 0.8,
      this.haulFrom.z + (z - this.haulFrom.z) * ease * 0.7,
    );
    visual.root.scale.setScalar(Math.max(0.001, 1 - ease * 0.85));
    if (t >= 1) {
      visual.item = null;
      visual.hauled = -1;
      visual.root.visible = false;
      visual.root.scale.setScalar(1);
    }
  }

  private createVisual(kind: LootKind): Visual {
    const root = new THREE.Group();
    root.name = `Loot:${kind}`;
    root.visible = false;
    const m = this.materials;
    let glow: THREE.Sprite | undefined;
    if (kind === "bottle") {
      // Lying almost flat with the neck a little up, as a corked bottle floats.
      this.lie.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - 0.3);
      const profile = [
        [0, -0.36], [0.15, -0.36], [0.16, -0.33], [0.16, 0.08], [0.13, 0.16], [0.07, 0.22], [0.055, 0.3], [0.055, 0.4], [0, 0.4],
      ].map(([r, y]) => new THREE.Vector2(r!, y!));
      const glass = new THREE.LatheGeometry(profile, 18);
      const scroll = new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10);
      const cork = new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10);
      this.geometries.push(glass, scroll, cork);
      const scrollMesh = new THREE.Mesh(scroll, m.scroll);
      scrollMesh.position.y = -0.06;
      const corkMesh = new THREE.Mesh(cork, m.cork);
      corkMesh.position.y = 0.43;
      const glassMesh = new THREE.Mesh(glass, m.glass);
      glassMesh.renderOrder = 2;
      const bottle = new THREE.Group();
      bottle.add(scrollMesh, glassMesh, corkMesh);
      bottle.scale.setScalar(1.6);
      glow = new THREE.Sprite(m.glow);
      glow.renderOrder = 3;
      root.add(bottle, glow);
    } else if (kind === "crate") {
      const box = new THREE.BoxGeometry(1.15, 0.95, 1.15);
      this.geometries.push(box);
      const crate = new THREE.Mesh(box, m.crate);
      crate.castShadow = true;
      root.add(crate);
    } else {
      const flamingo = createFlamingo(m, this.geometries);
      root.add(flamingo);
    }
    this.group.add(root);
    return { kind, root, glow, item: null, driftX: 0, driftZ: 0, hauled: -1 };
  }
}
