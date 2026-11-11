/**
 * The skipper's guns: the pistol Holloway gives him on the lighthouse
 * island (a couple of magazines' worth, for close work: it will not get
 * through a drone's armour, and its dome shrugs a pistol round off), and
 * the bolt-action rifle he gives him at Sato's (the drones' bane: the dome
 * blinded, the jets stopped). Their state only; where a round goes is the
 * simulator's business (`DroneSystem.shoot`).
 */

export type WeaponId = "pistol" | "rifle";

export type WeaponSpec = {
  id: WeaponId;
  /** Rounds in a magazine (reloaded by itself when empty). */
  magazine: number;
  /** Seconds between shots, and to reload. */
  interval: number;
  reload: number;
  /** Its own spread, rad. */
  spread: number;
  /** Beyond this a round is spent, m. */
  range: number;
  /** What a round does to a drone: 1 a rifle's, 0 nothing (it glances off). */
  power: number;
};

export const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = {
  pistol: { id: "pistol", magazine: 12, interval: 0.24, reload: 1.6, spread: 0.012, range: 160, power: 0 },
  // A round lands within ±0.5 m at 300 m.
  rifle: { id: "rifle", magazine: 8, interval: 0.42, reload: 2.2, spread: 0.0016, range: 900, power: 1 },
};

/** The order key 1 runs through them: holstered, the pistol, the rifle. */
export const WEAPON_ORDER: readonly WeaponId[] = ["pistol", "rifle"];

export class Firearm {
  ammo: number;
  private cooldown = 0;
  private reloading = 0;

  constructor(readonly spec: WeaponSpec) {
    this.ammo = spec.magazine;
  }

  get reloadProgress(): number {
    return this.reloading > 0 ? 1 - this.reloading / this.spec.reload : 1;
  }

  /** Takes a shot if one can be fired now; false while between shots or reloading. */
  trigger(): boolean {
    if (this.reloading > 0 || this.cooldown > 0 || this.ammo <= 0) return false;
    this.ammo -= 1;
    this.cooldown = this.spec.interval;
    if (this.ammo === 0) this.reloading = this.spec.reload;
    return true;
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    if (this.reloading > 0) {
      this.reloading -= delta;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = this.spec.magazine;
      }
    }
  }

  reset(): void {
    this.ammo = this.spec.magazine;
    this.cooldown = 0;
    this.reloading = 0;
  }
}

/** What he carries and which is in his hands (null: holstered). */
export class Armoury {
  readonly guns: Readonly<Record<WeaponId, Firearm>> = { pistol: new Firearm(WEAPONS.pistol), rifle: new Firearm(WEAPONS.rifle) };
  drawn: WeaponId | null = null;

  get current(): Firearm | null {
    return this.drawn ? this.guns[this.drawn] : null;
  }

  /**
   * Key 1: holstered → the first gun he has → the next → holstered. With
   * one gun it simply draws it or puts it away. Returns what is drawn now.
   */
  cycle(owned: (id: WeaponId) => boolean): WeaponId | null {
    const have = WEAPON_ORDER.filter(owned);
    if (have.length === 0) {
      this.drawn = null;
      return null;
    }
    const at = this.drawn ? have.indexOf(this.drawn) : -1;
    this.drawn = at + 1 < have.length ? have[at + 1]! : null;
    return this.drawn;
  }

  /** A gun he no longer has is put away. */
  check(owned: (id: WeaponId) => boolean): void {
    if (this.drawn && !owned(this.drawn)) this.drawn = null;
  }

  update(delta: number): void {
    for (const id of WEAPON_ORDER) this.guns[id].update(delta);
  }

  /** Put away and taken out fresh (a new game). */
  reset(): void {
    this.drawn = null;
    for (const id of WEAPON_ORDER) this.guns[id].reset();
  }
}
