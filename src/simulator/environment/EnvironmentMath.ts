import { clamp } from "../math";

export type TimeOfDayState = {
  normalizedTime: number;
  sunElevation: number;
  moonElevation: number;
  exposure: number;
  starVisibility: number;
  nightFactor: number;
};

export function deriveTimeOfDay(nightFactor: number): TimeOfDayState {
  const night = clamp(nightFactor, 0, 1);
  return {
    normalizedTime: 0.5 + night * 0.5,
    // A mid-afternoon sun, 24° up: low enough for a long glitter path on the
    // water ahead of the yacht, high enough to stay clear of the dusk tint.
    sunElevation: 0.42 - night * 0.69 - night * night * night * 0.2,
    moonElevation: -0.28 + night * (Math.PI / 6 + 0.28),
    exposure: 1.08 - night * 0.24,
    starVisibility: Math.pow(night, 1.6),
    nightFactor: night,
  };
}
