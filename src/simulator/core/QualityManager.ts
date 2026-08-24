import * as THREE from "three";
import type { QualityPreset } from "../types";

export type QualitySettings = {
  maxDpr: number;
  oceanSegments: number;
  shadowMapSize: number;
  reflectionSize: number;
  foamDensity: number;
  wildlifeCount: number;
};

export const QUALITY_SETTINGS: Record<QualityPreset, QualitySettings> = {
  low: {
    maxDpr: 1,
    oceanSegments: 96,
    shadowMapSize: 512,
    reflectionSize: 256,
    foamDensity: 0.45,
    wildlifeCount: 1,
  },
  medium: {
    maxDpr: 1.25,
    oceanSegments: 144,
    shadowMapSize: 1024,
    reflectionSize: 384,
    foamDensity: 0.7,
    wildlifeCount: 2,
  },
  high: {
    maxDpr: 1.75,
    oceanSegments: 224,
    shadowMapSize: 2048,
    reflectionSize: 512,
    foamDensity: 0.9,
    wildlifeCount: 2,
  },
};

export class QualityManager {
  private preset: QualityPreset;
  private slowWindows = 0;
  private fastWindows = 0;
  private readonly coarseDevice = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    initialPreset: QualityPreset,
    private readonly onChange?: (preset: QualityPreset) => void,
  ) {
    this.preset = this.coarseDevice && initialPreset === "high" ? "medium" : initialPreset;
    this.apply(this.preset, false);
  }

  get current(): QualityPreset {
    return this.preset;
  }

  get settings(): QualitySettings {
    return QUALITY_SETTINGS[this.preset];
  }

  setPreset(preset: QualityPreset): void {
    this.apply(preset, true);
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  observeFps(fps: number): void {
    const slowThreshold = this.coarseDevice ? 44 : 36;
    if (fps < slowThreshold) {
      this.slowWindows += 1;
      this.fastWindows = 0;
    } else if (fps > 58) {
      this.fastWindows += 1;
      this.slowWindows = 0;
    } else {
      this.slowWindows = Math.max(0, this.slowWindows - 1);
      this.fastWindows = Math.max(0, this.fastWindows - 1);
    }

    if (this.slowWindows >= 2 && this.preset !== "low") {
      this.apply(this.preset === "high" ? "medium" : "low", true);
      this.slowWindows = 0;
    } else if (this.fastWindows >= 30 && this.preset !== "high") {
      const nextPreset = this.preset === "low" ? "medium" : "high";
      if (!(this.coarseDevice && nextPreset === "high")) this.apply(nextPreset, true);
      this.fastWindows = 0;
    }
  }

  private apply(preset: QualityPreset, notify: boolean): void {
    this.preset = preset;
    const settings = QUALITY_SETTINGS[preset];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxDpr));
    this.renderer.shadowMap.enabled = preset !== "low" && (!this.coarseDevice || preset === "high");
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (notify) this.onChange?.(preset);
  }
}
