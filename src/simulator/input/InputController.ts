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
const DRIVING_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];

/**
 * Whether a key press belongs to the focused element rather than the helm.
 * Only text entry and an element's own arrow keys are left alone: after a
 * click on any button or on the rudder slider the keyboard still steers (it
 * used to fall silent until the scene was clicked again).
 */
export function keyBelongsToElement(target: EventTarget | null, code: string): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    if (target.type === "range") return code.startsWith("Arrow") || code === "Home" || code === "End";
    if (target.type === "checkbox" || target.type === "radio" || target.type === "button") return code === "Space";
    return true;
  }
  // A focused button is pressed by Space; arrows and letters still steer.
  return target instanceof HTMLButtonElement && (code === "Space" || code === "Enter");
}

export class InputController {
  private readonly keys = new Set<string>();

  constructor(
    private readonly controls: SimulatorControls,
    private readonly onReset: () => void,
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
    if (steering !== 0) this.controls.rudder = clamp(this.controls.rudder + HELM_STARBOARD * steering * delta * 0.62, -1, 1);
    if (throttle !== 0) this.controls.throttle = clamp(this.controls.throttle + throttle * delta * 0.55, -1, 1);
    this.updateGamepad(delta);
  }

  /** @param helm the helm in the player's terms: +1 hard to starboard (right). */
  setRudder(helm: number): void {
    this.controls.rudder = rudderFromHelm(helm);
  }

  centerRudder(): void {
    this.controls.rudder = 0;
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
    if (event.code === "Space") this.centerRudder();
    if (event.code === "KeyR") this.onReset();
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
    const gamepad = navigator.getGamepads?.()[0];
    if (!gamepad) return;
    const rudderAxis = Math.abs(gamepad.axes[0] ?? 0) > 0.08 ? gamepad.axes[0] : 0;
    const throttleAxis = Math.abs(gamepad.axes[1] ?? 0) > 0.08 ? -(gamepad.axes[1] ?? 0) : 0;
    if (rudderAxis) this.controls.rudder = clamp(this.controls.rudder + HELM_STARBOARD * rudderAxis * delta * 0.8, -1, 1);
    if (throttleAxis) this.controls.throttle = clamp(this.controls.throttle + throttleAxis * delta * 0.55, -1, 1);
  }
}
