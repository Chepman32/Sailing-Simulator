import * as THREE from "three";
import { islandEdgeNoise, islandsWithin, VOLCANO_RIM, volcanoHeight, type IslandDefinition } from "../environment/IslandMath";
import { LitPuffs } from "./LitPuffs";
import { EmberStreaks } from "./EmberStreaks";
import type { EnvironmentPalette } from "../environment/EnvironmentPalette";
import {
  ASH_PUFFS,
  ashPuff,
  BOMBS,
  bombFlight,
  COLLAPSE_PUFFS,
  collapsePuff,
  craterGlow,
  emberHeat,
  eruptionAt,
  eruptionHash,
  fountainActivity,
  GRAVITY,
  PLUME_LIFE,
  plumePuff,
  SHOCK_PUFFS,
  shockPuff,
  SPARKS,
  type AshPoint,
  type Ember,
  type Eruption,
  type PlumePoint,
} from "./VolcanoMath";

/**
 * The volcanic islands' fire and smoke: a plume of steam always rising from
 * the crater and bending away downwind, a crater glow that breathes, rivers
 * of lava creeping down the flanks, and about once a minute an eruption — a
 * blast and a ring of shocked air, a fountain of incandescent bombs that
 * streak out of the crater and tumble down the cone, a dark ash column
 * billowing up hundreds of metres into an umbrella the wind carries off,
 * lit orange from below, and in a strong one hot ash rolling down the flank.
 *
 * Smoke is drawn as lit, sorted billows (`LitPuffs`), the fountain as
 * motion-blurred streaks (`EmberStreaks`). The cone itself is island
 * terrain (see `IslandMath.volcanoHeight`). At most `MAX_VOLCANOES` in
 * range are animated; their meshes are built once when one comes in range.
 */

const MAX_VOLCANOES = 2;
/** Volcanoes farther than this are not animated (their plume is in the haze). */
const VOLCANO_RANGE = 2600;
const PLUME_PUFFS = 80;
const FLOWS = 3;

export type VolcanoEvent = {
  /** Where the crater is. */
  x: number;
  y: number;
  z: number;
  strength: number;
};

type Visual = {
  island: IslandDefinition | null;
  crater: THREE.Vector3;
  plume: LitPuffs;
  ash: LitPuffs;
  embers: EmberStreaks;
  glow: THREE.Sprite;
  flows: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  /** The slot of the last eruption reported (so each booms once). */
  lastSlot: number;
  /** Flight time at which each bomb (then each spark) lands on the cone, for the current slot. */
  landing: Float32Array;
  landingSlot: number;
  /** Light and roar of the eruption under way, for the scene and the sound. */
  light: number;
  roar: number;
};

const lavaVertex = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying float vAcross;
  varying vec2 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vAlong = aAlong;
    vAcross = uv.x;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const lavaFragment = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  varying float vAlong;
  varying float vAcross;
  varying vec2 vWorld;
  #include <fog_pars_fragment>
  float lavaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float lavaNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(lavaHash(i), lavaHash(i + vec2(1.0, 0.0)), u.x), mix(lavaHash(i + vec2(0.0, 1.0)), lavaHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    // A dark crust broken by glowing cracks, creeping downhill.
    vec2 flow = vec2(vAcross * 3.0, vAlong * 0.22 - uTime * 0.06);
    float crust = lavaNoise(flow * 2.0) * 0.6 + lavaNoise(flow * 5.3 + 3.1) * 0.4;
    float cracks = smoothstep(0.42, 0.62, crust);
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vAcross * 2.0 - 1.0));
    // Hottest near the vent; the tongue cools and crusts over toward its end.
    float hot = 1.0 - smoothstep(0.2, 1.0, vAlong / 120.0);
    vec3 glow = mix(vec3(2.4, 0.42, 0.06), vec3(5.2, 2.1, 0.45), cracks * hot);
    vec3 cold = vec3(0.05, 0.035, 0.03);
    vec3 color = mix(cold, glow * uHeat, clamp(cracks * (0.35 + 0.65 * hot) + hot * 0.25, 0.0, 1.0) * edge);
    float alpha = edge * (1.0 - smoothstep(0.85, 1.0, vAlong / 140.0));
    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
  }
`;

function glowTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(255 * Math.max(0, Math.exp(-r * r * 4.5) - 0.012));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function eruptionHashWidth(index: number, slot: number): number {
  return eruptionHash(index * 13 + 5, slot + 3);
}

export class VolcanoSystem {
  readonly group = new THREE.Group();
  private readonly visuals: Visual[] = [];
  private readonly glowMap = glowTexture();
  private readonly lavaTime = { value: 0 };
  private readonly lavaHeat = { value: 1 };
  private readonly eruption: Eruption = { age: -1, strength: 0, slot: 0 };
  private readonly point: PlumePoint = { x: 0, y: 0, z: 0, radius: 0, opacity: 0 };
  private readonly events: VolcanoEvent[] = [];
  private scanX = Number.NaN;
  private scanZ = Number.NaN;
  private nearest: Visual | null = null;

  constructor(
    scene: THREE.Scene,
    /** Height of the rendered terrain of `island` at a polar position. */
    private readonly terrainHeight: (island: IslandDefinition, radial: number, angle: number) => number,
  ) {
    this.group.name = "Volcanoes";
    for (let index = 0; index < MAX_VOLCANOES; index += 1) {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowMap,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      );
      glow.renderOrder = 4;
      glow.visible = false;
      const visual: Visual = {
        island: null,
        crater: new THREE.Vector3(),
        plume: new LitPuffs(PLUME_PUFFS, { name: "VolcanoPlume", softness: 0.15 }),
        ash: new LitPuffs(ASH_PUFFS + COLLAPSE_PUFFS + SHOCK_PUFFS, { name: "VolcanoAsh", softness: 0.7 }),
        embers: new EmberStreaks(BOMBS + SPARKS),
        glow,
        flows: null,
        lastSlot: Number.NaN,
        landing: new Float32Array(BOMBS + SPARKS),
        landingSlot: Number.NaN,
        light: 0,
        roar: 0,
      };
      this.group.add(visual.plume.mesh, visual.ash.mesh, visual.embers.mesh, glow);
      this.visuals.push(visual);
    }
    scene.add(this.group);
  }

  /** Eruptions that began since the last call (for the boom and the camera). */
  consumeEruptions(): VolcanoEvent[] {
    if (this.events.length === 0) return [];
    const taken = this.events.slice();
    this.events.length = 0;
    return taken;
  }

  /** The nearest animated volcano's crater, if one is in range. */
  get nearestCrater(): THREE.Vector3 | null {
    return this.nearest?.island ? this.nearest.crater : null;
  }

  /** The nearest animated volcanic island. */
  get nearestIsland(): IslandDefinition | null {
    return this.nearest?.island ?? null;
  }

  /** An eruption under way at the nearest volcano, 0…1 (for the camera). */
  get nearestEruption(): number {
    return this.nearestStrength;
  }

  private nearestStrength = 0;

  /**
   * The brightest eruption light in range: where and how strong (for the
   * environment's point light, as a flare's), or null.
   */
  get eruptionLight(): { position: THREE.Vector3; brightness: number } | null {
    let best: Visual | null = null;
    for (const visual of this.visuals) if (visual.island && visual.light > 0.05 && (!best || visual.light > best.light)) best = visual;
    if (!best) return null;
    this.lightPoint.copy(best.crater).y += 40;
    return { position: this.lightPoint, brightness: best.light };
  }

  /** The nearest eruption's roar, 0…1, and where it comes from. */
  get roar(): { level: number; position: THREE.Vector3 } | null {
    const visual = this.nearest;
    return visual?.island && visual.roar > 0.01 ? { level: visual.roar, position: visual.crater } : null;
  }

  private readonly lightPoint = new THREE.Vector3();
  private readonly ashPoint: AshPoint = { x: 0, y: 0, z: 0, radius: 0, opacity: 0, fresh: 0 };
  private readonly ember: Ember = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };

  update(
    time: number,
    x: number,
    z: number,
    windX: number,
    windZ: number,
    palette: EnvironmentPalette,
    lightDirection: THREE.Vector3,
    night: number,
    eye: THREE.Vector3,
  ): void {
    if (!(Math.hypot(x - this.scanX, z - this.scanZ) < 120)) this.rescan(x, z);
    this.lavaTime.value = time;
    this.lavaHeat.value = 0.9 + night * 0.5;
    this.nearest = null;
    this.nearestStrength = 0;
    let nearestDistance = Infinity;
    const wind = Math.hypot(windX, windZ) || 1;
    // The plume drifts at a fraction of the wind (it is higher, where it blows harder).
    const driftX = (windX / wind) * Math.min(8, wind * 0.9);
    const driftZ = (windZ / wind) * Math.min(8, wind * 0.9);
    const ambient = palette.ambientColor;
    const sun = palette.lightColor;
    const sunScale = 0.85;
    const sunLight: [number, number, number] = [sun[0] * sunScale, sun[1] * sunScale, sun[2] * sunScale];
    const fireReach = 0.22 + 0.78 * night;
    for (const visual of this.visuals) {
      const island = visual.island;
      if (!island) continue;
      const crater = visual.crater;
      const distance = Math.hypot(crater.x - x, crater.z - z);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        this.nearest = visual;
      }
      const eruption = eruptionAt(time, island.seed + island.id % 997, this.eruption);
      const glow = craterGlow(time, eruption);
      const fountain = fountainActivity(eruption);
      if (eruption.age >= 0 && eruption.age < 1 && eruption.slot !== visual.lastSlot) {
        visual.lastSlot = eruption.slot;
        this.events.push({ x: crater.x, y: crater.y, z: crater.z, strength: eruption.strength });
      }
      if (visual === this.nearest && eruption.age >= 0) this.nearestStrength = fountain;
      visual.light = eruption.age >= 0 ? (glow - 0.5) * 7 : 0;
      visual.roar = fountain;
      visual.plume.setLight(lightDirection, sunLight, ambient);
      visual.ash.setLight(lightDirection, sunLight, ambient);

      // Crater glow: orange light on the steam above the vent.
      visual.glow.visible = true;
      visual.glow.position.set(crater.x, crater.y + 8, crater.z);
      visual.glow.scale.setScalar(island.beachRadius * (0.3 + 0.14 * Math.min(glow, 3)));
      visual.glow.material.color.setRGB(2.6 * glow, 0.72 * glow, 0.15 * glow, THREE.LinearSRGBColorSpace);
      visual.glow.material.opacity = 0.45 + 0.55 * night;

      // The steady plume: whitish steam and gas, thinning as it drifts off.
      const plume = visual.plume;
      plume.begin();
      for (let index = 0; index < PLUME_PUFFS; index += 1) {
        const phase = index / PLUME_PUFFS;
        const age = (time + phase * PLUME_LIFE) % PLUME_LIFE;
        const p = plumePuff(age, phase, driftX, driftZ, this.point);
        const fire = glow * Math.exp(-p.y / 50) * fireReach * 0.5;
        const albedo = 0.78 - 0.18 * Math.min(1, p.y / 220);
        plume.push(
          crater.x + p.x,
          crater.y + 4 + p.y,
          crater.z + p.z,
          p.radius * 2.3,
          albedo,
          albedo * 0.97,
          albedo * 0.95,
          p.opacity * 0.38,
          2.4 * fire,
          0.62 * fire,
          0.14 * fire,
          phase,
        );
      }
      plume.end(eye);

      const ash = visual.ash;
      const embers = visual.embers;
      ash.begin();
      embers.begin();
      if (eruption.age >= 0) {
        // The blast: a ring of shocked, condensing air racing out.
        if (eruption.age < 1.4) {
          for (let index = 0; index < SHOCK_PUFFS; index += 1) {
            const p = shockPuff(eruption.age, index, this.point);
            ash.push(crater.x + p.x, crater.y + p.y, crater.z + p.z, p.radius * 2, 0.9, 0.9, 0.92, p.opacity * eruption.strength, 0, 0, 0, index / SHOCK_PUFFS);
          }
        }
        // The ash column: dark, dense billows, glowing from below near the vent.
        for (let index = 0; index < ASH_PUFFS; index += 1) {
          const p = ashPuff(eruption.age, index, eruption.slot, eruption.strength, driftX, driftZ, this.ashPoint);
          if (p.opacity <= 0) continue;
          const fire = glow * Math.exp(-p.y / 90) * p.fresh * fireReach;
          // Fresh ash is near-black brown; old, dilute ash a lighter grey.
          const albedo = 0.17 + 0.15 * (1 - p.fresh);
          ash.push(
            crater.x + p.x,
            crater.y + 6 + p.y,
            crater.z + p.z,
            p.radius * 2,
            albedo * 1.04,
            albedo,
            albedo * 0.96,
            p.opacity * (0.8 + 0.15 * p.fresh),
            2.6 * fire,
            0.7 * fire,
            0.16 * fire,
            index / ASH_PUFFS,
          );
        }
        // A collapse: hot ash rolling down the flank.
        for (let index = 0; index < COLLAPSE_PUFFS; index += 1) {
          const p = collapsePuff(eruption.age, index, eruption.slot, eruption.strength, this.point);
          if (p.opacity <= 0) continue;
          const radial = VOLCANO_RIM + p.x / island.beachRadius;
          const px = crater.x + Math.cos(p.z) * p.x;
          const pz = crater.z + Math.sin(p.z) * p.x * island.scaleZ;
          const ground = this.terrainHeight(island, Math.min(radial, 1.02), p.z);
          const heat = Math.exp(-p.x / 160) * fireReach;
          ash.push(px, ground + p.radius * 0.55, pz, p.radius * 2, 0.26, 0.24, 0.22, p.opacity * 0.8, 1.6 * heat, 0.42 * heat, 0.1 * heat, 0.37 + index * 0.031);
        }
        // The fountain: bombs streaking up and tumbling down the cone; sparks.
        if (visual.landingSlot !== eruption.slot) this.planLandings(visual, island, eruption);
        for (let index = 0; index < BOMBS + SPARKS; index += 1) {
          const sparks = index >= BOMBS;
          const id = sparks ? index - BOMBS : index;
          if (!bombFlight(eruption.age, id, eruption.slot, this.ember, sparks)) continue;
          const e = this.ember;
          const width = sparks ? 1.4 : 2.6 + 2.6 * eruptionHashWidth(id, eruption.slot);
          let heat = emberHeat(e.t, sparks);
          const land = visual.landing[index]!;
          let hx = crater.x + e.x;
          let hy = crater.y + 3 + e.y;
          let hz = crater.z + e.z;
          let tx: number;
          let ty: number;
          let tz: number;
          if (e.t > land) {
            // Landed: it rolls and bounces down the slope, cooling.
            const since = e.t - land;
            const horizontal = Math.hypot(e.vx, e.vz) || 1;
            const dirX = e.vx / horizontal;
            const dirZ = e.vz / horizontal;
            const landX = e.vx * land;
            const landZ = e.vz * land;
            const roll = 14 * since * Math.exp(-since / 5);
            const along = Math.hypot(landX, landZ) + roll;
            const angle = Math.atan2(landZ / island.scaleZ, landX);
            const ground = this.terrainHeight(island, Math.min(VOLCANO_RIM + along / island.beachRadius, 1), angle);
            hx = crater.x + dirX * along;
            hz = crater.z + dirZ * along;
            hy = ground + width * 0.5 + Math.abs(Math.sin(since * 5)) * 2 * Math.exp(-since);
            heat *= Math.exp(-since / 3);
            tx = hx - dirX * 4;
            tz = hz - dirZ * 4;
            ty = hy + 1.5;
            if (sparks) heat = 0;
          } else {
            // In flight: a streak back along its velocity (a short exposure).
            const blur = 0.2;
            tx = hx - e.vx * blur;
            ty = hy - (e.vy + GRAVITY * blur * 0.5) * blur;
            tz = hz - e.vz * blur;
          }
          embers.push(hx, hy, hz, tx, ty, tz, width, heat);
        }
      }
      ash.end(eye);
      embers.end();
    }
  }

  /** Flight time at which each bomb meets the cone (bisection against the terrain), once per eruption. */
  private planLandings(visual: Visual, island: IslandDefinition, eruption: Eruption): void {
    visual.landingSlot = eruption.slot;
    const probe: Ember = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };
    for (let index = 0; index < BOMBS + SPARKS; index += 1) {
      const sparks = index >= BOMBS;
      const id = sparks ? index - BOMBS : index;
      const above = (t: number): boolean => {
        // Launch time does not matter: evaluate the flight at time t after launch.
        bombFlight(1e3, id, eruption.slot, probe, sparks);
        const vx = probe.vx;
        const vz = probe.vz;
        const vy0 = probe.vy + GRAVITY * probe.t;
        const x = vx * t;
        const z = vz * t;
        const y = vy0 * t - 0.5 * GRAVITY * t * t + visual.crater.y + 3;
        const radial = VOLCANO_RIM + Math.hypot(x, z / island.scaleZ) / (island.beachRadius * islandEdgeNoise(Math.atan2(z / island.scaleZ, x), island));
        const angle = Math.atan2(z / island.scaleZ, x);
        return y > this.terrainHeight(island, Math.min(radial, 1.05), angle);
      };
      // It is above the cone just after launch; find when it comes down.
      let low = 0.5;
      let high = 30;
      if (above(high)) {
        visual.landing[index] = high;
        continue;
      }
      for (let step = 0; step < 14; step += 1) {
        const mid = (low + high) / 2;
        if (above(mid)) low = mid;
        else high = mid;
      }
      visual.landing[index] = high;
    }
  }

  dispose(): void {
    for (const visual of this.visuals) {
      visual.plume.dispose();
      visual.ash.dispose();
      visual.embers.dispose();
      visual.glow.material.dispose();
      if (visual.flows) {
        visual.flows.geometry.dispose();
        visual.flows.material.dispose();
      }
    }
    this.glowMap.dispose();
    this.group.removeFromParent();
  }

  private rescan(x: number, z: number): void {
    this.scanX = x;
    this.scanZ = z;
    const wanted = islandsWithin(x, z, VOLCANO_RANGE)
      .filter((island) => island.volcano)
      .slice(0, MAX_VOLCANOES);
    for (const visual of this.visuals) {
      if (visual.island && !wanted.some((island) => island.id === visual.island!.id)) this.release(visual);
    }
    for (const island of wanted) {
      if (this.visuals.some((visual) => visual.island?.id === island.id)) continue;
      const free = this.visuals.find((visual) => !visual.island);
      if (free) this.attach(free, island);
    }
  }

  private release(visual: Visual): void {
    visual.island = null;
    visual.glow.visible = false;
    visual.plume.mesh.visible = false;
    visual.ash.mesh.visible = false;
    visual.embers.mesh.visible = false;
    visual.light = 0;
    visual.roar = 0;
    if (visual.flows) {
      visual.flows.geometry.dispose();
      visual.flows.material.dispose();
      visual.flows.removeFromParent();
      visual.flows = null;
    }
  }

  private attach(visual: Visual, island: IslandDefinition): void {
    visual.island = island;
    visual.lastSlot = Number.NaN;
    const rimHeight = volcanoHeight(VOLCANO_RIM, 0, island.height, island.seed);
    visual.crater.set(island.centerX, rimHeight, island.centerZ);
    visual.flows = this.buildFlows(island);
    this.group.add(visual.flows);
  }

  /**
   * Lava tongues: ribbons draped down the flank from the rim, a metre above
   * the rock, each wandering a little as it finds its way down.
   */
  private buildFlows(island: IslandDefinition): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const positions: number[] = [];
    const uvs: number[] = [];
    const along: number[] = [];
    const indices: number[] = [];
    const steps = 36;
    for (let flow = 0; flow < FLOWS; flow += 1) {
      const start = island.seed * 0.7 + flow * 2.1 + (flow === 2 ? 0.6 : 0);
      const reach = 0.36 + ((island.seed * (flow + 3)) % 7) * 0.025;
      const width = 5 + flow * 1.5;
      let travelled = 0;
      let previousX = 0;
      let previousZ = 0;
      const base = positions.length / 3;
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const radial = VOLCANO_RIM + 0.005 + t * reach;
        const angle = start + Math.sin(t * 5 + flow) * 0.07 + t * 0.05;
        // (The terrain's rings are scaled by the coastline's own wobble.)
        const radius = island.beachRadius * radial * islandEdgeNoise(angle, island);
        const cx = Math.cos(angle) * radius;
        const cz = Math.sin(angle) * radius * island.scaleZ;
        if (step > 0) travelled += Math.hypot(cx - previousX, cz - previousZ);
        previousX = cx;
        previousZ = cz;
        // Across the slope: perpendicular to the radial direction.
        const acrossX = -Math.sin(angle);
        const acrossZ = Math.cos(angle) * island.scaleZ;
        const length = Math.hypot(acrossX, acrossZ) || 1;
        const half = width * (0.6 + 0.4 * Math.sin(t * Math.PI)) * 0.5;
        for (const side of [-1, 1]) {
          const px = cx + (acrossX / length) * half * side;
          const pz = cz + (acrossZ / length) * half * side;
          const a = Math.atan2(pz / island.scaleZ, px);
          const r = Math.hypot(px, pz / island.scaleZ) / (island.beachRadius * islandEdgeNoise(a, island));
          positions.push(island.centerX + px, this.terrainHeight(island, r, a) + 0.6, island.centerZ + pz);
          uvs.push(side < 0 ? 0 : 1, t);
          along.push(travelled);
        }
        if (step > 0) {
          const i = base + step * 2;
          indices.push(i - 2, i - 1, i, i - 1, i + 1, i);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      name: "LavaFlow",
      vertexShader: lavaVertex,
      fragmentShader: lavaFragment,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uHeat: { value: 1 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // Shared clock and heat (merge cloned them).
    material.uniforms.uTime = this.lavaTime;
    material.uniforms.uHeat = this.lavaHeat;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "LavaFlows";
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    return mesh;
  }
}
