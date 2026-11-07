import * as THREE from "three";
import { islandEdgeNoise, islandsWithin, VOLCANO_DRAW_DISTANCE, VOLCANO_RIM, volcanoHeight, type IslandDefinition } from "../environment/IslandMath";
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
  precursorAt,
  volcanoTremor,
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
 * terrain (see `IslandMath.volcanoHeight`). There is one volcano in the
 * sea; its meshes are built once when it comes in range.
 */

/** There is a single volcano in the sea (`isVolcanoCell`). */
const MAX_VOLCANOES = 1;
/** Plumes are kept to the distance at which the cones themselves are drawn (`VOLCANO_DRAW_DISTANCE`). */
const VOLCANO_RANGE = VOLCANO_DRAW_DISTANCE;
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
  /** The lava fountain's glare over the vent while it plays. */
  jet: THREE.Sprite;
  flows: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  /** The lava lake in the crater. */
  lake: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  /** The slot of the last eruption reported (so each booms once). */
  lastSlot: number;
  /** Flight time at which each bomb (then each spark) lands on the cone, for the current slot. */
  landing: Float32Array;
  landingSlot: number;
  /** Light and roar of the eruption under way, for the scene and the sound. */
  light: number;
  roar: number;
  /** The warning before an eruption (0…1), the fountain and the eruption's age, for the tremor. */
  precursor: number;
  fountain: number;
  age: number;
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

/** The lava lake fills the crater out to this fraction of the rim's radius. */
const LAKE_RADIAL = 0.62;

const lakeVertex = /* glsl */ `
  varying vec2 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const lakeFragment = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  uniform vec2 uCentre;
  uniform vec2 uShape;
  varying vec2 vWorld;
  #include <fog_pars_fragment>
  float lakeHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float lakeNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(lakeHash(i), lakeHash(i + vec2(1.0, 0.0)), u.x), mix(lakeHash(i + vec2(0.0, 1.0)), lakeHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  const mat2 LAKE_OCTAVE = mat2(1.6, 1.2, -1.2, 1.6);
  float lakeFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 5; octave++) {
      value += amplitude * lakeNoise(p);
      p = LAKE_OCTAVE * p;
      amplitude *= 0.5;
    }
    return value;
  }
  // Ridged noise: thin, jagged lines where the noise crosses its middle.
  float lakeRidge(vec2 p) {
    return 1.0 - abs(2.0 * lakeNoise(p) - 1.0);
  }
  // Incandescence by temperature (0 cold … 1 hottest): the colour of glowing
  // rock, from a dull blood red through orange to a yellow-white, in HDR so
  // the brightest lava blooms.
  vec3 incandescence(float t) {
    vec3 c = mix(vec3(0.0), vec3(0.42, 0.025, 0.0), smoothstep(0.0, 0.18, t));
    c = mix(c, vec3(1.9, 0.22, 0.01), smoothstep(0.15, 0.45, t));
    c = mix(c, vec3(4.2, 1.25, 0.12), smoothstep(0.42, 0.75, t));
    c = mix(c, vec3(6.5, 4.3, 1.5), smoothstep(0.75, 1.0, t));
    return c;
  }
  void main() {
    vec2 p = vWorld - uCentre;
    float t = uTime;
    // Distance from the middle as a share of the lake's radius (an ellipse).
    float rn = length(vec2(p.x, p.y / uShape.y)) / uShape.x;
    float r = length(p);
    // The lake churns slowly: lava wells up in the middle and spreads to the
    // walls, where it sinks again. Domain warping gives the flow its swirls.
    vec2 outward = p / max(r, 1.0);
    vec2 q = p * 0.075 - outward * t * 0.012;
    vec2 warp = vec2(lakeFbm(q + vec2(0.0, t * 0.010)), lakeFbm(q + vec2(5.2, 1.3) - t * 0.008));
    vec2 warp2 = vec2(lakeFbm(q + 3.2 * warp + vec2(1.7, 9.2)), lakeFbm(q + 3.2 * warp + vec2(8.3, 2.8) + t * 0.006));
    float field = lakeFbm(q * 1.4 + 2.6 * warp2);
    // A cooled skin floats where the field is high: black, glassy basalt in
    // rafts torn into irregular plates. Between the rafts, open lanes of
    // molten rock.
    float skin = smoothstep(0.44, 0.56, field);
    // The skin cracks: thin, jagged, branching lines of glowing rock, a few
    // wide ones and many fine ones, sheared by the same flow.
    vec2 crackSpace = p * 0.42 + warp2 * 6.0;
    float cracks = pow(lakeRidge(crackSpace), 22.0) + 0.65 * pow(lakeRidge(crackSpace * 2.7 + 11.0), 30.0) + 0.35 * pow(lakeRidge(crackSpace * 6.1 - 4.0), 40.0);
    cracks = clamp(cracks, 0.0, 1.0);
    // Heat of the open lava: hottest in the welling middle, in the core of
    // each lane, and in a bright band at the walls where the crust is torn
    // apart against the rock; a slow pulse of turbulence runs through it.
    float lane = 1.0 - smoothstep(0.28, 0.48, field);
    float turbulence = lakeFbm(p * 0.35 + vec2(t * 0.22, -t * 0.17)) ;
    float welling = exp(-rn * rn * 9.0) * (0.75 + 0.25 * sin(t * 0.6));
    float shore = smoothstep(0.82, 0.98, rn);
    float heat = lane * (0.45 + 0.55 * turbulence) + welling * 0.55 + shore * (0.55 + 0.35 * turbulence);
    heat = clamp(heat, 0.0, 1.0);
    // Through the cracks the hot interior shows, dimmer than the open lanes.
    float crackHeat = cracks * (0.55 + 0.35 * turbulence);
    // Thin skin near a lane still glows a dull red from beneath.
    float underglow = (1.0 - smoothstep(0.44, 0.62, field)) * 0.22;
    // Gas bursting through: a bright, spreading dome that tears the skin and
    // leaves a ring of spatter, here and there, now and then.
    vec2 cell = floor(p * 0.09 + 0.5);
    float seed = lakeHash(cell + 17.0);
    float phase = fract(t * (0.05 + seed * 0.06) + lakeHash(cell + 3.0));
    vec2 centre = (cell + (vec2(lakeHash(cell), lakeHash(cell + 9.0)) - 0.5) * 0.6) / 0.09;
    float burst = smoothstep(0.88, 0.94, phase) * (1.0 - smoothstep(0.94, 1.0, phase));
    float fromBurst = length(p - centre);
    float dome = burst * (1.0 - smoothstep(0.0, 1.0 + 3.5 * (phase - 0.88) * 8.0, fromBurst));
    // The skin itself: black and faintly glassy, lit a little by the glow.
    float grain = lakeFbm(p * 2.2);
    vec3 basalt = vec3(0.018, 0.016, 0.016) * (0.6 + 0.9 * grain);
    float skinHeat = max(crackHeat, underglow);
    vec3 skinColor = basalt + incandescence(skinHeat);
    vec3 openColor = incandescence(0.35 + heat * 0.65);
    vec3 color = mix(openColor, skinColor, skin * (1.0 - shore * 0.8));
    color = mix(color, incandescence(1.0), clamp(dome, 0.0, 1.0));
    // Cooler lava dims everything a little when the volcano is resting.
    color *= mix(0.75, 1.0, uHeat);
    gl_FragColor = vec4(color, 1.0);
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
      // Laid over the sky rather than added to it, so by day it stays orange
      // instead of bleaching the blue behind it to pink.
      const jet = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowMap, blending: THREE.NormalBlending, transparent: true, depthWrite: false, fog: false }),
      );
      jet.renderOrder = 4;
      jet.visible = false;
      const visual: Visual = {
        island: null,
        crater: new THREE.Vector3(),
        plume: new LitPuffs(PLUME_PUFFS, { name: "VolcanoPlume", softness: 0.15 }),
        // Ash is opaque and dark: it keeps its shape through more of the haze than steam does.
        ash: new LitPuffs(ASH_PUFFS + COLLAPSE_PUFFS + SHOCK_PUFFS, { name: "VolcanoAsh", softness: 0.55, fogScale: 0.36 }),
        embers: new EmberStreaks(BOMBS + SPARKS),
        glow,
        jet,
        flows: null,
        lake: null,
        lastSlot: Number.NaN,
        landing: new Float32Array(BOMBS + SPARKS),
        landingSlot: Number.NaN,
        light: 0,
        roar: 0,
        precursor: 0,
        fountain: 0,
        age: -1,
      };
      this.group.add(visual.plume.mesh, visual.ash.mesh, visual.embers.mesh, glow, jet);
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

  /**
   * How hard the ground shakes at (x, z), 0…1: the warning's tremor, the
   * blast and the fountain, strong near the volcano and gone far off.
   */
  shakeAt(x: number, z: number): number {
    let shake = 0;
    for (const visual of this.visuals) {
      if (!visual.island) continue;
      const distance = Math.hypot(visual.crater.x - x, visual.crater.z - z);
      shake = Math.max(shake, volcanoTremor(visual.precursor, visual.fountain, visual.age, distance));
    }
    return shake;
  }

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
      const seed = island.seed + island.id % 997;
      const eruption = eruptionAt(time, seed, this.eruption);
      // Half a minute of warning: the plume thickens and darkens, a low rumble, a tremor.
      const precursor = precursorAt(time, seed);
      const glow = craterGlow(time, eruption) * (1 + precursor * 0.6);
      const fountain = fountainActivity(eruption);
      visual.precursor = precursor;
      visual.fountain = fountain;
      visual.age = eruption.age;
      if (eruption.age >= 0 && eruption.age < 1 && eruption.slot !== visual.lastSlot) {
        visual.lastSlot = eruption.slot;
        this.events.push({ x: crater.x, y: crater.y, z: crater.z, strength: eruption.strength });
      }
      if (visual === this.nearest && eruption.age >= 0) this.nearestStrength = fountain;
      visual.light = eruption.age >= 0 ? (glow - 0.5) * 7 : 0;
      // The rumble of the warning grows into the eruption's roar.
      visual.roar = Math.max(fountain, precursor * 0.5);
      visual.plume.setLight(lightDirection, sunLight, ambient);
      visual.ash.setLight(lightDirection, sunLight, ambient);

      // Crater glow: a low, wide orange light on the steam just above the vent
      // (flattened: it is the lit underside of the plume, not a ball of fire).
      // By day only a hint of it shows against the bright sky.
      visual.glow.visible = true;
      visual.glow.position.set(crater.x, crater.y + 5, crater.z);
      const glowSize = island.beachRadius * (0.16 + 0.08 * Math.min(glow, 3));
      visual.glow.scale.set(glowSize * 1.5, glowSize * 0.7, 1);
      visual.glow.material.color.setRGB(2.4 * glow, 0.62 * glow, 0.1 * glow, THREE.LinearSRGBColorSpace);
      visual.glow.material.opacity = 0.18 + 0.8 * night;
      // The fountain: a tall, narrow glare of incandescent spray over the vent.
      visual.jet.visible = fountain > 0.02;
      if (visual.jet.visible) {
        const flicker = 0.82 + 0.18 * Math.sin(time * 23.1) * Math.sin(time * 9.7 + 1.3);
        const height = 70 + 90 * fountain;
        visual.jet.position.set(crater.x, crater.y + height * 0.42, crater.z);
        visual.jet.scale.set(20 + 14 * fountain, height, 1);
        const heat = fountain * flicker * (0.55 + 0.45 * night);
        visual.jet.material.color.setRGB(3.4 * heat, 1.25 * heat, 0.28 * heat, THREE.LinearSRGBColorSpace);
        visual.jet.material.opacity = 0.9;
      }

      // The steady plume: whitish steam and gas, thinning as it drifts off.
      const plume = visual.plume;
      plume.begin();
      for (let index = 0; index < PLUME_PUFFS; index += 1) {
        const phase = index / PLUME_PUFFS;
        const age = (time + phase * PLUME_LIFE) % PLUME_LIFE;
        const p = plumePuff(age, phase, driftX, driftZ, this.point);
        const fire = glow * Math.exp(-p.y / 50) * fireReach * 0.5;
        // Before an eruption the plume swells, thickens and darkens with ash.
        const swell = 1 + precursor * 0.55 * Math.exp(-age / 30);
        const albedo = (0.78 - 0.18 * Math.min(1, p.y / 220)) * (1 - precursor * 0.55);
        plume.push(
          crater.x + p.x,
          crater.y + 4 + p.y,
          crater.z + p.z,
          p.radius * 2.3 * swell,
          albedo,
          albedo * 0.97,
          albedo * 0.95,
          Math.min(0.95, p.opacity * 0.38 * (1 + precursor * 1.6)),
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
            ash.push(crater.x + p.x, crater.y + p.y, crater.z + p.z, p.radius * 2, 0.9, 0.9, 0.92, p.opacity * eruption.strength * 0.7, 0, 0, 0, index / SHOCK_PUFFS);
          }
        }
        // The ash column: dark, dense billows, glowing from below near the vent.
        for (let index = 0; index < ASH_PUFFS; index += 1) {
          const p = ashPuff(eruption.age, index, eruption.slot, eruption.strength, driftX, driftZ, this.ashPoint);
          if (p.opacity <= 0) continue;
          // Lit from below by the fountain: plain to see at night, only a warm
          // tinge low in the column by day.
          const fire = glow * Math.exp(-p.y / 70) * p.fresh * (0.07 + 0.93 * night);
          // Fresh ash is near-black brown; old, dilute ash a lighter grey-brown.
          const albedo = 0.08 + 0.17 * (1 - p.fresh);
          ash.push(
            crater.x + p.x,
            crater.y + 6 + p.y,
            crater.z + p.z,
            p.radius * 2,
            albedo * 1.1,
            albedo,
            albedo * 0.88,
            p.opacity * (0.82 + 0.16 * p.fresh),
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
          // A pyroclastic flow is grey-brown ash; only at night does its hot core show.
          const heat = Math.exp(-p.x / 120) * fireReach * night * 0.7;
          ash.push(px, ground + p.radius * 0.5 + p.y, pz, p.radius * 2, 0.36, 0.33, 0.29, p.opacity * 0.85, 1.4 * heat, 0.38 * heat, 0.08 * heat, (0.37 + index * 0.031) % 1);
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
      visual.jet.material.dispose();
      if (visual.flows) {
        visual.flows.geometry.dispose();
        visual.flows.material.dispose();
      }
      if (visual.lake) {
        visual.lake.geometry.dispose();
        visual.lake.material.dispose();
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
    visual.jet.visible = false;
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
    if (visual.lake) {
      visual.lake.geometry.dispose();
      visual.lake.material.dispose();
      visual.lake.removeFromParent();
      visual.lake = null;
    }
  }

  private attach(visual: Visual, island: IslandDefinition): void {
    visual.island = island;
    visual.lastSlot = Number.NaN;
    const rimHeight = volcanoHeight(VOLCANO_RIM, 0, island.height, island.seed);
    visual.crater.set(island.centerX, rimHeight, island.centerZ);
    visual.flows = this.buildFlows(island);
    this.group.add(visual.flows);
    visual.lake = this.buildLake(island);
    this.group.add(visual.lake);
  }

  /**
   * The lava lake filling the bottom of the crater: a disc following the
   * crater's own outline at the level where the bowl is a little over half
   * its width, with a crust of dark plates drifting on convection cells,
   * glowing seams between them and now and then a bursting bubble.
   */
  private buildLake(island: IslandDefinition): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const radial = VOLCANO_RIM * LAKE_RADIAL;
    const level = volcanoHeight(radial, 0, island.height, island.seed) + 0.25;
    const segments = 72;
    const rings = 6;
    const positions: number[] = [island.centerX, level, island.centerZ];
    for (let ring = 1; ring <= rings; ring += 1) {
      const fraction = ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        // A hand's breadth beyond the shoreline, under the crater wall, so no gap shows.
        const radius = island.beachRadius * radial * islandEdgeNoise(angle, island) * fraction * 1.04;
        positions.push(island.centerX + Math.cos(angle) * radius, level, island.centerZ + Math.sin(angle) * radius * island.scaleZ);
      }
    }
    const indices: number[] = [];
    for (let segment = 0; segment < segments; segment += 1) indices.push(0, 1 + ((segment + 1) % segments), 1 + segment);
    for (let ring = 1; ring < rings; ring += 1) {
      const inner = 1 + (ring - 1) * segments;
      const outer = 1 + ring * segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(inner + segment, inner + next, outer + segment, inner + next, outer + next, outer + segment);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      name: "LavaLake",
      vertexShader: lakeVertex,
      fragmentShader: lakeFragment,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uHeat: { value: 1 },
          uCentre: { value: new THREE.Vector2(island.centerX, island.centerZ) },
          // The lake's mean radius (m) and the island's stretch along z.
          uShape: { value: new THREE.Vector2(island.beachRadius * radial, island.scaleZ) },
        },
      ]),
      fog: true,
      side: THREE.DoubleSide,
    });
    material.uniforms.uTime = this.lavaTime;
    material.uniforms.uHeat = this.lavaHeat;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "LavaLake";
    return mesh;
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
