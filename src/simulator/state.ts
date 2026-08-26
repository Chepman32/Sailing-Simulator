import type {
  CameraMode,
  LightingMode,
  QualityPreset,
  SimulationSnapshot,
  SimulatorControls,
} from "./types";

export type SimulatorState = {
  controls: SimulatorControls;
  cameraMode: CameraMode;
  lightingMode: LightingMode;
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
    // Starting the engine is an explicit request for an audible engine. A mute
    // value saved by an earlier session must not silently survive this action;
    // the user can mute the running engine again from the sound control.
    state.engineMuted = false;
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
  quality: "high",
  soundEnabled: true,
  audioReady: false,
  engineRunning: false,
  engineMuted: false,
  fps: 60,
  status: "loading",
};
