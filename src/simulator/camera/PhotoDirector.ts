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
 * Where to stand and what to look at for `subject`, from a yacht at
 * (yachtX, yachtY, yachtZ): just behind her on the line to the subject,
 * a few metres up, and a lens that makes the subject fill about half the
 * height of the frame.
 */
export function photoShot(subject: PhotoSubject, yachtX: number, yachtY: number, yachtZ: number, out: PhotoShot): PhotoShot {
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
  out.position.x = yachtX - dx * back;
  out.position.y = yachtY + up;
  out.position.z = yachtZ - dz * back;
  out.target.x = subject.x;
  out.target.y = subject.y + subject.size * 0.12;
  out.target.z = subject.z;
  const range = Math.hypot(out.target.x - out.position.x, out.target.y - out.position.y, out.target.z - out.position.z);
  const fov = (2 * Math.atan((subject.size * 1.9) / (2 * Math.max(range, 1))) * 180) / Math.PI;
  out.fov = Math.min(58, Math.max(8, fov));
  return out;
}
