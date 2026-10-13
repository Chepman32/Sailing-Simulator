export type CameraMode = "chase" | "helm" | "orbit" | "drone";
export type QualityPreset = "low" | "medium" | "high";
export type LightingMode = "day" | "night";
export type { WeatherKind, WeatherMode } from "./environment/WeatherMath";
import type { WeatherKind, WeatherMode } from "./environment/WeatherMath";

export type LoadingState = {
  loaded: number;
  total: number;
  label: string;
  ready: boolean;
};

export type SimulationSnapshot = {
  speedKnots: number;
  depthMeters: number;
  headingDegrees: number;
  heelDegrees: number;
  apparentWindKnots: number;
  apparentWindAngle: number;
  rudderDegrees: number;
  throttle: number;
  sailTrim: number;
  cameraMode: CameraMode;
  lightingMode: LightingMode;
  /** The time of day follows its own automatic cycle. */
  autoTime: boolean;
  /** Weather chosen by the planner (auto) or by the player (manual). */
  weatherMode: WeatherMode;
  /** The player's choice, used in manual mode. */
  weather: WeatherKind;
  /** The weather in force right now, whichever mode picked it. */
  weatherNow: WeatherKind;
  /** Significant wave height of the sea at present, metres. */
  waveHeight: number;
  /** True wind speed at present, knots. */
  trueWindKnots: number;
  quality: QualityPreset;
  soundEnabled: boolean;
  audioReady: boolean;
  engineRunning: boolean;
  /** The helm is temporarily steering clear of an island. */
  shoreGuardActive: boolean;
  engineMuted: boolean;
  fps: number;
  status: "loading" | "running" | "paused" | "error";
};

export type SimulatorOptions = {
  onSnapshot?: (snapshot: SimulationSnapshot) => void;
  onLoading?: (state: LoadingState) => void;
  onError?: (message: string) => void;
  /** Return true when the interface handles the gesture instead of recentering. */
  onSceneDoubleTap?: () => boolean;
};

export type SimulatorControls = {
  throttle: number;
  rudder: number;
  sailTrim: number;
};

export type Dispose = () => void;
