/**
 * Fireworks from the cruise liner's top deck: pure numbers (`FireworksSystem`
 * draws them, `AudioSystem.fireworkBoom` sounds them).
 *
 * A show is a run of rockets for about forty seconds and a finale of many at
 * once; one comes every minute or two after dark and now and then by day.
 * A rocket climbs on a fuse trailing gold sparks and bursts near its apex
 * into one of several shells:
 *
 * - **peony**: a sphere of stars of one colour;
 * - **chrysanthemum**: the same with gold tails that turn to the colour;
 * - **willow**: long-burning gold that droops and hangs;
 * - **ring**: a tilted circle;
 * - **crossette**: stars that split once more in flight;
 * - **crackle**: a cloud of white flashes.
 *
 * Stars slow in the air quickly, fall slowly and fade; the brightest are
 * brighter than white so the bloom haloes them.
 */

export type RandomSource = () => number;

export type ShellKind = "peony" | "chrysanthemum" | "willow" | "ring" | "crossette" | "crackle";
export const SHELL_KINDS: readonly ShellKind[] = ["peony", "chrysanthemum", "willow", "ring", "crossette", "crackle"];

/** Star colours, HDR (scene-linear, the bloom picks up what is over 1). */
export const STAR_COLORS: readonly (readonly [number, number, number])[] = [
  [5.2, 0.5, 0.35],
  [0.55, 4.6, 0.8],
  [0.6, 1.4, 6.2],
  [5.4, 3.4, 0.5],
  [4.4, 0.7, 4.8],
  [0.6, 4.2, 5],
  [5.5, 5.2, 4.6],
];
export const GOLD: readonly [number, number, number] = [5.6, 3, 0.7];

/** A rocket on its way up. */
export type Rocket = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds until it bursts. */
  fuse: number;
  shell: ShellKind;
  color: readonly [number, number, number];
  /** Seconds to the next spark of its trail. */
  trailClock: number;
};

/** A star (or a trail spark) in flight. */
export type Star = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  color: readonly [number, number, number];
  /** Second colour it turns to as it burns (a chrysanthemum's tail). */
  later: readonly [number, number, number] | null;
  /** Air drag (1/s) and the share of gravity it feels (it is light). */
  drag: number;
  fall: number;
  /** Flickers (crackle, the trail) instead of burning steadily. */
  twinkle: boolean;
  /** Splits into a few more stars at this age (crossette), or never (−1). */
  split: number;
  /** Width of its streak, metres. */
  size: number;
};

export const GRAVITY = 9.81;
/** Seconds of a show, and the finale at its end. */
export const SHOW_LENGTH = { min: 32, max: 44 } as const;
export const FINALE_LENGTH = 5;
/** Seconds between shows after dark, and by day. */
export const NIGHT_GAP = { min: 55, max: 95 } as const;
export const DAY_GAP = { min: 150, max: 240 } as const;

export function between(random: RandomSource, low: number, high: number): number {
  return low + (high - low) * random();
}

/** Seconds until the next show, from how dark it is (0 day … 1 night). */
export function nextShowGap(random: RandomSource, night: number): number {
  const gap = night > 0.45 ? NIGHT_GAP : DAY_GAP;
  return between(random, gap.min, gap.max);
}

/** Seconds to the next launch, `remaining` seconds before the show ends: quicker in the finale. */
export function nextLaunchGap(random: RandomSource, remaining: number): number {
  return remaining < FINALE_LENGTH ? between(random, 0.08, 0.28) : between(random, 0.55, 1.5);
}

/** A rocket leaving the deck at (x, y, z). */
export function launchRocket(random: RandomSource, x: number, y: number, z: number, finale = false): Rocket {
  const speed = between(random, 60, 74);
  const tilt = between(random, 0, 0.16);
  const heading = random() * Math.PI * 2;
  const shell = finale && random() < 0.4 ? "crackle" : SHELL_KINDS[Math.floor(random() * SHELL_KINDS.length)]!;
  return {
    x,
    y,
    z,
    vx: Math.sin(heading) * Math.sin(tilt) * speed,
    vy: Math.cos(tilt) * speed,
    vz: Math.cos(heading) * Math.sin(tilt) * speed,
    fuse: between(random, 3.2, 4.3),
    shell,
    color: STAR_COLORS[Math.floor(random() * STAR_COLORS.length)]!,
    trailClock: 0,
  };
}

/**
 * Advances a rocket; calls `spark` for its trail. Returns true when it
 * bursts (its fuse is out, or it has stopped climbing).
 */
export function stepRocket(rocket: Rocket, dt: number, random: RandomSource, spark: (star: Star) => void): boolean {
  rocket.vy -= GRAVITY * dt;
  const drag = Math.exp(-0.18 * dt);
  rocket.vx *= drag;
  rocket.vy *= drag;
  rocket.vz *= drag;
  rocket.x += rocket.vx * dt;
  rocket.y += rocket.vy * dt;
  rocket.z += rocket.vz * dt;
  rocket.fuse -= dt;
  rocket.trailClock -= dt;
  while (rocket.trailClock <= 0) {
    rocket.trailClock += 0.035;
    spark({
      x: rocket.x,
      y: rocket.y,
      z: rocket.z,
      vx: rocket.vx * 0.15 + between(random, -1.5, 1.5),
      vy: rocket.vy * 0.1 - between(random, 1, 3),
      vz: rocket.vz * 0.15 + between(random, -1.5, 1.5),
      age: 0,
      life: between(random, 0.35, 0.7),
      color: GOLD,
      later: null,
      drag: 2.5,
      fall: 0.5,
      twinkle: true,
      split: -1,
      size: 0.8,
    });
  }
  return rocket.fuse <= 0 || rocket.vy < 4;
}

/** A unit vector spread evenly over the sphere (golden spiral), index of count. */
function sphereDirection(index: number, count: number, out: [number, number, number]): [number, number, number] {
  const y = 1 - ((index + 0.5) / count) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * 2.399963;
  out[0] = Math.cos(angle) * radius;
  out[1] = y;
  out[2] = Math.sin(angle) * radius;
  return out;
}

/** The stars of a shell bursting where the rocket is. */
export function burst(rocket: Rocket, random: RandomSource, add: (star: Star) => void): number {
  const direction: [number, number, number] = [0, 0, 0];
  const shell = rocket.shell;
  const count = shell === "willow" ? 110 : shell === "ring" ? 80 : shell === "crackle" ? 140 : shell === "crossette" ? 48 : 150;
  const speed = shell === "willow" ? between(random, 30, 38) : shell === "crackle" ? between(random, 20, 30) : between(random, 44, 58);
  // A ring lies in a tilted plane.
  const tiltA = random() * Math.PI;
  const tiltB = between(random, 0.3, 1.2);
  for (let index = 0; index < count; index += 1) {
    if (shell === "ring") {
      const angle = (index / count) * Math.PI * 2;
      const cx = Math.cos(angle);
      const cz = Math.sin(angle);
      // Rotate the circle about x by tiltB, then about y by tiltA.
      const y = cz * Math.sin(tiltB);
      const z = cz * Math.cos(tiltB);
      direction[0] = cx * Math.cos(tiltA) + z * Math.sin(tiltA);
      direction[1] = y;
      direction[2] = -cx * Math.sin(tiltA) + z * Math.cos(tiltA);
    } else {
      sphereDirection(index, count, direction);
    }
    const jitter = shell === "crackle" ? between(random, 0.3, 1) : between(random, 0.92, 1.06);
    const s = speed * jitter;
    const willow = shell === "willow";
    add({
      x: rocket.x,
      y: rocket.y,
      z: rocket.z,
      vx: rocket.vx * 0.3 + direction[0] * s,
      vy: rocket.vy * 0.3 + direction[1] * s,
      vz: rocket.vz * 0.3 + direction[2] * s,
      age: 0,
      life: willow ? between(random, 3.6, 4.6) : shell === "crackle" ? between(random, 1.1, 1.7) : between(random, 2, 2.8),
      color: willow ? GOLD : shell === "crackle" ? [6, 6, 5.6] : shell === "chrysanthemum" ? GOLD : rocket.color,
      later: shell === "chrysanthemum" ? rocket.color : null,
      drag: willow ? 0.85 : 1.0,
      fall: willow ? 0.55 : 0.3,
      twinkle: shell === "crackle",
      split: shell === "crossette" ? between(random, 0.55, 0.8) : -1,
      size: willow ? 1.3 : shell === "crackle" ? 1.1 : 1.7,
    });
  }
  return count;
}

/** The four stars a crossette star splits into. */
export function splitStar(star: Star, random: RandomSource, add: (star: Star) => void): void {
  const speed = Math.hypot(star.vx, star.vy, star.vz) + 7;
  const base = random() * Math.PI * 2;
  for (let index = 0; index < 4; index += 1) {
    const angle = base + (index * Math.PI) / 2;
    add({
      ...star,
      vx: Math.cos(angle) * speed * 0.8,
      vy: Math.sin(angle) * speed * 0.8 + star.vy * 0.3,
      vz: (random() - 0.5) * speed * 0.5,
      age: 0,
      life: between(random, 0.9, 1.4),
      split: -1,
      size: star.size * 0.8,
    });
  }
}

/**
 * Advances a star. Returns false once it has burnt out (or `splits` it,
 * leaving the caller to add its pieces when `split` was reached).
 */
export function stepStar(star: Star, dt: number): boolean {
  star.age += dt;
  const drag = Math.exp(-star.drag * dt);
  star.vx *= drag;
  star.vy = star.vy * drag - GRAVITY * star.fall * dt;
  star.vz *= drag;
  star.x += star.vx * dt;
  star.y += star.vy * dt;
  star.z += star.vz * dt;
  return star.age < star.life;
}

/**
 * How bright a star is now (0…1): full until the last third of its life,
 * then fading; a twinkling one flickers.
 */
export function starBrightness(star: Star, flicker: number): number {
  const t = star.age / star.life;
  const fade = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
  const flash = star.twinkle ? (flicker > 0.45 ? 1 : 0.15) : 1;
  return fade * fade * flash;
}
