/**
 * Fireworks from the cruise liner's top deck: pure numbers (`FireworksSystem`
 * draws them, `AudioSystem.fireworkBoom` sounds them).
 *
 * A show is a choreographed run of about forty seconds: single shells and
 * volleys of two or three fired together from along the deck, a mid-show
 * salvo, and a finale of many at once ending in hanging gold. One comes every
 * minute or two after dark and now and then by day. A rocket climbs on a fuse
 * trailing gold glitter and bursts near its apex with a white flash into one
 * of several shells:
 *
 * - **peony**: a sphere of stars of one colour, often with a pistil (a
 *   smaller inner sphere of a second colour);
 * - **chrysanthemum**: the same, but every star leaves a glittering tail and
 *   turns from gold to its colour;
 * - **willow**: long-burning gold that droops, hangs and twinkles out;
 * - **ring**: a tilted circle with a pistil at its centre;
 * - **saturn**: a sphere girdled by a ring of a second colour;
 * - **palm**: a few thick gold comets on heavy spark trails, a palm tree of fire;
 * - **crossette**: stars that split in four in flight;
 * - **strobe**: white stars that blink on and off as they fall;
 * - **kamuro**: a dense crown of glittering gold that hangs a long time;
 * - **crackle**: a cloud of white flashes.
 *
 * Stars slow in the air quickly, fall slowly and fade; the brightest are
 * brighter than white so the bloom haloes them.
 */

export type RandomSource = () => number;

export type ShellKind =
  | "peony"
  | "chrysanthemum"
  | "willow"
  | "ring"
  | "saturn"
  | "palm"
  | "crossette"
  | "strobe"
  | "kamuro"
  | "crackle";
export const SHELL_KINDS: readonly ShellKind[] = [
  "peony",
  "chrysanthemum",
  "willow",
  "ring",
  "saturn",
  "palm",
  "crossette",
  "strobe",
  "kamuro",
  "crackle",
];

export type Rgb = readonly [number, number, number];

/** Star colours, HDR (scene-linear, the bloom picks up what is over 1). */
export const STAR_COLORS: readonly Rgb[] = [
  [5.6, 0.45, 0.3],
  [0.5, 4.8, 0.75],
  [0.55, 1.35, 6.4],
  [5.6, 3.5, 0.45],
  [4.6, 0.6, 5],
  [0.55, 4.3, 5.2],
  [5.5, 5.2, 4.6],
  [5.8, 1.6, 0.25],
  [3.2, 0.7, 6],
];
export const GOLD: Rgb = [5.8, 3.1, 0.75];
/** Charcoal glitter: a deeper, redder gold. */
export const EMBER: Rgb = [4.6, 1.7, 0.35];
export const WHITE: Rgb = [6.2, 6, 5.6];

/**
 * How a star's light varies: steady, crackling, strobing, fizzing out at the
 * end of its life, or the round white flash of a burst.
 */
export type Twinkle = "none" | "crackle" | "strobe" | "fizz" | "flash";

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
  color: Rgb;
  /** Pistil or ring colour (some shells have two). */
  second: Rgb;
  /** Seconds to the next spark of its trail. */
  trailClock: number;
  /** Scales the shell (finale shells are larger). */
  size: number;
};

/** A star (or a spark) in flight. */
export type Star = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  color: Rgb;
  /** Second colour it turns to as it burns (a chrysanthemum's tail). */
  later: Rgb | null;
  /** Air drag (1/s) and the share of gravity it feels (it is light). */
  drag: number;
  fall: number;
  twinkle: Twinkle;
  /** Splits into a few more stars at this age (crossette), or never (−1). */
  split: number;
  /** Width of its streak, metres. */
  size: number;
  /** Seconds of its path drawn behind it (a comet's long streak). */
  streak: number;
  /** Glitter sparks it sheds per second (0: none), and their colour. */
  sparkle: number;
  sparkleColor: Rgb;
  /** Fraction of the next spark already accumulated. */
  sparkleClock: number;
  /** Per-star phase for strobes and flicker. */
  phase: number;
};

export const GRAVITY = 9.81;
/** Seconds of a show, and the finale at its end. */
export const SHOW_LENGTH = { min: 36, max: 48 } as const;
export const FINALE_LENGTH = 6;
/** Seconds between shows after dark, and by day. */
export const NIGHT_GAP = { min: 55, max: 95 } as const;
export const DAY_GAP = { min: 150, max: 240 } as const;
/** Seconds the white flash of a burst lasts. */
export const BURST_FLASH = 0.16;

export function between(random: RandomSource, low: number, high: number): number {
  return low + (high - low) * random();
}

function pick<T>(random: RandomSource, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length]!;
}

/** Seconds until the next show, from how dark it is (0 day … 1 night). */
export function nextShowGap(random: RandomSource, night: number): number {
  const gap = night > 0.45 ? NIGHT_GAP : DAY_GAP;
  return between(random, gap.min, gap.max);
}

/** Seconds to the next launch, `remaining` seconds before the show ends: quicker in the finale. */
export function nextLaunchGap(random: RandomSource, remaining: number): number {
  return remaining < FINALE_LENGTH ? between(random, 0.07, 0.22) : between(random, 0.6, 1.6);
}

/**
 * One cue of the show: `count` rockets fired together from points spread
 * along the deck, all with the same shell and colours (a volley reads as one
 * designed moment, not as noise).
 */
export type Cue = { count: number; shell: ShellKind; color: Rgb; second: Rgb; size: number; spread: number };

/** Shells that suit a finale: big, bright, and gold hanging at the end. */
const FINALE_SHELLS: readonly ShellKind[] = ["crackle", "kamuro", "willow", "peony", "strobe", "chrysanthemum", "palm", "crackle"];

/**
 * The next cue, `remaining` seconds before the show ends (of `length`).
 * Mostly single shells, a volley now and then, and a salvo about halfway.
 */
export function nextCue(random: RandomSource, remaining: number, length: number): Cue {
  const color = pick(random, STAR_COLORS);
  let second = pick(random, STAR_COLORS);
  if (second === color) second = color === WHITE ? GOLD : WHITE;
  if (remaining < FINALE_LENGTH) {
    return { count: random() < 0.45 ? 2 : 1, shell: pick(random, FINALE_SHELLS), color, second, size: between(random, 1.05, 1.3), spread: 0.4 };
  }
  const progress = 1 - remaining / Math.max(1, length);
  const salvo = progress > 0.45 && progress < 0.55;
  const roll = random();
  const count = salvo ? 3 : roll < 0.22 ? 2 : roll < 0.3 ? 3 : 1;
  // A volley spreads its rockets symmetrically along the deck.
  return { count, shell: pick(random, SHELL_KINDS), color, second, size: count > 1 ? between(random, 0.85, 1) : between(random, 0.95, 1.15), spread: count > 1 ? 0.32 : 0.2 };
}

/** A rocket leaving the deck at (x, y, z). */
export function launchRocket(random: RandomSource, x: number, y: number, z: number, finale = false, cue?: Cue): Rocket {
  const speed = between(random, 62, 76);
  const tilt = between(random, 0, 0.12);
  const heading = random() * Math.PI * 2;
  const shell = cue ? cue.shell : finale && random() < 0.4 ? "crackle" : pick(random, SHELL_KINDS);
  const color = cue ? cue.color : pick(random, STAR_COLORS);
  return {
    x,
    y,
    z,
    vx: Math.sin(heading) * Math.sin(tilt) * speed,
    vy: Math.cos(tilt) * speed,
    vz: Math.cos(heading) * Math.sin(tilt) * speed,
    fuse: between(random, 3.1, 4.3),
    shell,
    color,
    second: cue ? cue.second : pick(random, STAR_COLORS),
    trailClock: 0,
    size: cue ? cue.size : finale ? 1.2 : 1,
  };
}

function makeStar(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: Rgb): Star {
  return {
    x,
    y,
    z,
    vx,
    vy,
    vz,
    age: 0,
    life,
    color,
    later: null,
    drag: 1,
    fall: 0.3,
    twinkle: "none",
    split: -1,
    size: 1.9,
    streak: 0.11,
    sparkle: 0,
    sparkleColor: GOLD,
    sparkleClock: 0,
    phase: 0,
  };
}

/**
 * Advances a rocket; calls `spark` for its trail of glitter. Returns true
 * when it bursts (its fuse is out, or it has stopped climbing).
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
    rocket.trailClock += 0.022;
    // Sparks are laid along the last step, so the trail is continuous at any frame rate.
    const back = random() * dt;
    const star = makeStar(
      rocket.x - rocket.vx * back,
      rocket.y - rocket.vy * back,
      rocket.z - rocket.vz * back,
      rocket.vx * 0.12 + between(random, -2, 2),
      rocket.vy * 0.08 - between(random, 1, 4),
      rocket.vz * 0.12 + between(random, -2, 2),
      between(random, 0.4, 0.95),
      random() < 0.25 ? WHITE : random() < 0.5 ? GOLD : EMBER,
    );
    star.drag = 2.6;
    star.fall = 0.55;
    star.twinkle = "crackle";
    star.size = between(random, 0.45, 0.8);
    star.streak = 0.05;
    star.phase = random() * 100;
    spark(star);
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

/** A point on a circle tilted by `tiltB` about x, then turned by `tiltA` about y. */
function ringDirection(angle: number, tiltA: number, tiltB: number, out: [number, number, number]): [number, number, number] {
  const cx = Math.cos(angle);
  const cz = Math.sin(angle);
  const y = cz * Math.sin(tiltB);
  const z = cz * Math.cos(tiltB);
  out[0] = cx * Math.cos(tiltA) + z * Math.sin(tiltA);
  out[1] = y;
  out[2] = -cx * Math.sin(tiltA) + z * Math.cos(tiltA);
  return out;
}

/** Stars of each shell (before the scale of a large shell). */
export const SHELL_STARS: Readonly<Record<ShellKind, number>> = {
  peony: 230,
  chrysanthemum: 190,
  willow: 150,
  ring: 110,
  saturn: 210,
  palm: 9,
  crossette: 64,
  strobe: 150,
  kamuro: 170,
  crackle: 170,
};

/**
 * The stars of a shell bursting where the rocket is, and its white flash.
 * Returns how many stars it added.
 */
export function burst(rocket: Rocket, random: RandomSource, add: (star: Star) => void): number {
  const direction: [number, number, number] = [0, 0, 0];
  const shell = rocket.shell;
  const scale = rocket.size;
  let added = 0;
  const emit = (star: Star): void => {
    added += 1;
    add(star);
  };
  // The flash: a white-hot ball for a moment, haloed by the bloom.
  const flash = makeStar(rocket.x, rocket.y, rocket.z, rocket.vx * 0.3, rocket.vy * 0.3, rocket.vz * 0.3, BURST_FLASH, WHITE);
  flash.size = 16 * scale;
  flash.streak = 0;
  flash.twinkle = "flash";
  flash.drag = 4;
  flash.fall = 0;
  emit(flash);

  const count = Math.round(SHELL_STARS[shell] * (shell === "palm" ? 1 : scale));
  const baseSpeed =
    shell === "willow" || shell === "kamuro"
      ? between(random, 30, 37)
      : shell === "crackle"
        ? between(random, 20, 30)
        : shell === "palm"
          ? between(random, 34, 40)
          : between(random, 44, 56);
  const speed = baseSpeed * Math.sqrt(scale);
  const tiltA = random() * Math.PI;
  const tiltB = between(random, 0.3, 1.2);
  const palmLift = between(random, 0.15, 0.35);
  for (let index = 0; index < count; index += 1) {
    if (shell === "ring") {
      ringDirection((index / count) * Math.PI * 2, tiltA, tiltB, direction);
    } else if (shell === "palm") {
      // The fronds: evenly round, lifted, so they arch up and droop.
      const angle = (index / count) * Math.PI * 2 + between(random, -0.12, 0.12);
      const lift = palmLift + between(random, -0.1, 0.1);
      direction[0] = Math.cos(angle) * Math.cos(lift);
      direction[1] = Math.sin(lift);
      direction[2] = Math.sin(angle) * Math.cos(lift);
    } else {
      sphereDirection(index, count, direction);
      // A real shell is never a perfect lattice: the stars wander a little.
      direction[0] += between(random, -0.06, 0.06);
      direction[1] += between(random, -0.06, 0.06);
      direction[2] += between(random, -0.06, 0.06);
      const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
      direction[0] /= length;
      direction[1] /= length;
      direction[2] /= length;
    }
    const jitter = shell === "crackle" ? between(random, 0.3, 1) : shell === "kamuro" ? between(random, 0.75, 1.05) : between(random, 0.93, 1.05);
    const s = speed * jitter;
    const star = makeStar(
      rocket.x,
      rocket.y,
      rocket.z,
      rocket.vx * 0.3 + direction[0] * s,
      rocket.vy * 0.3 + direction[1] * s,
      rocket.vz * 0.3 + direction[2] * s,
      between(random, 2, 2.8),
      rocket.color,
    );
    star.phase = random() * 100;
    switch (shell) {
      case "peony":
        star.twinkle = random() < 0.5 ? "fizz" : "none";
        break;
      case "chrysanthemum":
        star.color = GOLD;
        star.later = rocket.color;
        star.sparkle = 16;
        star.sparkleColor = GOLD;
        star.size = 1.45;
        star.streak = 0.1;
        break;
      case "willow":
        star.color = EMBER;
        star.life = between(random, 4.6, 6);
        star.drag = 0.85;
        star.fall = 0.6;
        star.size = 1.15;
        star.streak = 0.22;
        star.sparkle = 9;
        star.sparkleColor = EMBER;
        star.twinkle = "fizz";
        break;
      case "ring":
        star.size = 1.8;
        break;
      case "saturn":
        if (index % 3 === 0) {
          // The ring round the planet, in the second colour.
          ringDirection((index / count) * Math.PI * 2 * 3, tiltA, tiltB, direction);
          star.vx = rocket.vx * 0.3 + direction[0] * s * 1.15;
          star.vy = rocket.vy * 0.3 + direction[1] * s * 1.15;
          star.vz = rocket.vz * 0.3 + direction[2] * s * 1.15;
          star.color = rocket.second;
          star.size = 1.75;
        } else {
          star.vx = rocket.vx * 0.3 + direction[0] * s * 0.62;
          star.vy = rocket.vy * 0.3 + direction[1] * s * 0.62;
          star.vz = rocket.vz * 0.3 + direction[2] * s * 0.62;
        }
        break;
      case "palm":
        star.color = GOLD;
        star.life = between(random, 2.8, 3.6);
        star.drag = 0.55;
        star.fall = 0.75;
        star.size = 3.2;
        star.streak = 0.3;
        star.sparkle = 110;
        star.sparkleColor = GOLD;
        break;
      case "crossette":
        star.split = between(random, 0.5, 0.8);
        star.sparkle = 10;
        star.sparkleColor = star.color;
        star.streak = 0.1;
        break;
      case "strobe":
        star.color = WHITE;
        star.life = between(random, 2.6, 3.4);
        star.drag = 1.1;
        star.fall = 0.45;
        star.twinkle = "strobe";
        star.size = 1.3;
        break;
      case "kamuro":
        star.color = GOLD;
        star.life = between(random, 4.2, 5.4);
        star.drag = 1.15;
        star.fall = 0.5;
        star.size = 1.05;
        star.streak = 0.16;
        star.sparkle = 14;
        star.sparkleColor = WHITE;
        star.twinkle = "fizz";
        break;
      case "crackle":
        star.color = WHITE;
        star.life = between(random, 1.1, 1.8);
        star.twinkle = "crackle";
        star.size = 1.05;
        break;
    }
    emit(star);
  }

  // A pistil: a smaller, slower inner sphere in a second colour.
  const pistil = shell === "ring" ? 40 : shell === "peony" && random() < 0.6 ? 70 : 0;
  for (let index = 0; index < pistil; index += 1) {
    sphereDirection(index, pistil, direction);
    const s = speed * 0.42 * between(random, 0.92, 1.05);
    const star = makeStar(
      rocket.x,
      rocket.y,
      rocket.z,
      rocket.vx * 0.3 + direction[0] * s,
      rocket.vy * 0.3 + direction[1] * s,
      rocket.vz * 0.3 + direction[2] * s,
      between(random, 1.6, 2.2),
      rocket.second,
    );
    star.size = 1.5;
    star.phase = random() * 100;
    emit(star);
  }
  return added;
}

/** The four stars a crossette star splits into. */
export function splitStar(star: Star, random: RandomSource, add: (star: Star) => void): void {
  const speed = Math.hypot(star.vx, star.vy, star.vz) + 8;
  const base = random() * Math.PI * 2;
  for (let index = 0; index < 4; index += 1) {
    const angle = base + (index * Math.PI) / 2;
    add({
      ...star,
      vx: Math.cos(angle) * speed * 0.8,
      vy: Math.sin(angle) * speed * 0.8 + star.vy * 0.3,
      vz: (random() - 0.5) * speed * 0.5,
      age: 0,
      life: between(random, 1, 1.5),
      split: -1,
      size: star.size * 0.85,
      sparkle: 14,
      sparkleColor: GOLD,
      sparkleClock: 0,
      phase: random() * 100,
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
 * The glitter a burning star sheds (a chrysanthemum's tail, a palm's frond,
 * a willow's drizzle): tiny sparks that hang where they were dropped and
 * twinkle out within half a second. Sheds less as the star burns down.
 */
export function shedSparks(star: Star, dt: number, random: RandomSource, add: (spark: Star) => void): void {
  if (star.sparkle <= 0) return;
  const t = star.age / star.life;
  if (t > 0.92) return;
  star.sparkleClock += star.sparkle * dt * (1 - t * 0.7);
  while (star.sparkleClock >= 1) {
    star.sparkleClock -= 1;
    const back = random() * dt;
    const spark = makeStar(
      star.x - star.vx * back,
      star.y - star.vy * back,
      star.z - star.vz * back,
      star.vx * 0.06 + between(random, -0.8, 0.8),
      star.vy * 0.06 - between(random, 0.2, 1.4),
      star.vz * 0.06 + between(random, -0.8, 0.8),
      between(random, 0.35, 0.8),
      star.sparkleColor,
    );
    spark.drag = 3;
    spark.fall = 0.35;
    spark.size = star.size * between(random, 0.32, 0.5);
    spark.streak = 0.03;
    spark.twinkle = "crackle";
    spark.phase = random() * 100;
    add(spark);
  }
}

/**
 * How bright a star is now (0…1): full until the last third of its life,
 * then fading. `flicker` (0…1) is a fast per-star noise, `time` the show's
 * clock: crackle flashes at random, a strobe blinks about eight times a
 * second once it has opened, and a fizzing star sputters as it dies.
 */
export function starBrightness(star: Star, flicker: number, time = 0): number {
  const t = star.age / star.life;
  if (star.twinkle === "flash") {
    // The burst flash: blinding at once, gone in a sixth of a second.
    const f = Math.max(0, 1 - t);
    return f * f;
  }
  const fade = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
  let flash = 1;
  if (star.twinkle === "crackle") flash = flicker > 0.45 ? 1 : 0.12;
  else if (star.twinkle === "strobe") flash = t < 0.3 ? 1 : Math.sin((time + star.phase) * 50) > 0.2 ? 1.25 : 0.03;
  else if (star.twinkle === "fizz" && t > 0.55) flash = flicker > 0.35 ? 1.15 : 0.25;
  return fade * fade * flash;
}

/**
 * Light a burst throws on the sea and the scene, by its age (s): a sharp
 * flash, then the glow of the burning stars dying away over two seconds.
 */
export function burstLight(age: number): number {
  if (age < 0) return 0;
  const flash = Math.exp(-age / 0.09);
  const glow = age < 2.4 ? 0.35 * (1 - age / 2.4) : 0;
  return flash + glow;
}
