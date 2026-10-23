import * as THREE from "three";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp, damp } from "../math";
import type { CameraMode } from "../types";
import { isUsablePose } from "../core/RenderHealth";
import type { PhotoShot } from "./PhotoDirector";
import type { VesselPhysics } from "../vessel/VesselPhysics";

/** The helmsman's eyes: a point in the yacht's frame, carried exactly with her. */
export type HelmFrame = { root: THREE.Object3D; eye: THREE.Vector3 };

/** Share of the yacht's roll and pitch the helmsman's head goes with (the rest the neck takes out). */
const HEAD_ROLL_SHARE = 0.3;
const HEAD_PITCH_SHARE = 0.45;

/**
 * Near plane: inside the helm station things are a hand's breadth from the
 * eye; from outside nothing is nearer than several metres, and the larger
 * value gives the 24-bit depth buffer four times the resolution at range,
 * so a ship or an island kilometres off does not shimmer where surfaces meet.
 */
const NEAR_PLANE_CLOSE = 0.08;
const NEAR_PLANE_OUTSIDE = 0.35;

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedTarget = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private yawOffset = 0;
  private pitch = 0.1;
  private distance = 17;
  private mode: CameraMode = "chase";

  constructor(
    aspect: number,
    private readonly ocean: OceanSystem,
  ) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.08, 3400);
    this.camera.position.set(0, 7, -16);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.recenter();
    if (mode === "chase") this.distance = 17;
    if (mode === "orbit") this.distance = 24;
    if (mode === "drone") this.distance = 42;
  }

  /** At the helm, keep the horizon level and the heave smoothed (a setting, on by default). */
  steadyHelm = true;
  private steadyEyeY = Number.NaN;

  /** Counts the player's own look-arounds and zooms (photo mode yields to them). */
  interactions = 0;

  orbit(deltaX: number, deltaY: number): void {
    this.interactions += 1;
    const yawLimit = this.mode === "helm" ? 1.45 : Math.PI * 4;
    this.yawOffset = clamp(this.yawOffset - deltaX * 0.0047, -yawLimit, yawLimit);
    this.pitch = clamp(this.pitch + deltaY * 0.0038, this.mode === "helm" ? -0.32 : -0.24, 1.08);
  }

  zoom(delta: number): void {
    this.interactions += 1;
    if (this.mode === "helm") return;
    this.distance = clamp(this.distance + delta * 0.035, 7, 68);
  }

  /**
   * The camera eases towards its goal, so one NaN (a zero-length step, a
   * boat reset mid-frame) would stay in it for good: every frame is then
   * drawn from nowhere while the HUD carries on. Put it back behind the boat.
   */
  private recoverPose(delta: number, focus: THREE.Vector3): void {
    const camera = this.camera;
    const ok = isUsablePose([
      camera.position.x, camera.position.y, camera.position.z,
      this.smoothedTarget.x, this.smoothedTarget.y, this.smoothedTarget.z,
      camera.fov, camera.aspect, camera.near, camera.quaternion.x, camera.quaternion.w,
    ]);
    if (ok && Number.isFinite(delta)) return;
    if (!isUsablePose([focus.x, focus.y, focus.z])) return;
    camera.position.set(focus.x, focus.y + 7, focus.z - 16);
    this.smoothedTarget.copy(focus);
    camera.fov = 60;
    if (!Number.isFinite(camera.aspect) || camera.aspect <= 0) camera.aspect = 1;
    camera.near = NEAR_PLANE_OUTSIDE;
    camera.quaternion.identity();
    camera.updateProjectionMatrix();
  }

  /** Jumps to the boat on the next update instead of easing there (a new start, a reset). */
  snap(): void {
    this.snapNext = true;
  }

  private snapNext = true;

  private follow(rate: number, delta: number): number {
    return this.snapNext ? 1 : 1 - Math.exp(-rate * delta);
  }

  recenter(): void {
    this.yawOffset = 0;
    this.pitch = this.mode === "helm" ? 0.1 : this.mode === "drone" ? 0.58 : this.mode === "orbit" ? 0.24 : 0.1;
  }

  private directed = false;
  private readonly savedPosition = new THREE.Vector3();
  private readonly savedQuaternion = new THREE.Quaternion();
  private savedFov = 52;
  private readonly aim = new THREE.Object3D();
  private readonly shotPosition = new THREE.Vector3();

  /**
   * Turns the camera toward a photo-mode shot (see `PhotoDirector`), blended
   * over the normal camera by `blend` (0…1). Called after `update`; the next
   * `update` starts again from the normal camera, so the follow camera never
   * drifts while a shot is held.
   */
  direct(shot: PhotoShot | null, blend: number): void {
    if (!shot || blend <= 0.001) return;
    const camera = this.camera;
    this.savedPosition.copy(camera.position);
    this.savedQuaternion.copy(camera.quaternion);
    this.savedFov = camera.fov;
    this.directed = true;
    this.shotPosition.set(shot.position.x, shot.position.y, shot.position.z);
    // Never below the waves.
    const water = this.ocean.sample(this.shotPosition.x, this.shotPosition.z).height;
    this.shotPosition.y = Math.max(this.shotPosition.y, water + 1.2);
    camera.position.lerp(this.shotPosition, blend);
    this.aim.position.copy(camera.position);
    this.aim.up.set(0, 1, 0);
    // An Object3D looks down its +Z; a camera down −Z: aim from the target back.
    this.aim.lookAt(2 * camera.position.x - shot.target.x, 2 * camera.position.y - shot.target.y, 2 * camera.position.z - shot.target.z);
    camera.quaternion.slerp(this.aim.quaternion, blend);
    camera.fov = camera.fov + (shot.fov - camera.fov) * blend;
    camera.near = NEAR_PLANE_OUTSIDE;
    camera.updateProjectionMatrix();
  }

  update(delta: number, physics: VesselPhysics, helm?: HelmFrame): void {
    if (this.directed) {
      // Back to the normal camera before it moves on.
      this.camera.position.copy(this.savedPosition);
      this.camera.quaternion.copy(this.savedQuaternion);
      this.camera.fov = this.savedFov;
      this.directed = false;
    }
    const focus = physics.position;
    this.recoverPose(delta, focus);
    const heading = physics.heading + this.yawOffset;
    const horizontalDirectionX = Math.sin(heading);
    const horizontalDirectionZ = Math.cos(heading);

    if (this.mode === "helm" && helm) {
      // Standing at the wheel: the eyes move exactly with the yacht (nothing
      // lags into the wheel or the pod), while the head keeps most of its
      // own level against her roll and pitch, as a helmsman's does.
      this.camera.position.copy(helm.eye).applyMatrix4(helm.root.matrixWorld);
      // Steady view (the default): the eyes ride the boat but the head keeps
      // the horizon level and soaks up the heave, so the deck still moves
      // under the player without the whole world swinging with it.
      const steady = this.steadyHelm;
      if (steady) {
        const y = this.camera.position.y;
        this.steadyEyeY = Number.isFinite(this.steadyEyeY) && !this.snapNext ? this.steadyEyeY + (y - this.steadyEyeY) * this.follow(2.2, delta) : y;
        this.camera.position.y = this.steadyEyeY;
      }
      this.camera.rotation.set(
        -this.pitch - physics.pitch * (steady ? HEAD_PITCH_SHARE * 0.15 : HEAD_PITCH_SHARE),
        physics.heading + this.yawOffset + Math.PI,
        physics.roll * (steady ? HEAD_ROLL_SHARE * 0.1 : HEAD_ROLL_SHARE),
        "YXZ",
      );
      this.camera.fov = damp(this.camera.fov, 66, 2.6, delta);
      this.camera.near = NEAR_PLANE_CLOSE;
      this.camera.updateProjectionMatrix();
      this.snapNext = false;
      return;
    }
    if (this.mode === "helm") {
      this.desiredPosition.copy(focus).addScaledVector(physics.forward, -3.1).setY(focus.y + 2.85);
      this.viewDirection.set(horizontalDirectionX, Math.sin(-this.pitch), horizontalDirectionZ).normalize();
      this.lookTarget.copy(this.desiredPosition).addScaledVector(this.viewDirection, 18);
      this.camera.position.lerp(this.desiredPosition, this.follow(12, delta));
      this.smoothedTarget.lerp(this.lookTarget, this.follow(10, delta));
    } else {
      const portraitFraming =
        this.camera.aspect < 0.78 && this.mode !== "drone"
          ? clamp(0.82 / Math.max(this.camera.aspect, 0.42), 1, 1.55)
          : 1;
      const distance = (this.mode === "drone" ? Math.max(this.distance, 34) : this.distance) * portraitFraming;
      const horizontalDistance = Math.cos(this.pitch) * distance;
      const height = Math.sin(this.pitch) * distance + (this.mode === "drone" ? 7 : 2.4);
      this.desiredPosition.set(
        focus.x - horizontalDirectionX * horizontalDistance,
        focus.y + height,
        focus.z - horizontalDirectionZ * horizontalDistance,
      );
      const waterHeight = this.ocean.sample(this.desiredPosition.x, this.desiredPosition.z).height;
      this.desiredPosition.y = Math.max(this.desiredPosition.y, waterHeight + 0.65);
      const spring = this.mode === "chase" ? 4.8 : 3.1;
      this.camera.position.lerp(this.desiredPosition, this.follow(spring, delta));
      this.lookTarget.copy(focus).addScaledVector(physics.forward, Math.min(5, Math.abs(physics.telemetry.forwardSpeed) * 0.7));
      this.lookTarget.y += 1.35;
      this.lookTarget.y += clamp(-this.pitch - 0.02, 0, 0.22) * distance * 0.9;
      this.smoothedTarget.lerp(this.lookTarget, this.follow(5.5, delta));
    }
    this.camera.lookAt(this.smoothedTarget);
    const targetFov = this.mode === "helm" ? 64 : 50 + Math.min(9, Math.abs(physics.telemetry.forwardSpeed) * 1.15);
    this.camera.fov = damp(this.camera.fov, targetFov, 2.6, delta);
    this.camera.near = NEAR_PLANE_OUTSIDE;
    this.camera.updateProjectionMatrix();
    this.snapNext = false;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
