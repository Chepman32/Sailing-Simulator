import type * as THREE from "three";
import type { SplashKind } from "../vessel/WakeSystem";

/**
 * How swimming animals meet the sea.
 *
 * Every animal tracks a few points on its body (rostrum, blowhole, dorsal fin,
 * flukes) against the rendered wave surface. A point crossing the surface
 * produces an event at that point, never at the model's centre, with an
 * energy derived from the mass behind it and its speed through the surface.
 */

/** The world as seen by an animal's behaviour. Pure, so behaviours are testable. */
export type MarineWorld = {
  /** Rendered sea surface height over (x, z). */
  surfaceHeight(x: number, z: number): number;
  /** Vertical excursion of the water at `depth` below the mean surface. */
  orbitalHeight(x: number, z: number, depth: number): number;
  /** Metres of water over the seabed at (x, z). */
  seabedDepth(x: number, z: number): number;
  /** Metres from the rendered waterline of the nearest island; negative on land. */
  shoreDistance(x: number, z: number): number;
};

/** The yacht, as far as wildlife is concerned. */
export type VesselState = {
  x: number;
  z: number;
  heading: number;
  speed: number;
};

/** Effects a contact with the surface can produce. */
export type WaterEffects = {
  splash(position: THREE.Vector3, intensity: number, kind: SplashKind, velocity?: THREE.Vector3): void;
  /** Foam streak where a fin or back cuts the surface. */
  trail(position: THREE.Vector3, heading: number, strength: number, width: number): void;
  /** Water running off a body that has just left the sea. */
  shed(position: THREE.Vector3, velocity: THREE.Vector3, count: number, size: number): void;
  /** Ring waves and a slick without spray, e.g. the footprint of a diving whale. */
  ripple(position: THREE.Vector3, strength: number): void;
};

export type SurfaceCrossing = "exit" | "entry" | null;

/** Clearance band a point must pass through for a crossing to count. */
export const SURFACE_HYSTERESIS = 0.04;

/**
 * Detects a point passing through the surface. The point is considered
 * submerged until it rises `hysteresis` above the water and dry until it
 * sinks `hysteresis` below it, so a fin riding the waterline cannot flicker
 * in and out, while a slow crossing spread over many frames is still caught.
 */
export function surfaceCrossing(
  submerged: boolean,
  clearance: number,
  hysteresis = SURFACE_HYSTERESIS,
): { submerged: boolean; crossing: SurfaceCrossing } {
  if (!Number.isFinite(clearance)) return { submerged, crossing: null };
  if (submerged && clearance > hysteresis) return { submerged: false, crossing: "exit" };
  if (!submerged && clearance < -hysteresis) return { submerged: true, crossing: "entry" };
  return { submerged, crossing: null };
}

/**
 * Splash energy on the effects scale (a dolphin re-entering at speed ≈ 1, a
 * whale's fluke slap ≈ 5) from the mass driven through the surface and its
 * speed. Spray volume grows sub-linearly with kinetic energy.
 */
export function contactIntensity(massKg: number, speed: number): number {
  const energy = 0.5 * Math.max(0, massKg) * speed * speed;
  if (energy <= 0) return 0;
  return Math.min(6, 0.032 * Math.pow(energy, 0.44));
}

/** Typical masses of the body part that hits the water. */
export const CONTACT_MASS = {
  /** Whole bottlenose dolphin. */
  dolphin: 220,
  /** Peduncle and flukes of an 18 m whale, as they swing. */
  whaleFluke: 2600,
  /** Back of a surfacing whale. */
  whaleBack: 9000,
  /** Dorsal fin and back of a large shark. */
  sharkFin: 160,
} as const;

/**
 * Tracks one body point against the surface and reports crossings.
 * Allocation-free; the caller supplies the world position each frame.
 */
export class SurfacePoint {
  clearance = Number.NaN;
  submerged = true;
  /** Vertical speed of the point, m/s; negative when sinking. */
  verticalSpeed = 0;
  /** Seconds the point has continuously been above the water. */
  airborneTime = 0;
  private previousY = Number.NaN;

  update(y: number, surface: number, delta: number): SurfaceCrossing {
    this.clearance = y - surface;
    this.verticalSpeed = Number.isFinite(this.previousY) && delta > 0 ? (y - this.previousY) / delta : 0;
    this.previousY = y;
    this.airborneTime = this.clearance > 0 ? this.airborneTime + delta : 0;
    const next = surfaceCrossing(this.submerged, this.clearance);
    this.submerged = next.submerged;
    return next.crossing;
  }

  /** Re-seeds the tracker without reporting a crossing (after a relocation). */
  reset(clearance = Number.NaN): void {
    this.clearance = clearance;
    this.submerged = !(clearance > 0);
    this.previousY = Number.NaN;
    this.verticalSpeed = 0;
    this.airborneTime = 0;
  }
}
