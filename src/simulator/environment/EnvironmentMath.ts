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
    sunElevation: 0.72 - night * 1.18,
    moonElevation: -0.28 + night * (Math.PI / 6 + 0.28),
    exposure: 1.08 - night * 0.24,
    starVisibility: Math.pow(night, 1.6),
    nightFactor: night,
  };
}
