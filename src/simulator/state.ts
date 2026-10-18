import type {
  CameraMode,
  LightingMode,
  QualityPreset,
  SimulationSnapshot,
  SimulatorControls,
  WeatherKind,
  WeatherMode,
} from "./types";

export type SimulatorState = {
  controls: SimulatorControls;
  cameraMode: CameraMode;
  lightingMode: LightingMode;
  /** The day cycle runs by itself (see `dayCycleState`). */
  autoTime: boolean;
  weatherMode: WeatherMode;
  /** The weather the player picked; it applies in manual mode. */
  weather: WeatherKind;
  quality: QualityPreset;
  soundEnabled: boolean;
  engineRunning: boolean;
  engineMuted: boolean;
};

export const ENGINE_START_THROTTLE = 0.12;

export function createSimulatorState(): SimulatorState {
  return {
    controls: { throttle: 0, rudder: 0, sailTrim: 0.68 },
    cameraMode: "chase",
    lightingMode: "day",
    autoTime: false,
    weatherMode: "auto",
    weather: "clear",
    quality: "high",
    soundEnabled: true,
    engineRunning: false,
    engineMuted: false,
  };
}

export function applyEnginePower(state: SimulatorState, running: boolean): void {
  state.engineRunning = running;
  if (!running) {
    state.controls.throttle = 0;
  } else {
    // Engine power and engine sound are independent controls: starting or
    // stopping the engine never touches the mute preference, and the sound
    // button never starts or stops the engine.
    if (Math.abs(state.controls.throttle) <= 0.08) {
      state.controls.throttle = ENGINE_START_THROTTLE;
    }
  }
}

export const EMPTY_SNAPSHOT: SimulationSnapshot = {
  speedKnots: 0,
  depthMeters: 18,
  headingDegrees: 0,
  heelDegrees: 0,
  apparentWindKnots: 12,
  apparentWindAngle: 35,
  rudderDegrees: 0,
  throttle: 0,
  sailTrim: 0.68,
  cameraMode: "chase",
  lightingMode: "day",
  autoTime: false,
  weatherMode: "auto",
  weather: "clear",
  weatherNow: "clear",
  waveHeight: 0.9,
  trueWindKnots: 15,
  quality: "high",
  soundEnabled: true,
  audioReady: false,
  engineRunning: false,
  shoreGuardActive: false,
  engineMuted: false,
  fps: 60,
  status: "loading",
};
