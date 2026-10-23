/** Timeline of a parachute signal flare (pure, for tests and the HUD). */
export const FLARE_ASCENT_SECONDS = 3.1;
export const FLARE_BURN_SECONDS = 26;
export const FLARE_APOGEE = 150;
/** A new flare can be fired this long after the previous launch. */
export const FLARE_RELOAD_SECONDS = 8;
export const FLARE_DESCENT_RATE = 2.1;

export type FlarePhase = "ascent" | "burning" | "spent";

export function flarePhase(age: number): FlarePhase {
  if (age < FLARE_ASCENT_SECONDS) return "ascent";
  if (age < FLARE_ASCENT_SECONDS + FLARE_BURN_SECONDS) return "burning";
  return "spent";
}

/** Height above the launch point: decelerating climb, then parachute descent. */
export function flareAltitude(age: number): number {
  if (age <= 0) return 0;
  if (age < FLARE_ASCENT_SECONDS) {
    const t = age / FLARE_ASCENT_SECONDS;
    return FLARE_APOGEE * (1 - (1 - t) * (1 - t));
  }
  return Math.max(0, FLARE_APOGEE - (age - FLARE_ASCENT_SECONDS) * FLARE_DESCENT_RATE);
}

/** Star brightness 0…1: ignition flash, steady burn, burn-out fade. */
export function flareBrightness(age: number): number {
  const burn = age - FLARE_ASCENT_SECONDS;
  if (burn < 0 || burn > FLARE_BURN_SECONDS) return 0;
  const ignite = Math.min(1, burn / 0.35);
  const fade = Math.min(1, (FLARE_BURN_SECONDS - burn) / 2.5);
  return ignite * fade;
}
