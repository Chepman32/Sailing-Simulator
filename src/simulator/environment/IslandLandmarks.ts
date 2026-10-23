import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { islandLandmarks, islandSpot, pierClearance, pierLine } from "./IslandLandmarkMath";
import { islandsWithin, type IslandDefinition } from "./IslandMath";
import { createHut, createLighthouse, createPier, createPropMaterials, createRockGeometry } from "./IslandProps";

/** Landmarks are built for islands within this distance of the yacht, metres. */
const LANDMARK_RANGE = 950;
/** Seconds between two checks of which islands are near. */
const SCAN_INTERVAL = 1;
const ROCK_CAPACITY = 360;
const PIER_DECK_HEIGHT = 1.25;

type Placed = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  beam: THREE.Object3D | null;
  pier: { x0: number; z0: number; x1: number; z1: number } | null;
};

/**
 * Merges a prop's meshes into one mesh per material (its primitives are
 * many and tiny), leaving `keep` (animated parts) as they are. The source
 * geometries are disposed; the merged ones are returned for disposal later.
 */
function mergeByMaterial(source: THREE.Group, keep: THREE.Object3D[], out: THREE.BufferGeometry[]): THREE.Group {
  const merged = new THREE.Group();
  merged.name = source.name;
  source.updateMatrixWorld(true);
  const kept = new Set<THREE.Object3D>();
  for (const object of keep) object.traverse((child) => kept.add(child));
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const sources = new Set<THREE.BufferGeometry>();
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || kept.has(object)) return;
    const material = object.material as THREE.Material;
    const geometry = (object.geometry as THREE.BufferGeometry).clone().applyMatrix4(object.matrixWorld);
    const plain = geometry.index ? geometry.toNonIndexed() : geometry;
    if (plain !== geometry) geometry.dispose();
    for (const name of Object.keys(plain.attributes)) if (name !== "position" && name !== "normal") plain.deleteAttribute(name);
    const list = buckets.get(material) ?? [];
    list.push(plain);
    buckets.set(material, list);
    sources.add(object.geometry as THREE.BufferGeometry);
  });
  for (const [material, parts] of buckets) {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    merged.add(mesh);
    out.push(geometry);
  }
  for (const geometry of sources) geometry.dispose();
  for (const object of keep) {
    // Keep the animated part where it was, now under the merged group.
    object.removeFromParent();
    merged.add(object);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) out.push(child.geometry as THREE.BufferGeometry);
    });
  }
  return merged;
}

/**
 * Lighthouses (with a sweeping beam at night), plank piers with a stilt hut,
 * and beach boulders on the islands near the yacht, as planned by
 * `islandLandmarks`. Built when an island comes within range and disposed
 * when it falls behind; the boulders share one bounded instanced mesh. The
 * piers are obstacles for the shore guard (`clearance`).
 */
export class IslandLandmarks {
  readonly group = new THREE.Group();
  private readonly materials = createPropMaterials();
  private readonly rockGeometry = createRockGeometry();
  private readonly rockMaterial = new THREE.MeshStandardMaterial({ name: "Beach_Boulder", color: 0xffffff, roughness: 0.95, flatShading: true });
  private readonly rocks: THREE.InstancedMesh;
  private readonly placed = new Map<number, Placed>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly normal = { x: 0, z: 0 };
  private scanClock = 0;
  private lampLevel = -1;

  constructor(
    scene: THREE.Scene,
    private readonly height: (island: IslandDefinition, radial: number, angle: number) => number,
  ) {
    this.group.name = "IslandLandmarks";
    this.rocks = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, ROCK_CAPACITY);
    this.rocks.name = "Beach_Boulders";
    this.rocks.count = 0;
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.rocks.frustumCulled = false;
    this.group.add(this.rocks);
    scene.add(this.group);
  }

  update(delta: number, x: number, z: number, night: number): void {
    this.scanClock -= delta;
    if (this.scanClock <= 0) {
      this.scanClock = SCAN_INTERVAL;
      this.scan(x, z);
    }
    // At night the lantern burns (above 1, so the bloom catches it) and the beam sweeps.
    const lamp = 1 + night * 6;
    if (Math.abs(lamp - this.lampLevel) > 0.01) {
      this.lampLevel = lamp;
      this.materials.lamp.color.setRGB(lamp, lamp * 0.94, lamp * 0.78);
      this.materials.beam.opacity = night * 0.32;
    }
    for (const placed of this.placed.values()) {
      if (!placed.beam) continue;
      placed.beam.visible = night > 0.05;
      placed.beam.rotation.y += delta * 0.55;
    }
  }

  /** Distance to the nearest pier (negative inside its planking) and the outward normal there. */
  clearance(x: number, z: number, normal: { x: number; z: number }): number {
    let best = Infinity;
    for (const placed of this.placed.values()) {
      if (!placed.pier) continue;
      const distance = pierClearance(placed.pier, x, z, this.normal);
      if (distance < best) {
        best = distance;
        normal.x = this.normal.x;
        normal.z = this.normal.z;
      }
    }
    return best;
  }

  private scan(x: number, z: number): void {
    const near = islandsWithin(x, z, LANDMARK_RANGE);
    const ids = new Set(near.map((island) => island.id));
    let changed = false;
    for (const [id, placed] of this.placed) {
      if (ids.has(id)) continue;
      placed.group.removeFromParent();
      for (const geometry of placed.geometries) geometry.dispose();
      this.placed.delete(id);
      changed = true;
    }
    for (const island of near) {
      if (this.placed.has(island.id)) continue;
      this.placed.set(island.id, this.build(island));
      changed = true;
    }
    if (changed) this.layRocks(near);
  }

  private build(island: IslandDefinition): Placed {
    const plan = islandLandmarks(island);
    const root = new THREE.Group();
    root.name = `Landmarks_${island.id}`;
    const geometries: THREE.BufferGeometry[] = [];
    let beam: THREE.Object3D | null = null;
    let pier: Placed["pier"] = null;
    if (plan.lighthouse) {
      const lighthouse = createLighthouse(this.materials);
      const merged = mergeByMaterial(lighthouse.group, [lighthouse.beam, lighthouse.lamp], geometries);
      const spot = islandSpot(island, plan.lighthouse.radial, plan.lighthouse.angle);
      merged.position.set(spot.x, this.height(island, plan.lighthouse.radial, plan.lighthouse.angle) - 0.3, spot.z);
      beam = lighthouse.beam;
      beam.visible = false;
      root.add(merged);
    }
    if (plan.pier) {
      const line = pierLine(island, plan.pier);
      const merged = mergeByMaterial(createPier(this.materials, plan.pier.length, PIER_DECK_HEIGHT), [], geometries);
      merged.position.set(line.x0, 0, line.z0);
      merged.rotation.y = Math.atan2(line.x1 - line.x0, line.z1 - line.z0);
      root.add(merged);
      pier = line;
    }
    if (plan.hut) {
      const merged = mergeByMaterial(createHut(this.materials), [], geometries);
      const spot = islandSpot(island, plan.hut.radial, plan.hut.angle);
      merged.position.set(spot.x, this.height(island, plan.hut.radial, plan.hut.angle) - 0.15, spot.z);
      // The porch faces the sea.
      merged.rotation.y = Math.atan2(Math.cos(plan.hut.angle), Math.sin(plan.hut.angle) * island.scaleZ);
      root.add(merged);
    }
    this.group.add(root);
    return { group: root, geometries, beam, pier };
  }

  private layRocks(islands: readonly IslandDefinition[]): void {
    let count = 0;
    for (const island of islands) {
      const plan = islandLandmarks(island);
      for (const rock of plan.rocks) {
        if (count >= ROCK_CAPACITY) break;
        const spot = islandSpot(island, rock.radial, rock.angle);
        // Bedded in the sand on the beach, awash at the waterline.
        const ground = rock.radial < 0.98 ? this.height(island, rock.radial, rock.angle) : -0.2;
        this.position.set(spot.x, ground - rock.size * 0.08, spot.z);
        this.euler.set(rock.tilt, rock.yaw, rock.tilt * 0.6);
        this.quaternion.setFromEuler(this.euler);
        this.scale.set(rock.size * 1.15, rock.size * 0.8, rock.size);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.rocks.setMatrixAt(count, this.matrix);
        // Grey coral rock; black basalt on a volcano.
        this.color.setHex(island.volcano ? 0x3b3633 : 0x8a8476).multiplyScalar(0.85 + (rock.yaw % 1) * 0.3);
        this.rocks.setColorAt(count, this.color);
        count += 1;
      }
    }
    this.rocks.count = count;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const placed of this.placed.values()) for (const geometry of placed.geometries) geometry.dispose();
    this.placed.clear();
    this.group.removeFromParent();
    this.rocks.dispose();
    this.rockGeometry.dispose();
    this.rockMaterial.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
