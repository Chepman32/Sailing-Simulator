import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { computeBoundingSphereFast, computeVertexNormalsFast, mergeTransformed } from "../core/FastGeometry";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { smoothstep } from "../math";
import type { UnderwaterLight } from "./UnderwaterLight";
import { applyFurnitureSurface } from "./FurnitureSurface";
import {
  addIslandShadows,
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
  MAX_EDGE_NOISE,
  islandsWithin,
  selectIslandSlots,
  shoreClearance,
  terrainNoise,
  VOLCANO_DRAW_DISTANCE,
  VOLCANO_FOOT,
  VOLCANO_RIM,
  volcanoHeight,
  waterDepthAt,
  type IslandDefinition,
} from "./IslandMath";
import { ISLAND_SLOT_UNIFORMS } from "./SurfMath";
import { createBarkTextures, createFrondTexture, createPalmVariants, type PalmPart, type PalmVariant } from "./PalmModels";
import { buildGrass, createGrassMaterial, createLeafClusterTexture, grassAmount } from "./IslandVegetation";
import { GrassField } from "./GrassField";
import { patchMaterialShader } from "../core/ShaderPatch";
import {
  furnishIsland,
  hillHeight,
  inClearing,
  islandClearings,
  islandPoint,
  islandProfile,
  traderSpot,
  LIGHTHOUSE_SCALE,
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
  /** Boulders and tors a walker goes round (world x, z and radius). */
  stones: THREE.Vector3[];
  /** Boulders, scrub, pier, hut, lighthouse (see IslandProps), and what glows at night. */
  furniture: THREE.Mesh[];
  pier: PierFootprint | null;
  beam: THREE.Group | null;
  /** Grass tufts over the turf, drawn only near the camera. */
  grass: THREE.Mesh | null;
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
/** Grass tufts are drawn within this distance of the camera (beyond it they are below a pixel). */
const GRASS_DRAW_DISTANCE = 240;
/** Beyond this a grove is drawn from its coarse palms (a third of the triangles). */
export const GROVE_DETAIL_DISTANCE = 230;
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
  /** Procedural palm variants (near and far detail) and the three materials every grove shares. */
  private palmVariants: { near: PalmVariant[]; far: PalmVariant[] } | null = null;
  private palmPartMaterials: Record<PalmPart, THREE.Material> | null = null;
  private readonly palmTextures: THREE.Texture[] = [];
  private leafMaterial: THREE.Material | null = null;
  private readonly grassMaterial: THREE.MeshStandardMaterial;
  /** Dense instanced grass round the viewer (off on the low preset). */
  private grassField: GrassField | null = null;
  private readonly clearingCache = new Map<number, ReturnType<typeof islandClearings>>();
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
    // Granite grain, leafy bushes, wood grain; in the island shadows.
    applyFurnitureSurface(this.furnitureMaterial, this.surface, this.sky);
    this.grassMaterial = createGrassMaterial(this.palmWind, this.palmStrength);
    patchMaterialShader(this.grassMaterial, "grass-shadows", (shader) => addIslandShadows(shader, this.surface, 2));
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
          this.invalidateGrass(island);
          this.clearingCache.delete(island.id);
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
      this.invalidateGrass(definition);
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
  update(time: number, wind = 1, focusX = 0, focusZ = 0, viewer?: THREE.Vector3): void {
    this.palmWind.value = time;
    for (const visual of this.built.values()) if (visual.beam) visual.beam.rotation.y = time * BEAM_SPEED + visual.definition.id * 0.7;
    this.palmStrength.value = Math.min(3.2, Math.max(0.4, wind));
    // The dense grass grows round the eyes (the diver's ashore, else the camera's).
    if (this.grassField && viewer) this.grassField.update(time, wind, viewer, viewer.y > -0.5);
    this.surface.uSurfTime.value = time;
    selectIslandSlots(focusX, focusZ, ISLAND_SLOT_UNIFORMS.uIslandShape.value, ISLAND_SLOT_UNIFORMS.uIslandFrame.value);
    this.seabed.position.x = Math.round(focusX / 50) * 50;
    this.seabed.position.z = Math.round(focusZ / 50) * 50;
    // Distant islands are hidden whole (both levels of detail); groves sooner.
    // Islands far off are left out of the water's mirror, where they would
    // be a sliver at the horizon fade.
    this.farFromMirror.length = 0;
    this.stream(focusX, focusZ, BUILDS_PER_FRAME);
    this.built.forEach(({ lod, definition }) => {
      const island = lod.parent!;
      const gap = Math.hypot(island.position.x - focusX, island.position.z - focusZ) - lod.userData.radius;
      // A volcano is a landmark: its cone stays in view as far as its plume
      // does, on every preset (a plume over an empty horizon gave it away).
      lod.visible = gap < (definition.volcano ? VOLCANO_DRAW_DISTANCE : ISLAND_DRAW_DISTANCE * this.drawScale);
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
        // Bush leaf cards add nothing to the blurred mirror image beyond the bush cores.
        if (mesh.visible && (gap > MIRROR_DISTANCE || mesh.userData.leafCards === true)) this.farFromMirror.push(mesh);
      }
      if (visual.beam) visual.beam.visible = this.night > 0.05 && visual.lod.visible;
      if (visual.grass) {
        const sphere = visual.grass.geometry.boundingSphere!;
        const island = visual.group.position;
        const from = viewer ?? { x: focusX, z: focusZ };
        const gap = Math.max(0, Math.hypot(island.x + sphere.center.x - from.x, island.z + sphere.center.z - from.z) - sphere.radius);
        visual.grass.visible = visual.lod.visible && gap < GRASS_DRAW_DISTANCE * this.drawScale;
        // Blades are far below what the blurred mirror image can show.
        if (visual.grass.visible) this.farFromMirror.push(visual.grass);
      }
    }
    const eye = viewer ?? null;
    for (const mesh of this.groves) {
      const sphere = mesh.geometry.boundingSphere;
      if (!sphere) continue;
      const gap = Math.max(0, Math.hypot(sphere.center.x - focusX, sphere.center.z - focusZ) - sphere.radius);
      // Near or far palms by the camera's distance (a chase camera or a
      // photographer can stand well away from the yacht).
      const seen = eye ? Math.max(0, Math.hypot(sphere.center.x - eye.x, sphere.center.z - eye.z) - sphere.radius) : gap;
      const near = seen < GROVE_DETAIL_DISTANCE;
      mesh.visible = gap < GROVE_DRAW_DISTANCE * this.drawScale && (mesh.userData.palmLevel === "near") === near;
      // Coconuts are too small for the mirror.
      if (mesh.visible && (gap > MIRROR_DISTANCE || mesh.material === this.palmPartMaterials?.nuts)) this.farFromMirror.push(mesh);
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

  /**
   * Height of an island's ground at (x, z) — beach, hills, crater, and the
   * apron that runs on under the shallows — as drawn; −Infinity where no
   * island's terrain is. Someone walking ashore stands on this.
   */
  terrainHeightAt(x: number, z: number): number {
    let best = Number.NEGATIVE_INFINITY;
    for (const island of islandsAround(x, z)) {
      const dx = x - island.centerX;
      const dz = (z - island.centerZ) / island.scaleZ;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > island.beachRadius * MAX_EDGE_NOISE * MAX_VISIBLE_TERRAIN_RADIUS_SCALE) continue;
      const angle = Math.atan2(dz, dx);
      const radial = r / (island.beachRadius * islandEdgeNoise(angle, island));
      if (radial > MAX_VISIBLE_TERRAIN_RADIUS_SCALE) continue;
      const height = this.terrainSurfaceHeight(island, radial, angle);
      if (height > best) best = height;
    }
    return best;
  }

  /** Top of a pier's planking over (x, z), or −Infinity (the deck is 1.15 m over the sea, see `IslandProps.addPier`). */
  pierDeckAt(x: number, z: number): number {
    for (const visual of this.built.values()) {
      const pier = visual.pier;
      if (!pier || Math.abs(pier.x - x) > pier.length + 4 || Math.abs(pier.z - z) > pier.length + 4) continue;
      const dx = x - pier.x;
      const dz = z - pier.z;
      const along = dx * pier.dirX + dz * pier.dirZ;
      const across = Math.abs(-dx * pier.dirZ + dz * pier.dirX);
      // The footprint is padded for the yacht; the walk is the planks: a
      // 2.3 m deck and the T at its end.
      const deckLength = pier.length - 2.4;
      if (along < -0.2 || along > deckLength + 2.4) continue;
      if (across < (along > deckLength - 0.3 ? 2.25 : 1.15)) return 1.18;
    }
    return Number.NEGATIVE_INFINITY;
  }

  /**
   * Distance from (x, z) to the nearest thing standing on an island that a
   * walker goes round (a palm trunk, a lighthouse, a hut; negative inside)
   * and its outward direction in `normal`; Infinity where there is none.
   */
  obstacleClearance(x: number, z: number, normal: { x: number; z: number }): number {
    let best = Number.POSITIVE_INFINITY;
    const consider = (cx: number, cz: number, radius: number) => {
      const dx = x - cx;
      const dz = z - cz;
      const length = Math.sqrt(dx * dx + dz * dz);
      const distance = length - radius;
      if (distance >= best) return;
      best = distance;
      normal.x = length > 1e-6 ? dx / length : 1;
      normal.z = length > 1e-6 ? dz / length : 0;
    };
    for (const visual of this.built.values()) {
      const island = visual.definition;
      const reach = island.beachRadius * Math.max(1, island.scaleZ) * 1.2 + 10;
      if (Math.abs(island.centerX - x) > reach || Math.abs(island.centerZ - z) > reach) continue;
      for (const trunk of visual.trunks) {
        if (Math.abs(trunk.x - x) > 3 || Math.abs(trunk.z - z) > 3) continue;
        consider(trunk.x, trunk.z, 0.16 + trunk.w * 0.08);
      }
      for (const stone of visual.stones) {
        if (Math.abs(stone.x - x) > stone.z + 3 || Math.abs(stone.y - z) > stone.z + 3) continue;
        consider(stone.x, stone.y, stone.z);
      }
      const profile = this.profile(island);
      if (profile.lighthouseAngle !== null) {
        const spot = islandPoint(island, 0.5, profile.lighthouseAngle);
        // The granite plinth, the tower's foot.
        consider(island.centerX + spot.x, island.centerZ + spot.z, 2.55 * LIGHTHOUSE_SCALE);
      }
      if (profile.pierAngle !== null) {
        const spot = islandPoint(island, 0.74, profile.pierAngle + 0.2);
        consider(island.centerX + spot.x, island.centerZ + spot.z, 2.3);
      }
    }
    return best;
  }

  /** The traders of the islands built round here: where each stands and which way he faces. */
  traderSpots(out: { id: number; x: number; z: number; facing: number }[] = []): { id: number; x: number; z: number; facing: number }[] {
    out.length = 0;
    for (const visual of this.built.values()) {
      const spot = traderSpot(visual.definition, this.profile(visual.definition));
      if (spot) out.push({ id: visual.definition.id, ...spot });
    }
    return out;
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

  private readonly mirrorSwap: THREE.Mesh[] = [];

  /**
   * For the water's mirror: shows the coarse palms where the fine ones are
   * shown (on), and puts them back (off). Returns whether anything changed.
   */
  coarseGrovesForMirror(on: boolean): boolean {
    if (!on) {
      for (const mesh of this.mirrorSwap) mesh.visible = !mesh.visible;
      const changed = this.mirrorSwap.length > 0;
      this.mirrorSwap.length = 0;
      return changed;
    }
    this.mirrorSwap.length = 0;
    for (const visual of this.built.values()) {
      const near = visual.batches.filter((mesh) => mesh.userData.palmLevel === "near" && mesh.visible);
      if (near.length === 0) continue;
      for (const mesh of visual.batches) this.mirrorSwap.push(mesh);
    }
    for (const mesh of this.mirrorSwap) mesh.visible = !mesh.visible;
    return this.mirrorSwap.length > 0;
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

  /**
   * The dense grass: its reach (m) and fraction of the full density (0 off).
   * The field is built on first use and shares the islands' shadows.
   */
  setGrass(radius: number, density: number): void {
    if (radius <= 0 || density <= 0) {
      this.grassField?.setQuality(0, 0);
      return;
    }
    this.grassField ??= new GrassField(
      this.scene,
      {
        amount: (x, z) => this.turfAt(x, z),
        ground: (x, z) => this.terrainHeightAt(x, z),
        landIn: (x0, z0, x1, z1) => {
          for (const visual of this.built.values()) {
            const island = visual.definition;
            if (island.volcano) continue;
            const reach = island.beachRadius * Math.max(1, island.scaleZ) * MAX_EDGE_NOISE;
            if (island.centerX + reach < x0 || island.centerX - reach > x1 || island.centerZ + reach < z0 || island.centerZ - reach > z1) continue;
            return true;
          }
          return false;
        },
      },
      this.sky,
      (material) => patchMaterialShader(material, "grass-field-shadows", (shader) => addIslandShadows(shader, this.surface, 2)),
    );
    this.grassField.setQuality(radius, density);
  }

  /**
   * How much turf grows at (x, z), 0…1: the island's own grass line (the
   * same as its tussocks'), nothing in clearings (round the hut and the
   * lighthouse), on rocks or against palm trunks, nor on a volcano.
   */
  turfAt(x: number, z: number): number {
    for (const visual of this.built.values()) {
      const island = visual.definition;
      if (island.volcano || island.beachRadius < 12) continue;
      const reach = island.beachRadius * Math.max(1, island.scaleZ) * MAX_EDGE_NOISE;
      if (Math.abs(x - island.centerX) > reach || Math.abs(z - island.centerZ) > reach) continue;
      const lx = x - island.centerX;
      const lz = z - island.centerZ;
      const { grass } = grassAmount(island, lx, lz);
      if (grass <= 0) continue;
      let clearings = this.clearingCache.get(island.id);
      if (!clearings) {
        clearings = islandClearings(island, this.profile(island));
        this.clearingCache.set(island.id, clearings);
      }
      // The grass thins out over the last couple of metres into a clearing, not at a ruled ring.
      let edge = Number.POSITIVE_INFINITY;
      for (const clearing of clearings) edge = Math.min(edge, Math.hypot(lx - clearing.x, lz - clearing.z) - clearing.radius);
      if (edge < 0) return 0;
      const thinning = smoothstep(0, 2.2, edge);
      for (const stone of visual.stones) {
        if (Math.abs(stone.x - x) < stone.z + 0.3 && Math.abs(stone.y - z) < stone.z + 0.3 && Math.hypot(stone.x - x, stone.y - z) < stone.z + 0.15) return 0;
      }
      for (const trunk of visual.trunks) {
        if (Math.abs(trunk.x - x) < 0.45 && Math.abs(trunk.z - z) < 0.45) return grass * 0.3 * thinning;
      }
      return grass * thinning;
    }
    return 0;
  }

  private invalidateGrass(island: IslandDefinition): void {
    if (!this.grassField) return;
    const reach = island.beachRadius * Math.max(1, island.scaleZ) * MAX_EDGE_NOISE;
    this.grassField.invalidateArea(island.centerX - reach, island.centerZ - reach, island.centerX + reach, island.centerZ + reach);
  }

  dispose(): void {
    this.grassField?.dispose();
    this.palmShadows.dispose();
    this.terrainMaterial.dispose();
    this.grassMaterial.dispose();
    this.palmTextures.forEach((texture) => texture.dispose());
    for (const material of this.palmMaterials.values()) (material.userData.shadowDepth as THREE.Material | undefined)?.dispose();
    // The palm variants' own geometries (the groves are merged copies).
    for (const variant of [...(this.palmVariants?.near ?? []), ...(this.palmVariants?.far ?? [])]) Object.values(variant.parts).forEach((geometry) => geometry.dispose());
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }

  /** The distant flat bottom; a diver has his own detailed one, so it is hidden under the water. */
  setDeepSeabedVisible(visible: boolean): void {
    this.seabed.visible = visible;
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

    const trunks: THREE.Vector4[] = [];
    this.group.add(islandGroup);

    const holder = new THREE.Group();
    holder.name = `PalmGrove_${island.id}`;
    this.group.add(holder);
    const batches = this.plantPalms(island, holder, trunks);

    // Boulders, scrub and buildings, merged into a solid mesh and a glowing one.
    const furniture: THREE.Mesh[] = [];
    const profile = this.profile(island);
    const built = furnishIsland(island, profile, (radial, angle) => this.terrainSurfaceHeight(island, radial, angle));
    if (built.solid) {
      const mesh = new THREE.Mesh(built.solid, this.furnitureMaterial);
      mesh.name = `IslandFurniture_${island.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Bushes, rocks and huts shade the ground around them.
      mesh.layers.enable(PALM_SHADOW_LAYER);
      mesh.userData.farSeen = profile.lighthouseAngle !== null;
      islandGroup.add(mesh);
      furniture.push(mesh);
    }
    if (built.leaves) {
      const mesh = new THREE.Mesh(built.leaves, this.leafClusterMaterial());
      mesh.name = `IslandBushLeaves_${island.id}`;
      mesh.userData.leafCards = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(PALM_SHADOW_LAYER);
      islandGroup.add(mesh);
      furniture.push(mesh);
    }
    let grass: THREE.Mesh | null = null;
    const clearings = islandClearings(island, profile);
    const grassGeometry = buildGrass(
      island,
      (radial, angle) => this.terrainSurfaceHeight(island, radial, angle),
      (x, z) => inClearing(clearings, x, z, 0.5),
    );
    if (grassGeometry) {
      grass = new THREE.Mesh(grassGeometry, this.grassMaterial);
      grass.name = `IslandGrass_${island.id}`;
      grass.receiveShadow = true;
      grass.visible = false;
      islandGroup.add(grass);
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
      // The beams and the lamp grow with the tower.
      beam.scale.setScalar(LIGHTHOUSE_SCALE);
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
    const stones = built.stones.map((stone) => new THREE.Vector3(island.centerX + stone.x, island.centerZ + stone.z, stone.radius));
    return { definition: island, group: islandGroup, holder, lod, batches, trunks, stones, furniture, pier: built.pier, beam, grass };
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
    visual.grass?.geometry.dispose();
    visual.furniture.length = 0;
    visual.trunks.length = 0;
  }

  /** The bushes' leaf cards: cut-out leaf clusters, lit through, in the island shadows. */
  private leafClusterMaterial(): THREE.Material {
    if (!this.leafMaterial) {
      const texture = createLeafClusterTexture();
      this.palmTextures.push(texture);
      const source = new THREE.MeshStandardMaterial({
        name: "BushLeaves",
        map: texture,
        vertexColors: true,
        roughness: 0.55,
        metalness: 0,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      });
      source.alphaToCoverage = true;
      source.userData.translucent = true;
      this.leafMaterial = this.palmMaterial(source);
      this.leafMaterial.userData.shadowDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
    }
    return this.leafMaterial;
  }

  /** The palm variants and their materials, made once and shared by every island. */
  private palmKit(): { near: PalmVariant[]; far: PalmVariant[]; materials: Record<PalmPart, THREE.Material> } {
    if (!this.palmVariants || !this.palmPartMaterials) {
      this.palmVariants = createPalmVariants(6);
      const frond = createFrondTexture();
      const { bark, normal } = createBarkTextures();
      this.palmTextures.push(frond, bark, normal);
      const trunk = new THREE.MeshStandardMaterial({ name: "PalmTrunk", map: bark, normalMap: normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9, metalness: 0 });
      const leaves = new THREE.MeshStandardMaterial({
        name: "PalmLeaves",
        map: frond,
        vertexColors: true,
        roughness: 0.6,
        metalness: 0,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      });
      // Leaflet edges are soft where the frame is multisampled.
      leaves.alphaToCoverage = true;
      leaves.userData.translucent = true;
      const nuts = new THREE.MeshStandardMaterial({ name: "PalmNuts", vertexColors: true, roughness: 0.75, metalness: 0 });
      this.palmPartMaterials = {
        trunk: this.palmMaterial(trunk),
        fronds: this.palmMaterial(leaves),
        nuts: this.palmMaterial(nuts),
      };
      // The shadow map cuts the leaflets out of the fronds' shadows too.
      this.palmPartMaterials.fronds.userData.shadowDepth = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: frond,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
    }
    return { ...this.palmVariants, materials: this.palmPartMaterials };
  }

  /**
   * Plants an island's palms: where each stands, how tall, which way it
   * leans. The trees are procedural coconut palms (`PalmModels`); a grove
   * is merged into one mesh per part (trunks, fronds, nuts) at two levels of
   * detail, so a whole grove is three draw calls near and three far.
   */
  private plantPalms(island: IslandDefinition, holder: THREE.Group, trunks: THREE.Vector4[]): THREE.Mesh[] {
    const kit = this.palmKit();
    const seed = island.seed;
    const profile = this.profile(island);
    const clearings = islandClearings(island, profile);
    // A volcano has only a fringe of palms between the black beach and the lava slopes.
    const baseCount = island.volcano ? 9 : palmsForIsland(island.beachRadius);
    const count = profile.character === "lush" ? Math.round(baseCount * 1.35) : profile.character === "rocky" ? Math.round(baseCount * 0.7) : baseCount;
    const placed: { matrix: THREE.Matrix4; variant: number }[] = [];
    const quaternion = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let palmIndex = 0; palmIndex < count; palmIndex += 1) {
      const variant = (palmIndex * 7 + seed) % kit.near.length;
      const height = kit.near[variant]!.height;
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
      // Coconut palms lean, most of all near the beach, out over the sand
      // toward the light; inland they stand straighter. Each its own way.
      const leanNoise = terrainNoise(palmIndex * 5.3 + seed * 1.7, seed * 3.3 + palmIndex);
      const lean = THREE.MathUtils.degToRad(2 + leanNoise * 6 + smoothstep(0.3, 0.66, radial) * (4 + leanNoise * 10));
      const leanToward = angle + (terrainNoise(palmIndex * 2.9, seed + 7.7) - 0.5) * 1.6;
      // Tilt about the horizontal axis square to the direction of the lean (outward is +X·cos, +Z·sin).
      const tiltAxis = new THREE.Vector3(Math.sin(leanToward), 0, -Math.cos(leanToward));
      // The trunk's own curve bends along its +X: turn it to face the lean.
      quaternion.setFromAxisAngle(tiltAxis, lean).multiply(spin.setFromAxisAngle(up, -leanToward));
      const s = ((11 + (seed % 3) * 1.2) * size) / height;
      position.set(
        island.centerX + px,
        // Roots sit slightly below the surface so no trunk floats on a dune.
        this.terrainSurfaceHeight(island, radial, angle) - 0.3,
        island.centerZ + pz,
      );
      placed.push({ matrix: new THREE.Matrix4().compose(position, quaternion, scale.setScalar(s)), variant });
      // Each trunk darkens the sand around its foot (contact shading).
      trunks.push(new THREE.Vector4(position.x, position.y + 0.3, position.z, 1.1 * size));
    }
    const meshes: THREE.Mesh[] = [];
    if (placed.length === 0) return meshes;
    const matrices = placed.map(({ matrix }) => matrix);
    for (const [level, variants] of [["near", kit.near], ["far", kit.far]] as const) {
      for (const part of ["trunk", "fronds", "nuts"] as const) {
        const sources = placed.map(({ variant }) => variants[variant]!.parts[part]);
        let merged = mergeTransformed(sources, matrices);
        if (!merged) {
          const pieces = sources.map((source, index) => source.clone().applyMatrix4(matrices[index]!));
          merged = mergeGeometries(pieces, false);
          pieces.forEach((piece) => piece.dispose());
        }
        if (!merged) continue;
        computeBoundingSphereFast(merged);
        const mesh = new THREE.Mesh(merged, kit.materials[part]);
        mesh.name = `PalmGrove_${island.id}_${part}_${level}`;
        mesh.userData.palmLevel = level;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = part !== "nuts";
        mesh.receiveShadow = true;
        // The groves are what the palm shadow map draws.
        mesh.layers.enable(PALM_SHADOW_LAYER);
        holder.add(mesh);
        meshes.push(mesh);
      }
    }
    return meshes;
  }

  /** One wind-animated material per source material, shared by every palm. */
  private palmMaterial(source: THREE.Material): THREE.Material {
    const existing = this.palmMaterials.get(source);
    if (existing) return existing;
    const material = source.clone();
    const translucent = material.userData.translucent === true;
    const wind = this.palmWind;
    const strength = this.palmStrength;
    const sky = this.sky;
    const surface = this.surface;
    material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPalmTime = wind;
      shader.uniforms.uPalmStrength = strength;
      shader.uniforms.uSunDirection = sky.uSunDirection!;
      shader.uniforms.uSunColor = sky.uSunColor!;
      shader.uniforms.uNight = sky.uNight!;
      // Sway in world space so every tree bends the same way in the same
      // breeze, whatever its own scale and orientation. Fronds also flutter:
      // a quicker, smaller shiver that grows toward their tips.
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uPalmTime;\nuniform float uPalmStrength;\nvarying vec3 vPalmWorld;")
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
           vec4 palmWorld = modelMatrix * vec4(transformed, 1.0);
           float palmSway = smoothstep(1.5, 13.0, palmWorld.y);
           palmSway *= palmSway;
           float palmPhase = uPalmTime * 1.3 + palmWorld.x * 0.23 + palmWorld.z * 0.17;
           palmWorld.x += (sin(palmPhase) * 0.34 + 0.22) * palmSway * uPalmStrength;
           palmWorld.z += (cos(palmPhase * 0.73) * 0.2 + 0.14) * palmSway * uPalmStrength;
           ${translucent ? `float palmFlutter = sin(uPalmTime * 7.1 + palmWorld.x * 1.9 + palmWorld.z * 2.3) * 0.045 * uPalmStrength * palmSway;
           palmWorld.y += palmFlutter;` : ""}
           vPalmWorld = palmWorld.xyz;
           mvPosition = viewMatrix * palmWorld;
           gl_Position = projectionMatrix * mvPosition;`,
        );
      if (translucent) {
        // Leaves are thin: with the sun behind them they glow yellow-green,
        // and their undersides are lit through the blade. Ambient occlusion
        // deep in the crown (toward its centre and underneath).
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec3 uSunDirection;\nuniform vec3 uSunColor;\nuniform float uNight;\nvarying vec3 vPalmWorld;",
          )
          .replace(
            "#include <opaque_fragment>",
            `{
               vec3 toEye = normalize(cameraPosition - vPalmWorld);
               float through = pow(max(dot(-toEye, uSunDirection), 0.0), 4.0);
               float day = (1.0 - uNight) * smoothstep(-0.05, 0.15, uSunDirection.y);
               outgoingLight += diffuseColor.rgb * vec3(1.15, 1.25, 0.55) * uSunColor * (0.22 + 1.1 * through) * day * 0.55;
             }
             #include <opaque_fragment>`,
          );
      } else {
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vPalmWorld;");
      }
      // Crowns shade their own trunks and the fronds below them.
      addIslandShadows(shader, surface, translucent ? 2 : 4);
    };
    material.customProgramCacheKey = () => `palm-wind-v6-${translucent ? "leaf" : "solid"}`;
    this.palmMaterials.set(source, material);
    return material;
  }

  private createIslandTerrain(island: IslandDefinition, detail = 1): THREE.BufferGeometry {
    // Detail follows size: a cay needs far fewer vertices than a high island.
    const segments = Math.max(32, Math.round(THREE.MathUtils.clamp(island.beachRadius * 2.6, 96, 220) * detail));
    const rings = Math.max(12, Math.round((island.volcano ? 72 : THREE.MathUtils.clamp(20 + island.beachRadius * 0.3, 30, 52)) * detail));
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    // Typed arrays of the final size: a high island is some 11k vertices, and
    // this runs while the yacht sails (an island streaming in).
    const vertexCount = 1 + rings * segments;
    const positions = new Float32Array(vertexCount * 3);
    positions[1] = island.volcano ? this.terrainSurfaceHeight(island, 0, 0) : this.islandTerrainHeight(0, 0, island.seed, island.height);
    const colors = new Float32Array(vertexCount * 4);
    // 1 on sand, 0 under vegetation: the sand shading applies only where it is sand.
    const sandMask = new Float32Array(vertexCount);
    // 1 on a volcano's bare rock and ash slopes (cinder grain, lava relief), 0 elsewhere.
    const rockMask = new Float32Array(vertexCount);
    rockMask[0] = island.volcano ? 1 : 0;
    // High islands carry darker forest and bare rock toward the summit.
    const highland = smoothstep(3, 10, island.height);
    const profile = this.profile(island);
    // The coastline's shape depends on the angle alone: once per segment, not per vertex.
    const angles = new Float64Array(segments);
    const cosines = new Float64Array(segments);
    const sines = new Float64Array(segments);
    const edges = new Float64Array(segments);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      angles[segment] = angle;
      cosines[segment] = Math.cos(angle);
      sines[segment] = Math.sin(angle);
      edges[segment] = islandEdgeNoise(angle, island);
    }
    const color = new THREE.Color();
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
    if (volcanic) colors.set([rim.r * 0.6, rim.g * 0.6, rim.b * 0.6, 1], 0);
    else colors.set([green.r, green.g, green.b, 1], 0);

    let vertex = 1;
    for (let ring = 1; ring <= rings; ring += 1) {
      // Rings crowd toward the beach, where the surf and the waterline need detail.
      // (A volcano needs its rings up the cone as much as at the beach.)
      const radial = outerRadius * Math.pow(ring / rings, island.volcano ? 0.92 : 0.72);
      const alpha = 1 - smoothstep(0.965, outerRadius, radial);
      for (let segment = 0; segment < segments; segment += 1, vertex += 1) {
        const angle = angles[segment]!;
        const radius = island.beachRadius * radial * edges[segment]!;
        const x = cosines[segment]! * radius;
        const z = sines[segment]! * radius * island.scaleZ;
        // Low-frequency patches break up the vegetation line and the dunes.
        const patch = terrainNoise(x * 0.11 + island.seed * 17.3, z * 0.11 - island.seed * 9.1);
        const fine = terrainNoise(x * 0.37 - island.seed * 4.2, z * 0.37 + island.seed * 13.7);
        // The height is `terrainSurfaceHeight`'s, from the values already at hand.
        const bump = volcanic ? 0 : hillHeight(profile, x, z, radial);
        const y = volcanic
          ? this.terrainSurfaceHeight(island, radial, angle)
          : this.islandTerrainHeight(radial, angle, island.seed, island.height) +
            (patch - 0.5) * (0.5 + highland * 1.6) * (1 - smoothstep(0.7, 0.95, radial)) +
            bump;
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;

        if (volcanic) {
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
          sandMask[vertex] = smoothstep(VOLCANO_FOOT - 0.02, VOLCANO_FOOT + 0.06, radial);
          rockMask[vertex] = 1 - smoothstep(VOLCANO_FOOT - 0.12, VOLCANO_FOOT - 0.02, radial);
        } else {
          const vegetationEdge = 0.7 + (patch - 0.5) * 0.16;
          sandMask[vertex] = smoothstep(vegetationEdge - 0.04, vegetationEdge + 0.12, radial);
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
        }
        colors[vertex * 4] = color.r;
        colors[vertex * 4 + 1] = color.g;
        colors[vertex * 4 + 2] = color.b;
        colors[vertex * 4 + 3] = alpha;
      }
    }

    const indices = new (vertexCount > 65535 ? Uint32Array : Uint16Array)((segments + (rings - 1) * segments * 2) * 3);
    let cursor = 0;
    for (let segment = 0; segment < segments; segment += 1) {
      // Counter-clockwise seen from above, so the lit front face is the top.
      indices[cursor++] = 0;
      indices[cursor++] = 1 + (segment + 1) % segments;
      indices[cursor++] = 1 + segment;
    }
    for (let ring = 1; ring < rings; ring += 1) {
      const innerStart = 1 + (ring - 1) * segments;
      const outerStart = 1 + ring * segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices[cursor++] = innerStart + segment;
        indices[cursor++] = innerStart + next;
        indices[cursor++] = outerStart + segment;
        indices[cursor++] = innerStart + next;
        indices[cursor++] = outerStart + next;
        indices[cursor++] = outerStart + segment;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute("sandMask", new THREE.BufferAttribute(sandMask, 1));
    geometry.setAttribute("rockMask", new THREE.BufferAttribute(rockMask, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    computeVertexNormalsFast(geometry);
    computeBoundingSphereFast(geometry);
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
