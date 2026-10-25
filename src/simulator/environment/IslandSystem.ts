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
  islandEdgeNoise,
  islandsAround,
  islandsWithin,
  selectIslandSlots,
  shoreClearance,
  terrainNoise,
  VOLCANO_FOOT,
  VOLCANO_RIM,
  volcanoHeight,
  waterDepthAt,
  type IslandDefinition,
} from "./IslandMath";
import { ISLAND_SLOT_UNIFORMS } from "./SurfMath";
import {
  furnishIsland,
  hillHeight,
  inClearing,
  islandClearings,
  islandProfile,
  pierClearance,
  type IslandProfile,
  type PierFootprint,
} from "./IslandProps";

type PalmWindUniform = { value: number };

/** What one streamed-in island owns: its terrain, its grove and the trunks that darken the sand. */
type IslandVisual = {
  definition: IslandDefinition;
  group: THREE.Group;
  holder: THREE.Group;
  lod: THREE.LOD;
  batches: THREE.Mesh[];
  trunks: THREE.Vector4[];
  /** Boulders, scrub, pier, hut, lighthouse (see IslandProps), and what glows at night. */
  furniture: THREE.Mesh[];
  pier: PierFootprint | null;
  beam: THREE.Group | null;
};

/** Furniture (boulders, scrub, huts) beyond this is not drawn; a lighthouse is seen as far as its island. */
const FURNITURE_DRAW_DISTANCE = 1100;
/** Turns per second of a lighthouse's light (one flash each way every ten seconds). */
const BEAM_SPEED = (Math.PI * 2) / 20;

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
/** Islands whose beach lies within this distance of the yacht are built, so they are ready long before they show. */
export const ISLAND_BUILD_RADIUS = ISLAND_DRAW_DISTANCE + 450;
/** Built islands farther than this from the yacht are released. */
export const ISLAND_RELEASE_RADIUS = ISLAND_BUILD_RADIUS + 500;
/** The wanted set of islands is recomputed after the yacht has moved this far, metres. */
const STREAM_STEP = 90;
/** Islands built per frame while sailing (all of them while loading). */
const BUILDS_PER_FRAME = 1;
/** Palms stay inside this fraction of the beach radius, clear of the swash. */
const PALM_MAX_RADIAL = 0.66;
const GOLDEN_ANGLE = 2.399963229728653;

export class IslandSystem {
  private readonly shoreNormal = { x: 0, z: 1 };
  private readonly structureNormal = { x: 0, z: 1 };
  private readonly group = new THREE.Group();
  private readonly palmWind: PalmWindUniform = { value: 0 };
  /** Weather's wind relative to the trade wind: how far the crowns lean and how fast they flutter. */
  private readonly palmStrength: PalmWindUniform = { value: 1 };
  private readonly palmMaterials = new Map<THREE.Material, THREE.Material>();
  private readonly surface: IslandSurfaceUniforms = createIslandSurfaceUniforms();
  private readonly palmShadows: PalmShadowMap;
  /** Every trunk's foot (x, y, z, radius); the nearest fill the contact-shading slots. */
  private trunks: THREE.Vector4[] = [];
  /** The islands built so far, by id: the world is streamed in around the yacht. */
  private readonly built = new Map<number, IslandVisual>();
  private readonly pending: IslandDefinition[] = [];
  private streamX = Number.NaN;
  private streamZ = Number.NaN;
  /** Fraction of the full draw distances (shorter on the low preset). */
  private drawScale = 1;
  /** Islands and groves too far to show in the water's mirror (see `update`). */
  readonly farFromMirror: THREE.Object3D[] = [];
  private groves: THREE.Mesh[] = [];
  private readonly terrainMaterial: THREE.MeshStandardMaterial;
  /** Shared by every island's furniture: vertex-coloured solids, glowing windows, the beams. */
  private readonly furnitureMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly beamMaterial: THREE.MeshBasicMaterial;
  private readonly beamGeometry: THREE.BufferGeometry;
  private readonly lampGeometry: THREE.SphereGeometry;
  private readonly lampMaterial: THREE.MeshBasicMaterial;
  private readonly profiles = new Map<number, IslandProfile>();
  private night = 0;
  private seabed!: THREE.Mesh;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
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
    this.furnitureMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    // Piles stand in the water like the terrain's apron.
    this.underwater.apply(this.furnitureMaterial);
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x1e1c1a });
    this.beamGeometry = createBeamGeometry();
    this.beamMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // A beam is a cone of lit haze: brightest seen through its middle, fading
    // to nothing at its silhouette, so it has no hard edges.
    this.beamMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vBeamFacing;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
           vec3 beamNormal = normalize(normalMatrix * normal);
           vBeamFacing = abs(dot(beamNormal, normalize(-mvPosition.xyz)));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vBeamFacing;")
        .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.a *= pow(vBeamFacing, 1.8);");
    };
    this.beamMaterial.customProgramCacheKey = () => "lighthouse-beam-v1";
    this.lampGeometry = new THREE.SphereGeometry(0.55, 14, 10);
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.6, 2.4), transparent: true, opacity: 0, depthWrite: false });
    this.palmShadows = new PalmShadowMap(scene, this.surface, shadowMapSize);
    // Everything around the start is built before the first frame.
    this.stream(0, 0, Number.POSITIVE_INFINITY);
    selectIslandSlots(0, 0, ISLAND_SLOT_UNIFORMS.uIslandShape.value, ISLAND_SLOT_UNIFORMS.uIslandFrame.value);
  }

  /**
   * Keeps the islands around (focusX, focusZ) built and releases the ones the
   * yacht has left far behind. The world has no edge: islands come from the
   * deterministic generator in `IslandMath`, a few per frame at most.
   */
  private stream(focusX: number, focusZ: number, budget: number): void {
    if (!(Math.hypot(focusX - this.streamX, focusZ - this.streamZ) < STREAM_STEP)) {
      this.streamX = focusX;
      this.streamZ = focusZ;
      this.pending.length = 0;
      for (const definition of islandsWithin(focusX, focusZ, ISLAND_BUILD_RADIUS)) {
        if (!this.built.has(definition.id)) this.pending.push(definition);
      }
      // Nearest last, so `pop` builds the one the yacht reaches first.
      this.pending.reverse();
      let released = false;
      for (const [id, visual] of this.built) {
        const island = visual.definition;
        const gap = Math.hypot(focusX - island.centerX, (focusZ - island.centerZ) / island.scaleZ) * Math.min(1, island.scaleZ) - island.beachRadius;
        if (gap > ISLAND_RELEASE_RADIUS) {
          this.releaseIsland(visual);
          this.built.delete(id);
          released = true;
        }
      }
      if (released) this.collect();
    }
    let built = 0;
    while (built < budget && this.pending.length > 0) {
      const definition = this.pending.pop()!;
      if (this.built.has(definition.id)) continue;
      this.built.set(definition.id, this.buildIsland(definition));
      built += 1;
    }
    if (built > 0) this.collect();
  }

  /** Rebuilds the flat lists the per-frame code walks, and asks for the palm shadows to be drawn again. */
  private collect(): void {
    const groves: THREE.Mesh[] = [];
    const trunks: THREE.Vector4[] = [];
    this.built.forEach((visual) => {
      groves.push(...visual.batches);
      trunks.push(...visual.trunks);
    });
    this.groves = groves;
    this.trunks = trunks;
    this.palmShadows?.invalidate();
  }

  /** Draws the palm shadows again (the GPU lost the map). */
  invalidateShadows(): void {
    this.palmShadows?.invalidate();
  }

  /** How many islands are built at the moment (for tests and diagnostics). */
  get builtCount(): number {
    return this.built.size;
  }

  /**
   * @param focusX, focusZ Where the yacht is: the shaders evaluate the islands
   * nearest her, the seabed follows her, and distant islands are not drawn.
   */
  update(time: number, wind = 1, focusX = 0, focusZ = 0): void {
    this.palmWind.value = time;
    for (const visual of this.built.values()) if (visual.beam) visual.beam.rotation.y = time * BEAM_SPEED + visual.definition.id * 0.7;
    this.palmStrength.value = Math.min(3.2, Math.max(0.4, wind));
    this.surface.uSurfTime.value = time;
    selectIslandSlots(focusX, focusZ, ISLAND_SLOT_UNIFORMS.uIslandShape.value, ISLAND_SLOT_UNIFORMS.uIslandFrame.value);
    this.seabed.position.x = Math.round(focusX / 50) * 50;
    this.seabed.position.z = Math.round(focusZ / 50) * 50;
    // Distant islands are hidden whole (both levels of detail); groves sooner.
    // Islands far off are left out of the water's mirror, where they would
    // be a sliver at the horizon fade.
    this.farFromMirror.length = 0;
    this.stream(focusX, focusZ, BUILDS_PER_FRAME);
    this.built.forEach(({ lod }) => {
      const island = lod.parent!;
      const gap = Math.hypot(island.position.x - focusX, island.position.z - focusZ) - lod.userData.radius;
      lod.visible = gap < ISLAND_DRAW_DISTANCE * this.drawScale;
      if (lod.visible && gap > MIRROR_DISTANCE) this.farFromMirror.push(lod);
    });
    for (const visual of this.built.values()) {
      for (const mesh of visual.furniture) {
        const sphere = mesh.geometry.boundingSphere;
        if (!sphere) continue;
        const island = visual.group.position;
        const gap = Math.max(0, Math.hypot(island.x + sphere.center.x - focusX, island.z + sphere.center.z - focusZ) - sphere.radius);
        const reach = mesh.userData.farSeen ? ISLAND_DRAW_DISTANCE : FURNITURE_DRAW_DISTANCE;
        mesh.visible = gap < reach * this.drawScale;
        if (mesh.visible && gap > MIRROR_DISTANCE) this.farFromMirror.push(mesh);
      }
      if (visual.beam) visual.beam.visible = this.night > 0.05 && visual.lod.visible;
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

  /** Lights the hut windows and the lighthouses at dusk; 0 by day, 1 at night. */
  setNight(night: number): void {
    this.night = night;
    const lit = smoothstep(0.12, 0.45, night);
    this.glowMaterial.color.setRGB(0.12 + lit * 2.6, 0.11 + lit * 2.3, 0.1 + lit * 1.7);
    this.beamMaterial.opacity = lit * 0.32;
    this.lampMaterial.opacity = lit;
  }

  /**
   * Distance from (x, z) to the nearest pier's footprint (negative inside) and
   * its outward normal in `normal`: the shore guard keeps the yacht off piers.
   */
  structureClearance(x: number, z: number, normal: { x: number; z: number }): number {
    let best = Number.POSITIVE_INFINITY;
    const scratch = this.structureNormal;
    for (const visual of this.built.values()) {
      const pier = visual.pier;
      if (!pier || Math.abs(pier.x - x) > pier.length + 80 || Math.abs(pier.z - z) > pier.length + 80) continue;
      const distance = pierClearance(pier, x, z, scratch);
      if (distance < best) {
        best = distance;
        normal.x = scratch.x;
        normal.z = scratch.z;
      }
    }
    return best;
  }

  /** The island's character, hills and buildings (cached: decided from its id). */
  profile(island: IslandDefinition): IslandProfile {
    let profile = this.profiles.get(island.id);
    if (!profile) {
      if (this.profiles.size > 2048) this.profiles.clear();
      profile = islandProfile(island);
      this.profiles.set(island.id, profile);
    }
    return profile;
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
    for (const island of islandsAround(position.x, position.z)) {
      const dx = position.x - island.centerX;
      const dz = (position.z - island.centerZ) / island.scaleZ;
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
    for (const island of islandsAround(position.x, position.z)) {
      const dx = position.x - island.centerX;
      const dz = (position.z - island.centerZ) / island.scaleZ;
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
      // Subdivided: the water's depth over it is read per vertex, and two
      // triangles four kilometres across would put a straight seam in it.
      new THREE.PlaneGeometry(4200, 4200, 48, 48),
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

  /** Builds one island: its two terrain levels, its palms (merged into a few meshes) and its trunks. */
  private buildIsland(island: IslandDefinition): IslandVisual {
    const islandGroup = new THREE.Group();
    islandGroup.position.set(island.centerX, 0, island.centerZ);
    islandGroup.name = `TropicalIsland_${island.id}`;

    // Two levels of detail: the full terrain near, a third of the vertices
    // beyond a few hundred metres, where a ring of the coast is a pixel.
    const lod = new THREE.LOD();
    lod.name = "IslandTerrainLOD";
    for (const [detail, distance] of [[1, 0], [0.34, TERRAIN_LOD_DISTANCE]] as const) {
      const terrain = new THREE.Mesh(this.createIslandTerrain(island, detail), this.terrainMaterial);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      terrain.name = "IrregularIslandTerrain";
      // The ocean is rendered immediately after this mesh. Vertex alpha tapers
      // the submerged apron into the seabed so its final radial edge cannot read
      // as a large ring (or as a dark, flat animal) through clear tropical water.
      terrain.renderOrder = 1;
      lod.addLevel(terrain, distance);
    }
    lod.userData.radius = island.beachRadius * Math.max(1, island.scaleZ) * MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    islandGroup.add(lod);

    const palmParts: THREE.Mesh[] = [];
    const trunks: THREE.Vector4[] = [];
    this.plantPalms(island, islandGroup, palmParts, trunks);
    this.group.add(islandGroup);

    const holder = new THREE.Group();
    holder.name = `PalmGrove_${island.id}`;
    this.group.add(holder);
    const batches = this.mergeGrove(islandGroup, holder, palmParts, island.id);

    // Boulders, scrub and buildings, merged into a solid mesh and a glowing one.
    const furniture: THREE.Mesh[] = [];
    const profile = this.profile(island);
    const built = furnishIsland(island, profile, (radial, angle) => this.terrainSurfaceHeight(island, radial, angle));
    if (built.solid) {
      const mesh = new THREE.Mesh(built.solid, this.furnitureMaterial);
      mesh.name = `IslandFurniture_${island.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.farSeen = profile.lighthouseAngle !== null;
      islandGroup.add(mesh);
      furniture.push(mesh);
    }
    if (built.glow) {
      const mesh = new THREE.Mesh(built.glow, this.glowMaterial);
      mesh.name = `IslandLights_${island.id}`;
      mesh.userData.farSeen = true;
      islandGroup.add(mesh);
      furniture.push(mesh);
    }
    let beam: THREE.Group | null = null;
    if (built.lamp) {
      // Two beams back to back, turning, and the lamp itself.
      beam = new THREE.Group();
      beam.name = `LighthouseBeam_${island.id}`;
      beam.position.copy(built.lamp);
      for (const turn of [0, Math.PI]) {
        const ray = new THREE.Mesh(this.beamGeometry, this.beamMaterial);
        ray.rotation.y = turn;
        ray.frustumCulled = false;
        ray.renderOrder = 4;
        beam.add(ray);
      }
      const lamp = new THREE.Mesh(this.lampGeometry, this.lampMaterial);
      lamp.renderOrder = 4;
      beam.add(lamp);
      beam.visible = false;
      islandGroup.add(beam);
    }
    return { definition: island, group: islandGroup, holder, lod, batches, trunks, furniture, pier: built.pier, beam };
  }

  /**
   * Frees an island the yacht has left far behind. The terrain and the merged
   * grove batches own their geometry; a palm left unmerged is a clone sharing
   * the loaded asset's geometry, and the materials are shared by every island.
   */
  private releaseIsland(visual: IslandVisual): void {
    visual.group.removeFromParent();
    visual.holder.removeFromParent();
    visual.lod.levels.forEach(({ object }) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    visual.batches.forEach((batch) => batch.geometry.dispose());
    visual.batches.length = 0;
    visual.furniture.forEach((mesh) => mesh.geometry.dispose());
    visual.furniture.length = 0;
    visual.trunks.length = 0;
  }

  /**
   * The palm asset is a row of five tree variants laid out side by side. Each
   * tree is lifted out of that row and planted on its own spot, so a grove
   * stands on the island instead of trailing out to sea.
   */
  private plantPalms(
    island: IslandDefinition,
    islandGroup: THREE.Group,
    palmParts: THREE.Mesh[],
    trunks: THREE.Vector4[],
  ): void {
    const source = this.assets.palms();
    source.updateMatrixWorld(true);
    const container = source.getObjectByName("RootNode") ?? source;
    const variants = container.children.filter((child) => child.children.length > 0 || child instanceof THREE.Mesh);
    if (variants.length === 0) return;

    const seed = island.seed;
    const profile = this.profile(island);
    const clearings = islandClearings(island, profile);
    // A volcano has only a fringe of palms between the black beach and the lava slopes.
    const baseCount = island.volcano ? 9 : palmsForIsland(island.beachRadius);
    const count = profile.character === "lush" ? Math.round(baseCount * 1.35) : profile.character === "rocky" ? Math.round(baseCount * 0.7) : baseCount;
    for (let palmIndex = 0; palmIndex < count; palmIndex += 1) {
      const tree = variants[(palmIndex + seed) % variants.length].clone(true);
      // Remove the tree's slot in the source row, keep its upright rotation.
      tree.position.set(0, 0, 0);
      tree.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(tree);
      const height = Math.max(0.1, bounds.max.y - bounds.min.y);
      tree.position.y = -bounds.min.y;

      const spread = (palmIndex + 0.5) / count;
      const radial = island.volcano
        ? VOLCANO_FOOT - 0.06 + terrainNoise(palmIndex * 5.1, seed) * 0.05
        : 0.1 + Math.sqrt(spread) * (PALM_MAX_RADIAL - 0.1);
      const angle = palmIndex * GOLDEN_ANGLE + seed * 1.3;
      const radius = island.beachRadius * radial * islandEdgeNoise(angle, island);
      const px = Math.cos(angle) * radius;
      const pz = Math.sin(angle) * radius * island.scaleZ;
      // Nothing grows on the hut's or the lighthouse's ground.
      if (inClearing(clearings, px, pz, 1)) continue;
      // Young palms and old giants side by side.
      const grain = terrainNoise(palmIndex * 3.7 + seed * 11.1, palmIndex * 1.9);
      const size = 0.62 + grain * grain * 0.55 + terrainNoise(palmIndex * 7.3, seed * 2.9 + 4.1) * 0.28;

      const palm = new THREE.Group();
      palm.name = `GLB_Palm_${island.id}_${palmIndex + 1}`;
      palm.add(tree);
      palm.scale.setScalar(((11 + (seed % 3) * 1.2) * size) / height);
      // Coconut palms lean, most of all near the beach, out over the sand
      // toward the light; inland they stand straighter. Each its own way.
      const leanNoise = terrainNoise(palmIndex * 5.3 + seed * 1.7, seed * 3.3 + palmIndex);
      const lean = THREE.MathUtils.degToRad(3 + leanNoise * 9 + smoothstep(0.3, 0.66, radial) * (6 + leanNoise * 14));
      const leanToward = angle + (terrainNoise(palmIndex * 2.9, seed + 7.7) - 0.5) * 1.6;
      // Tilt about the horizontal axis square to the direction of the lean (outward is +X·cos, +Z·sin).
      const tiltAxis = new THREE.Vector3(Math.sin(leanToward), 0, -Math.cos(leanToward));
      palm.quaternion
        .setFromAxisAngle(tiltAxis, lean)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), palmIndex * 1.94 + seed));
      palm.position.set(
        px,
        // Roots sit slightly below the surface so no trunk floats on a dune.
        this.terrainSurfaceHeight(island, radial, angle) - 0.35,
        pz,
      );
      // Each trunk darkens the sand around its foot (contact shading).
      trunks.push(
        new THREE.Vector4(island.centerX + palm.position.x, palm.position.y, island.centerZ + palm.position.z, 1.1 * size),
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
   * trees of an island merge into one mesh per material: a handful of draw
   * calls for every palm in view instead of one per trunk and per crown, and a
   * grove off screen or in the haze is skipped whole.
   */
  private mergeGrove(islandGroup: THREE.Group, holder: THREE.Group, parts: THREE.Mesh[], id: number): THREE.Mesh[] {
    islandGroup.updateMatrixWorld(true);
    const result = batchStaticMeshes(
      holder,
      parts,
      (mesh) => `${(mesh.material as THREE.Material).uuid}|${mesh.castShadow}|${mesh.receiveShadow}`,
      `PalmGrove_${id}`,
    );
    // The groves are what the palm shadow map draws.
    result.batches.forEach((batch) => batch.layers.enable(PALM_SHADOW_LAYER));
    parts.filter((part) => part.parent).forEach((part) => part.layers.enable(PALM_SHADOW_LAYER));
    // Drop the now-empty tree nodes so they are not traversed every frame.
    [...islandGroup.children].forEach((child) => {
      let hasMesh = false;
      child.traverse((object) => {
        hasMesh ||= object instanceof THREE.Mesh;
      });
      if (!hasMesh) child.removeFromParent();
    });
    return result.batches;
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

  private createIslandTerrain(island: IslandDefinition, detail = 1): THREE.BufferGeometry {
    // Detail follows size: a cay needs far fewer vertices than a high island.
    const segments = Math.max(32, Math.round(THREE.MathUtils.clamp(island.beachRadius * 2.6, 96, 220) * detail));
    const rings = Math.max(12, Math.round((island.volcano ? 72 : THREE.MathUtils.clamp(20 + island.beachRadius * 0.3, 30, 52)) * detail));
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    const positions: number[] = [
      0,
      island.volcano ? this.terrainSurfaceHeight(island, 0, 0) : this.islandTerrainHeight(0, 0, island.seed, island.height),
      0,
    ];
    const colors: number[] = [];
    // 1 on sand, 0 under vegetation: the sand shading applies only where it is sand.
    const sandMask: number[] = [0];
    // 1 on a volcano's bare rock and ash slopes (cinder grain, lava relief), 0 elsewhere.
    const rockMask: number[] = [island.volcano ? 1 : 0];
    // High islands carry darker forest and bare rock toward the summit.
    const highland = smoothstep(3, 10, island.height);
    const indices: number[] = [];
    const green = new THREE.Color(island.seed % 3 === 1 ? 0x3d8448 : 0x3a8a4c);
    const dryGrass = new THREE.Color(0x7d9a4e);
    const shade = new THREE.Color(0x2a6a3c);
    const sand = new THREE.Color(0xd9c08a);
    const deepSand = new THREE.Color(0xb99a60);
    const wetSand = new THREE.Color(0xa98d58);
    const forest = new THREE.Color(0x24572f);
    const rock = new THREE.Color(0x6d6a5c);
    // A volcano: black sand, dark lava rock, grey ash high up, a rust-red rim.
    const volcanic = island.volcano === true;
    const lavaRock = new THREE.Color(0x3a332f);
    const oldFlow = new THREE.Color(0x26221f);
    const ash = new THREE.Color(0x77716a);
    const rim = new THREE.Color(0x5c3b2b);
    const blackSand = new THREE.Color(0x45403a);
    const wetBlackSand = new THREE.Color(0x2b2825);
    if (volcanic) colors.push(rim.r * 0.6, rim.g * 0.6, rim.b * 0.6, 1);
    else colors.push(green.r, green.g, green.b, 1);

    for (let ring = 1; ring <= rings; ring += 1) {
      // Rings crowd toward the beach, where the surf and the waterline need detail.
      // (A volcano needs its rings up the cone as much as at the beach.)
      const radial = outerRadius * Math.pow(ring / rings, island.volcano ? 0.92 : 0.72);
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        const edgeNoise = islandEdgeNoise(angle, island);
        const radius = island.beachRadius * radial * edgeNoise;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius * island.scaleZ;
        // Low-frequency patches break up the vegetation line and the dunes.
        const patch = terrainNoise(x * 0.11 + island.seed * 17.3, z * 0.11 - island.seed * 9.1);
        const fine = terrainNoise(x * 0.37 - island.seed * 4.2, z * 0.37 + island.seed * 13.7);
        const y = this.terrainSurfaceHeight(island, radial, angle);
        positions.push(x, y, z);

        const color = new THREE.Color();
        if (volcanic) {
          const alpha = 1 - smoothstep(0.965, outerRadius, radial);
          if (radial < VOLCANO_RIM + 0.02) {
            color.copy(rim).lerp(lavaRock, smoothstep(VOLCANO_RIM * 0.4, VOLCANO_RIM, radial) * 0.4);
          } else if (radial < VOLCANO_FOOT - 0.1) {
            // Rock and old flows down the flanks, ash toward the top.
            const height = (VOLCANO_FOOT - radial) / (VOLCANO_FOOT - VOLCANO_RIM);
            // Old flows: long dark tongues down the slope; ash streaks between.
            const flow = smoothstep(0.5, 0.75, terrainNoise(angle * 9 + island.seed, radial * 3));
            const streak = smoothstep(0.35, 0.9, terrainNoise(angle * 40 + island.seed * 3, radial * 2.5));
            color.copy(lavaRock).lerp(oldFlow, flow * 0.85).lerp(ash, (smoothstep(0.4, 0.95, height) * 0.6 + streak * 0.25) * (0.6 + 0.4 * fine));
            color.multiplyScalar(0.82 + fine * 0.3);
            // Scrub creeps up the lowest slopes in patches.
            color.lerp(shade, (1 - smoothstep(0.04, 0.22, height)) * smoothstep(0.45, 0.75, patch) * 0.8);
            color.lerp(rim, smoothstep(0.86, 1, height) * 0.5);
          } else if (radial < VOLCANO_FOOT + 0.04) {
            color.copy(shade).multiplyScalar(0.8).lerp(lavaRock, smoothstep(0.5, 0.8, fine) * 0.6).lerp(blackSand, smoothstep(VOLCANO_FOOT - 0.02, VOLCANO_FOOT + 0.04, radial));
          } else if (radial < 1) {
            color.copy(blackSand).lerp(wetBlackSand, smoothstep(0.93, 0.985, radial));
          } else {
            color.copy(wetBlackSand).lerp(deepSand, smoothstep(1, outerRadius, radial) * 0.4);
          }
          sandMask.push(smoothstep(VOLCANO_FOOT - 0.02, VOLCANO_FOOT + 0.06, radial));
          rockMask.push(1 - smoothstep(VOLCANO_FOOT - 0.12, VOLCANO_FOOT - 0.02, radial));
          colors.push(color.r, color.g, color.b, alpha);
          continue;
        }
        const profile = this.profile(island);
        const bump = hillHeight(profile, x, z, radial);
        const vegetationEdge = 0.7 + (patch - 0.5) * 0.16;
        sandMask.push(smoothstep(vegetationEdge - 0.04, vegetationEdge + 0.12, radial));
        rockMask.push(0);
        if (radial < vegetationEdge - 0.08) {
          color.copy(green).lerp(shade, smoothstep(0.35, 0.8, fine)).lerp(dryGrass, smoothstep(0.55, 0.9, patch) * 0.6);
          if (highland > 0) {
            const summit = 1 - smoothstep(0.05, 0.45, radial);
            color.lerp(forest, highland * smoothstep(0.2, 0.7, fine) * 0.7);
            color.lerp(rock, highland * summit * smoothstep(0.45, 0.75, patch) * 0.8);
          }
          // Hills: forest on their flanks, bare granite on a rocky island's tops.
          if (bump > 0.5) {
            color.lerp(forest, smoothstep(0.5, 3, bump) * (1 - profile.rockiness) * 0.6);
            color.lerp(rock, profile.rockiness * smoothstep(1.5, 4.5, bump) * (0.55 + 0.45 * fine));
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
    geometry.setAttribute("rockMask", new THREE.Float32BufferAttribute(rockMask, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Height of the rendered terrain at a polar position, dunes and hummocks included. */
  terrainSurfaceHeight(island: IslandDefinition, radial: number, angle: number): number {
    if (island.volcano) {
      if (radial < VOLCANO_FOOT) return volcanoHeight(radial, angle, island.height, island.seed);
      // The foot of the cone runs down to the beach as on any island.
      const beach = radial < 0.9 ? 0.68 + ((radial - VOLCANO_FOOT) / (0.9 - VOLCANO_FOOT)) * 0.22 : radial;
      return this.islandTerrainHeight(beach, angle, island.seed, 1.36);
    }
    const radius = island.beachRadius * radial * islandEdgeNoise(angle, island);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * island.scaleZ;
    const patch = terrainNoise(x * 0.11 + island.seed * 17.3, z * 0.11 - island.seed * 9.1);
    const highland = smoothstep(3, 10, island.height);
    return (
      this.islandTerrainHeight(radial, angle, island.seed, island.height) +
      (patch - 0.5) * (0.5 + highland * 1.6) * (1 - smoothstep(0.7, 0.95, radial)) +
      hillHeight(this.profile(island), x, z, radial)
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

/**
 * A lighthouse's beam: a long cone along +X from the lamp, brightest at the
 * lamp and fading with distance and toward its edges (vertex alpha).
 */
function createBeamGeometry(): THREE.BufferGeometry {
  const length = 150;
  const geometry = new THREE.CylinderGeometry(0.5, 9, length, 20, 12, true);
  geometry.translate(0, -length / 2, 0);
  geometry.rotateZ(Math.PI / 2);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 4);
  for (let index = 0; index < position.count; index += 1) {
    const t = Math.min(1, Math.max(0, position.getX(index) / length));
    const fade = Math.pow(1 - t, 1.6) * (0.35 + 0.65 * Math.exp(-t * 6));
    colors[index * 4] = 1;
    colors[index * 4 + 1] = 0.9;
    colors[index * 4 + 2] = 0.68;
    colors[index * 4 + 3] = fade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  return geometry;
}
