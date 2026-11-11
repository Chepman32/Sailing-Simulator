/**
 * Thunder as it physically comes about (after Few 1969 and Ribner & Roy
 * 1982): the lightning channel is a tortuous line kilometres long, and every
 * few metres of it, heated in a microsecond, sends out a shock that has
 * become an N-wave (a pressure jump up, a straight fall, a jump back) a few
 * milliseconds long by the time it reaches the listener. Each piece is
 * heard from where it is: the near ones first, the far top of the channel
 * and its branches in the cloud seconds later, so one strike is heard as a
 * crack, a crash and a long roll. A piece radiates mostly square to itself,
 * so the pieces that happen to lie across the line of sight are the loud
 * claps in the rumble, the ones pointing at the listener almost silent.
 *
 * Far off, the air takes the high notes: every N-wave is rounded off more
 * with distance (and widened, the shock slowing as it weakens), so a close
 * strike is a tearing crack with real treble and a distant one only a low
 * rolling grumble. The sea mirrors every piece once more (an image source),
 * which thickens the roll.
 *
 * Pure: samples in, nothing played (`AudioSystem.thunder` plays them).
 */

export type ThunderShape = {
  /** Horizontal distance to where the bolt meets the sea, m. */
  distance: number;
  /** Where that is across the view: −1 left … 1 right. */
  pan: number;
  /** Height of the cloud base the channel comes down from, m (default 1500 … 3000). */
  cloudBase?: number;
};

export type ThunderSamples = {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Seconds from the flash to the first sound in the buffer (start the buffer then). */
  arrival: number;
};

/** The speed of sound in air, m/s. */
const SOUND_SPEED = 343;
/** Length of one piece of the channel, m. */
const PIECE = 9;
/** Longest the buffer runs after the first arrival, s. */
const MAX_LENGTH = 14;

type Piece = { x: number; y: number; z: number; dx: number; dy: number; dz: number; length: number; energy: number };

/**
 * A random walk of up to `count` pieces from (x, y, z) heading roughly along
 * `course`, each turned from the last by about the tortuosity real channels
 * show (a mean of about 16°), kept from wandering off its course. Given a
 * `target`, the course is toward it at every step (and the walk ends there,
 * or at the sea).
 */
function walk(
  pieces: Piece[],
  random: () => number,
  start: { x: number; y: number; z: number },
  initial: { x: number; y: number; z: number },
  count: number,
  energy: number,
  target?: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  let { x, y, z } = start;
  const course = { ...initial };
  let dx = course.x;
  let dy = course.y;
  let dz = course.z;
  for (let index = 0; index < count; index += 1) {
    if (target) {
      const tx = target.x - x;
      const ty = target.y - y;
      const tz = target.z - z;
      const left = Math.hypot(tx, ty, tz);
      if (left < PIECE) break;
      course.x = tx / left;
      course.y = ty / left;
      course.z = tz / left;
    }
    // A kink: a random turn, then pulled back toward the course.
    const turn = 0.28 + random() * 0.32;
    dx += (random() * 2 - 1) * turn + (course.x - dx) * 0.22;
    dy += (random() * 2 - 1) * turn + (course.y - dy) * 0.22;
    dz += (random() * 2 - 1) * turn + (course.z - dz) * 0.22;
    const norm = Math.hypot(dx, dy, dz) || 1;
    dx /= norm;
    dy /= norm;
    dz /= norm;
    const length = PIECE * (0.6 + random() * 0.8);
    pieces.push({ x: x + dx * length * 0.5, y: y + dy * length * 0.5, z: z + dz * length * 0.5, dx, dy, dz, length, energy });
    x += dx * length;
    y += dy * length;
    z += dz * length;
    if (y < 0) break;
  }
  return { x, y, z };
}

/** The channel: the leader down to the sea, a few branches off it, and a spread of discharge along the cloud base. */
export function thunderChannel(shape: ThunderShape, random: () => number): Piece[] {
  const pieces: Piece[] = [];
  const base = shape.cloudBase ?? 1500 + random() * 1500;
  const side = Math.max(-1, Math.min(1, shape.pan));
  // The listener is at the origin looking down +z; the strike point on the sea.
  const groundX = shape.distance * side;
  const groundZ = shape.distance * Math.sqrt(Math.max(0, 1 - side * side));
  // The main channel, walked from the cloud down.
  const top = { x: groundX + (random() - 0.5) * base * 0.5, y: base, z: groundZ + (random() - 0.5) * base * 0.5 };
  const toGround = { x: groundX - top.x, y: -base, z: groundZ - top.z };
  const span = Math.hypot(toGround.x, toGround.y, toGround.z);
  const course = { x: toGround.x / span, y: toGround.y / span, z: toGround.z / span };
  const before = pieces.length;
  walk(pieces, random, top, course, Math.ceil((span / PIECE) * 3), 1, { x: groundX, y: 0, z: groundZ });
  // Branches: weaker, from points along the upper two thirds, angling down and out.
  const branches = 2 + Math.floor(random() * 4);
  const mainPieces = pieces.length - before;
  for (let branch = 0; branch < branches; branch += 1) {
    const from = pieces[before + Math.floor(random() * mainPieces * 0.66)]!;
    const angle = random() * Math.PI * 2;
    const out = { x: Math.cos(angle) * 0.7 + from.dx * 0.3, y: -0.55 - random() * 0.3, z: Math.sin(angle) * 0.7 + from.dz * 0.3 };
    const norm = Math.hypot(out.x, out.y, out.z);
    walk(pieces, random, from, { x: out.x / norm, y: out.y / norm, z: out.z / norm }, Math.floor(15 + random() * 60), 0.35 + random() * 0.25);
  }
  // The discharge spreads through the cloud base: long, roughly level, a little weaker.
  const spreads = 1 + Math.floor(random() * 3);
  for (let spread = 0; spread < spreads; spread += 1) {
    const angle = random() * Math.PI * 2;
    walk(pieces, random, top, { x: Math.cos(angle), y: (random() - 0.5) * 0.15, z: Math.sin(angle) }, Math.floor(80 + random() * 220), 0.5 + random() * 0.3);
  }
  return pieces;
}

/**
 * Adds one N-wave arriving at `at` seconds: up to +1 over `rise`, down to
 * −1 over `width`, back to 0 over `rise`, scaled by `left`/`right`.
 */
function addNWave(left: Float32Array, right: Float32Array, rate: number, at: number, width: number, rise: number, gainLeft: number, gainRight: number): void {
  const start = Math.floor(at * rate);
  const riseSamples = Math.max(1, rise * rate);
  const widthSamples = Math.max(2, width * rate);
  const total = Math.ceil(riseSamples * 2 + widthSamples);
  const end = Math.min(left.length, start + total);
  for (let index = Math.max(0, start); index < end; index += 1) {
    const t = index - start;
    let value: number;
    if (t < riseSamples) value = t / riseSamples;
    else if (t < riseSamples + widthSamples) value = 1 - (2 * (t - riseSamples)) / widthSamples;
    else value = -1 + (t - riseSamples - widthSamples) / riseSamples;
    left[index]! += value * gainLeft;
    right[index]! += value * gainRight;
  }
}

/**
 * The thunder of one strike, as heard at the origin (stereo, normalised to a
 * peak of about 0.9), and the time from the flash to its first sound.
 */
export function synthesizeThunder(shape: ThunderShape, sampleRate: number, random: () => number = Math.random): ThunderSamples {
  const pieces = thunderChannel(shape, random);
  const ear = 1.7;
  let first = Infinity;
  const arrivals = new Float32Array(pieces.length * 2);
  const ranges = new Float32Array(pieces.length * 2);
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const direct = Math.hypot(piece.x, piece.y - ear, piece.z);
    // The sea's mirror image of the piece.
    const mirrored = Math.hypot(piece.x, piece.y + ear, piece.z);
    ranges[index * 2] = direct;
    ranges[index * 2 + 1] = mirrored;
    arrivals[index * 2] = direct / SOUND_SPEED;
    arrivals[index * 2 + 1] = mirrored / SOUND_SPEED;
    first = Math.min(first, arrivals[index * 2]!);
  }
  const lastWanted = Math.min(first + MAX_LENGTH, Math.max(...arrivals) + 0.4);
  const length = Math.ceil((lastWanted - first + 0.25) * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    for (let image = 0; image < 2; image += 1) {
      const range = ranges[index * 2 + image]!;
      const at = arrivals[index * 2 + image]! - first;
      if (at > MAX_LENGTH) continue;
      // Line of sight from the piece to the ear (the image: y mirrored).
      const sy = image === 0 ? piece.y - ear : -(piece.y + ear);
      const cosine = Math.abs((piece.x * piece.dx + sy * piece.dy * (image === 0 ? 1 : -1) + piece.z * piece.dz) / range);
      // Radiated square to the piece; a lobe as wide as the wavelength over the piece's length.
      const width = Math.min(0.03, 0.0075 * Math.pow(Math.max(range, 30) / 100, 0.25));
      const wavelength = SOUND_SPEED * width;
      const lobe = Math.exp(-Math.pow((cosine * piece.length) / wavelength, 2) * 0.9);
      // A shock weakens with range a little faster than 1/r near the channel.
      const amplitude = (piece.energy * (0.22 + lobe) * piece.length) / Math.pow(range, 1.08) * (image === 0 ? 1 : 0.72);
      // The air rounds the jumps off with distance (the treble lost first).
      const rise = 0.00012 + range * 1.6e-6;
      // Heard from its side: equal-power pan.
      const across = Math.max(-1, Math.min(1, piece.x / Math.max(1, Math.hypot(piece.x, piece.z))));
      const angle = ((across + 1) * Math.PI) / 4;
      addNWave(left, right, sampleRate, at, width, rise, amplitude * Math.cos(angle), amplitude * Math.sin(angle));
    }
  }
  // The ear's (and any recording's) own compression: the loudest claps are
  // held down against the roll, about 2:1 over a running 60 ms level, so a
  // close strike is a crack and then a long roar, not one click and a hush.
  compress(left, right, sampleRate);
  // To a common peak (the player's distance sets the level when it is played).
  let peak = 1e-9;
  for (let index = 0; index < length; index += 1) peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  const scale = 0.9 / peak;
  for (let index = 0; index < length; index += 1) {
    left[index]! *= scale;
    right[index]! *= scale;
  }
  return { left, right, sampleRate, arrival: first };
}

/**
 * Evens the level out (about 2.5:1 above the buffer's mean level), against
 * a level that looks both ways (a one-pole smoother run forward and back),
 * so even the first crack is caught, not let through.
 */
function compress(left: Float32Array, right: Float32Array, rate: number): void {
  const length = left.length;
  const level = new Float32Array(length);
  const pole = Math.exp(-1 / (0.025 * rate));
  let running = 0;
  for (let index = 0; index < length; index += 1) {
    running = pole * running + (1 - pole) * Math.max(Math.abs(left[index]!), Math.abs(right[index]!));
    level[index] = running;
  }
  running = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    running = pole * running + (1 - pole) * level[index]!;
    level[index] = running;
  }
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += level[index]!;
  const reference = (sum / Math.max(1, length)) * 1.8 + 1e-12;
  for (let index = 0; index < length; index += 1) {
    const over = level[index]! / reference;
    const gain = over > 1 ? Math.pow(over, -0.6) : 1;
    left[index]! *= gain;
    right[index]! *= gain;
  }
}

/**
 * The thunder's echo off the cloud base and the sea: a few seconds of
 * noise, dense from the start and dying away, darker as it goes. One
 * impulse response for every strike (for a ConvolverNode).
 */
export function thunderReverb(sampleRate: number, seconds = 3.6, random: () => number = Math.random): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.ceil(seconds * sampleRate);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  for (const data of channels) {
    let low = 0;
    for (let index = 0; index < length; index += 1) {
      const t = index / sampleRate;
      // Darker as it goes: a one-pole low-pass whose corner falls with time.
      const pole = Math.exp((-2 * Math.PI * (2200 * Math.exp(-t * 1.1) + 120)) / sampleRate);
      low = low * pole + (random() * 2 - 1) * (1 - pole);
      data[index] = low * Math.exp(-t * 1.9) * (1 - Math.exp(-t * 60));
    }
  }
  return channels;
}
