import * as THREE from "three";
import type { OceanSystem } from "../environment/OceanSystem";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { smoothstep } from "../math";
import { DISCOVERY_RANGE, nearestPoiClearance, poisAround, type Poi } from "./PoiMath";
import { buildBarge, buildMonolith, buildWreck, type BargeParts, type MonolithParts, type Owned, type WreckParts } from "./PoiModels";

/**
 * The strange places in the scene: streamed in as the yacht comes within
 * sight, animated (the barge's lights to its beat, the wreck's rags in the
 * wind, the monolith's glyphs), and handed to physics as obstacles.
 */

/** Places within this distance are built and drawn, metres. */
const POI_RANGE = 2200;
const RESCAN_STEP = 100;

type Visual = {
  poi: Poi;
  owned: Owned;
  root: THREE.Group;
  barge?: BargeParts;
  wreck?: WreckParts;
  monolith?: MonolithParts;
};

export type PoiDiscovery = { poi: Poi };

export class PoiSystem {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, Visual>();
  private pois: Poi[] = [];
  private scanX = Number.NaN;
  private scanZ = Number.NaN;
  private clock = 0;
  private readonly color = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly found: Poi[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly ocean: OceanSystem,
    private readonly underwater: UnderwaterLight,
    private readonly isOpen: (x: number, z: number) => boolean,
    private readonly discovered: Set<string>,
  ) {
    this.group.name = "PlacesOfInterest";
    scene.add(this.group);
  }

  /** Obstacles for physics: distance to the nearest footprint and its outward normal. */
  readonly clearance = (x: number, z: number, normal: { x: number; z: number }): number =>
    nearestPoiClearance(this.pois, x, z, normal);

  /** The nearest place of a kind, if within range. */
  nearest(kind: Poi["kind"], x: number, z: number): { poi: Poi; distance: number } | null {
    let best: { poi: Poi; distance: number } | null = null;
    for (const poi of this.pois) {
      if (poi.kind !== kind) continue;
      const distance = Math.hypot(poi.x - x, poi.z - z);
      if (!best || distance < best.distance) best = { poi, distance };
    }
    return best;
  }

  /** Places found since the last call (each only once, ever; keys are "kind:id"). */
  consumeDiscoveries(): Poi[] {
    if (this.found.length === 0) return [];
    const taken = this.found.slice();
    this.found.length = 0;
    return taken;
  }

  /**
   * @param beat The barge music's beat position (NaN when silent: the
   *   lights then run on their own clock).
   */
  update(delta: number, x: number, z: number, night: number, windX: number, windZ: number, beat: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.clock += dt;
    if (!(Math.hypot(x - this.scanX, z - this.scanZ) < RESCAN_STEP)) this.rescan(x, z);
    for (const visual of this.visuals.values()) {
      const poi = visual.poi;
      const distance = Math.hypot(poi.x - x, poi.z - z);
      const key = `${poi.kind}:${poi.id}`;
      if (distance < DISCOVERY_RANGE[poi.kind] && !this.discovered.has(key)) {
        this.discovered.add(key);
        this.found.push(poi);
      }
      if (visual.barge) this.animateBarge(visual, visual.barge, night, beat, distance);
      if (visual.wreck) this.animateWreck(visual.wreck, night, windX, windZ);
      if (visual.monolith) this.animateMonolith(visual.monolith, night, distance);
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) this.release(visual);
    this.visuals.clear();
    this.group.removeFromParent();
  }

  private rescan(x: number, z: number): void {
    this.scanX = x;
    this.scanZ = z;
    this.pois = poisAround(x, z, POI_RANGE, this.isOpen);
    const wanted = new Set(this.pois.map((poi) => poi.id));
    for (const [id, visual] of this.visuals) {
      if (!wanted.has(id)) {
        this.release(visual);
        this.visuals.delete(id);
      }
    }
    for (const poi of this.pois) {
      if (!this.visuals.has(poi.id)) this.visuals.set(poi.id, this.build(poi));
    }
  }

  private build(poi: Poi): Visual {
    const owned: Owned = { geometries: [], materials: [], textures: [] };
    const root = new THREE.Group();
    root.name = `Place:${poi.kind}:${poi.id}`;
    root.position.set(poi.x, 0, poi.z);
    root.rotation.y = poi.heading;
    const visual: Visual = { poi, owned, root };
    if (poi.kind === "barge") {
      visual.barge = buildBarge(owned);
      root.add(visual.barge.group);
    } else if (poi.kind === "wreck") {
      visual.wreck = buildWreck(owned);
      root.add(visual.wreck.group);
    } else {
      visual.monolith = buildMonolith(owned);
      root.add(visual.monolith.group);
    }
    // Lit materials are veiled by the water where they are under it.
    for (const material of owned.materials) {
      if (material instanceof THREE.MeshStandardMaterial) this.underwater.apply(material);
    }
    root.updateMatrixWorld(true);
    this.group.add(root);
    return visual;
  }

  private release(visual: Visual): void {
    visual.root.removeFromParent();
    visual.owned.geometries.forEach((geometry) => geometry.dispose());
    visual.owned.materials.forEach((material) => material.dispose());
    visual.owned.textures.forEach((texture) => texture.dispose());
  }

  /** The barge rides the swell at anchor; its lights keep the beat. */
  private animateBarge(visual: Visual, barge: BargeParts, night: number, beat: number, distance: number): void {
    const poi = visual.poi;
    const surface = this.ocean.sample(poi.x, poi.z);
    visual.root.position.y = surface.height - 0.15;
    // A heavy pontoon follows only a little of the wave slope.
    this.normal.set(surface.normalX * 0.4, surface.normalY, surface.normalZ * 0.4).normalize();
    this.tilt.setFromUnitVectors(this.up, this.normal);
    this.turn.setFromAxisAngle(this.up, poi.heading);
    visual.root.quaternion.copy(this.tilt).multiply(this.turn);
    const clock = Number.isFinite(beat) ? beat : (this.clock * 124) / 60;
    barge.floor.uniforms.uBeat!.value = clock;
    barge.floor.uniforms.uLevel!.value = 0.5 + 0.7 * night;
    // Bulbs chase round the strings, warm white and colours.
    const pulse = 1 - (clock % 1);
    for (let index = 0; index < barge.bulbCount; index += 1) {
      const chase = (index + Math.floor(clock * 2)) % 4;
      const level = (1.4 + night * 2.2) * (chase === 0 ? 1 + pulse : 0.6);
      const hue = (index * 0.13 + Math.floor(clock / 4) * 0.25) % 1;
      this.color.setHSL(hue, index % 3 === 0 ? 0 : 0.85, 0.55, THREE.LinearSRGBColorSpace).multiplyScalar(level);
      barge.bulbs.setColorAt(index, this.color);
    }
    if (barge.bulbs.instanceColor) barge.bulbs.instanceColor.needsUpdate = true;
    barge.ball.rotation.y += 0.012;
    // The crowd bounces on the beat; the haze over the floor pulses in its colour.
    const bounce = Math.pow(1 - (clock % 1), 3);
    barge.dancers.forEach((dancer, index) => {
      const phase = dancer.userData.phase as number;
      dancer.position.y = 1.62 + Math.abs(Math.sin((clock + phase) * Math.PI)) * 0.14;
      dancer.rotation.z = Math.sin((clock + phase) * Math.PI) * 0.08;
      dancer.rotation.y += (index % 2 === 0 ? 1 : -1) * 0.004;
    });
    this.color.setHSL((Math.floor(clock / 2) * 0.17) % 1, 0.9, 0.5, THREE.LinearSRGBColorSpace).multiplyScalar((0.25 + 0.9 * night) * (0.55 + 0.45 * bounce));
    barge.haze.material.color.copy(this.color);
    // Lasers after dark, sweeping to the music; seen from afar too.
    barge.lasers.visible = night > 0.35;
    if (barge.lasers.visible) {
      barge.lasers.rotation.x = -0.35 + Math.sin(clock * 0.5) * 0.3;
      barge.lasers.rotation.y = Math.sin(clock * 0.25) * 0.6;
      barge.laserMaterial.uniforms.uLevel!.value = smoothstep(0.35, 0.7, night) * (0.6 + 0.4 * pulse) * (distance < 1600 ? 1 : 0.5);
    }
  }

  private animateWreck(wreck: WreckParts, night: number, windX: number, windZ: number): void {
    const wind = Math.min(1, Math.hypot(windX, windZ) / 10);
    wreck.sails.forEach((sail, index) => {
      sail.rotation.x = Math.sin(this.clock * (1.1 + index * 0.3) + index) * 0.12 * wind - 0.08 * wind;
    });
    wreck.flag.rotation.y = Math.atan2(windX, windZ) * 0.2 + Math.sin(this.clock * 3.1) * 0.25;
    // The lantern: barely there by day, a ghostly green flicker at night.
    const flicker = 0.8 + 0.2 * Math.sin(this.clock * 7.3) * Math.sin(this.clock * 3.1 + 1);
    wreck.lantern.material.opacity = (0.15 + 0.85 * night) * flicker;
    wreck.lantern.scale.setScalar(3 + night * 4);
  }

  private animateMonolith(monolith: MonolithParts, night: number, distance: number): void {
    // The glyphs wake as the yacht comes near.
    const near = 1 - smoothstep(25, 260, distance);
    const breath = 0.75 + 0.25 * Math.sin(this.clock * 0.9);
    monolith.runes.emissiveIntensity = (0.12 + 0.5 * night + near * 2.2) * breath;
    monolith.ring.material.uniforms.uTime!.value = this.clock;
    monolith.ring.material.uniforms.uLevel!.value = (0.15 + 0.85 * night) * (0.25 + near * 0.75) * breath;
  }
}
