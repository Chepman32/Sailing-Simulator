/**
 * The menus' own small sounds, synthesised (nothing to download): a soft
 * tick as the highlight moves from one item to the next, and a low, rounded
 * two-note chime when one is chosen. Quiet on purpose: under the sea and
 * the music, felt more than heard.
 *
 * The browser lets sound start only after a gesture; the first key press
 * or click on the menu is one, so the context is made (or woken) then.
 */

let context: AudioContext | null = null;
let enabled = true;
let lastTick = 0;

/** Off with the game's sound. */
export function setMenuSoundEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  try {
    context ??= new Constructor();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context.state === "closed" ? null : context;
  } catch {
    return null;
  }
}

/** One soft voice: a sine gliding from `from` to `to` Hz, through a gentle low-pass, with a quick swell and a long fade. */
function voice(ctx: AudioContext, at: number, from: number, to: number, length: number, level: number): void {
  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(from, at);
  oscillator.frequency.exponentialRampToValueAtTime(to, at + length * 0.8);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2600;
  filter.Q.value = 0.4;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(filter).connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
}

/** The highlight moved to another item. */
export function menuTick(): void {
  const now = performance.now();
  // A burst of moves (a key held down) ticks at most every 45 ms.
  if (now - lastTick < 45) return;
  lastTick = now;
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime + 0.005;
  voice(ctx, at, 1480, 1180, 0.055, 0.022);
  voice(ctx, at, 2960, 2400, 0.03, 0.006);
}

/** An item chosen. */
export function menuSelect(): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime + 0.005;
  voice(ctx, at, 660, 640, 0.16, 0.03);
  voice(ctx, at + 0.06, 990, 960, 0.22, 0.024);
}

/** Back a page. */
export function menuBack(): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime + 0.005;
  voice(ctx, at, 740, 700, 0.12, 0.024);
  voice(ctx, at + 0.05, 520, 500, 0.18, 0.02);
}
