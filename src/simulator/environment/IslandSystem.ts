import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { clamp, smoothstep } from "../math";

type IslandObstacle = {
  center: THREE.Vector2;
  beachRadius: number;
  scaleZ: number;
};

type PalmWindUniform = { value: number };

const ISLANDS: readonly IslandObstacle[] = [
  { center: new THREE.Vector2(-115, -65), beachRadius: 54, scaleZ: 0.72 },
  { center: new THREE.Vector2(138, -28), beachRadius: 46, scaleZ: 0.82 },
  { center: new THREE.Vector2(25, 175), beachRadius: 36, scaleZ: 0.68 },
] as const;

export class IslandSystem {
  private readonly group = new THREE.Group();
  private readonly palmWindUniforms: PalmWindUniform[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    assets: AssetManager,
  ) {
    this.group.name = "TropicalIslandSystem";
    scene.add(this.group);
    this.createSeabed();
    ISLANDS.forEach((island, index) => this.createIsland(island, index, assets));
  }

  update(time: number): void {
    this.palmWindUniforms.forEach((uniform) => {
      uniform.value = time;
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
      new THREE.MeshStandardMaterial({ color: 0xb99a60, roughness: 0.98, metalness: 0 }),
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = -18;
    seabed.receiveShadow = true;
    seabed.name = "DeepTropicalSeabed";
    this.group.add(seabed);
  }

  private createIsland(island: IslandObstacle, index: number, assets: AssetManager): void {
    const islandGroup = new THREE.Group();
    islandGroup.position.set(island.center.x, 0, island.center.y);
    islandGroup.name = `TropicalIsland_${index + 1}`;

    const beach = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.MeshStandardMaterial({ color: 0xd7b96f, roughness: 0.97, metalness: 0 }),
    );
    beach.scale.set(island.beachRadius, 3.1 + index * 0.35, island.beachRadius * island.scaleZ);
    beach.position.y = -2.62;
    beach.receiveShadow = true;
    beach.name = "MutedYellowBeach";
    islandGroup.add(beach);

    const interior = new THREE.Mesh(
      new THREE.SphereGeometry(1, 56, 28),
      new THREE.MeshStandardMaterial({ color: index === 1 ? 0x32975c : 0x2c9e63, roughness: 0.94 }),
    );
    interior.scale.set(island.beachRadius * 0.79, 5.7 + index * 0.55, island.beachRadius * island.scaleZ * 0.78);
    interior.position.y = -3.65;
    interior.receiveShadow = true;
    interior.castShadow = true;
    islandGroup.add(interior);

    const palms = assets.palms();
    palms.name = `GLB_Palm_Grove_${index + 1}`;
    const bounds = new THREE.Box3().setFromObject(palms);
    const height = Math.max(0.1, bounds.max.y - bounds.min.y);
    const targetHeight = 13 + index * 1.5;
    const scale = targetHeight / height;
    palms.scale.setScalar(scale);
    palms.position.set(-island.beachRadius * 0.15, 0.2 - bounds.min.y * scale, 0);
    palms.rotation.y = index * 1.94;
    palms.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = true;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const materials = sourceMaterials.map((source) => {
        const material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.offsetHSL(0, 0.2, 0.08);
          material.roughness = 0.86;
        }
        const timeUniform: PalmWindUniform = { value: 0 };
        this.palmWindUniforms.push(timeUniform);
        material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
          shader.uniforms.uPalmTime = timeUniform;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uPalmTime;")
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
               float windWeight = smoothstep(0.0, 8.0, position.y);
               float palmPhase = uPalmTime * 1.35 + position.y * 0.42 + position.x * 0.17;
               transformed.x += sin(palmPhase) * 0.19 * windWeight;
               transformed.z += cos(palmPhase * 0.73) * 0.11 * windWeight;`,
            );
        };
        material.customProgramCacheKey = () => "palm-wind-v2";
        return material;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    });
    islandGroup.add(palms);
    this.group.add(islandGroup);
  }

}
