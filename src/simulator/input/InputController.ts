import { clamp } from "../math";
import type { SimulatorControls } from "../types";

export class InputController {
  private readonly keys = new Set<string>();

  constructor(
    private readonly controls: SimulatorControls,
    private readonly onReset: () => void,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  update(delta: number): void {
    const steering = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const throttle = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) -
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    if (steering !== 0) this.controls.rudder = clamp(this.controls.rudder + steering * delta * 0.62, -1, 1);
    if (throttle !== 0) this.controls.throttle = clamp(this.controls.throttle + throttle * delta * 0.55, -1, 1);
    this.updateGamepad(delta);
  }

  setRudder(value: number): void {
    this.controls.rudder = clamp(value, -1, 1);
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
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (event.code === "Space") this.centerRudder();
    if (event.code === "KeyR") this.onReset();
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private updateGamepad(delta: number): void {
    const gamepad = navigator.getGamepads?.()[0];
    if (!gamepad) return;
    const rudderAxis = Math.abs(gamepad.axes[0] ?? 0) > 0.08 ? gamepad.axes[0] : 0;
    const throttleAxis = Math.abs(gamepad.axes[1] ?? 0) > 0.08 ? -(gamepad.axes[1] ?? 0) : 0;
    if (rudderAxis) this.controls.rudder = clamp(this.controls.rudder + rudderAxis * delta * 0.8, -1, 1);
    if (throttleAxis) this.controls.throttle = clamp(this.controls.throttle + throttleAxis * delta * 0.55, -1, 1);
  }
}
