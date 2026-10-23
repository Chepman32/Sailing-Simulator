/**
 * The photographer of photo mode.
 *
 * With the controls hidden the player is watching, so when something worth
 * a picture happens — a whale breaching on the horizon, a whale surfacing or
 * slapping its tail, dolphins leaping, a shark's fin, a ship sounding its
 * horn, a volcano erupting — the camera turns to it by itself and zooms in, holds the shot for a
 * few seconds, and eases back to the yacht. It stands where a photographer
 * on board would: just behind and above the yacht, looking past her at the
 * subject, so a near subject has the yacht in the foreground and a far one
 * is brought close by the lens. A look-around by the player always wins and
 * keeps the director quiet for a while.
 *
 * Pure numbers; `CameraController.direct` applies the shot.
 */

export type PhotoSubjectKind = "eruption" | "breach" | "whale" | "horn" | "shark" | "dolphins";

export type PhotoSubject = {
  kind: PhotoSubjectKind;
  x: number;
  y: number;
  z: number;
  /** Rough size of what should fill the frame, metres. */
  size: number;
};

/** Which subject wins when two happen at once. */
export const PHOTO_PRIORITY: Record<PhotoSubjectKind, number> = {
  eruption: 6,
  breach: 5,
  whale: 4,
  horn: 3,
  shark: 2,
  dolphins: 1,
};

/** Longest a subject holds the camera, seconds. */
export const PHOTO_HOLD: Record<PhotoSubjectKind, number> = {
  eruption: 10,
  breach: 9,
  whale: 9,
  horn: 6,
  shark: 7,
  dolphins: 6,
};

/** Seconds the camera takes to swing to a subject or back. */
export const PHOTO_EASE = 1.1;
/** Quiet time after a shot before the next subject of the same or lower rank. */
export const PHOTO_COOLDOWN = 3;
/** Quiet time after the player looks around by hand. */
export const PHOTO_USER_PAUSE = 8;
/** Beyond this the subject is too far to be worth a shot, metres. */
export const PHOTO_RANGE = 1600;
/** An eruption is worth a shot from much farther away. */
export const ERUPTION_PHOTO_RANGE = 2600;

export type PhotoShot = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  /** Vertical field of view, degrees. */
  fov: number;
};

export class PhotoDirector {
  enabled = false;
  subject: PhotoSubject | null = null;
  /** 0 the normal camera … 1 fully on the subject. */
  weight = 0;
  private held = 0;
  private cooldown = 0;
  private pause = 0;
  private lastRank = 0;
  private seenThisFrame = false;
  /** Seconds since the current subject was last offered. */
  private unseen = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.subject = null;
      this.held = 0;
      this.cooldown = 0;
      this.pause = 0;
    }
  }

  /** The player looked around or zoomed by hand: let go, and stay quiet a while. */
  userLooked(): void {
    this.subject = null;
    this.pause = PHOTO_USER_PAUSE;
  }

  /**
   * Something worth a shot, this frame. A subject already being filmed is
   * tracked (its position updated); a new one is taken if it outranks the
   * current one, or if the camera is free and not cooling down.
   */
  offer(subject: PhotoSubject, viewerX: number, viewerZ: number): void {
    if (!this.enabled || this.pause > 0) return;
    const range = subject.kind === "eruption" ? ERUPTION_PHOTO_RANGE : PHOTO_RANGE;
    if (Math.hypot(subject.x - viewerX, subject.z - viewerZ) > range) return;
    const rank = PHOTO_PRIORITY[subject.kind];
    const current = this.subject;
    if (current && current.kind === subject.kind) {
      current.x = subject.x;
      current.y = subject.y;
      current.z = subject.z;
      current.size = subject.size;
      this.seenThisFrame = true;
      return;
    }
    if (current && rank <= PHOTO_PRIORITY[current.kind]) return;
    if (!current && this.cooldown > 0 && rank <= this.lastRank) return;
    this.subject = { ...subject };
    this.held = 0;
    this.unseen = 0;
    this.lastRank = rank;
    this.seenThisFrame = true;
  }

  /** Advances the timers; call once a frame after the offers. */
  update(delta: number): void {
    const dt = Math.max(0, Math.min(delta, 0.1));
    this.pause = Math.max(0, this.pause - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const subject = this.subject;
    if (subject) {
      this.held += dt;
      this.unseen = this.seenThisFrame ? 0 : this.unseen + dt;
      // Held for its time, or over (no longer offered) for a moment: let go.
      // (A horn is a single event: its shot is held for its full time.)
      const over = subject.kind !== "horn" && subject.kind !== "eruption" && this.unseen > 1.4;
      if (this.held >= PHOTO_HOLD[subject.kind] || over || !this.enabled) {
        this.subject = null;
        this.cooldown = PHOTO_COOLDOWN;
      }
    }
    this.seenThisFrame = false;
    const goal = this.subject ? 1 : 0;
    const step = dt / PHOTO_EASE;
    this.weight = goal > this.weight ? Math.min(goal, this.weight + step) : Math.max(goal, this.weight - step);
  }

  /** Eased weight for blending (slow in, slow out). */
  get blend(): number {
    const t = this.weight;
    return t * t * (3 - 2 * t);
  }
}

/**
 * Box around the hulls, mast and both sails in yacht space (x across, y up,
 * z along the bow), generous enough to cover the boom at any sheet angle. A
 * camera whose sight line to the subject crosses it could have the subject
 * hidden behind canvas.
 */
export const YACHT_BOX = { minX: -3.7, maxX: 3.7, minY: -1.1, maxY: 8.6, minZ: -5, maxZ: 4.9 } as const;

type Vec3 = { x: number; y: number; z: number };

/** Whether the segment a→b (yacht space) passes through the yacht box (slab test). */
export function segmentHitsYachtBox(a: Vec3, b: Vec3): boolean {
  let tMin = 0;
  let tMax = 1;
  const axes: Array<[keyof Vec3, number, number]> = [
    ["x", YACHT_BOX.minX, YACHT_BOX.maxX],
    ["y", YACHT_BOX.minY, YACHT_BOX.maxY],
    ["z", YACHT_BOX.minZ, YACHT_BOX.maxZ],
  ];
  for (const [axis, low, high] of axes) {
    const origin = a[axis];
    const direction = b[axis] - origin;
    if (Math.abs(direction) < 1e-9) {
      if (origin < low || origin > high) return false;
      continue;
    }
    let t1 = (low - origin) / direction;
    let t2 = (high - origin) / direction;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

/** A world point in yacht space (the yacht turned by `heading` about the vertical; her pitch and roll are small). */
export function toYachtSpace(x: number, y: number, z: number, yachtX: number, yachtY: number, yachtZ: number, heading: number, out: Vec3): Vec3 {
  const dx = x - yachtX;
  const dz = z - yachtZ;
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);
  out.x = dx * cosine - dz * sine;
  out.y = y - yachtY;
  out.z = dx * sine + dz * cosine;
  return out;
}

/** True if the yacht (rig and sails included) stands between the camera and the subject. */
export function yachtBlocksSight(camera: Vec3, subject: Vec3, yachtX: number, yachtY: number, yachtZ: number, heading: number): boolean {
  const from = toYachtSpace(camera.x, camera.y, camera.z, yachtX, yachtY, yachtZ, heading, { x: 0, y: 0, z: 0 });
  const to = toYachtSpace(subject.x, subject.y, subject.z, yachtX, yachtY, yachtZ, heading, { x: 0, y: 0, z: 0 });
  return segmentHitsYachtBox(from, to);
}

/** Camera offsets tried, in order of preference: how far back, and how many degrees round the yacht. */
const SHOT_BACKS = [1, 1.7, 2.6] as const;
const SHOT_TURNS = [0, 28, -28, 56, -56, 84, -84, 112, -112, 140, -140, 180] as const;

/**
 * Where to stand and what to look at for `subject`, from a yacht at
 * (yachtX, yachtY, yachtZ): just behind her on the line to the subject,
 * a few metres up, and a lens that makes the subject fill about half the
 * height of the frame. Given the yacht's `heading`, the camera is moved
 * round her (and back) until her mast and sails are not between it and the
 * subject, so a whale or a ship is never hidden behind canvas.
 */
export function photoShot(
  subject: PhotoSubject,
  yachtX: number,
  yachtY: number,
  yachtZ: number,
  out: PhotoShot,
  heading?: number,
): PhotoShot {
  let dx = subject.x - yachtX;
  let dz = subject.z - yachtZ;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 1e-3) {
    dx = 0;
    dz = 1;
  } else {
    dx /= horizontal;
    dz /= horizontal;
  }
  // Close subjects (dolphins at the bow) are seen from a little farther back and higher.
  const back = horizontal < 40 ? 14 : 10;
  const up = 5.5 + Math.min(horizontal * 0.012, 9) + (horizontal < 40 ? 4 : 0);
  const targetX = subject.x;
  const targetY = subject.y + subject.size * 0.12;
  const targetZ = subject.z;
  let x = yachtX - dx * back;
  let y = yachtY + up;
  let z = yachtZ - dz * back;
  if (heading !== undefined) {
    const sight = { x: targetX, y: targetY, z: targetZ };
    const camera = { x, y, z };
    let found = false;
    search: for (const stretch of SHOT_BACKS) {
      for (const turn of SHOT_TURNS) {
        const angle = (turn * Math.PI) / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        // Swing the "behind her" offset round the yacht, then push it out.
        const offsetX = -dx * cosine + dz * sine;
        const offsetZ = -dz * cosine - dx * sine;
        camera.x = yachtX + offsetX * back * stretch;
        camera.z = yachtZ + offsetZ * back * stretch;
        camera.y = yachtY + up;
        if (!yachtBlocksSight(camera, sight, yachtX, yachtY, yachtZ, heading)) {
          found = true;
          break search;
        }
      }
    }
    if (found) {
      x = camera.x;
      y = camera.y;
      z = camera.z;
    }
  }
  out.position.x = x;
  out.position.y = y;
  out.position.z = z;
  out.target.x = targetX;
  out.target.y = targetY;
  out.target.z = targetZ;
  const range = Math.hypot(out.target.x - out.position.x, out.target.y - out.position.y, out.target.z - out.position.z);
  const fov = (2 * Math.atan((subject.size * 1.9) / (2 * Math.max(range, 1))) * 180) / Math.PI;
  out.fov = Math.min(58, Math.max(8, fov));
  return out;
}
