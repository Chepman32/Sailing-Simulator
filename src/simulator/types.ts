export type CameraMode = "chase" | "helm" | "orbit" | "drone";
export type QualityPreset = "low" | "medium" | "high";
export type LightingMode = "day" | "night";

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
  quality: QualityPreset;
  soundEnabled: boolean;
  audioReady: boolean;
  engineRunning: boolean;
  engineMuted: boolean;
  fps: number;
  /** Yacht world position (meters) for the chart. */
  positionX: number;
  positionZ: number;
  /** Ids of charted landmarks discovered so far; the array is replaced when it changes. */
  discoveredLandmarks: readonly string[];
  /** Increments whenever fog or discoveries change, so the chart knows to redraw. */
  explorationRevision: number;
  /** Share of the chart square revealed, in [0, 1]. */
  exploredFraction: number;
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
