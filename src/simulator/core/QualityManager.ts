import * as THREE from "three";
import type { QualityPreset } from "../types";
import { AUTO_SLOW_FPS, budgetPixelRatio, FpsJudge, type GovernorVerdict } from "./RenderBudget";

/** Consecutive slow frame-rate windows (0.75 s each) before automatic mode lowers the preset. */
const SLOW_WINDOWS_TO_STEP_DOWN = 4;

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
  /** Sharks patrolling around the yacht, each on its own. */
  sharkCount: number;
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
  /** Most anisotropic filtering for textures seen at a slant (capped by the GPU). */
  anisotropy: number;
  /** Ground-truth ambient occlusion over the scene (a post pass on the scene's own depth). */
  ambientOcclusion: boolean;
  /** Sun shafts: crepuscular rays streaming from the sun past masts, sails, palms and cloud edges. */
  godRays: boolean;
  /** Extra capillary octaves of the ocean's normal up close. */
  oceanMicro: boolean;
  /** Dense 3D grass round the viewer: its reach (m) and the fraction of the full density. */
  grassRadius: number;
  grassDensity: number;
  /** Meshes keep their full detail at any size on screen (no simplified levels). */
  fullDetail: boolean;
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
    dolphinCount: 6,
    sharkCount: 1,
    oceanDetail: 0.3,
    fishDensity: 0.75,
    rainDrops: 1600,
    skyDetail: 0,
    postProcessing: false,
    bloomStrength: 0,
    msaaSamples: 0,
    anisotropy: 2,
    ambientOcclusion: false,
    godRays: false,
    oceanMicro: false,
    grassRadius: 0,
    grassDensity: 0,
    fullDetail: false,
  },
  medium: {
    maxDpr: 1.25,
    pixelBudget: 1_700_000,
    oceanSegments: 144,
    shadowMapSize: 1024,
    reflectionScale: 0.35,
    foamDensity: 0.7,
    wildlifeCount: 2,
    dolphinCount: 9,
    sharkCount: 2,
    oceanDetail: 0.55,
    fishDensity: 1.25,
    rainDrops: 3200,
    skyDetail: 1,
    postProcessing: true,
    bloomStrength: 0.2,
    msaaSamples: 2,
    anisotropy: 4,
    ambientOcclusion: false,
    godRays: false,
    oceanMicro: false,
    grassRadius: 22,
    grassDensity: 0.45,
    fullDetail: false,
  },
  high: {
    maxDpr: 1.5,
    pixelBudget: 2_600_000,
    oceanSegments: 224,
    shadowMapSize: 2048,
    reflectionScale: 0.5,
    foamDensity: 0.9,
    wildlifeCount: 2,
    dolphinCount: 12,
    sharkCount: 3,
    oceanDetail: 1,
    fishDensity: 1.8,
    rainDrops: 5600,
    skyDetail: 1,
    postProcessing: true,
    bloomStrength: 0.26,
    msaaSamples: 4,
    anisotropy: 8,
    ambientOcclusion: false,
    godRays: false,
    oceanMicro: false,
    grassRadius: 32,
    grassDensity: 0.72,
    fullDetail: false,
  },
  /**
   * Everything at its best, for a desktop GPU with room to spare: never
   * chosen by the automatic mode, only by the player. Full-resolution
   * reflections, 4096 soft shadows, 8× MSAA, ambient occlusion, sun shafts,
   * 16× anisotropic filtering, the densest grass and meshes at full detail.
   */
  ultra: {
    maxDpr: 2,
    pixelBudget: 4_200_000,
    oceanSegments: 320,
    shadowMapSize: 4096,
    reflectionScale: 0.75,
    foamDensity: 1,
    wildlifeCount: 3,
    dolphinCount: 14,
    sharkCount: 3,
    oceanDetail: 1,
    fishDensity: 2.2,
    rainDrops: 8000,
    skyDetail: 1,
    postProcessing: true,
    bloomStrength: 0.3,
    msaaSamples: 8,
    anisotropy: 16,
    ambientOcclusion: true,
    godRays: true,
    oceanMicro: true,
    grassRadius: 46,
    grassDensity: 1,
    fullDetail: true,
  },
};

/** The next preset down (the automatic mode's step when frames run slow). */
export function stepDown(preset: QualityPreset): QualityPreset {
  return preset === "ultra" ? "high" : preset === "high" ? "medium" : "low";
}

export class QualityManager {
  private preset: QualityPreset;
  private slowWindows = 0;
  private gpuMeasured = false;
  private fastWindows = 0;
  /** Whether automatic mode has lowered the preset in this session. */
  private steppedDown = false;
  private readonly coarseDevice = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  private readonly fpsJudge = new FpsJudge(AUTO_SLOW_FPS);
  /** Only automatic mode changes the level by itself; a chosen preset is never lowered or raised. */
  private adaptive = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    initialPreset: QualityPreset,
    private readonly onChange?: (preset: QualityPreset) => void,
  ) {
    this.preset = this.coarseDevice && (initialPreset === "high" || initialPreset === "ultra") ? "medium" : initialPreset;
    this.apply(this.preset, false);
  }

  get isAdaptive(): boolean {
    return this.adaptive;
  }

  setAdaptive(adaptive: boolean): void {
    this.adaptive = adaptive;
    // The automatic mode tops out at the high preset: ultra is the player's own choice.
    if (adaptive && this.preset === "ultra") this.apply("high", true);
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.fpsJudge.reset();
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
    if (!this.adaptive) return;
    this.gpuMeasured = true;
    if (verdict === "overloaded" && this.preset !== "low") {
      this.apply(stepDown(this.preset), true);
      this.steppedDown = true;
    } else if (verdict === "idle" && (this.preset === "low" || this.preset === "medium") && !(this.coarseDevice && this.steppedDown)) {
      const nextPreset = this.preset === "low" ? "medium" : "high";
      if (!(this.coarseDevice && nextPreset === "high")) this.apply(nextPreset, true);
    }
  }

  /**
   * Something other than the scene made the last frames slow (the screen
   * turned, the page came back from the background): the frame-rate windows
   * start over, with their warm-up.
   */
  noteDisruption(): void {
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.fpsJudge.reset();
  }

  /** @param frameCap the most frames per second the pacer allows right now (30 while unfocused). */
  observeFps(fps: number, frameCap = 60): void {
    if (!this.adaptive) return;
    const reading = this.fpsJudge.observe(fps, frameCap);
    if (reading === "ignored") return;
    if (reading === "slow") {
      this.slowWindows += 1;
      this.fastWindows = 0;
    } else if (reading === "fast") {
      this.fastWindows += 1;
      this.slowWindows = 0;
    } else {
      this.slowWindows = Math.max(0, this.slowWindows - 1);
      this.fastWindows = Math.max(0, this.fastWindows - 1);
    }

    if (this.slowWindows >= SLOW_WINDOWS_TO_STEP_DOWN && this.preset !== "low") {
      this.apply(stepDown(this.preset), true);
      this.slowWindows = 0;
      this.steppedDown = true;
    } else if (
      this.fastWindows >= 30 &&
      (this.preset === "low" || this.preset === "medium") &&
      !this.gpuMeasured &&
      // On a phone a step down and back up is two recompiles of every shader
      // (seconds of frozen picture each); once lowered, the level stays.
      !(this.coarseDevice && this.steppedDown)
    ) {
      // Without GPU timing a smooth frame rate is the only hint of headroom.
      const nextPreset = this.preset === "low" ? "medium" : "high";
      if (!(this.coarseDevice && nextPreset === "high")) this.apply(nextPreset, true);
      this.fastWindows = 0;
    }
  }

  /** Whether the last preset change switched shadows on or off (materials must recompile). */
  shadowsChanged = false;

  private apply(preset: QualityPreset, notify: boolean): void {
    this.preset = preset;
    this.fpsJudge.reset();
    const shadows = preset !== "low" && (!this.coarseDevice || preset === "high" || preset === "ultra");
    this.shadowsChanged = shadows !== this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (notify) this.onChange?.(preset);
  }
}
