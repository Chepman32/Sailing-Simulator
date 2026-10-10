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
    // A late-afternoon sun, 20° up: low enough to stand in the opening view
    // with a long glitter path below it, high enough to stay clear of the
    // dusk tint. Going to night it sets through a full sunset.
    sunElevation: 0.35 - night * 0.62 - night * night * night * 0.2,
    moonElevation: -0.28 + night * (Math.PI / 6 + 0.28),
    exposure: 1.08 - night * 0.24,
    starVisibility: Math.pow(night, 1.6),
    nightFactor: night,
  };
}
