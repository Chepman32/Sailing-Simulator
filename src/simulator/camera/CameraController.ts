import * as THREE from "three";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp, damp } from "../math";
import type { CameraMode } from "../types";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import type { DirectedShot } from "./PhotoDirector";

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedTarget = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private readonly directedPosition = new THREE.Vector3();
  private readonly directedLook = new THREE.Vector3();
  private directedFov = 50;
  private yawOffset = 0;
  private pitch = 0.1;
  private distance = 17;
  private mode: CameraMode = "chase";
  private directed: DirectedShot | null = null;
  private directedBlend = 0;

  constructor(
    aspect: number,
    private readonly ocean: OceanSystem,
  ) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.08, 2600);
    this.camera.position.set(0, 7, -16);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.recenter();
    if (mode === "chase") this.distance = 17;
    if (mode === "orbit") this.distance = 24;
    if (mode === "drone") this.distance = 42;
  }

  /**
   * Photo-mode auto targeting. While a shot is set the camera glides to it on a
   * slow spring; clearing it blends back to the normal follow camera.
   */
  setDirectedShot(shot: DirectedShot | null): void {
    this.directed = shot;
  }

  orbit(deltaX: number, deltaY: number): void {
    const yawLimit = this.mode === "helm" ? 1.45 : Math.PI * 4;
    this.yawOffset = clamp(this.yawOffset - deltaX * 0.0047, -yawLimit, yawLimit);
    this.pitch = clamp(this.pitch + deltaY * 0.0038, this.mode === "helm" ? -0.32 : -0.24, 1.08);
  }

  zoom(delta: number): void {
    if (this.mode === "helm") return;
    this.distance = clamp(this.distance + delta * 0.035, 7, 68);
  }

  recenter(): void {
    this.yawOffset = 0;
    this.pitch = this.mode === "helm" ? 0.02 : this.mode === "drone" ? 0.58 : this.mode === "orbit" ? 0.24 : 0.1;
  }

  update(delta: number, physics: VesselPhysics): void {
    const focus = physics.position;
    const heading = physics.heading + this.yawOffset;
    const horizontalDirectionX = Math.sin(heading);
    const horizontalDirectionZ = Math.cos(heading);

    if (this.mode === "helm") {
      this.desiredPosition.copy(focus).addScaledVector(physics.forward, -2.55).setY(focus.y + 1.92);
      this.viewDirection.set(horizontalDirectionX, Math.sin(-this.pitch), horizontalDirectionZ).normalize();
      this.lookTarget.copy(this.desiredPosition).addScaledVector(this.viewDirection, 18);
      this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-12 * delta));
      this.smoothedTarget.lerp(this.lookTarget, 1 - Math.exp(-10 * delta));
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
      this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-spring * delta));
      this.lookTarget.copy(focus).addScaledVector(physics.forward, Math.min(6, Math.abs(physics.telemetry.forwardSpeed) * 0.25));
      this.lookTarget.y += 1.35;
      this.lookTarget.y += clamp(-this.pitch - 0.02, 0, 0.22) * distance * 0.9;
      this.smoothedTarget.lerp(this.lookTarget, 1 - Math.exp(-5.5 * delta));
    }
    let targetFov = this.mode === "helm" ? 64 : 50 + Math.min(10, Math.abs(physics.telemetry.forwardSpeed) * 0.28);
    this.directedBlend = damp(this.directedBlend, this.directed ? 1 : 0, 1.6, delta);
    if (this.directed) {
      // Glide toward the directed shot; the subject may move, so keep following.
      // A new subject far away is a cut rather than a long fly-through.
      if (this.directedPosition.distanceTo(this.directed.position) > 350) {
        this.directedPosition.copy(this.directed.position);
        this.directedLook.copy(this.directed.lookAt);
        this.directedFov = this.directed.fov;
      }
      this.directedPosition.lerp(this.directed.position, 1 - Math.exp(-1.4 * delta));
      this.directedLook.lerp(this.directed.lookAt, 1 - Math.exp(-2.6 * delta));
      this.directedFov = damp(this.directedFov, this.directed.fov, 1.5, delta);
    } else {
      this.directedPosition.copy(this.camera.position);
      this.directedLook.copy(this.smoothedTarget);
      this.directedFov = this.camera.fov;
    }
    if (this.directedBlend > 0.001) {
      this.camera.position.lerp(this.directedPosition, this.directedBlend);
      this.smoothedTarget.lerp(this.directedLook, this.directedBlend);
      targetFov = THREE.MathUtils.lerp(targetFov, this.directedFov, this.directedBlend);
      const water = this.ocean.sample(this.camera.position.x, this.camera.position.z).height;
      this.camera.position.y = Math.max(this.camera.position.y, water + 0.9);
    }
    this.camera.lookAt(this.smoothedTarget);
    this.camera.fov = this.directed ? targetFov : damp(this.camera.fov, targetFov, 2.6, delta);
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
