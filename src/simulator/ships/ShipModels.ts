import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { batchStaticMeshes } from "../core/StaticBatching";
import { SHIP_SHADOW_LAYER } from "./ShipShadows";
import { SHIP_SPECS, type ShipKind } from "./ShipMath";
import {
  addHullMesh,
  bowYaw,
  closeHullProfile,
  emptyHullProfile,
  fitShipModel,
  isSeaSurface,
  modelLights,
  type ModelMesh,
  SHIP_MODELS,
  unionBounds,
  type Bounds3,
  type ShipModelSource,
} from "./ShipModelMath";

const box = new THREE.Box3();

function boundsOf(object: THREE.Object3D): Bounds3 {
  box.setFromObject(object);
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/**
 * The imported ship models (`SHIP_MODELS`), loaded in the background after the
 * scene has started: until a type's model has arrived (or if it never does),
 * its ships are drawn procedurally. Each model is prepared once — the sea
 * plane stripped, turned bow to +Z, scaled to the type's length, set at its
 * draught, its parts merged into one mesh per material — and every ship of
 * that type shares its geometry and materials through a shallow clone.
 */
export class ShipModels {
  private readonly prototypes = new Map<string, THREE.Group>();
  private readonly materials = new Set<THREE.Material>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private disposed = false;

  /**
   * @param prepareMaterial Shading for each of a model's materials; `windows`
   *   is that model's (deck height, accommodation from z, to z, 1 for a
   *   passenger ship lit all along), filled in once the model is measured.
   */
  constructor(private readonly prepareMaterial: (material: THREE.Material, windows: { value: THREE.Vector4 }) => void) {}

  private sources: Record<ShipKind, readonly ShipModelSource[]> = SHIP_MODELS;

  /** Starts loading every listed model; resolves when all have settled. */
  async load(
    loader: Pick<GLTFLoader, "loadAsync"> = new GLTFLoader(),
    sources: Record<ShipKind, readonly ShipModelSource[]> = SHIP_MODELS,
  ): Promise<void> {
    this.sources = sources;
    const jobs: Promise<void>[] = [];
    (Object.keys(sources) as ShipKind[]).forEach((kind) => {
      sources[kind].forEach((source, variant) => {
        jobs.push(
          loader
            .loadAsync(source.url)
            .then((gltf) => {
              if (this.disposed) return;
              this.prototypes.set(`${kind}:${variant}`, this.prepare(gltf.scene, kind, source, variant));
            })
            .catch((error: unknown) => {
              console.warn(`Ship model ${source.url} could not be loaded; the procedural ship is used.`, error);
            }),
        );
      });
    });
    await Promise.all(jobs);
  }

  /** How many models a kind has listed (loaded or not). */
  variants(kind: ShipKind): number {
    return this.sources[kind].length;
  }

  /** The measured waterline half-widths of a loaded model (see `measureHullProfile`). */
  profile(kind: ShipKind, variant: number): Float32Array | null {
    return (this.prototypes.get(`${kind}:${variant}`)?.userData.hullProfile as Float32Array | undefined) ?? null;
  }

  /** A ship-sized copy of a loaded model, or null while it is not available. */
  instance(kind: ShipKind, variant: number): THREE.Group | null {
    const prototype = this.prototypes.get(`${kind}:${variant}`);
    return prototype ? prototype.clone(true) : null;
  }

  dispose(): void {
    this.disposed = true;
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
    this.prototypes.clear();
  }

  /** The night lights of a loaded model (see `modelLights`), or null while it is not available. */
  lights(kind: ShipKind, variant: number): THREE.BufferGeometry | null {
    return (this.prototypes.get(`${kind}:${variant}`)?.userData.lights as THREE.BufferGeometry | undefined) ?? null;
  }

  /** The prepared model's meshes in the ship's frame (metres, bow +Z, waterline y = 0). */
  private shipFrameMeshes(root: THREE.Object3D): ModelMesh[] {
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const toRoot = new THREE.Matrix4();
    const point = new THREE.Vector3();
    const meshes: ModelMesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const position = geometry.getAttribute("position");
      if (!position) return;
      toRoot.multiplyMatrices(inverse, object.matrixWorld);
      const positions = new Float32Array(position.count * 3);
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        point.fromBufferAttribute(position, vertex).applyMatrix4(toRoot);
        positions[3 * vertex] = point.x;
        positions[3 * vertex + 1] = point.y;
        positions[3 * vertex + 2] = point.z;
      }
      meshes.push({ positions, index: geometry.index ? geometry.index.array : null });
    });
    return meshes;
  }

  /** Waterline half-widths of the prepared model, in the ship's frame. */
  private measure(meshes: readonly ModelMesh[], halfLength: number): Float32Array {
    const profile = emptyHullProfile();
    for (const mesh of meshes) addHullMesh(profile, mesh.positions, mesh.index, halfLength);
    return closeHullProfile(profile);
  }

  /** Her lights at night as points (`ShipSystem`'s beacon layer). */
  private lightPoints(meshes: readonly ModelMesh[], kind: ShipKind, variant: number, windows: THREE.Vector4): THREE.BufferGeometry {
    const spec = SHIP_SPECS[kind];
    const passenger = kind === "cruise" || kind === "ferry";
    const { positions, lights, block } = modelLights(meshes, spec.length / 2, spec.freeboard, passenger, 11 + variant * 7 + kind.length);
    windows.set(spec.freeboard, block[0], block[1], passenger ? 1 : 0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("shipLight", new THREE.BufferAttribute(lights, 4));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private prepare(scene: THREE.Group, kind: ShipKind, source: ShipModelSource, variant = 0): THREE.Group {
    const windows = { value: new THREE.Vector4(SHIP_SPECS[kind].freeboard, -1e4, 1e4, 0) };
    scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    // The sea the author modelled around the hull would float as a sheet.
    const solid = meshes.filter((mesh) => {
      const bounds = boundsOf(mesh);
      return !(bounds.max[1] - bounds.min[1] < 0.02 * Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]));
    });
    const rest = unionBounds(solid.map(boundsOf));
    meshes.forEach((mesh) => {
      if (isSeaSurface(mesh.name, boundsOf(mesh), rest)) mesh.removeFromParent();
    });

    const turned = new THREE.Group();
    turned.rotation.y = bowYaw(source.bow);
    turned.add(scene);
    turned.updateMatrixWorld(true);
    const fit = fitShipModel(boundsOf(turned), SHIP_SPECS[kind], source.keel ?? 1, source.waterline);
    turned.scale.setScalar(fit.scale);
    turned.position.set(fit.offset[0], fit.offset[1], fit.offset[2]);

    const root = new THREE.Group();
    root.name = `ShipModel_${kind}`;
    root.add(turned);
    root.updateMatrixWorld(true);

    const kept: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (this.materials.has(material)) return;
        this.prepareMaterial(material, windows);
        this.materials.add(material);
      });
      kept.push(object);
    });
    // One mesh per material: a liner is hundreds of parts.
    const { geometries } = batchStaticMeshes(root, kept, (mesh) => (mesh.material as THREE.Material).uuid, `ShipModel_${kind}`);
    geometries.forEach((geometry) => this.geometries.add(geometry));
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      this.geometries.add(object.geometry);
      // The merged meshes cast the ship's shadow (see ShipShadows).
      object.layers.enable(SHIP_SHADOW_LAYER);
    });
    // Materials the batching released are no longer referenced.
    this.materials.forEach((material) => {
      let used = false;
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const own = Array.isArray(object.material) ? object.material : [object.material];
        if (own.includes(material)) used = true;
      });
      if (!used) this.materials.delete(material);
    });
    root.userData.credit = source.credit;
    const frame = this.shipFrameMeshes(root);
    root.userData.hullProfile = this.measure(frame, SHIP_SPECS[kind].length / 2);
    root.userData.lights = this.lightPoints(frame, kind, variant, windows.value);
    this.geometries.add(root.userData.lights as THREE.BufferGeometry);
    return root;
  }
}
