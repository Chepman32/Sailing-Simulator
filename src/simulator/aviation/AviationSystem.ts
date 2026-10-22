import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { createGlowTexture } from "./AircraftLights";
import { AirlinerTraffic } from "./AirlinerTraffic";
import { LowPassAircraft } from "./LowPassAircraft";
import { SPEED_OF_SOUND, waterReflectionDelay, type LightAircraftKind } from "./AviationMath";

export type AviationAudioState = {
  /** Light aircraft engine: 0 when no pass is under way. */
  propPresence: number;
  propKind: LightAircraftKind;
  propDistance: number;
  /** Positive while the aircraft approaches the listener (m/s). */
  propRadialSpeed: number;
  /** Stereo position in [-1, 1], negative to the listener's left. */
  propPan: number;
  /** Delay (s) of the sea-reflected copy relative to the direct sound. */
  propReflectionDelay: number;
  /** Distant airliner roar level in [0, 1]. */
  jetLevel: number;
};

const CONTRAIL_PREWARM_SECONDS = 55;

/**
 * Owns all aircraft: periodic low passes by a sightseeing floatplane or a
 * banner-tow plane, and high-altitude airliners laying contrails that grow,
 * spread, drift and dissipate. The aircraft GLBs are optional; a missing model
 * removes that traffic type and leaves the rest of the scene intact.
 */
export class AviationSystem {
  private readonly lowPass: LowPassAircraft;
  private readonly airliners: AirlinerTraffic;
  private readonly glowTexture = createGlowTexture();
  private readonly listenerRight = new THREE.Vector3();
  private readonly toAircraft = new THREE.Vector3();
  private readonly audio: AviationAudioState = {
    propPresence: 0,
    propKind: "seaplane",
    propDistance: 1000,
    propRadialSpeed: 0,
    propPan: 0,
    propReflectionDelay: 0.01,
    jetLevel: 0,
  };
  private readonly heard = new THREE.Vector3();

  constructor(scene: THREE.Scene, assets: AssetManager) {
    this.lowPass = new LowPassAircraft(
      scene,
      { seaplane: assets.optionalScene("seaplane"), banner: assets.optionalScene("bannerPlane") },
      this.glowTexture,
    );
    this.airliners = new AirlinerTraffic(scene, assets.optionalScene("airliner"), this.glowTexture);
    this.airliners.prewarm(CONTRAIL_PREWARM_SECONDS);
  }

  /** Sky inputs owned by EnvironmentSystem: reflection map and sun/moon direction. */
  setSky(reflection: THREE.Texture | null, lightDirection: THREE.Vector3): void {
    this.lowPass.setReflection(reflection);
    this.airliners.setReflection(reflection);
    this.airliners.setLightDirection(lightDirection);
  }

  update(delta: number, focus: THREE.Vector3, nightFactor: number, camera: THREE.Camera): void {
    this.lowPass.update(delta, focus, nightFactor, camera);
    this.airliners.update(delta, focus, nightFactor, camera);
  }

  /** Listener-relative parameters for the procedural aircraft sounds. */
  audioState(camera: THREE.Camera): AviationAudioState {
    const listener = camera.position;
    const plane = this.lowPass.audioState;
    if (plane.active) {
      // Sound heard now left the aircraft distance / c seconds ago, so the
      // engine note trails the visible aircraft like it does in reality.
      const travel = plane.position.distanceTo(listener) / SPEED_OF_SOUND;
      this.heard.copy(plane.position).addScaledVector(plane.velocity, -travel);
      this.toAircraft.subVectors(this.heard, listener);
      const distance = Math.max(1, this.toAircraft.length());
      this.audio.propReflectionDelay = waterReflectionDelay(
        Math.hypot(this.toAircraft.x, this.toAircraft.z),
        this.heard.y,
        listener.y,
      );
      this.toAircraft.multiplyScalar(1 / distance);
      this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this.audio.propPresence = plane.presence;
      this.audio.propKind = plane.kind;
      this.audio.propDistance = distance;
      this.audio.propRadialSpeed = -plane.velocity.dot(this.toAircraft);
      this.audio.propPan = THREE.MathUtils.clamp(this.toAircraft.dot(this.listenerRight), -1, 1);
    } else {
      this.audio.propPresence = 0;
    }
    this.audio.jetLevel = this.airliners.roarLevel(listener);
    return this.audio;
  }

  reset(): void {
    this.lowPass.reset();
  }

  dispose(): void {
    this.lowPass.dispose();
    this.airliners.dispose();
    this.glowTexture.dispose();
  }
}
