import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetManager } from "../core/AssetManager";
import { clamp, smoothstep } from "../math";
import {
  createBeamGeometry,
  createHutGeometry,
  createLanternGeometry,
  createLighthouseGeometry,
  createPierGeometry,
  LIGHTHOUSE_HEIGHT,
} from "../world/IslandStructures";
import {
  islandHeight,
  islandPoint,
  lavaMask,
  MAX_VISIBLE_TERRAIN_RADIUS_SCALE,
  seededRandom,
  shorelineScale,
  terrainHeightAt,
  valueNoise2,
} from "../world/IslandTerrain";
import { GALLEON_REEF, ISLANDS, type IslandDefinition } from "../world/WorldLayout";

export { MAX_VISIBLE_TERRAIN_RADIUS_SCALE };

type PalmWindUniform = { value: number };

type PierObstacle = { ax: number; az: number; bx: number; bz: number; radius: number };

const DEEP_WATER_DEPTH = 17.5;
const SEABED_Y = -18;

const PALETTE = {
  sand: new THREE.Color(0xd5b874),
  wetSand: new THREE.Color(0xb39461),
  grass: new THREE.Color(0x4b9a4c),
  forest: new THREE.Color(0x2e6e3a),
  scrub: new THREE.Color(0x6a6a3a),
  rock: new THREE.Color(0x85817a),
  darkRock: new THREE.Color(0x5a564f),
  basalt: new THREE.Color(0x2c2827),
  ash: new THREE.Color(0x574b43),
  scorched: new THREE.Color(0x6a3a28),
  crust: new THREE.Color(0x2b2220),
};

/** Adds world-space colour breakup so large terrain never reads as flat polygons. */
function detailTerrainMaterial(material: THREE.MeshStandardMaterial, lava?: { glow: { value: number }; time: { value: number } }): void {
  material.onBeforeCompile = (shader) => {
    if (lava) {
      shader.uniforms.uLavaGlow = lava.glow;
      shader.uniforms.uLavaTime = lava.time;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vTerrainWorld;
         ${lava ? "attribute float aLava; varying float vLava;" : ""}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         ${lava ? "vLava = aLava;" : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vTerrainWorld;
         ${lava ? "varying float vLava; uniform float uLavaGlow; uniform float uLavaTime;" : ""}
         float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
         float terrainNoise(vec2 p) {
           vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
           return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
                      mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), f.x), f.y);
         }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         float broad = terrainNoise(vTerrainWorld.xz * 0.06);
         float fine = terrainNoise(vTerrainWorld.xz * 0.9 + vTerrainWorld.y * 0.3);
         diffuseColor.rgb *= 0.7 + broad * 0.38 + fine * 0.16;`,
      );
    if (lava) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float flow = terrainNoise(vTerrainWorld.xz * 0.35 + vec2(0.0, -uLavaTime * 0.4)) * 0.6
           + terrainNoise(vTerrainWorld.xz * 1.3 - uLavaTime * 0.2) * 0.4;
         float cracks = smoothstep(0.42, 0.78, flow);
         float lavaHeat = vLava * (0.25 + uLavaGlow * 0.95) * (0.55 + cracks * 0.9);
         totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * lavaHeat * 2.4;`,
      );
    }
  };
  material.customProgramCacheKey = () => (lava ? "terrain-detail-lava-v1" : "terrain-detail-v1");
}

export class IslandSystem {
  private readonly group = new THREE.Group();
  private readonly palmWindUniforms: PalmWindUniform[] = [];
  private readonly seabed: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly pierObstacles: PierObstacle[] = [];
  private readonly lavaGlow = { value: 0 };
  private readonly lavaTime = { value: 0 };
  private readonly beams = new THREE.Group();
  private lanternMaterial?: THREE.MeshStandardMaterial;
  private beamMaterial?: THREE.MeshBasicMaterial;
  private lanternGlow?: THREE.Sprite;
  private glowTexture?: THREE.CanvasTexture;
  readonly lighthouseLantern = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
  ) {
    this.group.name = "TropicalIslandSystem";
    scene.add(this.group);
    this.seabed = this.createSeabed();
    ISLANDS.forEach((island) => this.createIsland(island));
    this.createReef();
    this.createPalms(assets);
    this.createRocks();
    this.createStructures();
  }

  get islands(): readonly IslandDefinition[] {
    return ISLANDS;
  }

  /** Lava emission strength 0…1, driven by the volcano eruption cycle. */
  setLavaGlow(value: number): void {
    this.lavaGlow.value = clamp(value, 0, 1);
  }

  update(time: number, focus?: THREE.Vector3, nightFactor = 0): void {
    this.palmWindUniforms.forEach((uniform) => {
      uniform.value = time;
    });
    this.lavaTime.value = time;
    if (focus) {
      // The seabed follows the yacht in coarse steps, like the ocean grid.
      this.seabed.position.x = Math.round(focus.x / 100) * 100;
      this.seabed.position.z = Math.round(focus.z / 100) * 100;
    }
    const night = smoothstep(0.15, 0.6, nightFactor);
    if (this.lanternMaterial) this.lanternMaterial.emissiveIntensity = 0.4 + night * 3.2;
    if (this.beamMaterial) this.beamMaterial.opacity = night * 0.32;
    if (this.lanternGlow) (this.lanternGlow.material as THREE.SpriteMaterial).opacity = 0.15 + night * 0.85;
    this.beams.visible = night > 0.02;
    this.beams.rotation.y = time * 0.9;
  }

  terrainHeightAt(x: number, z: number): number {
    return terrainHeightAt(ISLANDS, x, z);
  }

  depthAt(x: number, z: number): number {
    const deepWater = DEEP_WATER_DEPTH + Math.sin(x * 0.006) * 1.7 + Math.cos(z * 0.005) * 1.2;
    let depth = deepWater;
    for (const island of ISLANDS) {
      const dx = x - island.x;
      const dz = (z - island.z) / island.scaleZ;
      const distanceFromBeach = Math.hypot(dx, dz) - island.beachRadius;
      if (distanceFromBeach < 34) {
        const localDepth = 0.38 + Math.max(0, distanceFromBeach) * 0.46;
        depth = Math.min(depth, localDepth);
      }
    }
    depth = Math.min(depth, reefDepthAt(x, z));
    return clamp(depth, 0.35, 24);
  }

  avoidanceForce(position: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    target.set(0, 0, 0);
    for (const island of ISLANDS) {
      const dx = position.x - island.x;
      const dz = (position.z - island.z) / island.scaleZ;
      const distance = Math.hypot(dx, dz) || 0.001;
      const clearance = distance - island.beachRadius;
      const approach = velocity.x * (-dx / distance) + velocity.z * (-dz / distance);
      if (clearance < 18 && approach > -0.2) {
        const strength = smoothstep(18, 1.5, clearance) * (8 + Math.max(0, approach) * 4.2);
        target.x += (dx / distance) * strength;
        target.z += (dz / distance) * strength / island.scaleZ;
      }
    }
    return target;
  }

  constrainToWater(position: THREE.Vector3, velocity: THREE.Vector3): boolean {
    let collided = false;
    for (const island of ISLANDS) {
      const dx = position.x - island.x;
      const scaledZ = (position.z - island.z) / island.scaleZ;
      const distance = Math.hypot(dx, scaledZ) || 0.001;
      const safeRadius = island.beachRadius + 2.25;
      if (distance >= safeRadius) continue;
      collided = true;
      const nx = dx / distance;
      const nz = scaledZ / distance;
      position.x = island.x + nx * safeRadius;
      position.z = island.z + nz * safeRadius * island.scaleZ;
      const inwardVelocity = velocity.x * nx + velocity.z * nz;
      if (inwardVelocity < 0) {
        velocity.x -= nx * inwardVelocity * 1.45;
        velocity.z -= nz * inwardVelocity * 1.45;
      }
      velocity.multiplyScalar(0.68);
    }
    for (const pier of this.pierObstacles) {
      const abx = pier.bx - pier.ax;
      const abz = pier.bz - pier.az;
      const t = clamp(((position.x - pier.ax) * abx + (position.z - pier.az) * abz) / (abx * abx + abz * abz), 0, 1);
      const cx = pier.ax + abx * t;
      const cz = pier.az + abz * t;
      const dx = position.x - cx;
      const dz = position.z - cz;
      const distance = Math.hypot(dx, dz) || 0.001;
      if (distance >= pier.radius) continue;
      collided = true;
      const nx = dx / distance;
      const nz = dz / distance;
      position.x = cx + nx * pier.radius;
      position.z = cz + nz * pier.radius;
      const inward = velocity.x * nx + velocity.z * nz;
      if (inward < 0) {
        velocity.x -= nx * inward * 1.4;
        velocity.z -= nz * inward * 1.4;
      }
      velocity.multiplyScalar(0.7);
    }
    return collided;
  }

  nearestShoreDirection(position: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    let nearestDistance = Number.POSITIVE_INFINITY;
    target.set(0, 0, 1);
    for (const island of ISLANDS) {
      const dx = position.x - island.x;
      const dz = (position.z - island.z) / island.scaleZ;
      const distance = Math.hypot(dx, dz);
      const clearance = distance - island.beachRadius;
      if (clearance < nearestDistance) {
        nearestDistance = clearance;
        target.set(dx, 0, dz / island.scaleZ).normalize();
      }
    }
    return target;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.glowTexture?.dispose();
  }

  private createSeabed(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
    const seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xb99a60, roughness: 0.98, metalness: 0 }),
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = SEABED_Y;
    seabed.receiveShadow = true;
    seabed.name = "DeepTropicalSeabed";
    this.group.add(seabed);
    return seabed;
  }

  private createIsland(island: IslandDefinition): void {
    const volcano = island.kind === "volcano";
    const geometry = this.createIslandTerrain(island);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: volcano ? 0.92 : 0.96,
      metalness: 0,
      transparent: true,
      alphaTest: 0.015,
      depthWrite: true,
      emissive: volcano ? 0x000000 : 0x000000,
    });
    detailTerrainMaterial(material, volcano ? { glow: this.lavaGlow, time: this.lavaTime } : undefined);
    const terrain = new THREE.Mesh(geometry, material);
    terrain.position.set(island.x, 0, island.z);
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    terrain.name = `IslandTerrain_${island.id}`;
    // The ocean is rendered immediately after this mesh. Vertex alpha tapers
    // the submerged apron into the seabed so its final radial edge cannot read
    // as a large ring (or as a dark, flat animal) through clear tropical water.
    terrain.renderOrder = 1;
    this.group.add(terrain);
  }

  private createIslandTerrain(island: IslandDefinition): THREE.BufferGeometry {
    const detail =
      island.kind === "volcano"
        ? { segments: 200, rings: 84, exponent: 1.25 }
        : island.kind === "islet"
          ? { segments: 64, rings: 18, exponent: 1 }
          : { segments: 128, rings: 36, exponent: 1.05 };
    const { segments, rings, exponent } = detail;
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    const positions: number[] = [];
    const colors: number[] = [];
    const lava: number[] = [];
    const indices: number[] = [];
    const color = new THREE.Color();
    const push = (radial: number, angle: number): void => {
      const point = islandPoint(island, radial, angle);
      positions.push(point.x - island.x, point.y, point.z - island.z);
      this.terrainColor(island, radial, angle, point.y, color);
      const alpha = 1 - smoothstep(0.965, outerRadius, radial);
      colors.push(color.r, color.g, color.b, alpha);
      lava.push(lavaMask(island, radial, angle));
    };

    push(0, 0);
    for (let ring = 1; ring <= rings; ring += 1) {
      const radial = outerRadius * Math.pow(ring / rings, exponent);
      for (let segment = 0; segment < segments; segment += 1) {
        push(radial, (segment / segments) * Math.PI * 2);
      }
    }
    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(0, 1 + ((segment + 1) % segments), 1 + segment);
    }
    for (let ring = 1; ring < rings; ring += 1) {
      const innerStart = 1 + (ring - 1) * segments;
      const outerStart = 1 + ring * segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(
          innerStart + segment,
          innerStart + next,
          outerStart + segment,
          innerStart + next,
          outerStart + next,
          outerStart + segment,
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    if (island.kind === "volcano") geometry.setAttribute("aLava", new THREE.Float32BufferAttribute(lava, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private terrainColor(island: IslandDefinition, radial: number, angle: number, height: number, target: THREE.Color): THREE.Color {
    const epsilon = 0.012;
    const radius = island.beachRadius * shorelineScale(island, angle);
    const slope = Math.abs(
      islandHeight(island, radial + epsilon, angle) - islandHeight(island, Math.max(0, radial - epsilon), angle),
    ) / (2 * epsilon * radius);
    const nx = Math.cos(angle) * radial;
    const nz = Math.sin(angle) * radial;
    const variation = valueNoise2(nx * 7, nz * 7, island.seed + 4);
    if (radial >= 1) return target.copy(PALETTE.sand).lerp(PALETTE.wetSand, smoothstep(1, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, radial));
    const beach = smoothstep(0.86, 0.95, radial);

    switch (island.kind) {
      case "volcano": {
        const fraction = height / island.peakHeight;
        if (fraction < 0.05) target.copy(PALETTE.forest).lerp(PALETTE.grass, variation);
        else if (fraction < 0.22) target.copy(PALETTE.forest).lerp(PALETTE.scrub, smoothstep(0.1, 0.22, fraction) * 0.7 + variation * 0.2);
        else if (fraction < 0.5) target.copy(PALETTE.scrub).lerp(PALETTE.ash, smoothstep(0.22, 0.42, fraction));
        else if (fraction < 0.8) target.copy(PALETTE.ash).lerp(PALETTE.basalt, smoothstep(0.5, 0.8, fraction) * 0.8 + variation * 0.15);
        else target.copy(PALETTE.basalt).lerp(PALETTE.scorched, smoothstep(0.82, 0.9, fraction) * 0.6);
        if (radial < 0.07) target.copy(PALETTE.scorched).lerp(PALETTE.crust, 0.6);
        const lava = lavaMask(island, radial, angle);
        if (lava > 0) target.lerp(PALETTE.crust, lava);
        if (slope > 0.9) target.lerp(PALETTE.darkRock, 0.35);
        break;
      }
      case "hill": {
        target.copy(PALETTE.grass).lerp(PALETTE.forest, smoothstep(2, 9, height) * 0.8 + variation * 0.2);
        if (slope > 0.55) target.lerp(PALETTE.rock, smoothstep(0.55, 0.95, slope) * 0.7);
        break;
      }
      case "rocky": {
        target.copy(PALETTE.rock).lerp(PALETTE.darkRock, variation * 0.6);
        if (slope < 0.35 && height > 3) target.lerp(PALETTE.grass, 0.55 * (1 - variation * 0.5));
        break;
      }
      case "atoll": {
        target.copy(PALETTE.sand).lerp(PALETTE.grass, (1 - smoothstep(0.2, 0.62, radial)) * (0.6 + variation * 0.4));
        break;
      }
      case "islet": {
        target.copy(PALETTE.darkRock).lerp(PALETTE.rock, variation);
        break;
      }
    }
    return target.lerp(PALETTE.sand, beach * (island.kind === "rocky" || island.kind === "islet" ? 0.7 : 1));
  }

  private createReef(): void {
    const reef = GALLEON_REEF;
    const segments = 96;
    const rings = 22;
    const positions: number[] = [0, -reef.topDepth, 0];
    const colors: number[] = [];
    const indices: number[] = [];
    const color = new THREE.Color();
    const coralA = new THREE.Color(0xd77f6a);
    const coralB = new THREE.Color(0x9c6bb0);
    const sand = new THREE.Color(0xd8c48e);
    colors.push(sand.r, sand.g, sand.b, 1);
    for (let ring = 1; ring <= rings; ring += 1) {
      const t = ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const radius = reef.radius * t * (1 + Math.sin(angle * 5 + 1.3) * 0.06);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const y = -reefDepthAt(reef.x + x, reef.z + z) + (valueNoise2(x * 0.12, z * 0.12, 5) - 0.5) * 0.8;
        positions.push(x, y, z);
        const patch = valueNoise2(x * 0.08, z * 0.08, 9);
        color.copy(sand);
        if (patch > 0.62) color.lerp(coralA, smoothstep(0.62, 0.8, patch));
        else if (patch < 0.3) color.lerp(coralB, smoothstep(0.3, 0.12, patch) * 0.8);
        colors.push(color.r, color.g, color.b, 1 - smoothstep(0.8, 1, t));
      }
    }
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
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, alphaTest: 0.015 });
    detailTerrainMaterial(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(reef.x, 0, reef.z);
    mesh.renderOrder = 1;
    mesh.name = "GalleonReef";
    this.group.add(mesh);
  }

  /** Individual palms: every tree gets its own lean, height and heading. */
  private createPalms(assets: AssetManager): void {
    const source = assets.palms();
    source.updateMatrixWorld(true);
    type Variant = { parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>; height: number };
    const variants: Variant[] = [];
    // The GLB wraps its five palm variants in a RootNode; each child is one tree.
    let holder: THREE.Object3D = source;
    while (holder.children.length === 1 && !(holder.children[0] instanceof THREE.Mesh)) holder = holder.children[0];
    holder.children.forEach((node) => {
      const saved = node.position.clone();
      node.position.set(0, 0, 0);
      node.updateMatrixWorld(true);
      const parts: Variant["parts"] = [];
      const bounds = new THREE.Box3();
      node.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = (object.geometry as THREE.BufferGeometry).clone().applyMatrix4(object.matrixWorld);
        geometry.computeBoundingBox();
        if (geometry.boundingBox) bounds.union(geometry.boundingBox);
        parts.push({ geometry, material: object.material as THREE.Material });
      });
      node.position.copy(saved);
      if (parts.length === 0 || bounds.isEmpty()) return;
      parts.forEach((part) => part.geometry.translate(0, -bounds.min.y, 0));
      variants.push({ parts, height: bounds.max.y - bounds.min.y });
    });
    if (variants.length === 0) return;

    type Placement = { matrix: THREE.Matrix4; variant: number };
    const placements: Placement[] = [];
    const quaternion = new THREE.Quaternion();
    const lean = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (const island of ISLANDS) {
      const random = seededRandom(island.seed * 3 + 1);
      const range: [number, number] =
        island.kind === "volcano" ? [0.8, 0.94] : island.kind === "atoll" ? [0.08, 0.8] : island.kind === "rocky" ? [0.3, 0.72] : [0.2, 0.86];
      let attempts = 0;
      let placed = 0;
      while (placed < island.palms && attempts < island.palms * 12) {
        attempts += 1;
        const angle = random() * Math.PI * 2;
        const radial = range[0] + (range[1] - range[0]) * Math.sqrt(random());
        const point = islandPoint(island, radial, angle);
        const slope = Math.abs(islandHeight(island, radial + 0.02, angle) - islandHeight(island, radial - 0.02, angle)) / (0.04 * island.beachRadius);
        if (slope > 0.75 || point.y < 0.4) continue;
        if (this.nearStructure(island, point.x, point.z, 7)) continue;
        const variant = Math.floor(random() * variants.length);
        const height = 7 + random() * 5.5;
        const factor = height / variants[variant].height;
        // Palms lean seaward, more strongly near the beach.
        const outward = axis.set(Math.cos(angle), 0, Math.sin(angle) * island.scaleZ).normalize();
        const tilt = (0.05 + random() * 0.18) + smoothstep(0.6, 0.95, radial) * 0.16;
        lean.setFromAxisAngle(new THREE.Vector3(outward.z, 0, -outward.x), tilt);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2).premultiply(lean);
        scale.set(factor * (0.9 + random() * 0.2), factor, factor * (0.9 + random() * 0.2));
        position.set(point.x, point.y - 0.2, point.z);
        placements.push({ matrix: new THREE.Matrix4().compose(position, quaternion, scale), variant });
        placed += 1;
      }
    }

    variants.forEach((variant, variantIndex) => {
      const matrices = placements.filter((placement) => placement.variant === variantIndex).map((placement) => placement.matrix);
      if (matrices.length === 0) return;
      variant.parts.forEach(({ geometry, material: sourceMaterial }) => {
        const material = sourceMaterial.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.offsetHSL(0, 0.18, 0.06);
          material.roughness = 0.86;
        }
        const timeUniform: PalmWindUniform = { value: 0 };
        this.palmWindUniforms.push(timeUniform);
        const height = variant.height;
        material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
          shader.uniforms.uPalmTime = timeUniform;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uPalmTime;")
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
               float windWeight = smoothstep(0.0, ${height.toFixed(2)}, position.y);
               windWeight *= windWeight;
               #ifdef USE_INSTANCING
                 vec2 palmOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
               #else
                 vec2 palmOrigin = vec2(0.0);
               #endif
               float palmPhase = uPalmTime * 1.35 + dot(palmOrigin, vec2(0.13, 0.21)) + position.y * 0.6;
               transformed.x += sin(palmPhase) * 0.09 * windWeight;
               transformed.z += cos(palmPhase * 0.73) * 0.06 * windWeight;`,
            );
        };
        material.customProgramCacheKey = () => `palm-wind-instanced-v3-${height.toFixed(2)}`;
        const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
        matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.name = `PalmInstances_${variantIndex}`;
        this.group.add(mesh);
      });
    });
  }

  private createRocks(): void {
    const base = new THREE.IcosahedronGeometry(1, 2);
    base.deleteAttribute("uv");
    base.deleteAttribute("normal");
    const merged = mergeVertices(base);
    base.dispose();
    const positions = merged.getAttribute("position") as THREE.BufferAttribute;
    const vertex = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index);
      const n = valueNoise2(vertex.x * 1.7 + 3, vertex.z * 1.7 + vertex.y * 1.3, 2) * 0.55 + valueNoise2(vertex.x * 4, vertex.y * 4, 8) * 0.18;
      vertex.multiplyScalar(0.72 + n);
      vertex.y *= vertex.y < 0 ? 0.6 : 1;
      positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    merged.computeVertexNormals();

    type Rock = { matrix: THREE.Matrix4; color: THREE.Color };
    const rocks: Rock[] = [];
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (const island of ISLANDS) {
      const random = seededRandom(island.seed * 7 + 5);
      for (let index = 0; index < island.rocks; index += 1) {
        const shoreline = island.kind === "rocky" ? index % 3 !== 0 : index % 4 !== 0;
        const angle = random() * Math.PI * 2;
        const radial = shoreline ? 0.92 + random() * 0.11 : 0.35 + random() * 0.5;
        const point = islandPoint(island, radial, angle);
        if (this.nearStructure(island, point.x, point.z, 5)) continue;
        const size = (island.kind === "volcano" ? 1.6 : 0.8) + random() * (island.kind === "rocky" ? 2.6 : 1.8);
        euler.set(random() * 0.5, random() * Math.PI * 2, random() * 0.5);
        quaternion.setFromEuler(euler);
        const scale = new THREE.Vector3(size * (0.8 + random() * 0.6), size * (0.55 + random() * 0.5), size * (0.8 + random() * 0.6));
        const position = new THREE.Vector3(point.x, point.y - scale.y * 0.25, point.z);
        const tone = 0.11 + random() * 0.1;
        const color = island.kind === "volcano" ? new THREE.Color(tone * 0.55, tone * 0.5, tone * 0.48) : new THREE.Color(tone, tone * 0.97, tone * 0.92);
        rocks.push({ matrix: new THREE.Matrix4().compose(position, quaternion, scale), color });
      }
    }
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, flatShading: false });
    detailTerrainMaterial(material);
    const mesh = new THREE.InstancedMesh(merged, material, rocks.length);
    rocks.forEach((rock, index) => {
      mesh.setMatrixAt(index, rock.matrix);
      mesh.setColorAt(index, rock.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.name = "IslandRocks";
    this.group.add(mesh);
  }

  private nearStructure(island: IslandDefinition, x: number, z: number, radius: number): boolean {
    const features = [island.hut, island.lighthouse].filter((feature): feature is { angle: number; radial: number } => Boolean(feature));
    for (const feature of features) {
      const point = islandPoint(island, feature.radial, feature.angle);
      if (Math.hypot(point.x - x, point.z - z) < radius + 3) return true;
    }
    if (island.pier) {
      const root = islandPoint(island, 0.93, island.pier.angle);
      if (Math.hypot(root.x - x, root.z - z) < radius + 4) return true;
    }
    return false;
  }

  private createStructures(): void {
    const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    for (const island of ISLANDS) {
      if (island.pier) {
        const root = islandPoint(island, 0.93, island.pier.angle);
        const outward = new THREE.Vector2(Math.cos(island.pier.angle), Math.sin(island.pier.angle) * island.scaleZ).normalize();
        const pier = new THREE.Mesh(createPierGeometry(island.pier.length, 1.15, 5), wood);
        pier.position.set(root.x, 0, root.z);
        pier.rotation.y = Math.atan2(outward.x, outward.y);
        pier.castShadow = true;
        pier.receiveShadow = true;
        pier.name = `Pier_${island.id}`;
        this.group.add(pier);
        const end = new THREE.Vector2(root.x, root.z).addScaledVector(outward, island.pier.length);
        this.pierObstacles.push({ ax: root.x, az: root.z, bx: end.x, bz: end.y, radius: 3.2 });
      }
      if (island.hut) {
        const point = islandPoint(island, island.hut.radial, island.hut.angle);
        const hut = new THREE.Mesh(createHutGeometry(), wood);
        hut.position.set(point.x, point.y - 0.2, point.z);
        // Doorway faces the sea.
        hut.rotation.y = Math.atan2(Math.cos(island.hut.angle), Math.sin(island.hut.angle) * island.scaleZ);
        hut.castShadow = true;
        hut.receiveShadow = true;
        hut.name = `Hut_${island.id}`;
        this.group.add(hut);
      }
      if (island.lighthouse) {
        const point = islandPoint(island, island.lighthouse.radial, island.lighthouse.angle);
        const base = new THREE.Vector3(point.x, point.y - 0.3, point.z);
        const tower = new THREE.Mesh(createLighthouseGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
        tower.position.copy(base);
        tower.castShadow = true;
        tower.receiveShadow = true;
        tower.name = "Lighthouse";
        this.group.add(tower);
        this.lanternMaterial = new THREE.MeshStandardMaterial({
          color: 0xfff1c4,
          emissive: 0xffd77a,
          emissiveIntensity: 0.4,
          roughness: 0.1,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const lantern = new THREE.Mesh(createLanternGeometry(), this.lanternMaterial);
        lantern.position.copy(base);
        this.group.add(lantern);
        this.lighthouseLantern.set(base.x, base.y + LIGHTHOUSE_HEIGHT - 3 + 1.05, base.z);
        this.beamMaterial = new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        });
        const beamGeometry = createBeamGeometry();
        const beamA = new THREE.Mesh(beamGeometry, this.beamMaterial);
        const beamB = new THREE.Mesh(beamGeometry.clone(), this.beamMaterial);
        beamB.rotation.y = Math.PI;
        this.beams.add(beamA, beamB);
        this.beams.position.copy(this.lighthouseLantern);
        this.beams.renderOrder = 4;
        this.beams.name = "LighthouseBeams";
        this.group.add(this.beams);
        this.glowTexture = glowTexture();
        this.lanternGlow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: 0xffe2a0,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false,
          }),
        );
        this.lanternGlow.scale.set(14, 14, 1);
        this.lanternGlow.position.copy(this.lighthouseLantern);
        this.lanternGlow.renderOrder = 4;
        this.group.add(this.lanternGlow);
      }
    }
  }
}

/** Seabed depth over the galleon reef (metres below the surface). */
export function reefDepthAt(x: number, z: number): number {
  const reef = GALLEON_REEF;
  const distance = Math.hypot(x - reef.x, z - reef.z) / reef.radius;
  if (distance >= 1) return DEEP_WATER_DEPTH + 4;
  return reef.topDepth + (DEEP_WATER_DEPTH - reef.topDepth) * smoothstep(0.35, 1, distance);
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}
