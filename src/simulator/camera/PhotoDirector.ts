import * as THREE from "three";
import type { PhotoSubjectKind } from "../types";

/** Something worth photographing, published by the system that owns it. */
export type InterestPoint = {
  kind: PhotoSubjectKind;
  /** Live reference; the director reads it every frame. */
  position: THREE.Vector3;
  /** Approximate subject radius in metres, used for framing. */
  radius: number;
  /** Higher wins. Short, rare events (breach, tail slap) rank highest. */
  priority: number;
  /** Look-at height above `position`, as a fraction of the radius. */
  lookHeight?: number;
};

export type DirectedShot = {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
};

export type YachtPose = {
  position: THREE.Vector3;
  heading: number;
};

/**
 * Yacht-space box (x, y, z min/max) that covers hulls, mast and both sails at
 * any sheet angle. A camera whose sight line crosses it could have the subject
 * hidden behind canvas.
 */
export const YACHT_OCCLUDER_MIN = new THREE.Vector3(-3.7, -1.1, -5);
export const YACHT_OCCLUDER_MAX = new THREE.Vector3(3.7, 8.6, 4.9);

/** Slab test: does the segment start→end pass through the axis-aligned box? */
export function segmentIntersectsBox(
  start: THREE.Vector3,
  end: THREE.Vector3,
  min: THREE.Vector3,
  max: THREE.Vector3,
): boolean {
  let tMin = 0;
  let tMax = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = start.getComponent(axis);
    const direction = end.getComponent(axis) - origin;
    const low = min.getComponent(axis);
    const high = max.getComponent(axis);
    if (Math.abs(direction) < 1e-9) {
      if (origin < low || origin > high) return false;
      continue;
    }
    let t1 = (low - origin) / direction;
    let t2 = (high - origin) / direction;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

/** Transform a world point into yacht space (heading only; pitch/roll are small). */
export function toYachtSpace(point: THREE.Vector3, yacht: YachtPose, target: THREE.Vector3): THREE.Vector3 {
  const dx = point.x - yacht.position.x;
  const dz = point.z - yacht.position.z;
  const cos = Math.cos(yacht.heading);
  const sin = Math.sin(yacht.heading);
  // Inverse of a rotation about +Y by `heading`.
  return target.set(dx * cos - dz * sin, point.y - yacht.position.y, dx * sin + dz * cos);
}

/** True if the yacht (sails included) blocks the line from camera to subject. */
export function isOccludedByYacht(camera: THREE.Vector3, subject: THREE.Vector3, yacht: YachtPose): boolean {
  const start = toYachtSpace(camera, yacht, new THREE.Vector3());
  const end = toYachtSpace(subject, yacht, new THREE.Vector3());
  return segmentIntersectsBox(start, end, YACHT_OCCLUDER_MIN, YACHT_OCCLUDER_MAX);
}

export type ShotEnvironment = {
  waterHeightAt: (x: number, z: number) => number;
  /** Terrain height or -Infinity over open water. */
  terrainHeightAt: (x: number, z: number) => number;
  sunDirection: THREE.Vector3;
};

const AZIMUTH_SAMPLES = 16;

/**
 * Choose a camera offset (relative to the subject) that frames it without the
 * yacht's sails or an island in the sight line, prefers a front-lit subject,
 * and stays close to the previous angle for continuity.
 */
export function planShotOffset(
  subject: InterestPoint,
  yacht: YachtPose,
  environment: ShotEnvironment,
  previousAzimuth: number | null,
  target = new THREE.Vector3(),
): { offset: THREE.Vector3; azimuth: number; blocked: boolean } {
  const lookAt = new THREE.Vector3().copy(subject.position);
  lookAt.y += subject.radius * (subject.lookHeight ?? 0.2);
  // Airborne subjects (a flare under its parachute) are shot from low over the
  // water looking up, with sea and horizon in frame.
  const altitude = subject.position.y - environment.waterHeightAt(subject.position.x, subject.position.z);
  const airborne = altitude > 25;
  const distance = airborne
    ? THREE.MathUtils.clamp(altitude * 0.95, 40, 220)
    : THREE.MathUtils.clamp(subject.radius * 3.4, 9, 900);
  const elevations = airborne
    ? [0]
    : subject.radius > 60 ? [0.06, 0.12] : subject.kind === "shark" ? [0.1, 0.18] : [0.12, 0.24, 0.38];
  const candidate = new THREE.Vector3();
  const sample = new THREE.Vector3();
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestAzimuth = previousAzimuth ?? 0;
  let bestBlocked = true;
  const sunHorizontal = Math.hypot(environment.sunDirection.x, environment.sunDirection.z) || 1;

  for (let index = 0; index < AZIMUTH_SAMPLES; index += 1) {
    const azimuth = (index / AZIMUTH_SAMPLES) * Math.PI * 2;
    for (const elevation of elevations) {
      const horizontal = airborne ? distance : Math.cos(elevation) * distance;
      candidate.set(
        subject.position.x + Math.sin(azimuth) * horizontal,
        lookAt.y + Math.sin(elevation) * distance,
        subject.position.z + Math.cos(azimuth) * horizontal,
      );
      const water = environment.waterHeightAt(candidate.x, candidate.z);
      candidate.y = airborne ? water + 5 : Math.max(candidate.y, water + 1.3);
      if (environment.terrainHeightAt(candidate.x, candidate.z) > candidate.y - 3) continue;

      let score = 0;
      let blocked = false;
      if (subject.kind !== "yacht" && isOccludedByYacht(candidate, lookAt, yacht)) {
        score -= 100;
        blocked = true;
      }
      // Islands between the camera and the subject.
      for (let step = 1; step < 6; step += 1) {
        sample.lerpVectors(candidate, lookAt, step / 6);
        if (environment.terrainHeightAt(sample.x, sample.z) > sample.y) {
          score -= 60;
          blocked = true;
          break;
        }
      }
      // Front light: camera on the sun's side of the subject.
      const facing = (Math.sin(azimuth) * environment.sunDirection.x + Math.cos(azimuth) * environment.sunDirection.z) / sunHorizontal;
      score += facing * 6;
      // Keep some sea and sky: favour the lower of the elevations slightly.
      score -= elevation * 4;
      if (previousAzimuth !== null) {
        const difference = Math.abs(Math.atan2(Math.sin(azimuth - previousAzimuth), Math.cos(azimuth - previousAzimuth)));
        score -= difference * 4;
      }
      if (score > bestScore) {
        bestScore = score;
        bestAzimuth = azimuth;
        bestBlocked = blocked;
        target.copy(candidate).sub(subject.position);
      }
    }
  }
  if (!Number.isFinite(bestScore)) target.set(0, distance * 0.3, -distance);
  return { offset: target, azimuth: bestAzimuth, blocked: bestBlocked };
}

const MIN_HOLD_SECONDS = 4.5;
const MAX_HOLD_SECONDS = 13;
const KIND_COOLDOWN_SECONDS = 14;
const REPLAN_SECONDS = 1.6;

/**
 * Photo-mode "auto target": picks the most interesting live event, holds it
 * long enough to be enjoyed, cycles away from long-lived subjects, and frames
 * each one from an unobstructed, well-lit angle.
 */
export class PhotoDirector {
  private current: InterestPoint | null = null;
  private holdTime = 0;
  private replanTimer = 0;
  private azimuth: number | null = null;
  private heroAzimuth = Math.PI * 0.82;
  private readonly offset = new THREE.Vector3(0, 6, -20);
  private readonly cooldowns = new Map<PhotoSubjectKind, number>();
  private readonly shot: DirectedShot = {
    position: new THREE.Vector3(),
    lookAt: new THREE.Vector3(),
    fov: 50,
  };
  private readonly heroPoint: InterestPoint = {
    kind: "yacht",
    position: new THREE.Vector3(),
    radius: 6,
    priority: 0,
    lookHeight: 0.45,
  };

  get subject(): PhotoSubjectKind | null {
    return this.current?.kind ?? null;
  }

  reset(): void {
    this.current = null;
    this.holdTime = 0;
    this.azimuth = null;
  }

  update(delta: number, points: readonly InterestPoint[], yacht: YachtPose, environment: ShotEnvironment): DirectedShot {
    this.cooldowns.forEach((value, kind) => {
      if (value - delta <= 0) this.cooldowns.delete(kind);
      else this.cooldowns.set(kind, value - delta);
    });
    this.holdTime += delta;
    this.heroPoint.position.copy(yacht.position);
    const next = this.choose(points);
    if (next?.position !== this.current?.position || next?.kind !== this.current?.kind) {
      if (this.current) this.cooldowns.set(this.current.kind, KIND_COOLDOWN_SECONDS);
      this.current = next;
      this.holdTime = 0;
      this.azimuth = null;
      this.replanTimer = 0;
    }
    if (next) this.current = next;
    const subject = this.current ?? this.heroPoint;

    if (subject.kind === "yacht") {
      // Slow cinematic orbit around the yacht, low over the water.
      this.heroAzimuth += delta * 0.07;
      const distance = 19;
      this.offset.set(
        Math.sin(yacht.heading + this.heroAzimuth) * distance,
        3.2 + Math.sin(this.heroAzimuth * 0.7) * 1.4,
        Math.cos(yacht.heading + this.heroAzimuth) * distance,
      );
    } else {
      this.replanTimer -= delta;
      const occludedNow = isOccludedByYacht(this.shot.position, this.lookPoint(subject, this.shot.lookAt), yacht);
      if (this.replanTimer <= 0 || occludedNow) {
        const plan = planShotOffset(subject, yacht, environment, this.azimuth, this.offset);
        this.azimuth = plan.azimuth;
        this.replanTimer = REPLAN_SECONDS;
      }
    }

    this.shot.position.copy(subject.position).add(this.offset);
    const water = environment.waterHeightAt(this.shot.position.x, this.shot.position.z);
    this.shot.position.y = Math.max(this.shot.position.y, water + 1.1);
    this.lookPoint(subject, this.shot.lookAt);
    const distance = Math.max(1, this.shot.position.distanceTo(this.shot.lookAt));
    this.shot.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((subject.radius * 1.35) / distance)), 22, 62);
    const subjectWater = environment.waterHeightAt(subject.position.x, subject.position.z);
    const altitude = subject.position.y - subjectWater;
    if (altitude > 25) {
      // Keep sea and horizon in frame below an airborne subject.
      const horizontal = Math.max(1, Math.hypot(this.shot.position.x - subject.position.x, this.shot.position.z - subject.position.z));
      this.shot.lookAt.y = subjectWater + altitude * 0.52;
      this.shot.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((altitude * 0.66) / horizontal)), 34, 72);
    }
    return this.shot;
  }

  private lookPoint(subject: InterestPoint, target: THREE.Vector3): THREE.Vector3 {
    target.copy(subject.position);
    target.y += subject.radius * (subject.lookHeight ?? 0.2);
    return target;
  }

  private choose(points: readonly InterestPoint[]): InterestPoint | null {
    // Systems may publish fresh objects each frame; the live position reference
    // identifies the same subject.
    const previous = this.current;
    const current = previous ? points.find((point) => point.position === previous.position && point.kind === previous.kind) ?? null : null;
    if (current && this.holdTime < MIN_HOLD_SECONDS) return current;
    let best: InterestPoint | null = null;
    let bestScore = 0;
    for (const point of points) {
      if (point !== current && this.cooldowns.has(point.kind)) continue;
      let score = point.priority;
      if (point === current) score += this.holdTime < MAX_HOLD_SECONDS ? 1.5 : -10;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    if (current && this.holdTime >= MAX_HOLD_SECONDS && best === current) return null;
    return best;
  }
}
