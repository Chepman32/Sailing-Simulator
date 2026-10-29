import { clamp } from "../math";
import type { SimulatorControls } from "../types";

/**
 * Sign of the physics rudder for a starboard (right) helm.
 *
 * The simulation runs in the renderer's right-handed frame with the bow
 * along +Z, where world +X lies on the LEFT of the view (see
 * `chartProject`): a positive `controls.rudder` turns the yacht toward +X,
 * that is to port. Every helm input in the player's terms (wheel, slider,
 * keys, gamepad: right means starboard) is converted here, and the HUD
 * converts back, so "right" turns the yacht to the right of the screen.
 */
export const HELM_STARBOARD = -1;

/** Physics rudder (−1…1) for a helm command in the player's terms (+1 = hard to starboard). */
export function rudderFromHelm(helm: number): number {
  return clamp(helm, -1, 1) * HELM_STARBOARD;
}

/** Helm command in the player's terms (+1 = hard to starboard) for a physics rudder. */
export function helmFromRudder(rudder: number): number {
  return rudder * HELM_STARBOARD;
}

/** Keys the simulator steers and drives with. */
const DRIVING_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyC", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];

/** Helm travel a second while a steering key is held, and the rate the helm returns by itself. */
export const KEY_HELM_RATE = 2.4;
export const HELM_RETURN_RATE = 4;

/**
 * The helm returning to the centre once it is let go: at
 * `HELM_RETURN_RATE` per second, never past zero.
 */
export function returnHelm(rudder: number, delta: number): number {
  const step = HELM_RETURN_RATE * Math.max(0, delta);
  return Math.abs(rudder) <= step ? 0 : rudder - Math.sign(rudder) * step;
}

export type InputHooks = {
  /** The engine is running (W/S then drive the throttle). */
  engineRunning: () => boolean;
  /** Start the engine: pressing W with it stopped does that first. */
  startEngine: () => void;
};

/**
 * Whether a key press belongs to the focused element rather than the helm.
 * Only text entry is left alone: after a click on any button or on the
 * rudder or throttle slider the keyboard still steers and drives. The
 * sliders' own arrow keys are taken over too: left to the browser they moved
 * the helm one notch per press (and only while that slider had the focus),
 * which felt like the keys stuck or stuttered.
 */
export function keyBelongsToElement(target: EventTarget | null, code: string): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    if (target.type === "range") return false;
    if (target.type === "checkbox" || target.type === "radio" || target.type === "button") return code === "Space";
    return true;
  }
  // A focused button is pressed by Space; arrows and letters still steer.
  return target instanceof HTMLButtonElement && (code === "Space" || code === "Enter");
}

export class InputController {
  private readonly keys = new Set<string>();
  /** The helm returns to the centre by itself when it is let go (a setting, off by default). */
  autoCenter = false;
  /**
   * Gamepads are only listened to once one has been used: some laptops and
   * phones expose a sensor or a virtual pad whose axes rest off-centre, and
   * read blindly they turned the helm by themselves, fighting the keys.
   */
  private readonly gamepadRest = new Map<number, number[]>();
  private gamepadArmed = false;
  /** The helm has been let go after keys or the slider moved it, and is on its way back. */
  private returning = false;

  constructor(
    private readonly controls: SimulatorControls,
    private readonly hooks: InputHooks,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  update(delta: number): void {
    const steering = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const throttle = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) -
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const sheet = (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
    if (steering !== 0) {
      this.controls.rudder = clamp(this.controls.rudder + HELM_STARBOARD * steering * delta * KEY_HELM_RATE, -1, 1);
      this.returning = this.autoCenter;
    } else if (this.returning && this.autoCenter) {
      // Let go: the helm comes back amidships by itself, as a balanced wheel does.
      this.controls.rudder = returnHelm(this.controls.rudder, delta);
      if (this.controls.rudder === 0) this.returning = false;
    }
    if (throttle !== 0) this.controls.throttle = clamp(this.controls.throttle + throttle * delta * 0.55, -1, 1);
    if (sheet !== 0) this.controls.sailTrim = clamp(this.controls.sailTrim + sheet * delta * 0.35, 0.2, 1);
    this.updateGamepad(delta);
  }

  /** @param helm the helm in the player's terms: +1 hard to starboard (right). */
  setRudder(helm: number): void {
    this.controls.rudder = rudderFromHelm(helm);
    this.returning = false;
  }

  /** The player let go of the helm (slider or wheel released): it returns if auto-centre is on. */
  releaseRudder(): void {
    this.returning = this.autoCenter;
  }

  centerRudder(): void {
    this.controls.rudder = 0;
    this.returning = false;
  }

  setThrottle(value: number): void {
    this.controls.throttle = clamp(value, -1, 1);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (keyBelongsToElement(event.target, event.code)) return;
    if (DRIVING_KEYS.includes(event.code)) event.preventDefault();
    if (event.code === "Space" || event.code === "KeyC") this.centerRudder();
    // Throttle up with the engine stopped: start it first (the obvious wish).
    if ((event.code === "KeyW" || event.code === "ArrowUp") && !event.repeat && !this.hooks.engineRunning()) this.hooks.startEngine();
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  // A key released while another window had the focus never sends keyup:
  // forget everything held, or the helm keeps turning by itself.
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  private updateGamepad(delta: number): void {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let gamepad: Gamepad | null = null;
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.axes.length < 2) continue;
      const rest = this.gamepadRest.get(pad.index);
      if (!rest) {
        this.gamepadRest.set(pad.index, pad.axes.slice(0, 2));
        continue;
      }
      // Armed by a press, or by a stick moved well away from where it rested.
      if (!this.gamepadArmed && (pad.buttons.some((button) => button.pressed) || pad.axes.slice(0, 2).some((axis, index) => Math.abs(axis - rest[index]!) > 0.35))) {
        this.gamepadArmed = true;
      }
      if (this.gamepadArmed && pad.mapping === "standard") {
        gamepad = pad;
        break;
      }
      if (this.gamepadArmed) gamepad ??= pad;
    }
    if (!gamepad) return;
    const rudderAxis = Math.abs(gamepad.axes[0] ?? 0) > 0.15 ? gamepad.axes[0]! : 0;
    const throttleAxis = Math.abs(gamepad.axes[1] ?? 0) > 0.15 ? -(gamepad.axes[1] ?? 0) : 0;
    // The stick is the helm itself, as in a driving game.
    if (rudderAxis) this.controls.rudder = clamp(HELM_STARBOARD * rudderAxis, -1, 1);
    if (throttleAxis) this.controls.throttle = clamp(this.controls.throttle + throttleAxis * delta * 0.55, -1, 1);
  }
}
