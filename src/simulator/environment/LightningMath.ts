import { clamp } from "../math";

/**
 * Lightning as pure, reproducible numbers.
 *
 * Strikes are drawn from time slots by hashing the slot index, so the same
 * session time always holds the same strikes, at any frame rate. A strike is
 * either a cloud-to-ground bolt (a visible channel from the cloud base to the
 * sea, with branches) or a flash inside the cloud (only the sky lights up).
 * Each has a distance, a stepped leader that reveals the channel downward in a
 * few tens of milliseconds, then one to four return strokes, each a bright
 * spike with a short glowing tail, and the continuing current between them.
 *
 * Distances are real (hundreds of metres to a dozen kilometres): they set the
 * apparent size of the bolt, how much it lights the scene, and how late and
 * how deep the thunder arrives (`THUNDER_SPEED`).
 */

export type StrikeKind = "ground" | "cloud";

export type Strike = {
  /** Slot index the strike was drawn from; unique per strike. */
  id: number;
  kind: StrikeKind;
  /** Session time the leader starts, s. */
  start: number;
  /** Distance from the observer to the channel, m. */
  distance: number;
  /** Bearing offset 0…1 (the system turns it into an azimuth). */
  bearingSeed: number;
  /** 0…1: whether the bearing is drawn near the view or anywhere. */
  bearingSpread: number;
  /** Height of the cloud base above the sea, m. */
  cloudBase: number;
  /** Return strokes: time after `start` and relative strength. */
  strokes: readonly { time: number; strength: number }[];
  /** Seed for the channel's shape. */
  seed: number;
};

/** Slot length, s: at most one strike begins in each. */
export const LIGHTNING_SLOT = 1.6;
/** Below this storm level there is no lightning at all. */
export const LIGHTNING_MIN_STORM = 0.35;
/** Storm level from which the storm is overhead (near strikes, frequent flashes). */
export const LIGHTNING_FULL_STORM = 0.6;
/** Speed of sound in air, m/s. */
export const THUNDER_SPEED = 343;
/** Thunder is not heard beyond this distance, m. */
export const THUNDER_RANGE = 16000;
/** Duration of the stepped leader, s. */
export const LEADER_SECONDS = 0.045;
/** Longest a strike stays visible, s. */
export const STRIKE_SECONDS = 1.1;

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

/** Chance that a slot holds a strike, for a storm level. */
export function strikeChance(storm: number): number {
  if (storm < LIGHTNING_MIN_STORM) return 0;
  if (storm < LIGHTNING_FULL_STORM) {
    // A storm on the horizon: now and then a distant flash.
    return 0.045 + ((storm - LIGHTNING_MIN_STORM) / (LIGHTNING_FULL_STORM - LIGHTNING_MIN_STORM)) * 0.06;
  }
  return 0.18 + clamp((storm - LIGHTNING_FULL_STORM) / (1 - LIGHTNING_FULL_STORM), 0, 1) * 0.3;
}

/** The strike that begins in `slot` at this storm level, or null. */
export function strikeInSlot(slot: number, storm: number): Strike | null {
  if (slot < 0 || hash(slot, 21) >= strikeChance(storm)) return null;
  const overhead = clamp((storm - LIGHTNING_FULL_STORM) / (1 - LIGHTNING_FULL_STORM), 0, 1);
  const distant = storm < LIGHTNING_FULL_STORM;
  // Mostly kilometres away; in a full storm one strike in seven is close.
  const near = !distant && hash(slot, 22) < 0.05 + overhead * 0.1;
  const distance = near
    ? 450 + hash(slot, 23) * 1100
    : (distant ? 6000 : 1600) + Math.pow(hash(slot, 24), 0.85) * (distant ? 7000 : 9500);
  const kind: StrikeKind = hash(slot, 25) < (distant ? 0.45 : 0.55) ? "ground" : "cloud";
  const strokeCount = 1 + Math.floor(hash(slot, 26) * (kind === "ground" ? 4 : 2.6));
  const strokes: { time: number; strength: number }[] = [];
  let time = LEADER_SECONDS;
  for (let stroke = 0; stroke < strokeCount; stroke += 1) {
    strokes.push({ time, strength: stroke === 0 ? 1 : 0.45 + hash(slot * 7 + stroke, 27) * 0.45 });
    time += 0.045 + hash(slot * 7 + stroke, 28) * 0.11;
  }
  return {
    id: slot,
    kind,
    start: slot * LIGHTNING_SLOT + hash(slot, 29) * (LIGHTNING_SLOT - 0.2),
    distance,
    bearingSeed: hash(slot, 30),
    bearingSpread: hash(slot, 31),
    cloudBase: 850 + hash(slot, 32) * 650,
    strokes,
    seed: Math.floor(hash(slot, 33) * 1e6),
  };
}

/**
 * Light of a strike `age` seconds after it began, relative to its first
 * return stroke (which peaks near 1). `reveal` is how far down the channel
 * the leader has reached, 0…1.
 */
export function strikeLight(strike: Strike, age: number): { brightness: number; reveal: number; channel: number } {
  if (age < 0 || age > STRIKE_SECONDS) return { brightness: 0, reveal: 0, channel: 0 };
  const reveal = clamp(age / LEADER_SECONDS, 0, 1);
  let brightness = age < LEADER_SECONDS ? 0.08 : 0;
  for (const stroke of strike.strokes) {
    const since = age - stroke.time;
    if (since < 0) continue;
    // A spike of a few milliseconds, then the continuing current glowing on.
    brightness += stroke.strength * (Math.exp(-since / 0.014) + 0.28 * Math.exp(-since / 0.11));
  }
  // The channel itself stays faintly lit between strokes, then is gone.
  const channel = age < LEADER_SECONDS ? 0.25 : clamp(brightness, 0, 1.6);
  return { brightness: clamp(brightness, 0, 1.6), reveal, channel };
}

/**
 * How strongly a strike at this distance lights the scene around the yacht
 * (1 for a strike close by; a few percent from the far horizon).
 */
export function strikeProximity(distance: number): number {
  const kilometres = Math.max(0, distance) / 1000;
  return 1 / (1 + kilometres * kilometres * 0.9);
}

/** Seconds after the flash that the thunder arrives, or null if out of earshot. */
export function thunderDelay(distance: number): number | null {
  return distance > THUNDER_RANGE ? null : Math.max(0, distance) / THUNDER_SPEED;
}

/** Strikes whose light can still be seen at `time` (oldest first). */
export function strikesAround(time: number, storm: number, target: Strike[] = []): Strike[] {
  target.length = 0;
  const last = Math.floor(time / LIGHTNING_SLOT);
  const first = Math.floor((time - STRIKE_SECONDS) / LIGHTNING_SLOT) - 1;
  for (let slot = Math.max(0, first); slot <= last; slot += 1) {
    const strike = strikeInSlot(slot, storm);
    if (strike && time >= strike.start && time - strike.start <= STRIKE_SECONDS) target.push(strike);
  }
  return target;
}

/** Overall brightness of lightning at `time` (0…~1.6) as seen from the yacht. */
export function lightningFlash(time: number, storm: number): number {
  let flash = 0;
  for (const strike of strikesAround(time, storm)) {
    const light = strikeLight(strike, time - strike.start);
    flash = Math.max(flash, light.brightness * (0.25 + 0.75 * strikeProximity(strike.distance)));
  }
  return clamp(flash, 0, 1.6);
}

// --- The channel ---------------------------------------------------------------

/** Most segments a bolt can have (main channel and branches together). */
export const BOLT_MAX_SEGMENTS = 176;

/**
 * A bolt's channel in its own frame: x across the view and y up, both in
 * units of the cloud-base height (the channel runs from y = 1 down to y = 0),
 * plus each segment's width, brightness and position along the channel.
 */
export type BoltShape = {
  /** Segment end points: x0, y0, x1, y1 per segment. */
  segments: Float32Array;
  /** Per segment: width (relative), brightness, along (0 top … 1 bottom), branch (0 main, 1 branch). */
  attributes: Float32Array;
  count: number;
};

export function createBoltShape(): BoltShape {
  return {
    segments: new Float32Array(BOLT_MAX_SEGMENTS * 4),
    attributes: new Float32Array(BOLT_MAX_SEGMENTS * 4),
    count: 0,
  };
}

/** A small deterministic random sequence for one bolt. */
function sequence(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Builds the channel: a tortuous main stroke that wanders as it descends
 * (lightning steps tens of metres at a time, each step a few degrees off the
 * last), and branches that fork from its upper part, die out partway down and
 * are dimmer and thinner. Fills `shape` in place.
 */
export function buildBolt(seed: number, shape: BoltShape): BoltShape {
  const random = sequence(seed);
  const gaussian = () => (random() + random() + random() - 1.5) * 1.15;
  let count = 0;
  const push = (x0: number, y0: number, x1: number, y1: number, width: number, brightness: number, along: number, branch: number) => {
    if (count >= BOLT_MAX_SEGMENTS) return;
    shape.segments.set([x0, y0, x1, y1], count * 4);
    shape.attributes.set([width, brightness, along, branch], count * 4);
    count += 1;
  };

  // Main channel.
  const steps = 64;
  const main: [number, number][] = [[0, 1]];
  let x = 0;
  let drift = gaussian() * 0.012;
  for (let step = 1; step <= steps; step += 1) {
    drift = drift * 0.6 + gaussian() * 0.022;
    x += drift + gaussian() * 0.01;
    const y = 1 - step / steps + (step < steps ? gaussian() * 0.004 : 0);
    main.push([x, Math.max(0, y)]);
  }
  for (let step = 0; step < steps; step += 1) {
    const [x0, y0] = main[step]!;
    const [x1, y1] = main[step + 1]!;
    push(x0, y0, x1, y1, 1, 1, step / steps, 0);
  }

  // Branches from the upper two thirds, angled down and out.
  const branches = 3 + Math.floor(random() * 5);
  for (let branch = 0; branch < branches; branch += 1) {
    const from = 2 + Math.floor(random() * steps * 0.62);
    let [bx, by] = main[from]!;
    const side = random() < 0.5 ? -1 : 1;
    let heading = side * (0.35 + random() * 0.6);
    const length = 8 + Math.floor(random() * 14);
    const brightness = 0.22 + random() * 0.28;
    for (let step = 0; step < length; step += 1) {
      heading += gaussian() * 0.25;
      heading = clamp(heading, -1.25, 1.25);
      const stepLength = 0.016 + random() * 0.01;
      const nx = bx + Math.sin(heading) * stepLength;
      const ny = by - Math.cos(heading) * stepLength;
      if (ny <= 0.02) break;
      const fade = 1 - step / length;
      push(bx, by, nx, ny, 0.5 * fade + 0.15, brightness * (0.4 + 0.6 * fade), (from + step) / steps, 1);
      bx = nx;
      by = ny;
      // Sub-branches: a short twig now and then.
      if (random() < 0.12 && step < length - 3) {
        let tx = bx;
        let ty = by;
        const twig = heading + side * (0.5 + random() * 0.5);
        for (let t = 0; t < 4; t += 1) {
          const ux = tx + Math.sin(twig + gaussian() * 0.3) * 0.012;
          const uy = ty - Math.cos(twig) * 0.012;
          push(tx, ty, ux, uy, 0.2, brightness * 0.5 * (1 - t / 4), (from + step + t) / steps, 1);
          tx = ux;
          ty = uy;
        }
      }
    }
  }
  shape.count = count;
  return shape;
}
