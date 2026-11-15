import * as THREE from "three";
import type { EnvironmentPalette, Rgb } from "./EnvironmentPalette";

/**
 * Uniform objects shared by reference between the sky dome, the lighting
 * capture and the ocean material. Writing a value once updates all three.
 */
export type SkyUniforms = {
  uZenith: THREE.IUniform<THREE.Color>;
  uHorizon: THREE.IUniform<THREE.Color>;
  uSunDirection: THREE.IUniform<THREE.Vector3>;
  uMoonDirection: THREE.IUniform<THREE.Vector3>;
  uLightDirection: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uCloudLit: THREE.IUniform<THREE.Color>;
  uCloudShade: THREE.IUniform<THREE.Color>;
  uNight: THREE.IUniform<number>;
  uCloudTime: THREE.IUniform<number>;
  uCloudCover: THREE.IUniform<number>;
  /** Lightning: 0 dark … 1 the whole sky lit from inside the clouds. */
  uFlash: THREE.IUniform<number>;
  /** Direction of the brightest strike; the flash is brightest around it. */
  uFlashDirection: THREE.IUniform<THREE.Vector3>;
  /** 0: the flash fills the sky (a strike overhead) … 1: only around `uFlashDirection` (far off). */
  uFlashFocus: THREE.IUniform<number>;
  /**
   * The volumetric clouds' map of the sky (see `CloudMap`): the last pass
   * drawn, the one before it, and how far the picture has moved from the
   * one to the other (0…1).
   */
  uCloudMap: THREE.IUniform<THREE.Texture | null>;
  uCloudMapPrev: THREE.IUniform<THREE.Texture | null>;
  uCloudMapBlend: THREE.IUniform<number>;
  /** 1 while the clouds are read from the map, 0 for the flat procedural ones. */
  uCloudVolume: THREE.IUniform<number>;
  /** Where the clouds have drifted to over the viewer (m): fine detail is laid on the cloud base with it. */
  uCloudDrift: THREE.IUniform<THREE.Vector2>;
};

export function createSkyUniforms(): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDirection: { value: new THREE.Vector3(0.6, 0.66, -0.45).normalize() },
    uMoonDirection: { value: new THREE.Vector3(0.18, 0.5, 0.85).normalize() },
    uLightDirection: { value: new THREE.Vector3(0.6, 0.66, -0.45).normalize() },
    uSunColor: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uNight: { value: 0 },
    uCloudTime: { value: 0 },
    uCloudCover: { value: 0.43 },
    uFlash: { value: 0 },
    uFlashDirection: { value: new THREE.Vector3(0, 0.2, 1).normalize() },
    uFlashFocus: { value: 0 },
    uCloudMap: { value: null },
    uCloudMapPrev: { value: null },
    uCloudMapBlend: { value: 1 },
    uCloudVolume: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2() },
  };
}

/** Palette colours are already scene-linear; bypass colour management. */
export function setLinearColor(target: THREE.Color, source: Rgb): THREE.Color {
  target.r = source[0];
  target.g = source[1];
  target.b = source[2];
  return target;
}

export function applySkyPalette(uniforms: SkyUniforms, palette: EnvironmentPalette, night: number): void {
  setLinearColor(uniforms.uZenith.value, palette.zenith);
  setLinearColor(uniforms.uHorizon.value, palette.horizon);
  setLinearColor(uniforms.uSunColor.value, palette.sunColor);
  setLinearColor(uniforms.uCloudLit.value, palette.cloudLit);
  setLinearColor(uniforms.uCloudShade.value, palette.cloudShade);
  uniforms.uNight.value = night;
  uniforms.uCloudCover.value = palette.cloudCover;
}
