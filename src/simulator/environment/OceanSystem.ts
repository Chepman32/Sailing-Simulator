import * as THREE from "three";
import type { QualitySettings } from "../core/QualityManager";
import type { EnvironmentPalette } from "./EnvironmentPalette";
import { createOceanGrid } from "./OceanGrid";
import { OCEAN_WAVES, sampleOcean, type OceanSample } from "./OceanMath";
import { createSkyUniforms, setLinearColor, type SkyUniforms } from "./SkyUniforms";
import { MAX_IMPACT_STRENGTH, MAX_SURFACE_IMPACTS, surfaceImpactLife } from "./SurfaceImpacts";
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
  private currentTime = 0;
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
      uVesselSpeed: { value: 0 },
      uImpacts: { value: Array.from({ length: MAX_SURFACE_IMPACTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uReflectionMap: { value: null },
      uReflectionMatrix: { value: new THREE.Matrix4() },
      uReflectionStrength: { value: 0 },
      uWakeMap: { value: null },
      uWakeArea: { value: new THREE.Vector3(0, 0, 1) },
      uWakeTexel: { value: 0 },
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

  /**
   * Mirror image of the world above the sea (see `OceanReflection`), or null
   * to reflect the sky alone.
   */
  setReflection(texture: THREE.Texture | null, matrix: THREE.Matrix4, strength: number): void {
    this.uniforms.uReflectionMap.value = texture;
    (this.uniforms.uReflectionMatrix.value as THREE.Matrix4).copy(matrix);
    this.uniforms.uReflectionStrength.value = texture ? strength : 0;
  }

  /**
   * The wake field (see `WakeField`). `area` is shared by reference, so the
   * field's re-centring reaches the shader without another call.
   */
  setWakeField(texture: THREE.Texture | null, area: THREE.Vector3, texel: number): void {
    this.uniforms.uWakeMap.value = texture;
    this.uniforms.uWakeArea.value = area;
    this.uniforms.uWakeTexel.value = texture ? texel : 0;
  }

  /** Simulation time the surface is currently drawn at. */
  get time(): number {
    return this.currentTime;
  }

  /**
   * Height and normal of the rendered surface above (x, z). With `depth`,
   * the vertical excursion of the water that far below the mean surface.
   */
  sample(x: number, z: number, depth = 0): OceanSample {
    return sampleOcean(x, z, this.currentTime, depth);
  }

  /**
   * Starts a ring wave and slick at (x, z). The oldest or weakest impact is
   * replaced when all slots are in use, so a burst of splashes stays bounded.
   */
  addImpact(x: number, z: number, strength: number): void {
    const bounded = Math.min(MAX_IMPACT_STRENGTH, Math.max(0, strength));
    if (bounded <= 0.02) return;
    const impacts = this.uniforms.uImpacts.value as THREE.Vector4[];
    let slot = impacts[0]!;
    let lowestRemaining = Number.POSITIVE_INFINITY;
    for (const impact of impacts) {
      const remaining =
        impact.w > 0 ? surfaceImpactLife(impact.w) - (this.currentTime - impact.z) : Number.NEGATIVE_INFINITY;
      // Prefer an empty or expired slot, then the one closest to fading out.
      const weight = remaining <= 0 ? Number.NEGATIVE_INFINITY : remaining * (0.5 + impact.w);
      if (weight < lowestRemaining) {
        lowestRemaining = weight;
        slot = impact;
      }
    }
    slot.set(x, z, this.currentTime, bounded);
  }

  clearImpacts(): void {
    (this.uniforms.uImpacts.value as THREE.Vector4[]).forEach((impact) => impact.set(0, 0, 0, 0));
  }

  update(time: number, focus: THREE.Vector3, heading = 0, speed = 0): void {
    this.currentTime = time;
    this.uniforms.uVesselSpeed.value = Math.abs(speed);
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
