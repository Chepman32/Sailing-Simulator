import * as THREE from "three";
import type { QualitySettings } from "../core/QualityManager";
import type { EnvironmentPalette } from "./EnvironmentPalette";
import { createOceanGrid } from "./OceanGrid";
import { OCEAN_WAVES, sampleOcean, type OceanSample } from "./OceanMath";
import { createSkyUniforms, setLinearColor, type SkyUniforms } from "./SkyUniforms";
import { oceanFragmentShader, oceanVertexShader } from "./shaders/oceanShader";

function createFocusedOceanGeometry(segments: number): { geometry: THREE.BufferGeometry; cellSize: number } {
  const grid = createOceanGrid(segments);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(grid.positions, 3));
  geometry.setAttribute("cellSpacing", new THREE.BufferAttribute(grid.spacing, 1));
  geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, cellSize: grid.cellSize };
}

export class OceanSystem {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Shared by reference with the sky dome so reflections match the sky. */
  readonly skyUniforms: SkyUniforms = createSkyUniforms();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private time = 0;
  private segments: number;
  private cellSize: number;

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    this.uniforms = {
      ...this.skyUniforms,
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color() },
      uShallowColor: { value: new THREE.Color() },
      uSandColor: { value: new THREE.Color() },
      uScatterColor: { value: new THREE.Color() },
      uLightColor: { value: new THREE.Color() },
      uAmbientColor: { value: new THREE.Color() },
      uFoamDensity: { value: quality.foamDensity },
      uDetail: { value: quality.oceanDetail },
      uVesselPosition: { value: new THREE.Vector3() },
      uVesselForward: { value: new THREE.Vector2(0, 1) },
    };
    const material = new THREE.ShaderMaterial({
      name: "OceanSurface",
      uniforms: this.uniforms,
      vertexShader: oceanVertexShader,
      fragmentShader: oceanFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const { geometry, cellSize } = createFocusedOceanGeometry(quality.oceanSegments);
    this.mesh = new THREE.Mesh(geometry, material);
    this.segments = quality.oceanSegments;
    this.cellSize = cellSize;
    this.mesh.name = "GPU_Ocean_World_Space_Gerstner";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  sample(x: number, z: number): OceanSample {
    return sampleOcean(x, z, this.time);
  }

  update(time: number, focus: THREE.Vector3, heading = 0): void {
    this.time = time;
    this.uniforms.uTime.value = time;
    (this.uniforms.uVesselPosition.value as THREE.Vector3).copy(focus);
    (this.uniforms.uVesselForward.value as THREE.Vector2).set(Math.sin(heading), Math.cos(heading));
    // Re-centre in whole cells: the dense lattice stays locked to the world,
    // so vertices never slide across the waves they are sampling.
    this.mesh.position.x = Math.round(focus.x / this.cellSize) * this.cellSize;
    this.mesh.position.z = Math.round(focus.z / this.cellSize) * this.cellSize;
  }

  /** Water colours and light levels for the current time of day. */
  setEnvironment(palette: EnvironmentPalette): void {
    setLinearColor(this.uniforms.uDeepColor.value as THREE.Color, palette.deepWater);
    setLinearColor(this.uniforms.uShallowColor.value as THREE.Color, palette.shallowWater);
    setLinearColor(this.uniforms.uSandColor.value as THREE.Color, palette.sand);
    setLinearColor(this.uniforms.uScatterColor.value as THREE.Color, palette.scatter);
    setLinearColor(this.uniforms.uLightColor.value as THREE.Color, palette.lightColor);
    setLinearColor(this.uniforms.uAmbientColor.value as THREE.Color, palette.ambientColor);
  }

  setQuality(quality: QualitySettings): void {
    this.uniforms.uFoamDensity.value = quality.foamDensity;
    this.uniforms.uDetail.value = quality.oceanDetail;
    if (quality.oceanSegments === this.segments) return;
    const previousGeometry = this.mesh.geometry;
    const { geometry, cellSize } = createFocusedOceanGeometry(quality.oceanSegments);
    this.mesh.geometry = geometry;
    this.segments = quality.oceanSegments;
    this.cellSize = cellSize;
    previousGeometry.dispose();
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export { OCEAN_WAVES };
