import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { clamp, smoothstep } from "../math";
import {
  createHut,
  createLighthouse,
  createPier,
  createPropMaterials,
  createRockGeometry,
  type Lighthouse,
  type PropMaterials,
} from "./IslandProps";
import {
  BEACH_START,
  ISLANDS as ISLAND_DEFINITIONS,
  LANDMARKS,
  MAX_VISIBLE_TERRAIN_RADIUS_SCALE,
  islandHeight,
  islandLocalPoint,
  islandWorldPoint,
  isPlantable,
  terrainSlope,
  type IslandDefinition,
} from "./IslandShape";

export { MAX_VISIBLE_TERRAIN_RADIUS_SCALE } from "./IslandShape";

type IslandObstacle = {
  center: THREE.Vector2;
  beachRadius: number;
  scaleZ: number;
};

type PalmWindUniform = { value: number };

type PalmVariant = {
  parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
};

type PierObstacle = { start: THREE.Vector2; end: THREE.Vector2; halfWidth: number };

const ISLANDS: readonly IslandObstacle[] = ISLAND_DEFINITIONS.map((island) => ({
  center: new THREE.Vector2(island.centerX, island.centerZ),
  beachRadius: island.beachRadius,
  scaleZ: island.scaleZ,
}));

const PALM_COUNTS: Record<IslandDefinition["style"], number> = { volcanic: 28, hills: 24, cay: 30 };
const ROCK_COUNTS: Record<IslandDefinition["style"], number> = { volcanic: 18, hills: 16, cay: 6 };
const PIER_LENGTH = 16;
const PIER_DECK_HEIGHT = 1.15;
// Hull half-beam plus margin kept clear of the pier's centerline.
const PIER_CLEARANCE = 4.2;

function seededRandom(seed: number): () => number {
  let state = Math.floor(seed * 9973 + 17) % 2147483647;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export class IslandSystem {
  private readonly group = new THREE.Group();
  private readonly palmWindUniform: PalmWindUniform = { value: 0 };
  private readonly propMaterials: PropMaterials = createPropMaterials();
  private readonly lighthouses: Lighthouse[] = [];
  private readonly piers: PierObstacle[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
  ) {
    this.group.name = "TropicalIslandSystem";
    scene.add(this.group);
    this.createSeabed();
    const palmVariants = this.extractPalmVariants(assets);
    const rockGeometry = createRockGeometry();
    this.ownedGeometries.push(rockGeometry);
    ISLAND_DEFINITIONS.forEach((island, index) => {
      this.createIsland(island, index);
      this.plantPalms(island, palmVariants);
      this.scatterRocks(island, rockGeometry);
    });
    this.createLandmarks();
  }

  update(time: number, nightFactor = 0): void {
    this.palmWindUniform.value = time;
    const night = smoothstep(0.25, 0.8, nightFactor);
    this.propMaterials.beam.opacity = night * 0.22;
    this.propMaterials.lamp.color.setRGB(0.55 + night * 0.45, 0.5 + night * 0.44, 0.38 + night * 0.38);
    this.lighthouses.forEach((lighthouse) => {
      lighthouse.beam.visible = night > 0.02;
      lighthouse.beam.rotation.y = time * 0.62;
    });
  }

  depthAt(x: number, z: number): number {
    const deepWater = 17.5 + Math.sin(x * 0.006) * 1.7 + Math.cos(z * 0.005) * 1.2;
    let depth = deepWater;
    for (const island of ISLANDS) {
      const dx = x - island.center.x;
      const dz = (z - island.center.y) / island.scaleZ;
      const distanceFromBeach = Math.hypot(dx, dz) - island.beachRadius;
      if (distanceFromBeach < 34) {
        const localDepth = 0.38 + Math.max(0, distanceFromBeach) * 0.46;
        depth = Math.min(depth, localDepth);
      }
    }
    return clamp(depth, 0.35, 24);
  }

  avoidanceForce(position: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    target.set(0, 0, 0);
    for (const island of ISLANDS) {
      const dx = position.x - island.center.x;
      const dz = (position.z - island.center.y) / island.scaleZ;
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
      const dx = position.x - island.center.x;
      const scaledZ = (position.z - island.center.y) / island.scaleZ;
      const distance = Math.hypot(dx, scaledZ) || 0.001;
      const safeRadius = island.beachRadius + 2.25;
      if (distance >= safeRadius) continue;
      collided = true;
      const nx = dx / distance;
      const nz = scaledZ / distance;
      position.x = island.center.x + nx * safeRadius;
      position.z = island.center.y + nz * safeRadius * island.scaleZ;
      const inwardVelocity = velocity.x * nx + velocity.z * nz;
      if (inwardVelocity < 0) {
        velocity.x -= nx * inwardVelocity * 1.45;
        velocity.z -= nz * inwardVelocity * 1.45;
      }
      velocity.multiplyScalar(0.68);
    }
    for (const pier of this.piers) {
      const dx = pier.end.x - pier.start.x;
      const dz = pier.end.y - pier.start.y;
      const lengthSquared = dx * dx + dz * dz;
      const t = clamp(((position.x - pier.start.x) * dx + (position.z - pier.start.y) * dz) / lengthSquared, 0, 1);
      const closestX = pier.start.x + dx * t;
      const closestZ = pier.start.y + dz * t;
      const offsetX = position.x - closestX;
      const offsetZ = position.z - closestZ;
      const distance = Math.hypot(offsetX, offsetZ) || 0.001;
      const safe = pier.halfWidth + PIER_CLEARANCE;
      if (distance >= safe) continue;
      collided = true;
      const nx = offsetX / distance;
      const nz = offsetZ / distance;
      position.x = closestX + nx * safe;
      position.z = closestZ + nz * safe;
      const inwardVelocity = velocity.x * nx + velocity.z * nz;
      if (inwardVelocity < 0) {
        velocity.x -= nx * inwardVelocity * 1.45;
        velocity.z -= nz * inwardVelocity * 1.45;
      }
      velocity.multiplyScalar(0.68);
    }
    return collided;
  }

  nearestShoreDirection(position: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    let nearestDistance = Number.POSITIVE_INFINITY;
    target.set(0, 0, 1);
    for (const island of ISLANDS) {
      const dx = position.x - island.center.x;
      const dz = (position.z - island.center.y) / island.scaleZ;
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
    const geometries = new Set<THREE.BufferGeometry>(this.ownedGeometries);
    const materials = new Set<THREE.Material>(this.ownedMaterials);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    Object.values(this.propMaterials).forEach((material) => materials.add(material));
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  private createSeabed(): void {
    const seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xb99a60, roughness: 0.98, metalness: 0 }),
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = -18;
    // Shadows 18 m down are invisible through the water column, but the
    // shadow frustum's edge printed a dark square on the seabed from above.
    seabed.receiveShadow = false;
    seabed.name = "DeepTropicalSeabed";
    this.group.add(seabed);
  }

  private createIsland(island: IslandDefinition, index: number): void {
    const islandGroup = new THREE.Group();
    islandGroup.position.set(island.centerX, 0, island.centerZ);
    islandGroup.name = `TropicalIsland_${index + 1}_${island.style}`;

    const terrain = new THREE.Mesh(
      this.createIslandTerrain(island),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.97,
        metalness: 0,
        transparent: true,
        alphaTest: 0.015,
        depthWrite: true,
      }),
    );
    terrain.receiveShadow = true;
    terrain.castShadow = island.style !== "cay";
    terrain.name = "IrregularIslandTerrain";
    // The ocean is rendered immediately after this mesh. Vertex alpha tapers
    // the submerged apron into the seabed so its final radial edge cannot read
    // as a large ring (or as a dark, flat animal) through clear tropical water.
    terrain.renderOrder = 1;
    islandGroup.add(terrain);
    this.group.add(islandGroup);
  }

  private createIslandTerrain(island: IslandDefinition): THREE.BufferGeometry {
    const segments = 112;
    const rings = 30;
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    const positions: number[] = [0, islandHeight(island, 0, 0), 0];
    const colors: number[] = [];
    const indices: number[] = [];
    const sand = new THREE.Color(0xd9bd78);
    const wetSand = new THREE.Color(0xc2a368);
    const deepSand = new THREE.Color(0xb99a60);
    const grass = new THREE.Color(0x5fa64e);
    const forest = new THREE.Color(0x2c7442);
    const rock = new THREE.Color(island.style === "volcanic" ? 0x5e5046 : 0x8b8377);
    const crater = new THREE.Color(0x3b322c);
    const color = new THREE.Color();
    const pushColor = (radial: number, angle: number, height: number, alpha: number): void => {
      const slope = terrainSlope(island, radial, angle);
      const { x, z } = islandLocalPoint(island, radial, angle);
      const variation =
        0.5 + 0.3 * Math.sin(x * 0.21 + island.seed * 3) * Math.sin(z * 0.17 - island.seed) + 0.2 * Math.sin((x + z) * 0.47);
      if (radial >= BEACH_START) {
        color.copy(sand).lerp(wetSand, smoothstep(0.95, 1, radial)).lerp(deepSand, smoothstep(1, outerRadius, radial));
      } else {
        color.copy(grass).lerp(forest, smoothstep(0.25, 0.75, variation) * smoothstep(1.2, 5, height));
        const rocky = Math.max(smoothstep(0.55, 0.95, slope), island.style === "volcanic" ? smoothstep(11, 15, height) : 0);
        color.lerp(rock, rocky);
        if (island.style === "volcanic") color.lerp(crater, 1 - smoothstep(0.03, 0.09, radial));
        // Dry grass and sand meet at the vegetation line just above the beach.
        color.lerp(sand, smoothstep(BEACH_START - 0.14, BEACH_START, radial) * (1 - smoothstep(1.6, 3, height)));
      }
      colors.push(color.r, color.g, color.b, alpha);
    };
    pushColor(0, 0, positions[1], 1);

    for (let ring = 1; ring <= rings; ring += 1) {
      // Denser rings toward the shoreline where colour and slope change fastest.
      const t = ring / rings;
      const radial = outerRadius * (1 - (1 - t) * (1 - t) * 0.55 - (1 - t) * 0.45);
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        const { x, z } = islandLocalPoint(island, radial, angle);
        const y = islandHeight(island, radial, angle);
        positions.push(x, y, z);
        pushColor(radial, angle, y, 1 - smoothstep(0.965, outerRadius, radial));
      }
    }

    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(0, 1 + (segment + 1) % segments, 1 + segment);
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
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * Splits the palm GLB into its five variants, bakes each to a unit-height
   * geometry with its trunk base at the origin, and gives every material the
   * shared wind sway.
   */
  private extractPalmVariants(assets: AssetManager): PalmVariant[] {
    const palms = assets.palms();
    palms.updateMatrixWorld(true);
    const materialCache = new Map<string, THREE.Material>();
    const variants: PalmVariant[] = [];
    const windUniform = this.palmWindUniform;
    const windMaterial = (source: THREE.Material): THREE.Material => {
      const cached = materialCache.get(source.uuid);
      if (cached) return cached;
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.offsetHSL(0, 0.2, 0.08);
        material.roughness = 0.86;
      }
      material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
        shader.uniforms.uPalmTime = windUniform;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uPalmTime;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
             // Geometry is unit height; sway grows toward the crown and each
             // instance gets its own phase from its world position.
             float windWeight = smoothstep(0.15, 0.95, position.y);
             vec3 palmOrigin = vec3(0.0);
             #ifdef USE_INSTANCING
               palmOrigin = instanceMatrix[3].xyz;
             #endif
             float palmPhase = uPalmTime * 1.35 + position.y * 3.0 + palmOrigin.x * 0.13 + palmOrigin.z * 0.11;
             transformed.x += sin(palmPhase) * 0.016 * windWeight;
             transformed.z += cos(palmPhase * 0.73) * 0.009 * windWeight;`,
          );
      };
      material.customProgramCacheKey = () => "palm-wind-instanced-v3";
      materialCache.set(source.uuid, material);
      this.ownedMaterials.push(material);
      return material;
    };

    palms.traverse((object) => {
      if (!(object instanceof THREE.Group) || !/palmtree/i.test(object.name)) return;
      const parts: PalmVariant["parts"] = [];
      const baked: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
      const bounds = new THREE.Box3();
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        // Bake the full source transform (axis conversion and scale); the
        // variant's row offset in the file is removed by re-centering below.
        const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
        geometry.computeBoundingBox();
        if (geometry.boundingBox) bounds.union(geometry.boundingBox);
        baked.push({ geometry, material: windMaterial(Array.isArray(child.material) ? child.material[0] : child.material) });
      });
      if (baked.length === 0 || bounds.isEmpty()) return;
      const height = Math.max(0.01, bounds.max.y - bounds.min.y);
      const center = bounds.getCenter(new THREE.Vector3());
      baked.forEach(({ geometry, material }) => {
        geometry.translate(-center.x, -bounds.min.y, -center.z);
        geometry.scale(1 / height, 1 / height, 1 / height);
        this.ownedGeometries.push(geometry);
        parts.push({ geometry, material });
      });
      variants.push({ parts });
    });
    return variants;
  }

  private plantPalms(island: IslandDefinition, variants: PalmVariant[]): void {
    if (variants.length === 0) return;
    const random = seededRandom(island.seed + 11);
    const count = PALM_COUNTS[island.style];
    const matrices: THREE.Matrix4[][] = variants.map(() => []);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const lean = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const leanAxis = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let attempts = 0;
    let planted = 0;
    while (planted < count && attempts < count * 30) {
      attempts += 1;
      // Most palms fringe the beach; a few grow further inland.
      const radial = random() < 0.7 ? 0.62 + random() * 0.26 : 0.25 + random() * 0.4;
      const angle = random() * Math.PI * 2;
      if (!isPlantable(island, radial, angle)) continue;
      const point = islandWorldPoint(island, radial, angle);
      const height = (island.style === "cay" ? 8.5 : 10) * (0.72 + random() * 0.55);
      position.set(point.x, islandHeight(island, radial, angle) - 0.15, point.z);
      // Coastal palms lean toward open water; inland ones stand straighter.
      const outward = Math.atan2(point.x - island.centerX, point.z - island.centerZ);
      const tilt = (0.04 + random() * 0.24) * smoothstep(0.35, 0.85, radial) + random() * 0.05;
      const leanDirection = outward + (random() - 0.5) * 0.9;
      leanAxis.set(Math.cos(leanDirection), 0, -Math.sin(leanDirection));
      lean.setFromAxisAngle(leanAxis, tilt);
      spin.setFromAxisAngle(up, random() * Math.PI * 2);
      quaternion.copy(lean).multiply(spin);
      scale.setScalar(height);
      const variant = Math.floor(random() * variants.length);
      matrices[variant].push(new THREE.Matrix4().compose(position, quaternion, scale));
      planted += 1;
    }
    variants.forEach((variant, variantIndex) => {
      const list = matrices[variantIndex];
      if (list.length === 0) return;
      variant.parts.forEach(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        list.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.name = `Palms_${island.name.replace(/\s+/g, "_")}_${variantIndex + 1}`;
        this.group.add(mesh);
      });
    });
  }

  private scatterRocks(island: IslandDefinition, geometry: THREE.BufferGeometry): void {
    const random = seededRandom(island.seed + 31);
    const count = ROCK_COUNTS[island.style];
    const material = new THREE.MeshStandardMaterial({
      color: island.style === "volcanic" ? 0x4c423b : 0x837b70,
      roughness: 0.92,
      flatShading: true,
    });
    this.ownedMaterials.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      // Boulders cluster along the waterline and on steep ground.
      const shore = random() < 0.65;
      let radial = shore ? 0.9 + random() * 0.12 : 0.2 + random() * 0.6;
      let angle = random() * Math.PI * 2;
      if (island.style === "hills" && random() < 0.5) {
        // Pile rocks around the lighthouse headland.
        radial = 0.78 + random() * 0.2;
        angle = 0.55 + (random() - 0.5) * 0.6;
      }
      const point = islandWorldPoint(island, radial, angle);
      const size = (shore ? 0.7 + random() * 1.6 : 0.6 + random() * 1.2) * (island.style === "cay" ? 0.7 : 1);
      position.set(point.x, islandHeight(island, radial, angle) - size * 0.25, point.z);
      euler.set(random() * 0.4, random() * Math.PI * 2, random() * 0.4);
      quaternion.setFromEuler(euler);
      scale.set(size * (0.8 + random() * 0.5), size, size * (0.8 + random() * 0.5));
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `Rocks_${island.name.replace(/\s+/g, "_")}`;
    this.group.add(mesh);
  }

  private createLandmarks(): void {
    LANDMARKS.forEach((landmark) => {
      const island = ISLAND_DEFINITIONS[landmark.island];
      const point = islandWorldPoint(island, landmark.radial, landmark.angle);
      const ground = islandHeight(island, landmark.radial, landmark.angle);
      const outward = Math.atan2(point.x - island.centerX, point.z - island.centerZ);
      if (landmark.kind === "lighthouse") {
        const lighthouse = createLighthouse(this.propMaterials);
        lighthouse.group.position.set(point.x, ground - 0.3, point.z);
        lighthouse.group.rotation.y = outward;
        this.group.add(lighthouse.group);
        this.lighthouses.push(lighthouse);
      } else if (landmark.kind === "pier") {
        const start = islandWorldPoint(island, landmark.radial - 0.1, landmark.angle);
        const direction = Math.atan2(point.x - start.x, point.z - start.z);
        const pier = createPier(this.propMaterials, PIER_LENGTH, PIER_DECK_HEIGHT);
        pier.position.set(start.x, 0, start.z);
        pier.rotation.y = direction;
        this.group.add(pier);
        const endX = start.x + Math.sin(direction) * PIER_LENGTH;
        const endZ = start.z + Math.cos(direction) * PIER_LENGTH;
        this.piers.push({ start: new THREE.Vector2(start.x, start.z), end: new THREE.Vector2(endX, endZ), halfWidth: 1.2 });
      } else if (landmark.kind === "hut") {
        const hut = createHut(this.propMaterials);
        hut.position.set(point.x, ground - 0.1, point.z);
        hut.rotation.y = outward;
        this.group.add(hut);
      }
    });
  }
}
