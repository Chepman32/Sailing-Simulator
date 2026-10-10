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
