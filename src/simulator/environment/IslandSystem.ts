import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { batchStaticMeshes } from "../core/StaticBatching";
import { smoothstep } from "../math";
import type { UnderwaterLight } from "./UnderwaterLight";
import {
  applyIslandSurface,
  createIslandSurfaceUniforms,
  MAX_PALM_TRUNKS,
  PALM_SHADOW_LAYER,
  PalmShadowMap,
  type IslandSurfaceUniforms,
} from "./IslandSurface";
import {
  ISLAND_DEFINITIONS,
  islandEdgeNoise,
  selectIslandSlots,
  shoreClearance,
  terrainNoise,
  waterDepthAt,
} from "./IslandMath";
import { ISLAND_SLOT_UNIFORMS } from "./SurfMath";

type IslandObstacle = {
  center: THREE.Vector2;
  beachRadius: number;
  scaleZ: number;
  height: number;
};

type PalmWindUniform = { value: number };

const ISLANDS: readonly IslandObstacle[] = ISLAND_DEFINITIONS.map((island) => ({
  center: new THREE.Vector2(island.centerX, island.centerZ),
  beachRadius: island.beachRadius,
  scaleZ: island.scaleZ,
  height: island.height,
}));

export const MAX_VISIBLE_TERRAIN_RADIUS_SCALE = 1.06;

/** Palms planted on an island of this beach radius: a few on a cay, a grove on a large island. */
export function palmsForIsland(beachRadius: number): number {
  return Math.round(Math.min(30, Math.max(4, 2 + beachRadius * 0.2)));
}
/** Islands (terrain and groves) further than this are lost in the haze and not drawn. */
export const ISLAND_DRAW_DISTANCE = 2000;
/** Palm groves beyond this are lost in the haze and not drawn. */
export const GROVE_DRAW_DISTANCE = 1300;
/** Islands further than this are left out of the planar mirror. */
const MIRROR_DISTANCE = 650;
/** Beyond this the island terrain is drawn from its coarse mesh. */
const TERRAIN_LOD_DISTANCE = 380;
/** Groves are merged per square of this side, so a cluster off screen is culled as a whole. */
const GROVE_CELL = 1500;
/** Palms stay inside this fraction of the beach radius, clear of the swash. */
const PALM_MAX_RADIAL = 0.66;
const GOLDEN_ANGLE = 2.399963229728653;

export class IslandSystem {
  private readonly shoreNormal = { x: 0, z: 1 };
  private readonly group = new THREE.Group();
  private readonly palmWind: PalmWindUniform = { value: 0 };
  /** Weather's wind relative to the trade wind: how far the crowns lean and how fast they flutter. */
  private readonly palmStrength: PalmWindUniform = { value: 1 };
  private readonly palmMaterials = new Map<THREE.Material, THREE.Material>();
  private readonly surface: IslandSurfaceUniforms = createIslandSurfaceUniforms();
  private readonly palmShadows: PalmShadowMap;
  /** Every trunk's foot (x, y, z, radius); the nearest fill the contact-shading slots. */
  private readonly trunks: THREE.Vector4[] = [];
  private readonly terrains: THREE.Mesh[] = [];
  private readonly terrainLods: THREE.LOD[] = [];
  /** Fraction of the full draw distances (shorter on the low preset). */
  private drawScale = 1;
  /** Islands and groves too far to show in the water's mirror (see `update`). */
  readonly farFromMirror: THREE.Object3D[] = [];
  private readonly groves: THREE.Mesh[] = [];
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  private seabed!: THREE.Mesh;

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
    private readonly underwater: UnderwaterLight,
    private readonly sky: Record<string, THREE.IUniform>,
    shadowMapSize: number,
  ) {
    this.group.name = "TropicalIslandSystem";
    scene.add(this.group);
    this.createSeabed();
    // One material for every island's terrain: one shader program, and the
    // islands differ only in their geometry.
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
      transparent: true,
      alphaTest: 0.015,
      depthWrite: true,
    });
    // The submerged apron fades into the water like any other seabed.
    this.underwater.apply(this.terrainMaterial);
    // Sand grain, wet sand, the swash and the palms' shadows.
    applyIslandSurface(this.terrainMaterial, this.surface, this.sky);
    const palmParts: THREE.Mesh[] = [];
    ISLANDS.forEach((island, index) => this.createIsland(island, index, assets, palmParts));
    this.mergeGroves(palmParts);
    this.palmShadows = new PalmShadowMap(scene, this.surface, shadowMapSize);
    selectIslandSlots(0, 0, ISLAND_SLOT_UNIFORMS.uIslandShape.value, ISLAND_SLOT_UNIFORMS.uIslandFrame.value);
  }

  /**
   * @param focusX, focusZ Where the yacht is: the shaders evaluate the islands
   * nearest her, the seabed follows her, and distant islands are not drawn.
   */
  update(time: number, wind = 1, focusX = 0, focusZ = 0): void {
    this.palmWind.value = time;
    this.palmStrength.value = Math.min(3.2, Math.max(0.4, wind));
    this.surface.uSurfTime.value = time;
    selectIslandSlots(focusX, focusZ, ISLAND_SLOT_UNIFORMS.uIslandShape.value, ISLAND_SLOT_UNIFORMS.uIslandFrame.value);
    this.seabed.position.x = Math.round(focusX / 50) * 50;
    this.seabed.position.z = Math.round(focusZ / 50) * 50;
    // Distant islands are hidden whole (both levels of detail); groves sooner.
    // Islands far off are left out of the water's mirror, where they would
    // be a sliver at the horizon fade.
    this.farFromMirror.length = 0;
    for (const lod of this.terrainLods) {
      const island = lod.parent!;
      const gap = Math.hypot(island.position.x - focusX, island.position.z - focusZ) - lod.userData.radius;
      lod.visible = gap < ISLAND_DRAW_DISTANCE * this.drawScale;
      if (lod.visible && gap > MIRROR_DISTANCE) this.farFromMirror.push(lod);
    }
    for (const mesh of this.groves) {
      const sphere = mesh.geometry.boundingSphere;
      if (!sphere) continue;
      const gap = Math.max(0, Math.hypot(sphere.center.x - focusX, sphere.center.z - focusZ) - sphere.radius);
      mesh.visible = gap < GROVE_DRAW_DISTANCE * this.drawScale;
      if (mesh.visible && gap > MIRROR_DISTANCE) this.farFromMirror.push(mesh);
    }
  }

  /**
   * Palm shadows follow the dominant light; `strength` fades them for a weak
   * or very low light. The map is only redrawn when the light has moved.
   */
  updateShadows(renderer: THREE.WebGLRenderer, lightDirection: THREE.Vector3, strength: number, focusX = 0, focusZ = 0): void {
    if (this.palmShadows.update(renderer, lightDirection, strength, focusX, focusZ)) this.fillTrunkSlots(focusX, focusZ);
  }

  /** Shortens how far islands and groves are drawn (1 = full distance). */
  setDrawScale(scale: number): void {
    this.drawScale = scale;
  }

  /** The trunks nearest the yacht darken the sand around their feet. */
  private fillTrunkSlots(x: number, z: number): void {
    const nearest = [...this.trunks]
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
      .slice(0, MAX_PALM_TRUNKS);
    this.surface.uPalmTrunks.value.forEach((slot, index) => {
      const trunk = nearest[index];
      if (trunk) slot.copy(trunk);
      else slot.set(0, -1000, 0, 0);
    });
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

  /** Metres from the rendered waterline and the outward normal (see `shoreClearance`). */
  readonly shoreClearance = (x: number, z: number, normal: { x: number; z: number }): number =>
    shoreClearance(x, z, normal);

  /**
   * Last-resort guard on the yacht's centre against the rendered coast; the
   * hull outline normally rebounds well before this (see `ShoreContact`).
   * Returns true if the centre had to be moved.
   */
  constrainToWater(position: THREE.Vector3, velocity: THREE.Vector3): boolean {
    const clearance = shoreClearance(position.x, position.z, this.shoreNormal);
    const minimum = 2.2;
    if (clearance >= minimum) return false;
    position.x += this.shoreNormal.x * (minimum - clearance);
    position.z += this.shoreNormal.z * (minimum - clearance);
    const inward = velocity.x * this.shoreNormal.x + velocity.z * this.shoreNormal.z;
    if (inward < 0) {
      velocity.x -= this.shoreNormal.x * inward * 1.5;
      velocity.z -= this.shoreNormal.z * inward * 1.5;
    }
    return true;
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
    this.palmShadows.dispose();
    this.terrainMaterial.dispose();
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
      // It follows the yacht (see `update`), so it only needs to reach the haze.
      new THREE.PlaneGeometry(4200, 4200, 1, 1),
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
    this.seabed = seabed;
  }

  private createIsland(island: IslandObstacle, index: number, assets: AssetManager, palmParts: THREE.Mesh[]): void {
    const islandGroup = new THREE.Group();
    islandGroup.position.set(island.center.x, 0, island.center.y);
    islandGroup.name = `TropicalIsland_${index + 1}`;

    // Two levels of detail: the full terrain near, a third of the vertices
    // beyond a few hundred metres, where a ring of the coast is a pixel.
    const lod = new THREE.LOD();
    lod.name = "IslandTerrainLOD";
    for (const [detail, distance] of [[1, 0], [0.34, TERRAIN_LOD_DISTANCE]] as const) {
      const terrain = new THREE.Mesh(this.createIslandTerrain(island, index, detail), this.terrainMaterial);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      terrain.name = "IrregularIslandTerrain";
      // The ocean is rendered immediately after this mesh. Vertex alpha tapers
      // the submerged apron into the seabed so its final radial edge cannot read
      // as a large ring (or as a dark, flat animal) through clear tropical water.
      terrain.renderOrder = 1;
      lod.addLevel(terrain, distance);
      this.terrains.push(terrain);
    }
    lod.userData.radius = island.beachRadius * Math.max(1, island.scaleZ) * MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    islandGroup.add(lod);
    this.terrainLods.push(lod);

    this.plantPalms(island, index, assets, islandGroup, palmParts);
    this.group.add(islandGroup);
  }

  /**
   * The palm asset is a row of five tree variants laid out side by side. Each
   * tree is lifted out of that row and planted on its own spot, so a grove
   * stands on the island instead of trailing out to sea.
   */
  private plantPalms(
    island: IslandObstacle,
    index: number,
    assets: AssetManager,
    islandGroup: THREE.Group,
    palmParts: THREE.Mesh[],
  ): void {
    const source = assets.palms();
    source.updateMatrixWorld(true);
    const container = source.getObjectByName("RootNode") ?? source;
    const variants = container.children.filter((child) => child.children.length > 0 || child instanceof THREE.Mesh);
    if (variants.length === 0) return;

    const count = palmsForIsland(island.beachRadius);
    for (let palmIndex = 0; palmIndex < count; palmIndex += 1) {
      const tree = variants[(palmIndex + index) % variants.length].clone(true);
      // Remove the tree's slot in the source row, keep its upright rotation.
      tree.position.set(0, 0, 0);
      tree.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(tree);
      const height = Math.max(0.1, bounds.max.y - bounds.min.y);
      tree.position.y = -bounds.min.y;

      const spread = (palmIndex + 0.5) / count;
      const radial = 0.1 + Math.sqrt(spread) * (PALM_MAX_RADIAL - 0.1);
      const angle = palmIndex * GOLDEN_ANGLE + index * 1.3;
      const radius = island.beachRadius * radial * islandEdgeNoise(angle, index);
      const size = 0.78 + terrainNoise(palmIndex * 3.7 + index * 11.1, palmIndex * 1.9) * 0.5;

      const palm = new THREE.Group();
      palm.name = `GLB_Palm_${index + 1}_${palmIndex + 1}`;
      palm.add(tree);
      palm.scale.setScalar(((11 + (index % 3) * 1.2) * size) / height);
      palm.rotation.y = palmIndex * 1.94 + index;
      palm.position.set(
        Math.cos(angle) * radius,
        // Roots sit slightly below the surface so no trunk floats on a dune.
        this.terrainSurfaceHeight(island, index, radial, angle) - 0.35,
        Math.sin(angle) * radius * island.scaleZ,
      );
      // Each trunk darkens the sand around its foot (contact shading).
      this.trunks.push(
        new THREE.Vector4(island.center.x + palm.position.x, palm.position.y, island.center.y + palm.position.z, 1.1 * size),
      );
      tree.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = false;
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const materials = sourceMaterials.map((material) => this.palmMaterial(material));
        object.material = Array.isArray(object.material) ? materials : materials[0];
        palmParts.push(object);
      });
      islandGroup.add(palm);
    }
  }

  /**
   * The groves never move and their wind is computed in world space, so the
   * trees of each part of the archipelago merge into one mesh per material: a
   * handful of draw calls for every palm in view instead of one per trunk and
   * per crown, and a cluster off screen or in the haze is skipped whole.
   */
  private mergeGroves(parts: THREE.Mesh[]): void {
    this.group.updateMatrixWorld(true);
    const cells = new Map<string, THREE.Mesh[]>();
    const position = new THREE.Vector3();
    for (const part of parts) {
      part.getWorldPosition(position);
      const key = `${Math.floor(position.x / GROVE_CELL)}:${Math.floor(position.z / GROVE_CELL)}`;
      const cell = cells.get(key);
      if (cell) cell.push(part);
      else cells.set(key, [part]);
    }
    cells.forEach((members, key) => {
      const holder = new THREE.Group();
      holder.name = `PalmGroves_${key}`;
      this.group.add(holder);
      const result = batchStaticMeshes(
        holder,
        members,
        (mesh) => `${(mesh.material as THREE.Material).uuid}|${mesh.castShadow}|${mesh.receiveShadow}`,
        `PalmGrove_${key}`,
      );
      // The groves are what the palm shadow map draws.
      result.batches.forEach((batch) => {
        batch.layers.enable(PALM_SHADOW_LAYER);
        this.groves.push(batch);
      });
      members.filter((part) => part.parent).forEach((part) => part.layers.enable(PALM_SHADOW_LAYER));
    });
    // Drop the now-empty tree nodes so they are not traversed every frame.
    this.group.children.forEach((islandGroup) => {
      [...islandGroup.children].forEach((child) => {
        let hasMesh = false;
        child.traverse((object) => {
          hasMesh ||= object instanceof THREE.Mesh;
        });
        if (!hasMesh) child.removeFromParent();
      });
    });
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
    const strength = this.palmStrength;
    material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPalmTime = wind;
      shader.uniforms.uPalmStrength = strength;
      // Sway in world space so every tree bends the same way in the same
      // breeze, whatever its own scale and orientation.
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uPalmTime;\nuniform float uPalmStrength;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
           vec4 palmWorld = modelMatrix * vec4(transformed, 1.0);
           float palmSway = smoothstep(1.5, 13.0, palmWorld.y);
           palmSway *= palmSway;
           float palmPhase = uPalmTime * 1.3 + palmWorld.x * 0.23 + palmWorld.z * 0.17;
           palmWorld.x += (sin(palmPhase) * 0.34 + 0.22) * palmSway * uPalmStrength;
           palmWorld.z += (cos(palmPhase * 0.73) * 0.2 + 0.14) * palmSway * uPalmStrength;
           mvPosition = viewMatrix * palmWorld;
           gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    material.customProgramCacheKey = () => "palm-wind-v4";
    this.palmMaterials.set(source, material);
    return material;
  }

  private createIslandTerrain(island: IslandObstacle, index: number, detail = 1): THREE.BufferGeometry {
    // Detail follows size: a cay needs far fewer vertices than a high island.
    const segments = Math.max(32, Math.round(THREE.MathUtils.clamp(island.beachRadius * 2.6, 96, 220) * detail));
    const rings = Math.max(12, Math.round(THREE.MathUtils.clamp(20 + island.beachRadius * 0.3, 30, 52) * detail));
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    const positions: number[] = [0, this.islandTerrainHeight(0, 0, index, island.height), 0];
    const colors: number[] = [];
    // 1 on sand, 0 under vegetation: the sand shading applies only where it is sand.
    const sandMask: number[] = [0];
    // High islands carry darker forest and bare rock toward the summit.
    const highland = smoothstep(3, 10, island.height);
    const indices: number[] = [];
    const green = new THREE.Color(index % 3 === 1 ? 0x3d8448 : 0x3a8a4c);
    const dryGrass = new THREE.Color(0x7d9a4e);
    const shade = new THREE.Color(0x2a6a3c);
    const sand = new THREE.Color(0xd9c08a);
    const deepSand = new THREE.Color(0xb99a60);
    const wetSand = new THREE.Color(0xa98d58);
    const forest = new THREE.Color(0x24572f);
    const rock = new THREE.Color(0x6d6a5c);
    colors.push(green.r, green.g, green.b, 1);

    for (let ring = 1; ring <= rings; ring += 1) {
      // Rings crowd toward the beach, where the surf and the waterline need detail.
      const radial = outerRadius * Math.pow(ring / rings, 0.72);
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        const edgeNoise = islandEdgeNoise(angle, index);
        const radius = island.beachRadius * radial * edgeNoise;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius * island.scaleZ;
        // Low-frequency patches break up the vegetation line and the dunes.
        const patch = terrainNoise(x * 0.11 + index * 17.3, z * 0.11 - index * 9.1);
        const fine = terrainNoise(x * 0.37 - index * 4.2, z * 0.37 + index * 13.7);
        const y = this.terrainSurfaceHeight(island, index, radial, angle);
        positions.push(x, y, z);

        const color = new THREE.Color();
        const vegetationEdge = 0.7 + (patch - 0.5) * 0.16;
        sandMask.push(smoothstep(vegetationEdge - 0.04, vegetationEdge + 0.12, radial));
        if (radial < vegetationEdge - 0.08) {
          color.copy(green).lerp(shade, smoothstep(0.35, 0.8, fine)).lerp(dryGrass, smoothstep(0.55, 0.9, patch) * 0.6);
          if (highland > 0) {
            const summit = 1 - smoothstep(0.05, 0.45, radial);
            color.lerp(forest, highland * smoothstep(0.2, 0.7, fine) * 0.7);
            color.lerp(rock, highland * summit * smoothstep(0.45, 0.75, patch) * 0.8);
          }
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
    geometry.setAttribute("sandMask", new THREE.Float32BufferAttribute(sandMask, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Height of the rendered terrain at a polar position, dunes and hummocks included. */
  private terrainSurfaceHeight(island: IslandObstacle, index: number, radial: number, angle: number): number {
    const radius = island.beachRadius * radial * islandEdgeNoise(angle, index);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * island.scaleZ;
    const patch = terrainNoise(x * 0.11 + index * 17.3, z * 0.11 - index * 9.1);
    const highland = smoothstep(3, 10, island.height);
    return (
      this.islandTerrainHeight(radial, angle, index, island.height) +
      (patch - 0.5) * (0.5 + highland * 1.6) * (1 - smoothstep(0.7, 0.95, radial))
    );
  }

  private islandTerrainHeight(radial: number, angle: number, index: number, height: number): number {
    // Fade the angular folds toward the summit so the fan of triangles there
    // does not read as a pinwheel.
    const surfaceVariation =
      (Math.sin(angle * 4 + index * 1.3) * 0.12 + Math.cos(angle * 9) * 0.05) * smoothstep(0.08, 0.5, radial);
    if (radial < 0.68) {
      // A low cay is a gentle dome; a high island rises into ridged hills.
      const t = radial / 0.68;
      const rise = Math.max(0, height - 1.36);
      const steep = smoothstep(3, 10, height);
      const dome = Math.pow(1 - t * t, 1 + steep * 0.8);
      const ridges =
        steep * (Math.sin(angle * 5 + index * 2.1) * 0.5 + Math.sin(angle * 3 - index) * 0.5) * t * (1 - t) * rise * 0.35;
      return 1.36 + rise * dome + ridges + surfaceVariation;
    }
    if (radial < 0.9) return THREE.MathUtils.lerp(1.36, 0.28, smoothstep(0.68, 0.9, radial)) + surfaceVariation * 0.35;
    if (radial < 1) return THREE.MathUtils.lerp(0.28, -0.08, smoothstep(0.9, 1, radial));
    return THREE.MathUtils.lerp(-0.08, -0.42, smoothstep(1, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, radial));
  }

}
