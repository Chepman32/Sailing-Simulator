import * as THREE from "three";
import type { QualityLevel, QualityPreset } from "../types";

export type QualitySettings = {
  maxDpr: number;
  oceanSegments: number;
  shadowMapSize: number;
  /** Main yacht sun shadows. Ship shadows have their own budget below. */
  shadows: boolean;
  shipShadowMapSize: number;
  reflectionSize: number;
  foamDensity: number;
  wildlifeCount: number;
  smokeParticles: number;
};

export const QUALITY_SETTINGS: Record<QualityLevel, QualitySettings> = {
  low: {
    maxDpr: 1,
    oceanSegments: 96,
    shadowMapSize: 512,
    shadows: false,
    shipShadowMapSize: 1024,
    reflectionSize: 256,
    foamDensity: 0.45,
    wildlifeCount: 1,
    smokeParticles: 56,
  },
  medium: {
    maxDpr: 1.25,
    oceanSegments: 144,
    shadowMapSize: 1024,
    shadows: true,
    shipShadowMapSize: 2048,
    reflectionSize: 384,
    foamDensity: 0.7,
    wildlifeCount: 2,
    smokeParticles: 96,
  },
  high: {
    maxDpr: 1.75,
    oceanSegments: 224,
    shadowMapSize: 2048,
    shadows: true,
    shipShadowMapSize: 2048,
    reflectionSize: 512,
    foamDensity: 0.9,
    wildlifeCount: 2,
    smokeParticles: 140,
  },
};

/** Automatic mode only aims to keep the scene above this rate. */
export const AUTO_QUALITY_TARGET_FPS = 30;
const AUTO_SLOW_FPS = AUTO_QUALITY_TARGET_FPS - 3;
const AUTO_FAST_FPS = 50;
const AUTO_SLOW_WINDOWS = 3;
const AUTO_FAST_WINDOWS = 24;
/** After a downgrade, wait this many FPS windows before trying to upgrade. */
const AUTO_UPGRADE_COOLDOWN_WINDOWS = 80;

const LEVEL_ORDER: readonly QualityLevel[] = ["low", "medium", "high"];

export type AutoQualityState = {
  slowWindows: number;
  fastWindows: number;
  cooldownWindows: number;
};

export function createAutoQualityState(): AutoQualityState {
  return { slowWindows: 0, fastWindows: 0, cooldownWindows: 0 };
}

/**
 * One FPS window of the automatic quality policy. Pure so it can be tested:
 * it degrades only when the scene stays below ~30 FPS and upgrades only after a
 * long, clearly fast period, with a cooldown to prevent oscillation.
 */
export function stepAutoQuality(
  level: QualityLevel,
  fps: number,
  state: AutoQualityState,
  coarseDevice: boolean,
): QualityLevel {
  state.cooldownWindows = Math.max(0, state.cooldownWindows - 1);
  if (fps < AUTO_SLOW_FPS) {
    state.slowWindows += 1;
    state.fastWindows = 0;
  } else if (fps > AUTO_FAST_FPS) {
    state.fastWindows += 1;
    state.slowWindows = 0;
  } else {
    state.slowWindows = Math.max(0, state.slowWindows - 1);
    state.fastWindows = Math.max(0, state.fastWindows - 1);
  }

  const index = LEVEL_ORDER.indexOf(level);
  if (state.slowWindows >= AUTO_SLOW_WINDOWS && index > 0) {
    state.slowWindows = 0;
    state.fastWindows = 0;
    state.cooldownWindows = AUTO_UPGRADE_COOLDOWN_WINDOWS;
    return LEVEL_ORDER[index - 1];
  }
  if (state.fastWindows >= AUTO_FAST_WINDOWS && state.cooldownWindows === 0 && index < LEVEL_ORDER.length - 1) {
    state.fastWindows = 0;
    const next = LEVEL_ORDER[index + 1];
    // Phones and tablets never promote themselves to the high budget.
    if (coarseDevice && next === "high") return level;
    return next;
  }
  return level;
}

export function initialAutoLevel(coarseDevice: boolean, compactViewport: boolean): QualityLevel {
  if (coarseDevice) return "low";
  return compactViewport ? "medium" : "high";
}

export class QualityManager {
  private presetValue: QualityPreset;
  private levelValue: QualityLevel;
  private readonly autoState = createAutoQualityState();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    initialPreset: QualityPreset,
    private readonly coarseDevice: boolean,
    private readonly autoStartLevel: QualityLevel,
    private readonly onChange?: (preset: QualityPreset, level: QualityLevel) => void,
  ) {
    this.presetValue = initialPreset;
    this.levelValue = this.levelForPreset(initialPreset);
    this.apply(false);
  }

  get preset(): QualityPreset {
    return this.presetValue;
  }

  get level(): QualityLevel {
    return this.levelValue;
  }

  get settings(): QualitySettings {
    return QUALITY_SETTINGS[this.levelValue];
  }

  setPreset(preset: QualityPreset): void {
    this.presetValue = preset;
    this.levelValue = this.levelForPreset(preset);
    Object.assign(this.autoState, createAutoQualityState());
    this.apply(true);
  }

  observeFps(fps: number): void {
    // A fixed preset is a promise to the user: never change it behind their back.
    if (this.presetValue !== "auto") return;
    const next = stepAutoQuality(this.levelValue, fps, this.autoState, this.coarseDevice);
    if (next === this.levelValue) return;
    this.levelValue = next;
    this.apply(true);
  }

  private levelForPreset(preset: QualityPreset): QualityLevel {
    if (preset === "auto") return this.autoStartLevel;
    return preset;
  }

  private apply(notify: boolean): void {
    const settings = QUALITY_SETTINGS[this.levelValue];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxDpr));
    // The shadow renderer stays enabled so large ships can always cast their own
    // crisp shadows; the yacht sun toggles its castShadow flag per level instead.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (notify) this.onChange?.(this.presetValue, this.levelValue);
  }
}
