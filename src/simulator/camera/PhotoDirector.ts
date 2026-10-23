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
 * keeps the director quiet for a while. The mainsail and mast stand right
 * in that line of sight for a subject ahead, so the photographer moves to
 * one side of the rig, ahead of it, or above it whenever the rig would
 * hide the subject.
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
  /** Which stand-point was taken (see `photoShot`); kept while it stays clear, so the camera does not hop. */
  slot?: number;
};

/**
 * The yacht's rig as an occluder, in world space: a cone around the mast
 * from the boom up to the masthead, as wide at its foot as the boom is long
 * (the boom swings to either side, and the jib fills the fore-triangle).
 */
export type PhotoRig = {
  x: number;
  z: number;
  bottom: number;
  top: number;
  radius: number;
};

/** Whether the rig hides `to` from `from` (the line of sight passes through the sail cone). */
export function rigBlocksView(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  rig: PhotoRig,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return false;
  // Only the stretch of the sight line that can pass the rig needs checking.
  const reach = Math.min(length, Math.hypot(rig.x - from.x, rig.z - from.z) + rig.radius + 2);
  const height = Math.max(1e-3, rig.top - rig.bottom);
  for (let travelled = 0; travelled <= reach; travelled += 0.4) {
    const t = travelled / length;
    const y = from.y + dy * t;
    if (y < rig.bottom || y > rig.top) continue;
    const allowed = rig.radius * (1 - (y - rig.bottom) / height) + 0.6;
    if (Math.hypot(from.x + dx * t - rig.x, from.z + dz * t - rig.z) < allowed) return true;
  }
  return false;
}

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
export function photoShot(
  subject: PhotoSubject,
  yachtX: number,
  yachtY: number,
  yachtZ: number,
  out: PhotoShot,
  rig?: PhotoRig | null,
  preferredSlot = 0,
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
  out.target.x = subject.x;
  out.target.y = subject.y + subject.size * 0.12;
  out.target.z = subject.z;
  // Stand-points, in order of preference: behind the yacht; behind and to
  // either side of the rig (the subject's side first); ahead of the rig on
  // the line to the subject; high above the masthead.
  const side = rig ? rig.radius + 4.5 : 0;
  const across = rig && (subject.x - rig.x) * dz - (subject.z - rig.z) * dx >= 0 ? 1 : -1;
  const place = (slot: number): void => {
    out.position.x = yachtX - dx * back;
    out.position.y = yachtY + up;
    out.position.z = yachtZ - dz * back;
    if (!rig || slot === 0) return;
    if (slot === 1 || slot === 2) {
      const sign = slot === 1 ? across : -across;
      out.position.x += dz * side * sign;
      out.position.z -= dx * side * sign;
    } else if (slot === 3) {
      out.position.x = rig.x + dx * (rig.radius + 3.5);
      out.position.z = rig.z + dz * (rig.radius + 3.5);
      out.position.y = yachtY + Math.max(4, up * 0.6);
    } else {
      out.position.y = rig.top + 6;
    }
  };
  out.slot = 0;
  place(0);
  if (rig) {
    const order = [preferredSlot, 0, 1, 2, 3, 4];
    let found = false;
    for (const slot of order) {
      place(slot);
      if (!rigBlocksView(out.position, out.target, rig)) {
        out.slot = slot;
        found = true;
        break;
      }
    }
    if (!found) place(0);
  }
  const range = Math.hypot(out.target.x - out.position.x, out.target.y - out.position.y, out.target.z - out.position.z);
  const fov = (2 * Math.atan((subject.size * 1.9) / (2 * Math.max(range, 1))) * 180) / Math.PI;
  out.fov = Math.min(58, Math.max(8, fov));
  return out;
}
