import * as THREE from "three";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetManager } from "../core/AssetManager";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import { ISLAND_DEFINITIONS, islandEdgeNoise, waterDepthAt, WATERLINE_RADIAL } from "../environment/IslandMath";
import type { OceanSystem } from "../environment/OceanSystem";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import {
  REEF_FISH_SPECIES,
  createFishAgent,
  stepSchool,
  tailAmplitude,
  type FishAgent,
  type FishSpecies,
  type FishThreat,
  type FishWorld,
} from "./ReefFishMath";

/**
 * Reef fish schools rendered with instancing.
 *
 * The licensed school asset contains nine rigged fish of four species,
 * choreographed as one 41-second loop. One fish of each species is lifted out
 * of it at load time (by the bones that drive its vertices) and normalised to
 * unit length; every visible fish is then an instance of that geometry with
 * its own swimming body wave computed in the vertex shader. Behaviour comes
 * from `ReefFishMath`.
 *
 * Reef fish live over reefs: each school patrols the shelf of the island
 * nearest the yacht, in the clear shallow water where they can be seen.
 */

/** Schools beyond this distance from the camera are neither simulated nor drawn. */
export const FISH_ACTIVE_DISTANCE = 170;
/**
 * Beyond this distance a fish is drawn from a simplified mesh: a 25 cm fish
 * is under ten pixels long there, and its thousand source triangles would
 * cost as much as the whole ocean surface for a school of a hundred.
 */
export const FISH_DETAIL_DISTANCE = 24;
/** Share of the source vertices the distant mesh gives up. */
const FISH_DISTANT_REDUCTION = 0.72;
/** A school further than this from its new reef moves there out of sight. */
const RELOCATE_DISTANCE = 70;

type FishGeometry = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

type School = {
  species: FishSpecies;
  agents: FishAgent[];
  mesh: THREE.InstancedMesh;
  detail: THREE.BufferGeometry;
  /** Simplified mesh for distant schools; null if simplification failed. */
  distant: THREE.BufferGeometry | null;
  bounds: THREE.Sphere;
  swim: THREE.InstancedBufferAttribute;
  home: THREE.Vector3;
  island: number;
  active: boolean;
};

export class ReefFishController {
  private readonly schools: School[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly scale = new THREE.Vector3();
  private readonly threats: FishThreat[] = [];
  private readonly world: FishWorld;
  private time = 0;

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    underwater: UnderwaterLight,
    countScale: number,
  ) {
    this.world = {
      surfaceAt: (x, z) => this.ocean.sample(x, z).height,
      bottomAt: (x, z) => -waterDepthAt(x, z),
      homeX: 0,
      homeY: 0,
      homeZ: 0,
      threats: this.threats,
      time: 0,
    };
    const asset = assets.animated("fishSchool");
    if (!asset) return;
    let fishGeometries: Map<string, FishGeometry>;
    try {
      fishGeometries = extractFish(asset.scene);
    } catch (error) {
      console.warn("Reef fish could not be prepared and are omitted.", error);
      return;
    }

    REEF_FISH_SPECIES.forEach((species, speciesIndex) => {
      const source = fishGeometries.get(species.key);
      if (!source) return;
      const count = Math.max(4, Math.round(species.count * THREE.MathUtils.clamp(countScale, 0.2, 1)));
      const material = source.material;
      const distant = simplifiedFish(source.geometry);
      const swim = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
      swim.setUsage(THREE.DynamicDrawUsage);
      source.geometry.setAttribute("fishSwim", swim);
      distant?.setAttribute("fishSwim", swim);
      applySwimShader(material);
      underwater.apply(material);
      const mesh = new THREE.InstancedMesh(source.geometry, material, count);
      mesh.name = `Reef_Fish_${species.key}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The school's bounds are rebuilt from its fish every frame (see
      // writeInstances), so a school behind the camera costs nothing.
      const bounds = new THREE.Sphere();
      mesh.boundingSphere = bounds;
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      group.add(mesh);
      this.ownedGeometries.push(source.geometry);
      if (distant) this.ownedGeometries.push(distant);
      this.ownedMaterials.push(material);
      const agents: FishAgent[] = [];
      for (let index = 0; index < count; index += 1) {
        agents.push(createFishAgent(0, -2, 0, 0, fract(Math.sin((index + 1) * 12.9898 + speciesIndex * 78.233) * 43758.5453)));
      }
      this.schools.push({
        species,
        agents,
        mesh,
        detail: source.geometry,
        distant,
        bounds,
        swim,
        home: new THREE.Vector3(),
        island: -1,
        active: false,
      });
    });
  }

  /**
   * @param predators World positions of dolphins and sharks the fish fear.
   */
  update(delta: number, physics: VesselPhysics, camera: THREE.Camera, predators: readonly THREE.Vector3[]): void {
    if (this.schools.length === 0) return;
    this.time += delta;
    this.world.time = this.time;
    this.collectThreats(physics, predators);

    this.schools.forEach((school, schoolIndex) => {
      const island = this.nearestIsland(physics.position);
      this.reefHome(island, physics.position, school.species, schoolIndex, school.home);
      const cameraDistance = Math.hypot(camera.position.x - school.home.x, camera.position.z - school.home.z);
      school.active = cameraDistance < FISH_ACTIVE_DISTANCE;
      school.mesh.visible = school.active;
      if (!school.active) return;
      if (school.island !== island || this.schoolDistance(school) > RELOCATE_DISTANCE) {
        this.spawn(school);
        school.island = island;
      }
      this.world.homeX = school.home.x;
      this.world.homeY = school.home.y;
      this.world.homeZ = school.home.z;
      // Sub-step so a slow frame cannot fling a fish through the reef.
      let remaining = Math.min(delta, 0.1);
      while (remaining > 1e-5) {
        const step = Math.min(remaining, 1 / 30);
        stepSchool(school.agents, school.species, this.world, step);
        remaining -= step;
      }
      this.writeInstances(school);
      const viewDistance = Math.max(0, camera.position.distanceTo(school.bounds.center) - school.bounds.radius);
      const geometry = school.distant && viewDistance > FISH_DETAIL_DISTANCE ? school.distant : school.detail;
      if (school.mesh.geometry !== geometry) school.mesh.geometry = geometry;
    });
  }

  dispose(): void {
    this.schools.forEach((school) => this.group.remove(school.mesh));
    this.schools.length = 0;
    this.ownedGeometries.forEach((geometry) => geometry.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
  }

  private collectThreats(physics: VesselPhysics, predators: readonly THREE.Vector3[]): void {
    this.threats.length = 0;
    const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
    // Each hull is a looming shadow; a moving hull is far more alarming.
    for (const side of [-1.71, 1.71]) {
      this.threats.push({
        x: physics.position.x + physics.right.x * side,
        y: physics.position.y - 0.9,
        z: physics.position.z + physics.right.z * side,
        radius: 3.5 + Math.min(speed, 4) * 0.9,
        strength: 0.35 + Math.min(speed / 3, 0.65),
      });
    }
    for (const predator of predators) {
      this.threats.push({ x: predator.x, y: predator.y, z: predator.z, radius: 9, strength: 1 });
    }
  }

  private nearestIsland(position: THREE.Vector3): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    ISLAND_DEFINITIONS.forEach((island, index) => {
      const distance = Math.hypot(position.x - island.centerX, (position.z - island.centerZ) / island.scaleZ) -
        island.beachRadius;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  /** A patch of reef on the shelf facing the yacht, spread by species. */
  private reefHome(
    islandIndex: number,
    yacht: THREE.Vector3,
    species: FishSpecies,
    schoolIndex: number,
    target: THREE.Vector3,
  ): void {
    const island = ISLAND_DEFINITIONS[islandIndex];
    const facing = Math.atan2((yacht.z - island.centerZ) / island.scaleZ, yacht.x - island.centerX);
    // Snap the bearing so the reef patch does not slide as the yacht moves.
    const bearing = Math.round(facing / 0.35) * 0.35 + (schoolIndex - 1.5) * 0.16;
    const radius =
      island.beachRadius * islandEdgeNoise(bearing, islandIndex) * WATERLINE_RADIAL + species.shoreDistance;
    target.set(
      island.centerX + Math.cos(bearing) * radius,
      0,
      island.centerZ + Math.sin(bearing) * radius * island.scaleZ,
    );
    target.y = -waterDepthAt(target.x, target.z) * 0.5;
  }

  private schoolDistance(school: School): number {
    const first = school.agents[0];
    return first ? Math.hypot(first.x - school.home.x, first.z - school.home.z) : 0;
  }

  private spawn(school: School): void {
    school.agents.forEach((fish, index) => {
      const angle = index * 2.399963 + fish.seed;
      const radius = Math.sqrt((index + 0.5) / school.agents.length) * school.species.wanderRadius * 0.6;
      fish.x = school.home.x + Math.sin(angle) * radius;
      fish.z = school.home.z + Math.cos(angle) * radius;
      const bottom = -waterDepthAt(fish.x, fish.z);
      fish.y = THREE.MathUtils.lerp(bottom + school.species.bottomClearance + 0.2, school.home.y, 0.5);
      fish.heading = angle + Math.PI / 2;
      fish.pitch = 0;
      fish.yawRate = 0;
      fish.speed = school.species.cruiseSpeed;
      fish.panic = 0;
    });
  }

  private writeInstances(school: School): void {
    const { species, agents, mesh, swim, bounds } = school;
    const swimArray = swim.array as Float32Array;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    agents.forEach((fish, index) => {
      minX = Math.min(minX, fish.x); maxX = Math.max(maxX, fish.x);
      minY = Math.min(minY, fish.y); maxY = Math.max(maxY, fish.y);
      minZ = Math.min(minZ, fish.z); maxZ = Math.max(maxZ, fish.z);
      this.position.set(fish.x, fish.y, fish.z);
      this.euler.set(-fish.pitch, fish.heading, fish.bank, "YXZ");
      this.quaternion.setFromEuler(this.euler);
      const size = species.length * (0.85 + fish.seed * 0.3);
      this.scale.set(size, size, size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      swimArray[index * 2] = fish.tailPhase;
      swimArray[index * 2 + 1] = tailAmplitude(fish.speed, species.length, fish.panic);
    });
    // Half the box diagonal, plus a whole fish for its body and tail swing.
    bounds.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    bounds.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + species.length * 1.2;
    mesh.instanceMatrix.needsUpdate = true;
    swim.needsUpdate = true;
  }
}

/**
 * A distant-view copy of a fish mesh with about a quarter of its triangles.
 * Simplification collapses edges by curvature, so the silhouette and the tail
 * fork survive while the flat flanks lose their detail.
 */
export function simplifiedFish(detail: THREE.BufferGeometry): THREE.BufferGeometry | null {
  try {
    const welded = mergeVertices(detail.clone());
    const remove = Math.floor(welded.getAttribute("position").count * FISH_DISTANT_REDUCTION);
    const simplified = new SimplifyModifier().modify(welded, remove);
    welded.dispose();
    if (simplified.getAttribute("position").count < 120) {
      simplified.dispose();
      return null;
    }
    simplified.computeBoundingSphere();
    return simplified;
  } catch (error) {
    console.warn("A reef fish could not be simplified; it keeps its full mesh at every distance.", error);
    return null;
  }
}

/** "Clown2Spine_039_13" → "Clown2"; "blue_tang1Tail59_63" → "blue_tang1". */
export function fishOwner(boneName: string): string {
  const match = /^([A-Za-z_]+?\d+)(?=[A-Za-z])/u.exec(boneName);
  return match ? match[1] : "";
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * Swimming as a travelling body wave: the head barely moves, the tail sweeps
 * furthest. Normals bend with the body so the flanks catch the light.
 */
function applySwimShader(material: THREE.MeshStandardMaterial): void {
  patchMaterialShader(material, "reef-fish-swim-v1", (shader) => {
    shader.vertexShader = injectAfter(shader.vertexShader, "common", "attribute vec2 fishSwim;");
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "beginnormal_vertex",
      `float fishAlongN = clamp(0.5 - position.z, 0.0, 1.0);
      float fishArgN = fishSwim.x - fishAlongN * 4.2;
      float fishSlope = fishSwim.y * (2.0 * fishAlongN * sin(fishArgN) - fishAlongN * fishAlongN * 4.2 * cos(fishArgN));
      objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z + objectNormal.x * fishSlope));`,
    );
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "begin_vertex",
      `float fishAlong = clamp(0.5 - position.z, 0.0, 1.0);
      transformed.x += sin(fishSwim.x - fishAlong * 4.2) * fishSwim.y * fishAlong * fishAlong;
      // The head counter-yaws slightly against the tail.
      transformed.x -= sin(fishSwim.x) * fishSwim.y * 0.08 * (1.0 - fishAlong);`,
    );
  });
}

/**
 * Lifts one fish of each species out of the rigged school. Vertices are
 * assigned to a fish by the bone that weighs on them most; the fish's own
 * head and tail bones give its axis. The result is a unit-length model with
 * the nose at +Z/2, the back toward +Y and its original texture.
 */
function extractFish(scene: THREE.Object3D): Map<string, FishGeometry> {
  scene.updateMatrixWorld(true);
  const result = new Map<string, FishGeometry>();
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinned.push(object);
  });

  const vertex = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  skinned.forEach((mesh) => {
    mesh.skeleton.pose();
    scene.updateMatrixWorld(true);
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const skinIndex = geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
    const skinWeight = geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
    if (!position || !skinIndex || !skinWeight) return;

    // Group vertices by fish. The loader strips ":" and "." from node names,
    // so "Clown2:Spine_03.9_13" arrives as "Clown2Spine_039_13" → "Clown2".
    const owners: string[] = new Array(position.count);
    const members = new Map<string, number[]>();
    for (let index = 0; index < position.count; index += 1) {
      let best = 0;
      let bestWeight = -1;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = skinWeight.getComponent(index, slot);
        if (weight > bestWeight) {
          bestWeight = weight;
          best = skinIndex.getComponent(index, slot);
        }
      }
      const bone = mesh.skeleton.bones[best];
      const owner = bone ? fishOwner(bone.name) : "";
      owners[index] = owner;
      if (!members.has(owner)) members.set(owner, []);
      members.get(owner)?.push(index);
    }

    members.forEach((vertices, owner) => {
      const species = owner.replace(/\d+$/u, "");
      if (!species || result.has(species) || vertices.length < 60) return;
      const ownBones = mesh.skeleton.bones.filter((bone) => fishOwner(bone.name) === owner);
      const head = ownBones.find((bone) => bone.name.slice(owner.length).toLowerCase().startsWith("head"));
      if (!head) return;
      const headWorld = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const boneWorld = new THREE.Vector3();
      // The tail tip is the fish's bone furthest from its head.
      let tail: THREE.Bone | undefined;
      let tailDistance = -1;
      ownBones.forEach((bone) => {
        const name = bone.name.slice(owner.length).toLowerCase();
        if (name.includes("fin")) return;
        const distance = boneWorld.setFromMatrixPosition(bone.matrixWorld).distanceToSquared(headWorld);
        if (distance > tailDistance) {
          tailDistance = distance;
          tail = bone;
        }
      });
      if (!tail) return;
      const headPosition = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      const tailPosition = new THREE.Vector3().setFromMatrixPosition(tail.matrixWorld);
      const forward = headPosition.clone().sub(tailPosition);
      if (forward.lengthSq() < 1e-10) return;
      forward.normalize();
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(forward, -forward.y);
      if (up.lengthSq() < 1e-6) up.set(0, 0, 1).addScaledVector(forward, -forward.z);
      up.normalize();
      const right = new THREE.Vector3().crossVectors(up, forward).normalize();

      // World-space vertices, then their extent along the body axis.
      const world = new Float32Array(vertices.length * 3);
      const minimum = new THREE.Vector3(Infinity, Infinity, Infinity);
      const maximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      vertices.forEach((sourceIndex, local) => {
        vertex.fromBufferAttribute(position, sourceIndex);
        mesh.applyBoneTransform(sourceIndex, vertex);
        vertex.applyMatrix4(mesh.matrixWorld);
        world[local * 3] = vertex.x;
        world[local * 3 + 1] = vertex.y;
        world[local * 3 + 2] = vertex.z;
        const projected = [vertex.dot(right), vertex.dot(up), vertex.dot(forward)];
        minimum.set(Math.min(minimum.x, projected[0]), Math.min(minimum.y, projected[1]), Math.min(minimum.z, projected[2]));
        maximum.set(Math.max(maximum.x, projected[0]), Math.max(maximum.y, projected[1]), Math.max(maximum.z, projected[2]));
      });
      const length = maximum.z - minimum.z;
      if (!(length > 1e-6)) return;
      const centre = new THREE.Vector3().addVectors(minimum, maximum).multiplyScalar(0.5);

      const remap = new Map<number, number>();
      vertices.forEach((sourceIndex, local) => remap.set(sourceIndex, local));
      const positions = new Float32Array(vertices.length * 3);
      const normals = new Float32Array(vertices.length * 3);
      const uvs = uv ? new Float32Array(vertices.length * 2) : null;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const worldNormal = new THREE.Vector3();
      vertices.forEach((sourceIndex, local) => {
        vertex.set(world[local * 3], world[local * 3 + 1], world[local * 3 + 2]);
        positions[local * 3] = (vertex.dot(right) - centre.x) / length;
        positions[local * 3 + 1] = (vertex.dot(up) - centre.y) / length;
        positions[local * 3 + 2] = (vertex.dot(forward) - centre.z) / length;
        if (normal) {
          worldNormal.fromBufferAttribute(normal, sourceIndex).applyMatrix3(normalMatrix).normalize();
          normals[local * 3] = worldNormal.dot(right);
          normals[local * 3 + 1] = worldNormal.dot(up);
          normals[local * 3 + 2] = worldNormal.dot(forward);
        }
        if (uv && uvs) {
          uvs[local * 2] = uv.getX(sourceIndex);
          uvs[local * 2 + 1] = uv.getY(sourceIndex);
        }
      });

      const indices: number[] = [];
      const sourceIndexAttribute = geometry.getIndex();
      const triangleCount = sourceIndexAttribute ? sourceIndexAttribute.count / 3 : position.count / 3;
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const a = sourceIndexAttribute ? sourceIndexAttribute.getX(triangle * 3) : triangle * 3;
        const b = sourceIndexAttribute ? sourceIndexAttribute.getX(triangle * 3 + 1) : triangle * 3 + 1;
        const c = sourceIndexAttribute ? sourceIndexAttribute.getX(triangle * 3 + 2) : triangle * 3 + 2;
        if (owners[a] !== owner || owners[b] !== owner || owners[c] !== owner) continue;
        indices.push(remap.get(a) ?? 0, remap.get(b) ?? 0, remap.get(c) ?? 0);
      }
      if (indices.length < 60) return;

      const fish = new THREE.BufferGeometry();
      fish.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      fish.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      if (uvs) fish.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      fish.setIndex(indices);
      if (!normal) fish.computeVertexNormals();
      fish.computeBoundingSphere();

      const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const material =
        sourceMaterial instanceof THREE.MeshStandardMaterial
          ? sourceMaterial.clone()
          : new THREE.MeshStandardMaterial({ color: 0xd0a040 });
      material.side = THREE.DoubleSide;
      material.roughness = Math.min(material.roughness, 0.55);
      material.envMapIntensity = 1.2;
      result.set(species, { geometry: fish, material });
    });
  });
  return result;
}
