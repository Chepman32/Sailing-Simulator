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

export const MAX_VISIBLE_TERRAIN_RADIUS_SCALE = 1.06;

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
    // The ocean is rendered immediately after this mesh. Vertex alpha tapers
    // the submerged apron into the seabed so its final radial edge cannot read
    // as a large ring (or as a dark, flat animal) through clear tropical water.
    terrain.renderOrder = 1;
    islandGroup.add(terrain);

    const palms = assets.palms();
    palms.name = `GLB_Palm_Grove_${index + 1}`;
    const bounds = new THREE.Box3().setFromObject(palms);
    const height = Math.max(0.1, bounds.max.y - bounds.min.y);
    const targetHeight = 13 + index * 1.5;
    const scale = targetHeight / height;
    palms.scale.setScalar(scale);
    palms.position.set(-island.beachRadius * 0.15, 1.15 - bounds.min.y * scale, 0);
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

  private createIslandTerrain(island: IslandObstacle, index: number): THREE.BufferGeometry {
    const segments = 72;
    const rings = 10;
    const outerRadius = MAX_VISIBLE_TERRAIN_RADIUS_SCALE;
    const positions: number[] = [0, 1.78 + index * 0.18, 0];
    const colors: number[] = [];
    const indices: number[] = [];
    const green = new THREE.Color(index === 1 ? 0x32975c : 0x2c9e63);
    const sand = new THREE.Color(0xd7b96f);
    const deepSand = new THREE.Color(0xb99a60);
    colors.push(green.r, green.g, green.b, 1);

    for (let ring = 1; ring <= rings; ring += 1) {
      const radial = outerRadius * ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        const edgeNoise =
          1 +
          Math.sin(angle * 3 + index * 1.7) * 0.038 +
          Math.sin(angle * 7 - index * 0.9) * 0.023 +
          Math.cos(angle * 11 + index * 0.6) * 0.012;
        const radius = island.beachRadius * radial * edgeNoise;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius * island.scaleZ;
        const y = this.islandTerrainHeight(radial, angle, index);
        positions.push(x, y, z);

        const color = new THREE.Color();
        if (radial < 0.68) {
          color.copy(green).offsetHSL(Math.sin(angle * 5 + index) * 0.006, 0, Math.sin(angle * 4) * 0.018);
        } else if (radial < 0.88) {
          color.copy(green).lerp(sand, smoothstep(0.68, 0.88, radial));
        } else if (radial < 1) {
          color.copy(sand);
        } else {
          color.copy(sand).lerp(deepSand, smoothstep(1, outerRadius, radial));
        }
        const alpha = 1 - smoothstep(0.965, outerRadius, radial);
        colors.push(color.r, color.g, color.b, alpha);
      }
    }

    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(0, 1 + segment, 1 + (segment + 1) % segments);
    }
    for (let ring = 1; ring < rings; ring += 1) {
      const innerStart = 1 + (ring - 1) * segments;
      const outerStart = 1 + ring * segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(
          innerStart + segment,
          outerStart + segment,
          innerStart + next,
          innerStart + next,
          outerStart + segment,
          outerStart + next,
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
    const surfaceVariation = Math.sin(angle * 4 + index * 1.3) * 0.12 + Math.cos(angle * 9) * 0.05;
    if (radial < 0.68) return 1.78 + index * 0.18 - radial * radial * 0.9 + surfaceVariation;
    if (radial < 0.9) return THREE.MathUtils.lerp(1.36, 0.28, smoothstep(0.68, 0.9, radial)) + surfaceVariation * 0.35;
    if (radial < 1) return THREE.MathUtils.lerp(0.28, -0.08, smoothstep(0.9, 1, radial));
    return THREE.MathUtils.lerp(-0.08, -0.42, smoothstep(1, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, radial));
  }

}
