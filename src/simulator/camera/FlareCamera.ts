import { clamp, smoothstep } from "../math";
import { FLARE_RISE, FLARE_SINK, flarePosition, type FlareLaunch, type FlarePoint } from "../effects/FlareMath";
import type { PhotoShot } from "./PhotoDirector";

/**
 * The camera's flare shot. When the player fires a parachute flare the
 * camera pulls back out to the side, 70–95 m from the yacht and low over the
 * water, so the whole flight reads in profile: the rocket leaving the
 * cockpit, its smoky climb to the apex at 160 m, the star igniting under its
 * parachute and sinking slowly the first several metres. Then it hands the
 * view back to the normal camera.
 *
 * The camera stands off the rocket's line of flight (square to the wind it
 * leans with), on the side the normal camera already is, so the swing out is
 * short; it keeps drifting gently farther out while the rocket climbs. Its
 * aim follows the flare with a little lag, as a camera operator's would.
 * Pure state; `CameraController.direct` applies the shot.
 */

/** How far out the camera goes, m (at the launch and at the end of the shot). */
export const FLARE_SHOT_DISTANCE = { start: 70, end: 95 } as const;
/** Height of the camera over the water, m. */
export const FLARE_SHOT_HEIGHT = 7;
/** Seconds the pull-back takes. */
export const FLARE_SHOT_PULL = 1.4;
/** How far the star sinks under its parachute before the shot ends, m. */
export const FLARE_SHOT_DESCENT = 14;
/** Seconds the camera takes to return. */
export const FLARE_SHOT_RETURN = 1.8;
/** Field of view, degrees: wide, so the climb, the smoke and the sea all fit. */
export const FLARE_SHOT_FOV = 68;
/**
 * Where the flare sits in the frame: this fraction of the half field of view
 * above the centre. The camera tilts only as far as it must, so while the
 * rocket is low the yacht and the horizon stay in the picture, and at the
 * apex the star is high in the frame with its smoke trail below it.
 */
export const FLARE_SHOT_FRAMING = 0.6;

/** Age of the flare at which the shot starts its return. */
export const FLARE_SHOT_HOLD = FLARE_RISE + FLARE_SHOT_DESCENT / FLARE_SINK;

const ease = (t: number) => smoothstep(0, 1, clamp(t, 0, 1));

export class FlareCamera {
  /** 0 the normal camera … 1 fully on the flare. */
  blend = 0;
  readonly shot: PhotoShot = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: FLARE_SHOT_FOV };
  private active = false;
  private age = 0;
  private releaseFrom = Number.POSITIVE_INFINITY;
  private readonly launch: FlareLaunch = { x: 0, y: 0, z: 0, leanX: 0, leanZ: 1, windX: 0, windZ: 0, seed: 0 };
  private sideX = 1;
  private sideZ = 0;
  private readonly flare: FlarePoint = { x: 0, y: 0, z: 0 };
  private readonly aim = { x: 0, y: 0, z: 0 };

  get running(): boolean {
    return this.active;
  }

  /**
   * Starts the shot for a flare just fired. `camera` is where the normal
   * camera is now (the shot stays on its side); `heading` is the yacht's,
   * used when there is no wind to lean the rocket.
   */
  start(launch: FlareLaunch, camera: { x: number; z: number }, heading: number): void {
    Object.assign(this.launch, launch);
    this.active = true;
    this.age = 0;
    this.releaseFrom = Number.POSITIVE_INFINITY;
    // Square to the line of flight.
    let leanX = launch.leanX;
    let leanZ = launch.leanZ;
    if (Math.hypot(leanX, leanZ) < 0.1) {
      leanX = Math.sin(heading);
      leanZ = Math.cos(heading);
    }
    let sideX = -leanZ;
    let sideZ = leanX;
    if ((camera.x - launch.x) * sideX + (camera.z - launch.z) * sideZ < 0) {
      sideX = -sideX;
      sideZ = -sideZ;
    }
    this.sideX = sideX;
    this.sideZ = sideZ;
    this.aimSet = false;
  }

  private aimSet = false;

  /** The player took the camera (a drag or a zoom): hand it back now. */
  cancel(): void {
    if (this.active) this.releaseFrom = Math.min(this.releaseFrom, this.age);
  }

  /** Stops at once (a restart). */
  stop(): void {
    this.active = false;
    this.blend = 0;
  }

  /** Advances the shot; `waterHeight` keeps the camera above the waves. */
  update(delta: number, waterHeight: (x: number, z: number) => number): void {
    if (!this.active) return;
    const dt = clamp(delta, 0, 0.1);
    this.age += dt;
    if (this.age >= FLARE_SHOT_HOLD) this.releaseFrom = Math.min(this.releaseFrom, FLARE_SHOT_HOLD);
    const pull = ease(this.age / FLARE_SHOT_PULL);
    const back = Number.isFinite(this.releaseFrom) ? 1 - ease((this.age - this.releaseFrom) / FLARE_SHOT_RETURN) : 1;
    this.blend = pull * back;
    if (back <= 0) {
      this.stop();
      return;
    }

    const launch = this.launch;
    const flare = flarePosition(launch, this.age, this.flare);
    // Out to the side, slightly back from the drift, easing farther out.
    const out = FLARE_SHOT_DISTANCE.start + (FLARE_SHOT_DISTANCE.end - FLARE_SHOT_DISTANCE.start) * ease(this.age / FLARE_SHOT_HOLD);
    const x = launch.x + this.sideX * out - launch.leanX * out * 0.18;
    const z = launch.z + this.sideZ * out - launch.leanZ * out * 0.18;
    this.shot.position.x = x;
    this.shot.position.z = z;
    this.shot.position.y = waterHeight(x, z) + FLARE_SHOT_HEIGHT;

    // Aim: toward the flare in azimuth; in elevation only as high as needed
    // to keep the flare in the upper part of the frame (`FLARE_SHOT_FRAMING`),
    // and never below the horizon line just above the water.
    const dx = flare.x - x;
    const dz = flare.z - z;
    const across = Math.hypot(dx, dz) || 1;
    const flareElevation = Math.atan2(flare.y - this.shot.position.y, across);
    const halfFov = ((FLARE_SHOT_FOV / 2) * Math.PI) / 180;
    const elevation = Math.max(0.08, flareElevation - FLARE_SHOT_FRAMING * halfFov);
    const reach = 100;
    const goalX = x + (dx / across) * reach * Math.cos(elevation);
    const goalY = this.shot.position.y + reach * Math.sin(elevation);
    const goalZ = z + (dz / across) * reach * Math.cos(elevation);
    // A camera operator's lag: smooth, never quite as fast as the rocket.
    if (!this.aimSet) {
      this.aim.x = goalX;
      this.aim.y = goalY;
      this.aim.z = goalZ;
      this.aimSet = true;
    }
    const follow = 1 - Math.exp(-dt * 5);
    this.aim.x += (goalX - this.aim.x) * follow;
    this.aim.y += (goalY - this.aim.y) * follow;
    this.aim.z += (goalZ - this.aim.z) * follow;
    this.shot.target.x = this.aim.x;
    this.shot.target.y = this.aim.y;
    this.shot.target.z = this.aim.z;
  }
}
