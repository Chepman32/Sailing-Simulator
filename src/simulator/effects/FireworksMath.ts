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
 * - **crackle**: a cloud of white and gold flashes;
 * - **rainbow**: a peony whose stars are dealt out in five colours, in bands
 *   round the sphere;
 * - **dahlia**: fewer, bigger stars on long streaks, in three colours;
 * - **cluster**: a dozen bomblets that each bloom into a small sphere of
 *   its own colour, a bouquet;
 * - **heart**: stars laid out on a heart, turned to face the onlookers.
 *
 * Between the shells the deck itself fires (`groundEffect`): **fans** of
 * comets thrown up and out on glittering tails, and **mines**, fountains of
 * coloured stars and crackle bursting straight from the deck.
 *
 * Every star draws its own path behind it (`tx, ty, tz`: a point that
 * follows the star a moment late), so a fresh shell is a wheel of spokes
 * from its centre that shorten into drifting embers as the stars slow, the
 * way a firework looks to the eye and to a camera.
 *
 * Shells are rarely of one colour: peonies change colour in flight or burst
 * in two halves, willows end in coloured tips, palms throw coloured comets,
 * rings come double, and a volley's rockets can each have their own colour.
 * Every burst leaves a puff of smoke lit in its colours. Stars slow in the
 * air quickly, fall slowly and fade; the brightest are brighter than white
 * so the bloom haloes them.
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
  | "crackle"
  | "rainbow"
  | "dahlia"
  | "cluster"
  | "heart";
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
  "rainbow",
  "dahlia",
  "cluster",
  "heart",
];
/** How often each shell is fired (relative): the coloured ones lead, gold and white accent them. */
const SHELL_WEIGHTS: Readonly<Record<ShellKind, number>> = {
  peony: 3,
  chrysanthemum: 2,
  willow: 1.2,
  ring: 1.4,
  saturn: 1.3,
  palm: 1,
  crossette: 1.3,
  strobe: 0.9,
  kamuro: 0.8,
  crackle: 0.8,
  rainbow: 1.6,
  dahlia: 1.4,
  cluster: 1.5,
  heart: 0.6,
};

export type Rgb = readonly [number, number, number];

/**
 * Star colours, HDR (scene-linear, the bloom picks up what is over 1), in
 * hue order round the colour wheel: red, vermilion, orange, amber, lemon,
 * lime, green, emerald, aqua, azure, blue, indigo, violet, magenta, pink,
 * and silver. Each is one strong channel with little of the others: a
 * colour brighter than about 4 in every channel reads as white once the
 * stars of a shell overlap, and a show of white-gold blobs is what this
 * palette exists to prevent.
 */
export const STAR_COLORS: readonly Rgb[] = [
  [4.6, 0.1, 0.07],
  [4.8, 0.62, 0.05],
  [4.7, 1.45, 0.06],
  [4.4, 2.5, 0.1],
  [3.6, 3.7, 0.14],
  [1.5, 4.4, 0.12],
  [0.12, 4.4, 0.3],
  [0.08, 4.1, 1.7],
  [0.1, 3.6, 3.7],
  [0.12, 1.9, 5.2],
  [0.14, 0.5, 5.8],
  [0.9, 0.22, 5.8],
  [2.6, 0.16, 5.4],
  [4.6, 0.14, 3.6],
  [4.9, 0.75, 2.1],
  [4.3, 4.2, 4],
];
/** The silver of the palette (last), told apart from the hues. */
const SILVER_INDEX = STAR_COLORS.length - 1;
export const GOLD: Rgb = [4.9, 2.5, 0.45];
/** Charcoal glitter: a deeper, redder gold. */
export const EMBER: Rgb = [3.9, 1.3, 0.2];
export const WHITE: Rgb = [5.2, 5, 4.7];

/**
 * How a star's light varies: steady, crackling, strobing, fizzing out at the
 * end of its life, the round white flash of a burst, or the burst's smoke
 * lit in its colours (a soft, wide, slow glow).
 */
export type Twinkle = "none" | "crackle" | "strobe" | "fizz" | "flash" | "haze";

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
  /** A third colour (rainbow, dahlia, cluster shells deal out several). */
  third: Rgb;
  /** Which way a shaped shell faces (yaw toward the onlookers). */
  face: number;
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
  /** Second colour it turns to as it burns (a chrysanthemum's tail), from `turn` of its life. */
  later: Rgb | null;
  turn: number;
  /** Air drag (1/s) and the share of gravity it feels (it is light). */
  drag: number;
  fall: number;
  twinkle: Twinkle;
  /** Splits into a few more stars at this age (crossette), or never (−1). */
  split: number;
  /** When it splits: 0 a crossette's four pieces, else a small sphere of this many stars (a cluster's bloom). */
  bloom: number;
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
  /**
   * The end of its drawn streak: a point that follows the star `streak`
   * seconds behind (`stepStar`). It starts where the star was lit, so a
   * shell's stars open as spokes from the burst.
   */
  tx: number;
  ty: number;
  tz: number;
};

/** A heart's second colour: hot pink. */
const HEART_PINK: Rgb = [4.9, 0.4, 1.9];

export const GRAVITY = 9.81;
/** Seconds of a show, and the finale at its end. */
export const SHOW_LENGTH = { min: 36, max: 48 } as const;
export const FINALE_LENGTH = 6;
/** Seconds between shows after dark, and by day. */
export const NIGHT_GAP = { min: 55, max: 95 } as const;
// By day a show is a rare treat: ten times rarer than it used to be.
export const DAY_GAP = { min: 1500, max: 2400 } as const;
/** Seconds the white flash of a burst lasts (a blink: the shell is its stars, not a ball of light). */
export const BURST_FLASH = 0.11;

export function between(random: RandomSource, low: number, high: number): number {
  return low + (high - low) * random();
}

function pickShell(random: RandomSource, from: readonly ShellKind[] = SHELL_KINDS): ShellKind {
  let total = 0;
  for (const kind of from) total += SHELL_WEIGHTS[kind];
  let roll = random() * total;
  for (const kind of from) {
    roll -= SHELL_WEIGHTS[kind];
    if (roll < 0) return kind;
  }
  return from[from.length - 1]!;
}

/**
 * `count` colours that go together and are easy to tell apart: hues spread
 * evenly round the wheel (red with blue or green, never red with orange),
 * now and then with silver among them. `turn` (a show's cue counter) picks
 * the first hue instead of chance: each cue then starts a good third of
 * the wheel on from the last one, so a show walks through every colour and
 * never fires the same one twice running.
 */
export function harmony(random: RandomSource, count: number, turn?: number): Rgb[] {
  const hues = SILVER_INDEX;
  const out: Rgb[] = [];
  const first = turn === undefined ? Math.floor(random() * hues) % hues : (Math.round(turn * HUE_STEP) + Math.floor(random() * 2)) % hues;
  // Evenly round the wheel from the first, a little irregular.
  const stride = hues / Math.max(2, count);
  for (let index = 0; index < count; index += 1) {
    const hue = Math.round(first + index * stride + (index > 0 ? between(random, -0.4, 0.4) : 0)) % hues;
    out.push(STAR_COLORS[(hue + hues) % hues]!);
  }
  if (count > 1 && random() < 0.2) out[count - 1] = STAR_COLORS[SILVER_INDEX]!;
  return out;
}

/** Hues a show moves on between cues: about 0.38 of the wheel (the golden angle), so the colours never settle into a cycle. */
const HUE_STEP = 5.7;

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
export type Cue = {
  count: number;
  shell: ShellKind;
  color: Rgb;
  second: Rgb;
  third: Rgb;
  /** A volley's rockets each in their own colour (left to right), or all in `color`. */
  colors: readonly Rgb[] | null;
  size: number;
  spread: number;
  /**
   * Fired from the deck itself instead of a shell: a fan of comets or a
   * mine (`groundEffect`); `count` is then how many of them, along the deck.
   */
  ground?: GroundKind;
};

/** What the deck fires between the shells. */
export type GroundKind = "fan" | "mine";

/** Shells that suit a finale: big, bright, many-coloured, and gold hanging at the end. */
const FINALE_SHELLS: readonly ShellKind[] = ["crackle", "kamuro", "willow", "peony", "strobe", "chrysanthemum", "palm", "rainbow", "cluster", "dahlia"];

/**
 * The next cue, `remaining` seconds before the show ends (of `length`).
 * Mostly single shells, a volley now and then, and a salvo about halfway.
 */
export function nextCue(random: RandomSource, remaining: number, length: number, turn?: number): Cue {
  const [color, second, third] = harmony(random, 3, turn) as [Rgb, Rgb, Rgb];
  if (remaining < FINALE_LENGTH) {
    // The finale: shells in twos, and mines along the whole deck under them.
    if (random() < 0.16) return { count: 3, shell: "peony", color, second, third, colors: harmony(random, 3, turn), size: 1.15, spread: 0.45, ground: "mine" };
    const count = random() < 0.45 ? 2 : 1;
    return { count, shell: pickShell(random, FINALE_SHELLS), color, second, third, colors: count > 1 ? harmony(random, count, turn) : null, size: between(random, 1.05, 1.3), spread: 0.4 };
  }
  const progress = 1 - remaining / Math.max(1, length);
  const salvo = progress > 0.45 && progress < 0.55;
  const roll = random();
  // Now and then the deck answers the sky: a fan of comets, or mines.
  if (!salvo && roll > 0.86) {
    const fan = roll < 0.94;
    const count = fan ? (random() < 0.5 ? 1 : 2) : random() < 0.5 ? 2 : 3;
    return { count, shell: "peony", color, second, third, colors: random() < 0.6 ? harmony(random, 3, turn) : null, size: 1, spread: fan ? 0.3 : 0.4, ground: fan ? "fan" : "mine" };
  }
  const count = salvo ? 3 : roll < 0.22 ? 2 : roll < 0.3 ? 3 : 1;
  // A volley spreads its rockets symmetrically along the deck; half the
  // time each in its own colour (red, white and blue; green, gold, violet).
  const shell = pickShell(random);
  const colors = count > 1 && shell !== "rainbow" && random() < 0.5 ? harmony(random, count, turn) : null;
  return { count, shell, color, second, third, colors, size: count > 1 ? between(random, 0.85, 1) : between(random, 0.95, 1.15), spread: count > 1 ? 0.32 : 0.2 };
}

/** Comets in a fan, and stars in a mine. */
export const FAN_COMETS = 7;
export const MINE_STARS = 260;

/**
 * What the deck fires at (x, y, z) for a ground cue, the `slot`-th of its
 * `cue.count`; (`axisX`, `axisZ`) is the unit direction along the deck.
 *
 * - a **fan**: seven comets thrown up and outward along the deck's length,
 *   each a thick star in its own colour on a long glittering tail, arcing
 *   over and burning out as it falls;
 * - a **mine**: a fountain of stars bursting from the deck in an upward
 *   cone, the fast inner ones in one colour, the slower outer ones in a
 *   second, in a cloud of white crackle.
 *
 * Returns how many stars it added.
 */
export function groundEffect(cue: Cue, slot: number, random: RandomSource, x: number, y: number, z: number, axisX: number, axisZ: number, add: (star: Star) => void): number {
  const palette = cue.colors ?? [cue.color, cue.second, cue.third];
  let added = 0;
  if (cue.ground === "fan") {
    // Mirrored for the second of a pair, so two fans cross.
    const lean = cue.count > 1 ? (slot % 2 === 0 ? 0.18 : -0.18) : 0;
    for (let index = 0; index < FAN_COMETS; index += 1) {
      const angle = ((index / (FAN_COMETS - 1)) * 2 - 1) * 0.62 + lean + between(random, -0.02, 0.02);
      const speed = between(random, 60, 66);
      const out = Math.sin(angle) * speed;
      const star = makeStar(x, y, z, axisX * out + between(random, -1, 1), Math.cos(angle) * speed, axisZ * out + between(random, -1, 1), between(random, 2.7, 3.2), palette[index % palette.length]!);
      star.drag = 0.42;
      star.fall = 0.95;
      star.size = 3.1;
      star.streak = 0.5;
      star.sparkle = 220;
      star.sparkleColor = index % 2 === 0 ? GOLD : star.color;
      star.twinkle = "fizz";
      star.phase = random() * 100;
      add(star);
      added += 1;
    }
    return added;
  }
  // The mine's lift charge: a flash on the deck.
  const flash = makeStar(x, y + 2, z, 0, 6, 0, BURST_FLASH, WHITE);
  flash.size = 5;
  flash.streak = 0;
  flash.twinkle = "flash";
  flash.drag = 4;
  flash.fall = 0;
  add(flash);
  added += 1;
  const inner = palette[slot % palette.length]!;
  const outer = palette[(slot + 1) % palette.length]!;
  for (let index = 0; index < MINE_STARS; index += 1) {
    // An upward cone, denser toward its axis.
    const off = Math.pow(random(), 0.7) * 0.5;
    const round = random() * Math.PI * 2;
    const crackle = index % 4 === 3;
    const speed = crackle ? between(random, 30, 60) : between(random, 44, 88) * (1 - off * 0.5);
    const side = Math.sin(off) * speed;
    const star = makeStar(x, y, z, Math.cos(round) * side, Math.cos(off) * speed, Math.sin(round) * side, crackle ? between(random, 0.9, 1.5) : between(random, 1.7, 2.5), crackle ? WHITE : off < 0.24 ? inner : outer);
    star.drag = crackle ? 1.6 : 0.95;
    star.fall = 0.85;
    star.size = crackle ? 1 : 1.7;
    star.streak = crackle ? 0.05 : 0.26;
    star.twinkle = crackle ? "crackle" : random() < 0.5 ? "fizz" : "none";
    if (!crackle && index % 5 === 0) {
      star.sparkle = 12;
      star.sparkleColor = GOLD;
    }
    star.phase = random() * 100;
    add(star);
    added += 1;
  }
  return added;
}

/**
 * A rocket leaving the deck at (x, y, z): the `slot`-th of its cue's
 * volley; `face` is the yaw toward the onlookers (for a heart).
 */
export function launchRocket(random: RandomSource, x: number, y: number, z: number, finale = false, cue?: Cue, slot = 0, face?: number): Rocket {
  const speed = between(random, 70, 84);
  const tilt = between(random, 0, 0.12);
  const heading = random() * Math.PI * 2;
  const shell = cue ? cue.shell : finale && random() < 0.4 ? "crackle" : pickShell(random);
  const palette = cue ? null : harmony(random, 3);
  const color = cue ? (cue.colors ? cue.colors[slot % cue.colors.length]! : cue.color) : palette![0]!;
  return {
    x,
    y,
    z,
    vx: Math.sin(heading) * Math.sin(tilt) * speed,
    vy: Math.cos(tilt) * speed,
    vz: Math.cos(heading) * Math.sin(tilt) * speed,
    fuse: between(random, 3.2, 4.3),
    shell,
    color,
    second: cue ? (cue.second === color ? cue.third : cue.second) : palette![1]!,
    third: cue ? (cue.third === color ? cue.second : cue.third) : palette![2]!,
    face: face ?? random() * Math.PI * 2,
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
    turn: 0,
    drag: 1,
    fall: 0.3,
    twinkle: "none",
    split: -1,
    bloom: 0,
    size: 1.9,
    streak: 0.2,
    sparkle: 0,
    sparkleColor: GOLD,
    sparkleClock: 0,
    phase: 0,
    tx: x,
    ty: y,
    tz: z,
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
    rocket.trailClock += 0.012;
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

/**
 * Stars of each shell (before the scale of a large shell and the preset's
 * `density`). Many and fine: a shell is a cloud of hundreds of points of
 * light, each a thin spark, not a few dozen fat ones.
 */
export const SHELL_STARS: Readonly<Record<ShellKind, number>> = {
  peony: 640,
  chrysanthemum: 460,
  willow: 340,
  ring: 230,
  saturn: 500,
  palm: 13,
  crossette: 110,
  strobe: 330,
  kamuro: 430,
  crackle: 430,
  rainbow: 660,
  dahlia: 130,
  cluster: 14,
  heart: 210,
};

/**
 * Every star's drawn width is its `size` times this, metres: a spark some
 * 0.7 m across, a pixel or two at the range a show is watched from.
 */
export const STAR_FINENESS = 0.42;

/** A point on a heart (unit size, centred), at parameter `t` (0…2π). */
export function heartPoint(t: number): [number, number] {
  const s = Math.sin(t);
  return [(16 * s * s * s) / 17, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17];
}

/**
 * The stars of a shell bursting where the rocket is, and its white flash.
 * `density` (the quality preset's, 0.35…1) thins the shell on a slow
 * device. Returns how many stars it added.
 */
export function burst(rocket: Rocket, random: RandomSource, add: (star: Star) => void, density = 1): number {
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
  flash.size = 7 * scale;
  flash.streak = 0;
  flash.twinkle = "flash";
  flash.drag = 4;
  flash.fall = 0;
  emit(flash);
  // The smoke of the burst, lit from inside in the shell's colours: a wide,
  // soft glow that swells, drifts and dims as the stars burn out.
  const gold = shell === "willow" || shell === "kamuro" || shell === "palm" || shell === "crackle" || shell === "strobe";
  const smokeColor = gold ? GOLD : rocket.color;
  const haze = makeStar(rocket.x, rocket.y, rocket.z, rocket.vx * 0.15, rocket.vy * 0.15, rocket.vz * 0.15, between(random, 2.6, 3.4), [smokeColor[0] * 0.022, smokeColor[1] * 0.022, smokeColor[2] * 0.022]);
  // (Faint: the light of a shell is its stars; a bright ball of lit smoke read as a blob.)
  haze.size = 44 * scale;
  haze.streak = 0;
  haze.twinkle = "haze";
  haze.drag = 2.5;
  haze.fall = -0.04;
  emit(haze);

  const count = Math.round(SHELL_STARS[shell] * (shell === "palm" || shell === "cluster" ? 1 : scale * Math.min(1, Math.max(0.3, density))));
  // Big shells: a peony opens to some 70 m across its radius, a willow hangs lower and wider.
  const baseSpeed =
    shell === "willow" || shell === "kamuro"
      ? between(random, 40, 48)
      : shell === "crackle"
        ? between(random, 26, 38)
        : shell === "palm" || shell === "dahlia"
          ? between(random, 46, 54)
          : shell === "cluster"
            ? between(random, 42, 48)
            : shell === "heart"
              ? between(random, 50, 55)
              : between(random, 60, 74);
  const speed = baseSpeed * Math.sqrt(scale);
  const tiltA = random() * Math.PI;
  const tiltB = between(random, 0.3, 1.2);
  const palmLift = between(random, 0.15, 0.35);
  // Variants that colour a shell in more than one colour.
  const variant = random();
  const doubleRing = shell === "ring" && variant < 0.4;
  const tiltC = between(random, 0.3, 1.2);
  const palette = [rocket.color, rocket.second, rocket.third] as const;
  const rainbow = harmony(random, 5);
  const bandOffset = random() * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    if (shell === "ring") {
      // A double ring: every other star on a second ring at another tilt.
      if (doubleRing && index % 2 === 1) ringDirection((index / count) * Math.PI * 2, tiltA + 1.3, tiltC, direction);
      else ringDirection((index / count) * Math.PI * 2, tiltA, tiltB, direction);
    } else if (shell === "heart") {
      // The outline, in a vertical plane facing the onlookers.
      const [hx, hy] = heartPoint((index / count) * Math.PI * 2);
      direction[0] = Math.cos(rocket.face) * hx;
      direction[1] = hy;
      direction[2] = -Math.sin(rocket.face) * hx;
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
    const jitter =
      shell === "crackle" ? between(random, 0.3, 1) : shell === "kamuro" ? between(random, 0.75, 1.05) : shell === "heart" ? between(random, 0.98, 1.02) : between(random, 0.93, 1.05);
    const s = speed * jitter;
    const star = makeStar(
      rocket.x,
      rocket.y,
      rocket.z,
      rocket.vx * 0.3 + direction[0] * s,
      rocket.vy * 0.3 + direction[1] * s,
      rocket.vz * 0.3 + direction[2] * s,
      between(random, 2.3, 3.1),
      rocket.color,
    );
    star.phase = random() * 100;
    // Heavy stars carry far: a shell opens wide before the air stops it.
    star.drag = 0.82;
    switch (shell) {
      case "peony":
        star.twinkle = random() < 0.5 ? "fizz" : "none";
        if (variant < 0.35) {
          // Changes colour halfway through its flight.
          star.later = rocket.second;
          star.turn = 0.35;
        } else if (variant < 0.65) {
          // Two halves, split along a tilted plane.
          const side = direction[0] * Math.cos(tiltA) + direction[1] * Math.sin(tiltB) + direction[2] * Math.sin(tiltA);
          if (side > 0) star.color = rocket.second;
        }
        break;
      case "rainbow": {
        // Five bands of colour round the sphere.
        const band = Math.floor(((Math.atan2(direction[2], direction[0]) + bandOffset + Math.PI * 4) / (Math.PI * 2)) * 5) % 5;
        star.color = rainbow[band]!;
        star.size = 1.75;
        star.twinkle = random() < 0.35 ? "fizz" : "none";
        break;
      }
      case "dahlia":
        star.color = palette[index % 3]!;
        star.life = between(random, 2.6, 3.4);
        star.drag = 0.9;
        star.fall = 0.38;
        star.size = 2.7;
        star.streak = 0.42;
        star.sparkle = 7;
        star.sparkleColor = star.color;
        star.twinkle = "fizz";
        break;
      case "cluster":
        // A bomblet on a gold fuse, blooming into its own colour.
        star.color = GOLD;
        star.later = index % 4 === 3 ? STAR_COLORS[SILVER_INDEX]! : palette[index % 3]!;
        star.turn = 0.99;
        star.life = between(random, 0.9, 1.1);
        star.split = between(random, 0.5, 0.85);
        star.bloom = Math.round(90 * Math.min(1, Math.max(0.3, density)));
        star.size = 1.1;
        star.sparkle = 30;
        star.sparkleColor = GOLD;
        break;
      case "heart":
        star.color = random() < 0.5 ? rocket.color : HEART_PINK;
        star.life = between(random, 2.1, 2.6);
        // Heavy drag, little fall: it holds its shape a moment.
        star.drag = 1.6;
        star.fall = 0.12;
        star.size = 1.9;
        star.streak = 0.12;
        break;
      case "chrysanthemum":
        star.color = GOLD;
        star.later = rocket.color;
        star.sparkle = 20;
        star.sparkleColor = GOLD;
        star.size = 1.45;
        star.streak = 0.3;
        break;
      case "willow":
        star.color = EMBER;
        // Half the willows end in coloured tips.
        if (variant < 0.5) {
          star.later = rocket.color;
          star.turn = 0.55;
        }
        star.life = between(random, 4.6, 6);
        star.drag = 0.85;
        star.fall = 0.6;
        star.size = 1.15;
        star.streak = 0.5;
        star.sparkle = 9;
        star.sparkleColor = EMBER;
        star.twinkle = "fizz";
        break;
      case "ring":
        star.size = 1.8;
        if (doubleRing && index % 2 === 1) star.color = rocket.second;
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
        // Gold fronds, or coloured comets on gold trails.
        star.color = variant < 0.45 ? rocket.color : GOLD;
        star.life = between(random, 2.8, 3.6);
        star.drag = 0.55;
        star.fall = 0.75;
        star.size = 3.2;
        star.streak = 0.55;
        star.sparkle = 260;
        star.sparkleColor = GOLD;
        break;
      case "crossette":
        star.split = between(random, 0.5, 0.8);
        star.sparkle = 10;
        star.sparkleColor = star.color;
        star.streak = 0.24;
        // Its pieces flare into the second colour.
        if (variant < 0.5) {
          star.later = rocket.second;
          star.turn = 1;
        }
        break;
      case "strobe":
        // White, or (half the time) blinking in a colour.
        star.color = variant < 0.5 ? WHITE : rocket.color;
        star.life = between(random, 2.6, 3.4);
        star.drag = 1.1;
        star.fall = 0.45;
        star.twinkle = "strobe";
        star.size = 1.3;
        star.streak = 0.08;
        break;
      case "kamuro":
        star.color = GOLD;
        star.life = between(random, 4.2, 5.4);
        star.drag = 1.15;
        star.fall = 0.5;
        star.size = 1.05;
        star.streak = 0.45;
        star.sparkle = 14;
        star.sparkleColor = WHITE;
        star.twinkle = "fizz";
        break;
      case "crackle":
        star.color = random() < 0.35 ? GOLD : WHITE;
        star.life = between(random, 1.1, 1.8);
        star.twinkle = "crackle";
        star.size = 1.05;
        star.streak = 0.06;
        break;
    }
    emit(star);
  }

  // A pistil: a smaller, slower inner sphere in a second colour (a third
  // where the shell already uses two).
  const pistil =
    Math.round((shell === "ring" ? 90 : shell === "peony" && random() < 0.6 ? 170 : shell === "rainbow" ? 130 : shell === "chrysanthemum" || (shell === "kamuro" && variant < 0.45) ? 150 : 0) * Math.min(1, Math.max(0.3, density)));
  const pistilColor = shell === "rainbow" ? WHITE : shell === "peony" && variant < 0.65 ? rocket.third : shell === "kamuro" ? rocket.color : rocket.second;
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
      pistilColor,
    );
    star.size = 1.5;
    star.phase = random() * 100;
    emit(star);
  }
  return added;
}

/**
 * What a star splits into: a crossette's four pieces, or a cluster
 * bomblet's bloom, a small sphere of stars in its own colour.
 */
export function splitStar(star: Star, random: RandomSource, add: (star: Star) => void): void {
  if (star.bloom > 0) {
    const direction: [number, number, number] = [0, 0, 0];
    const color = star.later ?? star.color;
    const speed = between(random, 18, 23);
    for (let index = 0; index < star.bloom; index += 1) {
      sphereDirection(index, star.bloom, direction);
      const s = speed * between(random, 0.9, 1.06);
      add({
        ...star,
        vx: star.vx * 0.3 + direction[0] * s,
        vy: star.vy * 0.3 + direction[1] * s,
        vz: star.vz * 0.3 + direction[2] * s,
        age: 0,
        life: between(random, 1.4, 2),
        color,
        later: null,
        turn: 0,
        drag: 1.4,
        fall: 0.35,
        split: -1,
        bloom: 0,
        size: 1.35,
        streak: 0.16,
        sparkle: 0,
        sparkleClock: 0,
        twinkle: random() < 0.4 ? "fizz" : "none",
        phase: random() * 100,
        tx: star.x,
        ty: star.y,
        tz: star.z,
      });
    }
    return;
  }
  const speed = Math.hypot(star.vx, star.vy, star.vz) + 8;
  const base = random() * Math.PI * 2;
  const color = star.later ?? star.color;
  for (let index = 0; index < 4; index += 1) {
    const angle = base + (index * Math.PI) / 2;
    add({
      ...star,
      vx: Math.cos(angle) * speed * 0.8,
      vy: Math.sin(angle) * speed * 0.8 + star.vy * 0.3,
      vz: (random() - 0.5) * speed * 0.5,
      age: 0,
      life: between(random, 1, 1.5),
      color,
      later: null,
      split: -1,
      size: star.size * 0.85,
      sparkle: 14,
      sparkleColor: GOLD,
      sparkleClock: 0,
      phase: random() * 100,
      tx: star.x,
      ty: star.y,
      tz: star.z,
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
  // The streak's end follows `streak` seconds behind (at once, for a spark with none).
  const follow = star.streak > 1e-3 ? 1 - Math.exp(-dt / star.streak) : 1;
  star.tx += (star.x - star.tx) * follow;
  star.ty += (star.y - star.ty) * follow;
  star.tz += (star.z - star.tz) * follow;
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
  if (star.twinkle === "haze") {
    // The lit smoke: brightest while the stars are near, then dimming.
    if (t >= 1) return 0;
    return Math.min(1, t / 0.06) * (1 - t) * (1 - t);
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

/**
 * A star just lit is not yet at its full light (0.1 rising smoothly to 1
 * over its first `STAR_KINDLE` seconds). At the instant of a burst hundreds
 * of stars lie on top of one another: at full light they summed to a solid
 * white ball for the first third of a second; kindling as it spreads, the
 * shell is seen opening as separate points from the first frame. (Glitter
 * and crackle, which live half a second, are at full light at once.)
 */
export const STAR_KINDLE = 0.5;
export function starKindle(age: number, life: number): number {
  if (life < 1.6) return 1;
  const t = Math.min(1, Math.max(0, age) / STAR_KINDLE);
  return 0.1 + 0.9 * t * t * (3 - 2 * t);
}
