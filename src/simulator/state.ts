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
  if (!running) state.controls.throttle = 0;
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
