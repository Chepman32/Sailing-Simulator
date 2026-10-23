export type CameraMode = "chase" | "helm" | "orbit" | "drone";
/** Concrete renderer budget. */
export type QualityLevel = "low" | "medium" | "high";
/** User selection. Only "auto" adapts the level at runtime (targeting 30 FPS). */
export type QualityPreset = "auto" | QualityLevel;
export type LightingMode = "day" | "night";

export type LoadingState = {
  loaded: number;
  total: number;
  label: string;
  ready: boolean;
};

export type DiscoveryNotice = {
  /** Point-of-interest id, or "collectible" for a picked-up bottle or crate. */
  id: string;
  kind: PointOfInterestKind;
  serial: number;
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
  qualityLevel: QualityLevel;
  soundEnabled: boolean;
  audioReady: boolean;
  engineRunning: boolean;
  engineMuted: boolean;
  fps: number;
  status: "loading" | "running" | "paused" | "error";
  positionX: number;
  positionZ: number;
  collected: number;
  collectibleTotal: number;
  discovered: number;
  discoverableTotal: number;
  /** Increments whenever explored cells or discovered places change. */
  mapRevision: number;
  lastDiscovery: DiscoveryNotice | null;
  photoAutoTarget: boolean;
  photoSubject: PhotoSubjectKind | null;
  flareReady: boolean;
};

export type PointOfInterestKind =
  | "volcano"
  | "galleon"
  | "monolith"
  | "party"
  | "lighthouse"
  | "bottle"
  | "crate";

export type PhotoSubjectKind =
  | "yacht"
  | "dolphin"
  | "whale"
  | "shark"
  | "ship"
  | "volcano"
  | "flare"
  | "party"
  | "monolith"
  | "lighthouse";

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
