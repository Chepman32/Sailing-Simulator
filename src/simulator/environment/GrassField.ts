import * as THREE from "three";
import { patchMaterialShader } from "../core/ShaderPatch";

/**
 * Dense 3D grass round the viewer: thousands of instanced clumps of curved
 * blades over the islands' turf, where the merged tussocks (see
 * `IslandVegetation.buildGrass`) only dot it.
 *
 * - **Placement** is deterministic, on a jittered grid in world space,
 *   worked out per 8 m tile (a few tiles a frame, nearest first) and cached:
 *   walking back over a lawn finds every clump where it was.
 * - **Two levels of detail**: rich clumps (many blades, four segments each)
 *   near the viewer, sparse ones (few blades, two segments) beyond, the
 *   whole field shrinking into the ground toward its edge so there is no
 *   line where it ends.
 * - **Root occlusion**: blades darken toward their roots and toward the
 *   middle of their clump, where light hardly reaches the soil.
 * - **Wind**: gusts roll across the field along the trade wind, bending the
 *   blades from the root (tips furthest), each blade fluttering on its own.
 * - Back-lit blades glow a little where the sun shines through them.
 */

/** Side of a placement tile, m. */
const TILE = 8;
/** Clumps nearer than this (by their tile) use the rich geometry, m. */
const NEAR_RADIUS = 13;
/** Clump spacing at full density, m (sparser presets space them out). */
const BASE_SPACING = 0.34;
/** Most tiles kept worked out (a few islands' lawns). */
const MAX_CACHED_TILES = 420;
/** Tiles worked out per frame at most. */
const TILES_PER_FRAME = 3;
/** Floats per clump in a tile: x, y, z, cos, sin, width, height, r, g, b. */
const STRIDE = 10;

export type GrassWorld = {
  /** How much turf there is at (x, z), 0 bare … 1 lush (0 on sand, rock, clearings, under buildings). */
  amount: (x: number, z: number) => number;
  /** Ground height at (x, z), m. */
  ground: (x: number, z: number) => number;
  /** Whether any island ground lies within the rectangle (a cheap test before a tile is worked out). */
  landIn: (x0: number, z0: number, x1: number, z1: number) => boolean;
};

function hash(a: number, b: number, salt: number): number {
  let h = Math.imul((a | 0) ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul((b | 0) + salt * 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A smooth value noise for the dry and lush swathes. */
function swathe(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, 5);
  const b = hash(ix + 1, iz, 5);
  const c = hash(ix, iz + 1, 5);
  const d = hash(ix + 1, iz + 1, 5);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * One clump: `blades` curved, tapering blades of `segments` segments each,
 * rooted within a small disc, leaning outward. Attributes: `bladeT` (0 at
 * the root … 1 at the tip) and `clumpCentre` (1 at the clump's heart … 0 at
 * its rim) for the occlusion; colours from a dark root to a lighter tip.
 */
export function createClumpGeometry(blades: number, segments: number, seed: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const bladeT: number[] = [];
  const centre: number[] = [];
  const indices: number[] = [];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let blade = 0; blade < blades; blade += 1) {
    const r = Math.sqrt(random()) * 0.16;
    const a = random() * Math.PI * 2;
    const rootX = Math.cos(a) * r;
    const rootZ = Math.sin(a) * r;
    // Leaning out from the clump's heart, with some scatter.
    const heading = a + (random() - 0.5) * 1.2;
    const dx = Math.cos(heading);
    const dz = Math.sin(heading);
    const lean = 0.15 + random() * 0.55 + (r / 0.16) * 0.25;
    const height = 0.32 + random() * 0.38;
    const width = 0.011 + random() * 0.009;
    // Across the blade, square to its lean; the blade faces along its lean.
    const ax = -dz;
    const az = dx;
    const facing = new THREE.Vector3(dx * 0.4, 1, dz * 0.4).normalize();
    const twist = (random() - 0.5) * 0.6;
    const base = indices.length === 0 ? 0 : positions.length / 3;
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      // The blade curves over: the further up, the more it leans.
      const bend = lean * t * t;
      const along = Math.sin(bend) * height * t * 0.9;
      const y = Math.cos(bend * 0.85) * height * t;
      const half = width * (1 - t * 0.92) * (step === segments ? 0.05 : 1);
      const twistX = Math.cos(twist * t);
      const twistZ = Math.sin(twist * t);
      const sideX = ax * twistX - dx * twistZ * 0.3;
      const sideZ = az * twistX - dz * twistZ * 0.3;
      const cx = rootX + dx * along;
      const cz = rootZ + dz * along;
      for (const side of [-1, 1]) {
        positions.push(cx + sideX * half * side, y, cz + sideZ * half * side);
        normals.push(facing.x, facing.y, facing.z);
        // A dark, yellowed root to a fresh green tip (tinted per clump by its instance colour).
        colors.push(0.16 + t * 0.2, 0.26 + t * 0.32, 0.08 + t * 0.07);
        bladeT.push(t);
        centre.push(1 - r / 0.16);
      }
    }
    for (let step = 0; step < segments; step += 1) {
      const i = base + step * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("bladeT", new THREE.Float32BufferAttribute(bladeT, 1));
  geometry.setAttribute("clumpCentre", new THREE.Float32BufferAttribute(centre, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

type Tile = { key: string; tx: number; tz: number; data: Float32Array; count: number; used: number };

export class GrassField {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private near: THREE.InstancedMesh | null = null;
  private far: THREE.InstancedMesh | null = null;
  private readonly tiles = new Map<string, Tile>();
  private radius = 0;
  private spacing = BASE_SPACING;
  private density = 0;
  private assembledX = Number.NaN;
  private assembledZ = Number.NaN;
  private assembledTiles = -1;
  private frame = 0;
  private readonly uniforms = {
    uGrassTime: { value: 0 },
    uGrassWind: { value: new THREE.Vector2(0.851, 0.526) },
    uGrassStrength: { value: 1 },
    uGrassRadius: { value: 30 },
  };

  constructor(
    scene: THREE.Scene,
    private readonly world: GrassWorld,
    sky: Record<string, THREE.IUniform>,
    decorate: (material: THREE.MeshStandardMaterial) => void,
  ) {
    this.group.name = "Grass_Field";
    this.material = new THREE.MeshStandardMaterial({ name: "GrassField", vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
    const uniforms = this.uniforms;
    patchMaterialShader(this.material, "grass-field-v1", (shader) => {
      Object.assign(shader.uniforms, uniforms, { uSunDirection: sky.uSunDirection, uSunColor: sky.uSunColor });
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute float bladeT;
          attribute float clumpCentre;
          uniform float uGrassTime;
          uniform vec2 uGrassWind;
          uniform float uGrassStrength;
          uniform float uGrassRadius;
          varying float vBladeT;
          varying float vClumpCentre;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vBladeT = bladeT;
          vClumpCentre = clumpCentre;
          {
            vec3 rootWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            // The field sinks into the ground toward its edge: no line where it ends.
            float reach = distance(rootWorld.xz, cameraPosition.xz);
            float fade = 1.0 - smoothstep(uGrassRadius * 0.72, uGrassRadius, reach);
            // Gusts roll down the wind across the field; each blade flutters on its own.
            float phase = dot(rootWorld.xz, uGrassWind) * 0.33 - uGrassTime * 2.1;
            float gust = 0.5 + 0.5 * sin(phase) * (0.6 + 0.4 * sin(phase * 0.41 + rootWorld.x * 0.05));
            float flutter = sin(uGrassTime * 6.7 + rootWorld.x * 3.1 + rootWorld.z * 2.3 + position.x * 40.0) * 0.18;
            float bend = uGrassStrength * (0.22 + 0.78 * gust) * bladeT * bladeT;
            // The wind in the clump's own frame (turned and scaled by the instance).
            vec2 axisX = normalize(instanceMatrix[0].xz);
            vec2 axisZ = normalize(instanceMatrix[2].xz);
            vec2 wind = vec2(dot(uGrassWind, axisX), dot(uGrassWind, axisZ));
            vec2 across = vec2(-wind.y, wind.x);
            transformed.xz += (wind * (0.22 * bend) + across * (flutter * 0.04 * bladeT)) ;
            transformed.y -= 0.05 * bend * bend;
            transformed *= fade;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec3 uSunDirection;
          uniform vec3 uSunColor;
          varying float vBladeT;
          varying float vClumpCentre;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          // Root occlusion: the soil and the blades' feet sit in the shade of
          // the clump, darkest at its heart.
          float rootLight = mix(0.28, 1.0, smoothstep(0.0, 0.55, vBladeT));
          rootLight *= mix(1.0, 0.72, vClumpCentre * (1.0 - smoothstep(0.0, 0.4, vBladeT)));
          diffuseColor.rgb *= rootLight;`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          {
            // Translucency: a blade between the eye and the sun glows green-gold.
            vec3 toEyeView = normalize(vViewPosition);
            vec3 sunView = normalize((viewMatrix * vec4(uSunDirection, 0.0)).xyz);
            float through = pow(max(dot(-toEyeView, sunView), 0.0), 3.0) * smoothstep(-0.05, 0.15, uSunDirection.y);
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * through * vBladeT * 0.45;
          }`,
        );
    });
    decorate(this.material);
    scene.add(this.group);
  }

  /** Reach (m) and fraction of the full density; 0 switches the field off. */
  setQuality(radius: number, density: number): void {
    if (radius === this.radius && density === this.density) return;
    this.radius = radius;
    this.density = density;
    this.uniforms.uGrassRadius.value = radius;
    const spacing = density > 0 ? BASE_SPACING / Math.sqrt(density) : BASE_SPACING;
    if (spacing !== this.spacing) {
      this.spacing = spacing;
      this.tiles.clear();
    }
    this.disposeMeshes();
    if (radius <= 0 || density <= 0) return;
    const capacity = (r: number) => Math.ceil((Math.PI * r * r) / (spacing * spacing) * 1.25) + 64;
    const nearReach = NEAR_RADIUS + TILE;
    this.near = new THREE.InstancedMesh(createClumpGeometry(16, 4, 1013), this.material, capacity(nearReach));
    this.far = new THREE.InstancedMesh(createClumpGeometry(6, 2, 2027), this.material, capacity(radius + TILE));
    for (const mesh of [this.near, this.far]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    this.near.name = "Grass_Near";
    this.far.name = "Grass_Far";
    this.assembledTiles = -1;
  }

  /** Forget the worked-out tiles over a rectangle (an island was built or released there). */
  invalidateArea(x0: number, z0: number, x1: number, z1: number): void {
    for (const tile of [...this.tiles.values()]) {
      const tx0 = tile.tx * TILE;
      const tz0 = tile.tz * TILE;
      if (tx0 + TILE < x0 || tx0 > x1 || tz0 + TILE < z0 || tz0 > z1) continue;
      this.tiles.delete(tile.key);
    }
    this.assembledTiles = -1;
  }

  /** One frame: the wind, the tiles round `eye`, and the instances when the view has moved. */
  update(time: number, wind: number, eye: THREE.Vector3, visible: boolean): void {
    this.uniforms.uGrassTime.value = time;
    this.uniforms.uGrassStrength.value = Math.min(2.6, Math.max(0.35, wind));
    this.group.visible = visible && this.near !== null;
    if (!this.near || !this.far || !visible) return;
    this.frame += 1;
    const radius = this.radius;
    const t0 = Math.floor((eye.x - radius) / TILE);
    const t1 = Math.floor((eye.x + radius) / TILE);
    const u0 = Math.floor((eye.z - radius) / TILE);
    const u1 = Math.floor((eye.z + radius) / TILE);
    // Work out the missing tiles nearest first, a few a frame.
    const missing: { tx: number; tz: number; d: number }[] = [];
    let present = 0;
    for (let tz = u0; tz <= u1; tz += 1) {
      for (let tx = t0; tx <= t1; tx += 1) {
        const d = this.tileDistance(tx, tz, eye);
        if (d > radius) continue;
        const tile = this.tiles.get(`${tx},${tz}`);
        if (tile) {
          tile.used = this.frame;
          present += 1;
        } else missing.push({ tx, tz, d });
      }
    }
    if (missing.length > 0) {
      missing.sort((a, b) => a.d - b.d);
      for (const { tx, tz } of missing.slice(0, TILES_PER_FRAME)) {
        this.tiles.set(`${tx},${tz}`, this.buildTile(tx, tz));
        present += 1;
      }
      this.trimCache();
    }
    const moved = Math.hypot(eye.x - this.assembledX, eye.z - this.assembledZ);
    if (present !== this.assembledTiles || !(moved < TILE * 0.5)) this.assemble(eye);
  }

  private tileDistance(tx: number, tz: number, eye: THREE.Vector3): number {
    const nx = Math.max(tx * TILE, Math.min(eye.x, (tx + 1) * TILE));
    const nz = Math.max(tz * TILE, Math.min(eye.z, (tz + 1) * TILE));
    return Math.hypot(nx - eye.x, nz - eye.z);
  }

  private buildTile(tx: number, tz: number): Tile {
    const key = `${tx},${tz}`;
    const x0 = tx * TILE;
    const z0 = tz * TILE;
    if (!this.world.landIn(x0, z0, x0 + TILE, z0 + TILE)) return { key, tx, tz, data: new Float32Array(0), count: 0, used: this.frame };
    const spacing = this.spacing;
    const cells = Math.ceil(TILE / spacing);
    const data = new Float32Array(cells * cells * STRIDE);
    let count = 0;
    const gx0 = Math.floor(x0 / spacing);
    const gz0 = Math.floor(z0 / spacing);
    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        const gx = gx0 + i;
        const gz = gz0 + j;
        const x = (gx + 0.15 + hash(gx, gz, 1) * 0.7) * spacing;
        const z = (gz + 0.15 + hash(gx, gz, 2) * 0.7) * spacing;
        if (x < x0 || x >= x0 + TILE || z < z0 || z >= z0 + TILE) continue;
        const amount = this.world.amount(x, z);
        if (amount <= 0.02 || hash(gx, gz, 3) > amount * 1.15) continue;
        const y = this.world.ground(x, z);
        // Never on the wet beach or in the water.
        if (!(y > 0.35)) continue;
        const yaw = hash(gx, gz, 4) * Math.PI * 2;
        const lush = swathe(x * 0.09 + 17.3, z * 0.09 - 4.1);
        const dry = Math.max(0, Math.min(1, (swathe(x * 0.05 - 3.7, z * 0.05 + 9.2) - 0.45) * 2.2));
        const height = (0.55 + hash(gx, gz, 5) * 0.65) * (0.55 + 0.45 * amount) * (0.85 + lush * 0.35);
        const width = 0.85 + hash(gx, gz, 6) * 0.4;
        const tone = 0.86 + hash(gx, gz, 7) * 0.28;
        const o = count * STRIDE;
        data[o] = x;
        data[o + 1] = y - 0.02;
        data[o + 2] = z;
        data[o + 3] = Math.cos(yaw);
        data[o + 4] = Math.sin(yaw);
        data[o + 5] = width;
        data[o + 6] = height;
        // Lush green, or sun-bleached straw in the dry swathes.
        data[o + 7] = tone * (0.95 + dry * 0.75);
        data[o + 8] = tone * (1.05 + dry * 0.12);
        data[o + 9] = tone * (0.9 - dry * 0.25);
        count += 1;
      }
    }
    return { key, tx, tz, data: data.slice(0, count * STRIDE), count, used: this.frame };
  }

  private trimCache(): void {
    if (this.tiles.size <= MAX_CACHED_TILES) return;
    const oldest = [...this.tiles.values()].sort((a, b) => a.used - b.used);
    for (const tile of oldest.slice(0, this.tiles.size - MAX_CACHED_TILES)) this.tiles.delete(tile.key);
  }

  /** Writes the clumps of the tiles in reach into the near and far meshes. */
  private assemble(eye: THREE.Vector3): void {
    const near = this.near!;
    const far = this.far!;
    this.assembledX = eye.x;
    this.assembledZ = eye.z;
    let nearCount = 0;
    let farCount = 0;
    let tiles = 0;
    const nearMatrix = near.instanceMatrix.array as Float32Array;
    const farMatrix = far.instanceMatrix.array as Float32Array;
    const nearColor = near.instanceColor!.array as Float32Array;
    const farColor = far.instanceColor!.array as Float32Array;
    const nearCapacity = near.instanceMatrix.count;
    const farCapacity = far.instanceMatrix.count;
    for (const tile of this.tiles.values()) {
      const d = this.tileDistance(tile.tx, tile.tz, eye);
      if (d > this.radius) continue;
      tiles += 1;
      if (tile.count === 0) continue;
      const isNear = d < NEAR_RADIUS;
      const data = tile.data;
      for (let k = 0; k < tile.count; k += 1) {
        const o = k * STRIDE;
        let matrix: Float32Array;
        let color: Float32Array;
        let index: number;
        if (isNear && nearCount < nearCapacity) {
          matrix = nearMatrix;
          color = nearColor;
          index = nearCount++;
        } else if (farCount < farCapacity) {
          matrix = farMatrix;
          color = farColor;
          index = farCount++;
        } else continue;
        const c = data[o + 3]!;
        const s = data[o + 4]!;
        const w = data[o + 5]!;
        const h = data[o + 6]!;
        const m = index * 16;
        // Column-major: a turn about the vertical, a scale, a translation.
        matrix[m] = c * w;
        matrix[m + 1] = 0;
        matrix[m + 2] = -s * w;
        matrix[m + 3] = 0;
        matrix[m + 4] = 0;
        matrix[m + 5] = h;
        matrix[m + 6] = 0;
        matrix[m + 7] = 0;
        matrix[m + 8] = s * w;
        matrix[m + 9] = 0;
        matrix[m + 10] = c * w;
        matrix[m + 11] = 0;
        matrix[m + 12] = data[o]!;
        matrix[m + 13] = data[o + 1]!;
        matrix[m + 14] = data[o + 2]!;
        matrix[m + 15] = 1;
        const ci = index * 3;
        color[ci] = data[o + 7]!;
        color[ci + 1] = data[o + 8]!;
        color[ci + 2] = data[o + 9]!;
      }
    }
    this.assembledTiles = tiles;
    near.count = nearCount;
    far.count = farCount;
    for (const mesh of [near, far]) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  private disposeMeshes(): void {
    for (const mesh of [this.near, this.far]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.near = null;
    this.far = null;
  }

  dispose(): void {
    this.disposeMeshes();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
