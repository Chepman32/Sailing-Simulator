import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { AirlinerTraffic } from "./AirlinerTraffic";
import { LowPassAircraft } from "./LowPassAircraft";
import type { LightAircraftKind } from "./AviationMath";

export type AviationAudioState = {
  /** Light aircraft engine: 0 when no pass is under way. */
  propPresence: number;
  propKind: LightAircraftKind;
  propDistance: number;
  /** Positive while the aircraft approaches the listener (m/s). */
  propRadialSpeed: number;
  /** Stereo position in [-1, 1], negative to the listener's left. */
  propPan: number;
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
  private readonly listenerRight = new THREE.Vector3();
  private readonly toAircraft = new THREE.Vector3();
  private readonly audio: AviationAudioState = {
    propPresence: 0,
    propKind: "seaplane",
    propDistance: 1000,
    propRadialSpeed: 0,
    propPan: 0,
    jetLevel: 0,
  };

  constructor(scene: THREE.Scene, assets: AssetManager) {
    this.lowPass = new LowPassAircraft(scene, {
      seaplane: assets.optionalScene("seaplane"),
      banner: assets.optionalScene("bannerPlane"),
    });
    this.airliners = new AirlinerTraffic(scene, assets.optionalScene("airliner"));
    this.airliners.prewarm(CONTRAIL_PREWARM_SECONDS);
  }

  update(delta: number, focus: THREE.Vector3, nightFactor: number): void {
    this.lowPass.update(delta, focus, nightFactor);
    this.airliners.update(delta, focus, nightFactor);
  }

  /** Listener-relative parameters for the procedural aircraft sounds. */
  audioState(camera: THREE.Camera): AviationAudioState {
    const listener = camera.position;
    const plane = this.lowPass.audioState;
    if (plane.active) {
      this.toAircraft.subVectors(plane.position, listener);
      const distance = Math.max(1, this.toAircraft.length());
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
  }
}
