import * as THREE from "three";
import { islandEdgeNoise, islandsWithin, VOLCANO_RIM, volcanoHeight, type IslandDefinition } from "../environment/IslandMath";
import { smoothstep } from "../math";
import { PuffPoints } from "./PuffPoints";
import {
  BOMBS,
  bombFlight,
  craterGlow,
  ERUPTION_LENGTH,
  eruptionAt,
  PLUME_LIFE,
  plumePuff,
  type Eruption,
  type PlumePoint,
} from "./VolcanoMath";

/**
 * The volcanic islands' fire and smoke: a plume always rising from the
 * crater and bending away downwind, a crater glow that breathes, rivers of
 * lava creeping down the flanks, and every minute or so an eruption — a
 * boom, a fountain of glowing bombs and a darker burst of ash.
 *
 * The cone itself is island terrain (see `IslandMath.volcanoHeight`). At
 * most `MAX_VOLCANOES` in range are animated; their meshes are built once
 * when one comes into range.
 */

const MAX_VOLCANOES = 2;
/** Volcanoes farther than this are not animated (their plume is in the haze). */
const VOLCANO_RANGE = 2600;
const PLUME_PUFFS = 72;
const ASH_PUFFS = 28;
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
  plume: PuffPoints;
  ash: PuffPoints;
  bombs: PuffPoints;
  glow: THREE.Sprite;
  flows: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  /** The slot of the last eruption reported (so each booms once). */
  lastSlot: number;
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
        plume: new PuffPoints(PLUME_PUFFS, { name: "VolcanoPlume", soft: 0.05 }),
        ash: new PuffPoints(ASH_PUFFS, { name: "VolcanoAsh", soft: 0.05 }),
        bombs: new PuffPoints(BOMBS, { name: "LavaBombs", additive: true, soft: 0.3 }),
        glow,
        flows: null,
        lastSlot: Number.NaN,
      };
      this.group.add(visual.plume.points, visual.ash.points, visual.bombs.points, glow);
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

  update(
    time: number,
    delta: number,
    x: number,
    z: number,
    windX: number,
    windZ: number,
    ambient: readonly [number, number, number],
    night: number,
    pixelScale: number,
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
    const skyLight = Math.min(1, (ambient[0] + ambient[1] + ambient[2]) * 1.1);
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
      if (eruption.age >= 0 && eruption.age < 1 && eruption.slot !== visual.lastSlot) {
        visual.lastSlot = eruption.slot;
        this.events.push({ x: crater.x, y: crater.y, z: crater.z, strength: eruption.strength });
      }
      if (visual === this.nearest && eruption.age >= 0) {
        this.nearestStrength = eruption.strength * (1 - smoothstep(ERUPTION_LENGTH, ERUPTION_LENGTH + 5, eruption.age));
      }

      // Crater glow: orange light on the steam above the vent.
      visual.glow.visible = true;
      visual.glow.position.set(crater.x, crater.y + 6, crater.z);
      visual.glow.scale.setScalar(island.beachRadius * (0.32 + 0.12 * glow));
      visual.glow.material.color.setRGB(2.6 * glow, 0.75 * glow, 0.16 * glow, THREE.LinearSRGBColorSpace);
      visual.glow.material.opacity = 0.5 + 0.5 * night;

      // The plume: a column of grey-brown smoke, lit orange from below at night.
      const plume = visual.plume;
      plume.begin();
      for (let index = 0; index < PLUME_PUFFS; index += 1) {
        const phase = index / PLUME_PUFFS;
        const age = (time + phase * PLUME_LIFE) % PLUME_LIFE;
        const p = plumePuff(age, phase, driftX, driftZ, this.point);
        const fire = glow * Math.exp(-p.y / 45) * (0.25 + 0.75 * night);
        // Steam near the vent, greyer and browner with ash as it spreads.
        const grey = (0.1 + skyLight * 0.46) * (1 - 0.25 * Math.min(1, p.y / 200));
        plume.push(
          crater.x + p.x,
          crater.y + 4 + p.y,
          crater.z + p.z,
          p.radius * 2,
          grey * 1.0 + fire * 1.3,
          grey * 0.94 + fire * 0.42,
          grey * 0.88 + fire * 0.1,
          p.opacity * 0.42,
        );
      }
      plume.end(pixelScale);

      // An eruption: a dark burst of ash and a fountain of bombs.
      const ash = visual.ash;
      const bombs = visual.bombs;
      ash.begin();
      bombs.begin();
      if (eruption.age >= 0) {
        for (let index = 0; index < ASH_PUFFS; index += 1) {
          const age = eruption.age - index * 0.22;
          if (age < 0) continue;
          const p = plumePuff(age * 1.8, index / ASH_PUFFS + 0.31, driftX, driftZ, this.point);
          const fire = glow * Math.exp(-p.y / 60) * 0.8;
          const dark = 0.07 + skyLight * 0.3;
          ash.push(crater.x + p.x, crater.y + 4 + p.y, crater.z + p.z, p.radius * 2.4 * eruption.strength, dark + fire * 1.4, dark + fire * 0.45, dark + fire * 0.12, p.opacity * 0.75);
        }
        for (let index = 0; index < BOMBS; index += 1) {
          if (!bombFlight(eruption.age, index, eruption.slot, this.point)) continue;
          const heat = this.point.opacity;
          bombs.push(
            crater.x + this.point.x,
            crater.y + this.point.y,
            crater.z + this.point.z,
            this.point.radius * (1 + heat),
            6 * heat + 0.6,
            2.4 * heat * heat + 0.08,
            0.5 * heat * heat * heat,
            Math.min(1, heat * 1.4),
          );
        }
      }
      ash.end(pixelScale);
      bombs.end(pixelScale);
    }
  }

  dispose(): void {
    for (const visual of this.visuals) {
      visual.plume.dispose();
      visual.ash.dispose();
      visual.bombs.dispose();
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
    visual.plume.points.visible = false;
    visual.ash.points.visible = false;
    visual.bombs.points.visible = false;
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
