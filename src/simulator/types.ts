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
  status: "loading" | "running" | "paused" | "error";
};

export type SimulatorOptions = {
  onSnapshot?: (snapshot: SimulationSnapshot) => void;
  onLoading?: (state: LoadingState) => void;
  onError?: (message: string) => void;
};

export type SimulatorControls = {
  throttle: number;
  rudder: number;
  sailTrim: number;
};

export type Dispose = () => void;
