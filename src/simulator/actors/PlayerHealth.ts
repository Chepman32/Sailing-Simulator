/**
 * The skipper's own skin in a fight: hit points that the guards' rounds take
 * and that come back by themselves only up to the next quarter (a wound
 * stays a wound) once he has not been hit for a while; a bandage (from a
 * dry backpack, a first-aid box) closes it, all the way, over a few
 * seconds. At zero he is down, and the story takes him back to its last
 * checkpoint. Pure.
 */
export const MAX_HEALTH = 100;
/** Seconds unhit before the body starts to steady itself, and how fast, hp/s. */
const CALM_AFTER = 6;
const STEADY_RATE = 7;
const SEGMENT = 25;
/** A bandage: how much and over how long. */
const BANDAGE_HEAL = 70;
const BANDAGE_TIME = 3;

export class PlayerHealth {
  health = MAX_HEALTH;
  bandages = 0;
  /** Seconds since the last hit; where it came from (world yaw from him to the shooter). */
  sinceHit = 99;
  hitFrom = 0;
  /** Healing still to come from a bandage being put on, hp. */
  private healing = 0;
  private healTime = 0;

  get dead(): boolean {
    return this.health <= 0;
  }

  /** 0…1 for the interface. */
  get fraction(): number {
    return this.health / MAX_HEALTH;
  }

  get bandaging(): boolean {
    return this.healing > 0;
  }

  /** A hit from (fromYaw); returns true if it put him down. */
  hurt(amount: number, fromYaw: number): boolean {
    if (this.dead) return true;
    this.health = Math.max(0, this.health - amount);
    this.sinceHit = 0;
    this.hitFrom = fromYaw;
    return this.dead;
  }

  /** Puts a bandage on (false if he has none, or needs none). */
  bandage(): boolean {
    if (this.bandages <= 0 || this.health >= MAX_HEALTH || this.healing > 0 || this.dead) return false;
    this.bandages -= 1;
    this.healing = BANDAGE_HEAL;
    this.healTime = BANDAGE_TIME;
    return true;
  }

  update(dt: number): void {
    if (this.dead) return;
    this.sinceHit += dt;
    if (this.healing > 0) {
      const step = Math.min(this.healing, (BANDAGE_HEAL / BANDAGE_TIME) * dt);
      this.healing -= step;
      this.health = Math.min(MAX_HEALTH, this.health + step);
      if (this.health >= MAX_HEALTH) this.healing = 0;
      this.healTime -= dt;
    } else if (this.sinceHit > CALM_AFTER) {
      const ceiling = Math.min(MAX_HEALTH, Math.ceil(this.health / SEGMENT - 1e-6) * SEGMENT);
      if (this.health < ceiling) this.health = Math.min(ceiling, this.health + STEADY_RATE * dt);
    }
  }

  reset(health = MAX_HEALTH): void {
    this.health = health;
    this.sinceHit = 99;
    this.healing = 0;
  }
}
