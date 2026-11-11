/**
 * The skipper's rifle (handed over by Holloway): a bolt-action with a
 * magazine of eight, reloaded by itself when empty. Its state only; where
 * a round goes is the simulator's business (`DroneSystem.shoot`).
 */

export const MAGAZINE = 8;
/** Seconds between shots (working the bolt) and to reload a magazine. */
export const SHOT_INTERVAL = 0.42;
export const RELOAD_TIME = 2.2;
/** The rifle's own spread, rad (a round lands within ±0.5 m at 300 m). */
export const RIFLE_SPREAD = 0.0016;
/** Beyond this a round is spent, m. */
export const RIFLE_RANGE = 900;

export class Rifle {
  drawn = false;
  ammo = MAGAZINE;
  private cooldown = 0;
  private reloading = 0;

  get reloadProgress(): number {
    return this.reloading > 0 ? 1 - this.reloading / RELOAD_TIME : 1;
  }

  get busy(): boolean {
    return this.reloading > 0 || this.cooldown > 0;
  }

  /** Takes a shot if one can be fired now; false while working the bolt or reloading. */
  trigger(): boolean {
    if (!this.drawn || this.reloading > 0 || this.cooldown > 0 || this.ammo <= 0) return false;
    this.ammo -= 1;
    this.cooldown = SHOT_INTERVAL;
    if (this.ammo === 0) this.reloading = RELOAD_TIME;
    return true;
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    if (this.reloading > 0) {
      this.reloading -= delta;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = MAGAZINE;
      }
    }
  }

  /** Put away and taken out fresh (a new game). */
  reset(): void {
    this.drawn = false;
    this.ammo = MAGAZINE;
    this.cooldown = 0;
    this.reloading = 0;
  }
}
