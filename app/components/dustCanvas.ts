import { createDust, grainLook, stepDust } from "./dustMath";
import type { PillSnapshot } from "./SoundPrompt";

/**
 * Plays a painted pill's dissolve into fine dust on `canvas` (a full-window
 * overlay): the grains are cut from the picture, released by a wave from left
 * to right and carried toward `target()` (page coordinates, asked each frame
 * so a moving target is followed), fading as they go. `onDone` runs once the
 * last grain has gone. Returns a function that stops the animation early.
 * Shared by the sound prompt and the action notices.
 */
export function animateDust(
  canvas: HTMLCanvasElement,
  snapshot: PillSnapshot,
  target: () => { x: number; y: number },
  onDone: () => void,
): () => void {
  const context = canvas.getContext("2d");
  if (!context) {
    onDone();
    return () => undefined;
  }
  const ratio = snapshot.ratio;
  canvas.width = Math.ceil(window.innerWidth * ratio);
  canvas.height = Math.ceil(window.innerHeight * ratio);
  const pixels = snapshot.picture.getContext("2d")!.getImageData(0, 0, snapshot.picture.width, snapshot.picture.height);
  const palette: string[] = [];
  const paletteIndex = new Map<number, number>();
  const dust = createDust(snapshot.left, snapshot.top, snapshot.width, snapshot.height, (x, y) => {
    const px = Math.min(pixels.width - 1, Math.floor(x * ratio));
    const py = Math.min(pixels.height - 1, Math.floor(y * ratio));
    const offset = (py * pixels.width + px) * 4;
    if (pixels.data[offset + 3]! < 90) return -1;
    // Colours quantised to 5 bits a channel keep the palette small.
    const key = ((pixels.data[offset]! >> 3) << 10) | ((pixels.data[offset + 1]! >> 3) << 5) | (pixels.data[offset + 2]! >> 3);
    let index = paletteIndex.get(key);
    if (index === undefined) {
      index = palette.length;
      paletteIndex.set(key, index);
      palette.push(`rgb(${pixels.data[offset]},${pixels.data[offset + 1]},${pixels.data[offset + 2]})`);
    }
    return index;
  });
  // Grains are drawn grouped by colour, so the fill colour changes rarely.
  const order = Array.from({ length: dust.count }, (_, index) => index).sort((a, b) => dust.colour[a]! - dust.colour[b]!);
  let frame = 0;
  let last = performance.now();
  let time = 0;
  let finished = false;
  const draw = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    time += dt;
    const goal = target();
    const visible = stepDust(dust, dt, goal.x, goal.y, time);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let colour = -1;
    for (const index of order) {
      const age = dust.age[index]!;
      const life = dust.life[index]!;
      if (age >= life) continue;
      const look = grainLook(age, life);
      if (dust.colour[index] !== colour) {
        colour = dust.colour[index]!;
        context.fillStyle = palette[colour]!;
      }
      context.globalAlpha = look.alpha;
      // Grains still in the picture overlap a hair, so it shows no seams before the wave reaches it.
      const size = age < 0 ? dust.size + 0.6 : dust.size * look.scale;
      context.fillRect(dust.x[index]!, dust.y[index]!, size, size);
    }
    context.globalAlpha = 1;
    if (visible === 0) {
      finished = true;
      onDone();
      return;
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    if (!finished) context.clearRect(0, 0, canvas.width, canvas.height);
  };
}
