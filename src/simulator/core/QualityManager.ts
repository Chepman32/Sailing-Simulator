import * as THREE from "three";
import type { QualityPreset } from "../types";
import { budgetPixelRatio, type GovernorVerdict } from "./RenderBudget";

export type QualitySettings = {
  maxDpr: number;
  /** Most pixels the drawing buffer may hold, whatever the window and display. */
  pixelBudget: number;
  oceanSegments: number;
  shadowMapSize: number;
  /** Resolution of the planar water reflection relative to the screen; 0 = sky only. */
  reflectionScale: number;
  foamDensity: number;
  wildlifeCount: number;
  /** Dolphins in the pod; pairs can leap together from two upward. */
  dolphinCount: number;
  /** 0–1: enables per-pixel wave detail, capillary ripples and cloud reflections. */
  oceanDetail: number;
  /** 0 = three-octave clouds, 1 = five-octave clouds. */
  skyDetail: number;
  /** Fraction of the full reef-fish school sizes. */
  fishDensity: number;
  /** Streaks in the rain pool; one draw call at any count. */
  rainDrops: number;
  /** HDR pipeline with bloom, grading and vignette. */
  postProcessing: boolean;
  bloomStrength: number;
  /** Multisample count of the HDR scene target. */
  msaaSamples: number;
};

export const QUALITY_SETTINGS: Record<QualityPreset, QualitySettings> = {
  low: {
    maxDpr: 1,
    pixelBudget: 1_000_000,
    oceanSegments: 96,
    shadowMapSize: 512,
    reflectionScale: 0,
    foamDensity: 0.45,
    wildlifeCount: 1,
    dolphinCount: 4,
    oceanDetail: 0.3,
    fishDensity: 0.55,
    rainDrops: 1600,
    skyDetail: 0,
    postProcessing: false,
    bloomStrength: 0,
    msaaSamples: 0,
  },
  medium: {
    maxDpr: 1.25,
    pixelBudget: 1_700_000,
    oceanSegments: 144,
    shadowMapSize: 1024,
    reflectionScale: 0.35,
    foamDensity: 0.7,
    wildlifeCount: 2,
    dolphinCount: 6,
    oceanDetail: 0.55,
    fishDensity: 0.9,
    rainDrops: 3200,
    skyDetail: 1,
    postProcessing: true,
    bloomStrength: 0.2,
    msaaSamples: 2,
  },
  high: {
    maxDpr: 1.5,
    pixelBudget: 2_600_000,
    oceanSegments: 224,
    shadowMapSize: 2048,
    reflectionScale: 0.5,
    foamDensity: 0.9,
    wildlifeCount: 2,
    dolphinCount: 8,
    oceanDetail: 1,
    fishDensity: 1.4,
    rainDrops: 5600,
    skyDetail: 1,
    postProcessing: true,
    bloomStrength: 0.26,
    msaaSamples: 4,
  },
};

export class QualityManager {
  private preset: QualityPreset;
  private slowWindows = 0;
  private gpuMeasured = false;
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

  /** Pixel ratio for a canvas of this CSS size at the governor's render scale. */
  pixelRatioFor(cssWidth: number, cssHeight: number, scale = 1): number {
    const settings = QUALITY_SETTINGS[this.preset];
    return budgetPixelRatio(window.devicePixelRatio || 1, settings.maxDpr, settings.pixelBudget, cssWidth, cssHeight, scale);
  }

  /**
   * Where GPU time is measured it decides the preset instead of the frame
   * rate (a GPU can deliver 60 fps while working flat out): overloaded at
   * the lowest render scale steps down; long idle at full scale steps up.
   */
  observeGpu(verdict: GovernorVerdict): void {
    this.gpuMeasured = true;
    if (verdict === "overloaded" && this.preset !== "low") {
      this.apply(this.preset === "high" ? "medium" : "low", true);
    } else if (verdict === "idle" && this.preset !== "high") {
      const nextPreset = this.preset === "low" ? "medium" : "high";
      if (!(this.coarseDevice && nextPreset === "high")) this.apply(nextPreset, true);
    }
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
    } else if (this.fastWindows >= 30 && this.preset !== "high" && !this.gpuMeasured) {
      // Without GPU timing a smooth frame rate is the only hint of headroom.
      const nextPreset = this.preset === "low" ? "medium" : "high";
      if (!(this.coarseDevice && nextPreset === "high")) this.apply(nextPreset, true);
      this.fastWindows = 0;
    }
  }

  private apply(preset: QualityPreset, notify: boolean): void {
    this.preset = preset;
    this.renderer.shadowMap.enabled = preset !== "low" && (!this.coarseDevice || preset === "high");
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (notify) this.onChange?.(preset);
  }
}
