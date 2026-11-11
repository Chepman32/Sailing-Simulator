import type { Cutscene, Shot, ShotPoint } from "./StoryTypes";

/**
 * Cut scenes in numbers: where the camera is and what it looks at, at any
 * moment of a scene, from the shots' anchors (the yacht, her helm, the
 * skipper, a drone, a person, a place). Pure: the anchors' frames come in
 * from outside.
 *
 * An anchor's frame: a point and a heading (forward is (sin h, cos h) on
 * x, z; "right" in an offset is the frame's +right, (cos h, −sin h)).
 */

export type AnchorFrame = { x: number; y: number; z: number; heading: number };

export type CameraPose = { eye: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; fov: number };

export function ease(kind: Shot["ease"], t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case "in":
      return x * x * x;
    case "out":
      return 1 - Math.pow(1 - x, 3);
    case "inOut":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    default:
      return x;
  }
}

/** A shot point in the world, or null when its anchor is not there (a drone not yet out). */
export function pointOf(point: ShotPoint, frame: (anchor: string) => AnchorFrame | null): { x: number; y: number; z: number } | null {
  const base = frame(point.anchor);
  if (!base) return null;
  const [right, up, ahead] = point.offset ?? [0, 0, 0];
  const sin = Math.sin(base.heading);
  const cos = Math.cos(base.heading);
  return {
    x: base.x + sin * ahead + cos * right,
    y: base.y + up,
    z: base.z + cos * ahead - sin * right,
  };
}

/** Where shot `index` is, `time` seconds into the scene; `index` −1 when the scene has run out (unless it holds). */
export function shotAt(scene: Cutscene, time: number): { index: number; local: number; progress: number } {
  let start = 0;
  for (let index = 0; index < scene.shots.length; index += 1) {
    const shot = scene.shots[index]!;
    if (time < start + shot.seconds) return { index, local: time - start, progress: (time - start) / shot.seconds };
    start += shot.seconds;
  }
  if (scene.hold && scene.shots.length > 0) return { index: scene.shots.length - 1, local: time - start, progress: 1 };
  return { index: -1, local: 0, progress: 1 };
}

export function sceneLength(scene: Cutscene): number {
  return scene.shots.reduce((sum, shot) => sum + shot.seconds, 0);
}

/** A small unsteadiness, as a camera held by hand on a moving deck: smooth, never jittery. */
function wobble(time: number, seed: number): number {
  return Math.sin(time * 1.7 + seed) * 0.6 + Math.sin(time * 3.1 + seed * 2.3) * 0.3 + Math.sin(time * 7.3 + seed * 0.7) * 0.1;
}

/**
 * The camera for a shot at `progress` (0…1) and absolute `time` (for the
 * shake), from the anchors' frames; null if an anchor is missing. Each end
 * of the move is computed from where its anchors are now, so a camera tied
 * to a moving yacht moves with her.
 */
export function cameraFor(shot: Shot, progress: number, time: number, frame: (anchor: string) => AnchorFrame | null): CameraPose | null {
  const from = shot.from;
  const to = shot.to ?? shot.from;
  const t = ease(shot.ease, progress);
  const eyeA = pointOf(from.eye, frame);
  const lookA = pointOf(from.look, frame);
  const eyeB = pointOf(to.eye, frame) ?? eyeA;
  const lookB = pointOf(to.look, frame) ?? lookA;
  if (!eyeA || !lookA || !eyeB || !lookB) return null;
  const mix = (a: number, b: number) => a + (b - a) * t;
  const shake = (shot.shake ?? 0) * 0.35;
  const fovA = from.fov ?? 45;
  const fovB = to.fov ?? fovA;
  return {
    eye: { x: mix(eyeA.x, eyeB.x), y: mix(eyeA.y, eyeB.y), z: mix(eyeA.z, eyeB.z) },
    look: {
      x: mix(lookA.x, lookB.x) + wobble(time, 1.3) * shake,
      y: mix(lookA.y, lookB.y) + wobble(time, 4.1) * shake * 0.7,
      z: mix(lookA.z, lookB.z) + wobble(time, 2.9) * shake,
    },
    fov: mix(fovA, fovB),
  };
}
