import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { smoothstep } from "../math";
import type { UnderwaterLight } from "./UnderwaterLight";
import { ISLAND_DEFINITIONS, islandEdgeNoise, terrainNoise, waterDepthAt } from "./IslandMath";

type IslandObstacle = {
  center: THREE.Vector2;
  beachRadius: number;
  scaleZ: number;
};

type PalmWindUniform = { value: number };

const ISLANDS: readonly IslandObstacle[] = ISLAND_DEFINITIONS.map((island) => ({
  center: new THREE.Vector2(island.centerX, island.centerZ),
  beachRadius: island.beachRadius,
  scaleZ: island.scaleZ,
}));

export const MAX_VISIBLE_TERRAIN_RADIUS_SCALE = 1.06;

/** Palms planted on each island. */
const PALMS_PER_ISLAND = 9;
/** Palms stay inside this fraction of the beach radius, clear of the swash. */
const PALM_MAX_RADIAL = 0.66;
const GOLDEN_ANGLE = 2.399963229728653;

export class IslandSystem {
  private readonly group = new THREE.Group();
  private readonly palmWind: PalmWindUniform = { value: 0 };
  private readonly palmMaterials = new Map<THREE.Material, THREE.Material>();

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
    private readonly underwater: UnderwaterLight,
  ) {
    this.group.name = "TropicalIslandSystem";
    scene.add(this.group);
    this.createSeabed();
    ISLANDS.forEach((island, index) => this.createIsland(island, index, assets));
  }

  update(time: number): void {
    this.palmWind.value = time;
  }

  depthAt(x: number, z: number): number {
    return waterDepthAt(x, z);
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
      // A keel running onto sand stops; it does not bounce. Remove the
      // shoreward velocity and let friction bleed off the rest.
      const normalLength = Math.hypot(nx, nz / island.scaleZ) || 1;
      const normalX = nx / normalLength;
      const normalZ = nz / island.scaleZ / normalLength;
      const inwardVelocity = velocity.x * normalX + velocity.z * normalZ;
      if (inwardVelocity < 0) {
        velocity.x -= normalX * inwardVelocity;
        velocity.z -= normalZ * inwardVelocity;
      }
      velocity.multiplyScalar(0.94);
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
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private createSeabed(): void {
    const seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400, 1, 1),
      // Sand; eighteen metres of water above it turn it deep blue.
      new THREE.MeshStandardMaterial({ color: 0x9c8a62, roughness: 1, metalness: 0 }),
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = -18;
    // Eighteen metres of water scatter the yacht's shadow long before it
    // could reach the bottom.
    seabed.receiveShadow = false;
    seabed.name = "DeepTropicalSeabed";
    this.underwater.apply(seabed.material);
    this.group.add(seabed);
  }

  private createIsland(island: IslandObstacle, index: number, assets: AssetManager): void {
    const islandGroup = new THREE.Group();
    islandGroup.position.set(island.center.x, 0, island.center.y);
    islandGroup.name = `TropicalIsland_${index + 1}`;

    const terrain = new THREE.Mesh(
      this.createIslandTerrain(island, index),
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
    terrain.castShadow = false;
    terrain.name = "IrregularIslandTerrain";
    // The submerged apron fades into the water like any other seabed.
    this.underwater.apply(terrain.material);
    // The ocean is rendered immediately after this mesh. Vertex alpha tapers
    // the submerged apron into the seabed so its final radial edge cannot read
    // as a large ring (or as a dark, flat animal) through clear tropical water.
    terrain.renderOrder = 1;
    islandGroup.add(terrain);

    this.plantPalms(island, index, assets, islandGroup);
    this.group.add(islandGroup);
  }

  /**
   * The palm asset is a row of five tree variants laid out side by side. Each
   * tree is lifted out of that row and planted on its own spot, so a grove
   * stands on the island instead of trailing out to sea.
   */
  private plantPalms(island: IslandObstacle, index: number, assets: AssetManager, islandGroup: THREE.Group): void {
    const source = assets.palms();
    source.updateMatrixWorld(true);
    const container = source.getObjectByName("RootNode") ?? source;
    const variants = container.children.filter((child) => child.children.length > 0 || child instanceof THREE.Mesh);
    if (variants.length === 0) return;

    for (let palmIndex = 0; palmIndex < PALMS_PER_ISLAND; palmIndex += 1) {
      const tree = variants[(palmIndex + index) % variants.length].clone(true);
      // Remove the tree's slot in the source row, keep its upright rotation.
      tree.position.set(0, 0, 0);
      tree.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(tree);
      const height = Math.max(0.1, bounds.max.y - bounds.min.y);
      tree.position.y = -bounds.min.y;

      const spread = (palmIndex + 0.5) / PALMS_PER_ISLAND;
      const radial = 0.1 + Math.sqrt(spread) * (PALM_MAX_RADIAL - 0.1);
      const angle = palmIndex * GOLDEN_ANGLE + index * 1.3;
      const radius = island.beachRadius * radial * islandEdgeNoise(angle, index);
      const size = 0.78 + terrainNoise(palmIndex * 3.7 + index * 11.1, palmIndex * 1.9) * 0.5;

      const palm = new THREE.Group();
      palm.name = `GLB_Palm_${index + 1}_${palmIndex + 1}`;
      palm.add(tree);
      palm.scale.setScalar(((11 + index * 1.2) * size) / height);
      palm.rotation.y = palmIndex * 1.94 + index;
      palm.position.set(
        Math.cos(angle) * radius,
        // Roots sit slightly below the surface so no trunk floats on a dune.
        this.islandTerrainHeight(radial, angle, index) - 0.35,
        Math.sin(angle) * radius * island.scaleZ,
      );
      tree.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = false;
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const materials = sourceMaterials.map((material) => this.palmMaterial(material));
        object.material = Array.isArray(object.material) ? materials : materials[0];
      });
      islandGroup.add(palm);
    }
  }

  /** One wind-animated material per source material, shared by every palm. */
  private palmMaterial(source: THREE.Material): THREE.Material {
    const existing = this.palmMaterials.get(source);
    if (existing) return existing;
    const material = source.clone();
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = 0.86;
      material.metalness = 0;
      if (material.name.toLowerCase().includes("leaves")) {
        // Fronds are single sheets: they must be visible from above and
        // below, and they are solid rather than blended.
        material.side = THREE.DoubleSide;
        material.transparent = false;
        material.depthWrite = true;
        material.alphaTest = material.map ? 0.5 : 0;
        material.color.offsetHSL(0, 0.06, 0.02);
      }
    }
    const wind = this.palmWind;
    material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPalmTime = wind;
      // Sway in world space so every tree bends the same way in the same
      // breeze, whatever its own scale and orientation.
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uPalmTime;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
           vec4 palmWorld = modelMatrix * vec4(transformed, 1.0);
           float palmSway = smoothstep(1.5, 13.0, palmWorld.y);
           palmSway *= palmSway;
           float palmPhase = uPalmTime * 1.3 + palmWorld.x * 0.23 + palmWorld.z * 0.17;
           palmWorld.x += (sin(palmPhase) * 0.34 + 0.22) * palmSway;
           palmWorld.z += (cos(palmPhase * 0.73) * 0.2 + 0.14) * palmSway;
           mvPosition = viewMatrix * palmWorld;
           gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    material.customProgramCacheKey = () => "palm-wind-v3";
    this.palmMaterials.set(source, material);
    return material;
  }

  private createIslandTerrain(island: IslandObstacle, index: number): THREE.BufferGeometry {
    const segments = 96;
    const rings = 22;
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    const positions: number[] = [0, 1.78 + index * 0.18, 0];
    const colors: number[] = [];
    const indices: number[] = [];
    const green = new THREE.Color(index === 1 ? 0x3d8448 : 0x3a8a4c);
    const dryGrass = new THREE.Color(0x7d9a4e);
    const shade = new THREE.Color(0x2a6a3c);
    const sand = new THREE.Color(0xd9c08a);
    const deepSand = new THREE.Color(0xb99a60);
    const wetSand = new THREE.Color(0xa98d58);
    colors.push(green.r, green.g, green.b, 1);

    for (let ring = 1; ring <= rings; ring += 1) {
      const radial = outerRadius * ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        const edgeNoise = islandEdgeNoise(angle, index);
        const radius = island.beachRadius * radial * edgeNoise;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius * island.scaleZ;
        // Low-frequency patches break up the vegetation line and the dunes.
        const patch = terrainNoise(x * 0.11 + index * 17.3, z * 0.11 - index * 9.1);
        const fine = terrainNoise(x * 0.37 - index * 4.2, z * 0.37 + index * 13.7);
        const y = this.islandTerrainHeight(radial, angle, index) + (patch - 0.5) * 0.5 * (1 - smoothstep(0.7, 0.95, radial));
        positions.push(x, y, z);

        const color = new THREE.Color();
        const vegetationEdge = 0.7 + (patch - 0.5) * 0.16;
        if (radial < vegetationEdge - 0.08) {
          color.copy(green).lerp(shade, smoothstep(0.35, 0.8, fine)).lerp(dryGrass, smoothstep(0.55, 0.9, patch) * 0.6);
        } else if (radial < vegetationEdge + 0.12) {
          color
            .copy(green)
            .lerp(dryGrass, 0.5)
            .lerp(sand, smoothstep(vegetationEdge - 0.08, vegetationEdge + 0.12, radial));
        } else if (radial < 1) {
          // Sand darkens where the swash keeps it wet.
          color.copy(sand).lerp(wetSand, smoothstep(0.93, 0.985, radial));
        } else {
          color.copy(wetSand).lerp(deepSand, smoothstep(1, outerRadius, radial));
        }
        const alpha = 1 - smoothstep(0.965, outerRadius, radial);
        colors.push(color.r, color.g, color.b, alpha);
      }
    }

    for (let segment = 0; segment < segments; segment += 1) {
      // Counter-clockwise seen from above, so the lit front face is the top.
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

  private islandTerrainHeight(radial: number, angle: number, index: number): number {
    // Fade the angular folds toward the summit so the fan of triangles there
    // does not read as a pinwheel.
    const surfaceVariation =
      (Math.sin(angle * 4 + index * 1.3) * 0.12 + Math.cos(angle * 9) * 0.05) * smoothstep(0.08, 0.5, radial);
    if (radial < 0.68) return 1.78 + index * 0.18 - radial * radial * 0.9 + surfaceVariation;
    if (radial < 0.9) return THREE.MathUtils.lerp(1.36, 0.28, smoothstep(0.68, 0.9, radial)) + surfaceVariation * 0.35;
    if (radial < 1) return THREE.MathUtils.lerp(0.28, -0.08, smoothstep(0.9, 1, radial));
    return THREE.MathUtils.lerp(-0.08, -0.42, smoothstep(1, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, radial));
  }

}
