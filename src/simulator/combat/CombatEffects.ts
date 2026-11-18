import * as THREE from "three";
import { FxParticles, NO_FLOOR, type FxLook } from "../effects/FxParticles";

/**
 * What a fight looks like in the air: tracer streaks, muzzle flashes,
 * sparks off armour, chips and dust off walls, fire, the smoke of a holed
 * hull or a burning drone, and blasts that throw burning debris.
 *
 * One draw call for all of it (`FxParticles`): every particle is written
 * once when it is born and moved by the vertex shader, so nothing is
 * simulated or allocated per frame beyond a handful of debris trails.
 *
 * A blast also reports its light (`light`, handed to the environment the
 * way a flare's is, so no light is added to the scene) and its shock wave
 * (`shock`, bent into the picture by the finishing pass).
 */

const POOL = 9000;
const DEBRIS = 16;
/** Seconds a shock wave is seen crossing the view. */
export const SHOCK_SECONDS = 0.55;

const GLOW: FxLook = { additive: true, textured: false, gravity: 0, drag: 0, stretch: 0, fade: 1 };
const SPARK: FxLook = { additive: true, textured: false, gravity: 9.8, drag: 0.9, stretch: 0.026, fade: 0.7 };
const EMBER: FxLook = { additive: true, textured: false, gravity: 9.8, drag: 0.35, stretch: 0.03, fade: 0.5 };
const RISING_EMBER: FxLook = { additive: true, textured: false, gravity: -1.2, drag: 0.35, stretch: 0.012, fade: 0.5 };
const DEBRIS_EMBER: FxLook = { additive: true, textured: false, gravity: 9.8, drag: 0.2, stretch: 0.02, fade: 1 };
const TRACER: FxLook = { additive: true, textured: false, gravity: 0, drag: 0, stretch: 0.04, fade: 0 };
const TRACER_HALO: FxLook = { additive: true, textured: false, gravity: 0, drag: 0, stretch: 0.046, fade: 0 };
const FLAME: FxLook = { additive: true, textured: true, gravity: -1, drag: 0.6, stretch: 0, fade: 1 };
const FIREBALL: FxLook = { additive: true, textured: true, gravity: -1.5, drag: 4.2, stretch: 0, fade: 1.1 };
const SMOKE: FxLook = { additive: false, textured: true, gravity: -0.25, drag: 0.4, stretch: 0, fade: 1.4 };
const BLAST_SMOKE: FxLook = { additive: false, textured: true, gravity: -0.55, drag: 2.3, stretch: 0, fade: 1.5 };
const DUST: FxLook = { additive: false, textured: true, gravity: -0.1, drag: 3, stretch: 0, fade: 1.4 };
const CHIP: FxLook = { additive: false, textured: false, gravity: 9.8, drag: 0.5, stretch: 0.012, fade: 0.5 };

type Debris = { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; floor: number; clock: number };

/** What a round struck. */
export type ImpactMaterial = "metal" | "wood" | "fabric" | "stone" | "sand" | "flesh";

export class CombatEffects {
  readonly group = new THREE.Group();
  private readonly particles = new FxParticles(POOL, { name: "CombatParticles", renderOrder: 3 });
  private readonly debris: Debris[] = Array.from({ length: DEBRIS }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, floor: NO_FLOOR, clock: 0 }));
  private debrisNext = 0;
  private readonly ambient: [number, number, number] = [0.4, 0.42, 0.45];
  private readonly sun: [number, number, number] = [0.5, 0.48, 0.44];
  private readonly scratch = new THREE.Vector3();
  private readonly blastAt = new THREE.Vector3();
  private blastLight = 0;
  private readonly fireAt = new THREE.Vector3();
  private fireGlow = 0;
  private readonly shockAt = new THREE.Vector3();
  private shockAge = SHOCK_SECONDS;
  private shockStrength = 0;
  private readonly lightOut = { position: new THREE.Vector3(), brightness: 0, rgb: [1, 0.55, 0.22] as readonly [number, number, number] };
  private readonly shockOut = { position: new THREE.Vector3(), progress: 0, strength: 0 };

  constructor(scene: THREE.Scene) {
    this.group.name = "CombatEffects";
    this.group.add(this.particles.mesh);
    scene.add(this.group);
  }

  /** The sky's fill on smoke (dark at night). */
  setAmbient(color: readonly [number, number, number]): void {
    this.ambient[0] = color[0] * 0.55;
    this.ambient[1] = color[1] * 0.55;
    this.ambient[2] = color[2] * 0.55;
  }

  /** The dominant light's colour on smoke (the sun, or the moon). */
  setSun(color: readonly [number, number, number]): void {
    this.sun[0] = color[0];
    this.sun[1] = color[1];
    this.sun[2] = color[2];
  }

  /** The brightest blast burning now, for the scene's light (null when there is none). */
  get light(): { position: THREE.Vector3; brightness: number; rgb: readonly [number, number, number] } | null {
    if (this.blastLight < 0.02) return null;
    this.lightOut.position.copy(this.blastAt);
    this.lightOut.brightness = this.blastLight;
    return this.lightOut;
  }

  /** The shock wave crossing the view (`progress` 0…1), or null. */
  get shock(): { position: THREE.Vector3; progress: number; strength: number } | null {
    if (this.shockAge >= SHOCK_SECONDS) return null;
    this.shockOut.position.copy(this.shockAt);
    this.shockOut.progress = this.shockAge / SHOCK_SECONDS;
    this.shockOut.strength = this.shockStrength;
    return this.shockOut;
  }

  /** Particles in the air now (bounded by the pool). */
  get live(): number {
    return this.particles.live;
  }

  /** A direction scattered round `(nx, ny, nz)` (any length; zero for a full sphere), into `scratch`. */
  private scatter(nx: number, ny: number, nz: number, bias: number): THREE.Vector3 {
    const out = this.scratch.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
    out.normalize();
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-6) {
      if (out.x * nx + out.y * ny + out.z * nz < 0) out.negate();
      out.x += (nx / length) * bias;
      out.y += (ny / length) * bias;
      out.z += (nz / length) * bias;
      out.normalize();
    }
    return out;
  }

  /**
   * A round's streak from muzzle to where it strikes (`warm`: an enemy's
   * red-orange tracer; else the skipper's pale one): a hot core inside a
   * soft halo, never reaching back behind the muzzle.
   */
  tracer(from: THREE.Vector3, to: THREE.Vector3, warm: boolean): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.5) return;
    // Slower than a real round, so the eye can follow it: the streak crosses
    // a hundred metres in a quarter of a second.
    const speed = warm ? 300 : 420;
    const life = Math.max(0.04, distance / speed);
    const vx = (dx / distance) * speed;
    const vy = (dy / distance) * speed;
    const vz = (dz / distance) * speed;
    const r = 1;
    const g = warm ? 0.3 : 0.86;
    const b = warm ? 0.12 : 0.62;
    this.particles.emit(from.x, from.y, from.z, vx, vy, vz, life, 0.045, 0.045, r * 9, g * 9, b * 9, 1, TRACER);
    this.particles.emit(from.x, from.y, from.z, vx, vy, vz, life, 0.16, 0.16, r, g, b, 0.45, TRACER_HALO);
  }

  /** A muzzle flash: a burst of light, a few sparks thrown forward, a wisp of smoke. */
  flash(at: THREE.Vector3, size = 0.9): void {
    const p = this.particles;
    p.emit(at.x, at.y, at.z, 0, 0, 0, 0.06, size * 0.9, size * 0.45, 7, 4.6, 2.2, 1, GLOW);
    p.emit(at.x, at.y, at.z, 0, 0, 0, 0.09, size * 2.4, size * 1.6, 1.4, 0.8, 0.35, 0.5, GLOW);
    for (let index = 0; index < 4; index += 1) {
      const d = this.scatter(0, 0, 0, 0);
      const speed = 4 + Math.random() * 9;
      p.emit(at.x, at.y, at.z, d.x * speed, d.y * speed, d.z * speed, 0.06 + Math.random() * 0.1, 0.012, 0.004, 8, 5, 2, 1, SPARK);
    }
    p.emit(at.x, at.y, at.z, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.4, size * 0.18, size * 0.7, 0.75, 0.75, 0.78, 0.2, SMOKE);
  }

  /** Smoke curling from a barrel after a shot, drifting along (`dx`, `dy`, `dz`). */
  muzzleSmoke(at: THREE.Vector3, dx: number, dy: number, dz: number): void {
    for (let index = 0; index < 3; index += 1) {
      const push = 0.6 + Math.random() * 2.2;
      this.particles.emit(
        at.x, at.y, at.z,
        dx * push + (Math.random() - 0.5) * 0.3, dy * push + 0.15 + Math.random() * 0.35, dz * push + (Math.random() - 0.5) * 0.3,
        0.45 + Math.random() * 0.5, 0.04, 0.26 + Math.random() * 0.2, 0.6, 0.6, 0.62, 0.08, DUST,
      );
    }
  }

  /** Sparks off steel: `count` embers flung out round `at`, falling, and bouncing off `floor` if there is one. */
  sparks(at: THREE.Vector3, count = 10, heat = 1, floor = NO_FLOOR): void {
    const p = this.particles;
    p.emit(at.x, at.y, at.z, 0, 0, 0, 0.07, 0.42, 0.18, 6 * heat, 4 * heat, 2 * heat, 1, GLOW);
    for (let index = 0; index < count * 2; index += 1) {
      const d = this.scatter(0, 1, 0, 0.5);
      const speed = 2 + Math.random() * 8;
      const hot = 7 * heat;
      p.emit(
        at.x, at.y, at.z, d.x * speed, d.y * speed, d.z * speed,
        0.2 + Math.random() * 0.55, 0.012 + Math.random() * 0.012, 0.004,
        hot, hot * (0.52 + Math.random() * 0.22), hot * 0.22, 1, SPARK, floor,
      );
    }
  }

  /** Splinters and a puff where a round goes into the yacht. */
  splinters(at: THREE.Vector3): void {
    this.sparks(at, 3, 0.7);
    this.chips(at, 9, 0.5, 0.36, 0.22);
    this.puff(at, 0.55, 0.9, 0.45, 0.42, 0.38);
  }

  private chips(at: THREE.Vector3, count: number, r: number, g: number, b: number, floor = NO_FLOOR): void {
    for (let index = 0; index < count; index += 1) {
      const d = this.scatter(0, 1, 0, 0.6);
      const speed = 1.5 + Math.random() * 4.5;
      const shade = 0.7 + Math.random() * 0.5;
      this.particles.emit(at.x, at.y, at.z, d.x * speed, d.y * speed, d.z * speed, 0.45 + Math.random() * 0.6, 0.022 + Math.random() * 0.02, 0.014, r * shade, g * shade, b * shade, 1, CHIP, floor);
    }
  }

  /**
   * A round's strike on something solid, thrown back along (`nx`, `ny`,
   * `nz`) (toward whoever fired; zero for straight up): sparks off metal,
   * splinters off wood, dust and chips off stone and plaster, a spurt of
   * sand, a tuft off cloth.
   */
  impact(at: THREE.Vector3, material: ImpactMaterial, nx = 0, ny = 1, nz = 0, floor = NO_FLOOR): void {
    const p = this.particles;
    const dust = (count: number, shade: number, opacity: number, reach: number) => {
      for (let index = 0; index < count; index += 1) {
        const d = this.scatter(nx, ny + 0.4, nz, 1.1);
        const speed = (1 + Math.random() * 2.4) * reach;
        p.emit(at.x, at.y, at.z, d.x * speed, d.y * speed, d.z * speed, 0.7 + Math.random() * 0.9, 0.12, 0.55 + Math.random() * 0.6, shade, shade * 0.98, shade * 0.94, opacity, DUST);
      }
    };
    if (material === "metal") {
      this.sparks(at, 8, 1, floor);
      dust(1, 0.5, 0.2, 0.6);
    } else if (material === "wood") {
      this.sparks(at, 2, 0.6, floor);
      this.chips(at, 10, 0.5, 0.36, 0.22, floor);
      dust(3, 0.62, 0.3, 0.8);
    } else if (material === "fabric") {
      this.chips(at, 5, 0.6, 0.6, 0.58, floor);
      dust(2, 0.7, 0.22, 0.6);
    } else if (material === "sand") {
      this.chips(at, 12, 0.78, 0.68, 0.48, floor);
      dust(5, 0.8, 0.32, 1.2);
    } else if (material === "flesh") {
      dust(3, 0.3, 0.4, 0.5);
    } else {
      this.sparks(at, 2, 0.5, floor);
      this.chips(at, 9, 0.6, 0.58, 0.54, floor);
      dust(5, 0.82, 0.34, 1);
    }
  }

  /** One puff of smoke (`r`, `g`, `b`: its own colour, lit by the sky). */
  puff(at: THREE.Vector3, size: number, life: number, r = 0.25, g = 0.25, b = 0.26, rise = 1.2, opacity = 0.55): void {
    this.particles.emit(
      at.x + (Math.random() - 0.5) * size * 0.3, at.y, at.z + (Math.random() - 0.5) * size * 0.3,
      (Math.random() - 0.5) * 0.5, rise * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.5,
      life, size, size * 2.4, r * 1.6, g * 1.6, b * 1.6, opacity, SMOKE,
    );
  }

  /** Smoke from something burning: dark puffs drifting downwind (`windX`, `windZ` in m/s). */
  smokeFrom(at: THREE.Vector3, strength: number, windX: number, windZ: number): void {
    const dark = 0.2 + Math.random() * 0.16;
    this.particles.emit(
      at.x + (Math.random() - 0.5) * 0.4, at.y, at.z + (Math.random() - 0.5) * 0.4,
      windX * 0.35 + (Math.random() - 0.5) * 0.4, 1.6 + strength * 1.8, windZ * 0.35 + (Math.random() - 0.5) * 0.4,
      4 + strength * 3 + Math.random() * 2, 0.9 + strength * 0.8, 3.4 + strength * 3.4, dark, dark, dark * 1.05, 0.5 + strength * 0.25, SMOKE,
    );
  }

  /** Licks of flame at `at`, with the odd ember carried up. */
  fire(at: THREE.Vector3, strength: number): void {
    const p = this.particles;
    for (let index = 0; index < 2; index += 1) {
      p.emit(
        at.x + (Math.random() - 0.5) * 0.6, at.y + (Math.random() - 0.5) * 0.2, at.z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 1.7, (Math.random() - 0.5) * 0.6,
        0.38 + Math.random() * 0.4, 0.55 + strength * 0.75, 0.25, 2.5, 1.45, 0.52, 0.95, FLAME,
      );
    }
    if (Math.random() < 0.35) {
      p.emit(at.x + (Math.random() - 0.5) * 0.5, at.y + 0.3, at.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2, 1 + Math.random() * 1.4, 0.03, 0.008, 8, 3.6, 1, 1, RISING_EMBER);
    }
    this.fireAt.copy(at);
    this.fireGlow = Math.max(this.fireGlow, 0.5 + strength * 0.6);
  }

  /**
   * A blast: a flash, a fireball rolling up into black smoke, a shower of
   * sparks, a ring of dust along the ground, burning debris trailing smoke.
   * `floor`: the ground or sea under it, which sparks and debris bounce off.
   */
  explosion(at: THREE.Vector3, scale = 1, floor = NO_FLOOR): void {
    const p = this.particles;
    const s = scale;
    p.emit(at.x, at.y + 0.4, at.z, 0, 0, 0, 0.1, 3.6 * s, 5.5 * s, 7, 4.8, 2.6, 1, GLOW);
    for (let index = 0; index < 30 * s; index += 1) {
      const d = this.scatter(0, 1, 0, 0.35);
      const speed = (5 + Math.random() * 8) * s;
      p.emit(
        at.x + (Math.random() - 0.5) * 0.8, at.y + Math.random() * 0.5, at.z + (Math.random() - 0.5) * 0.8,
        d.x * speed, d.y * speed, d.z * speed, 0.45 + Math.random() * 0.5, 1.1 * s, (2.2 + Math.random() * 0.8) * s, 1.5, 0.85, 0.32, 1, FIREBALL,
      );
    }
    for (let index = 0; index < 24 * s; index += 1) {
      const d = this.scatter(0, 1, 0, 0.5);
      const speed = (3 + Math.random() * 5) * s;
      p.emit(
        at.x + (Math.random() - 0.5) * 1.2, at.y + 0.2 + Math.random() * 0.7, at.z + (Math.random() - 0.5) * 1.2,
        d.x * speed, d.y * speed, d.z * speed, 3 + Math.random() * 3.6, 1.4 * s, (4 + Math.random() * 2) * s, 0.22, 0.21, 0.21, 0.78, BLAST_SMOKE,
      );
    }
    for (let index = 0; index < 100 * s; index += 1) {
      const d = this.scatter(0, 1, 0, 0.4);
      const speed = 7 + Math.random() * 21;
      p.emit(at.x, at.y + 0.3, at.z, d.x * speed, d.y * speed, d.z * speed, 0.5 + Math.random() * 1.2, 0.02 + Math.random() * 0.02, 0.006, 9, 5, 1.8, 1, EMBER, floor);
    }
    if (floor > NO_FLOOR + 1) {
      for (let index = 0; index < 20 * s; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (6 + Math.random() * 5) * s;
        p.emit(at.x, floor + 0.25, at.z, Math.cos(angle) * speed, 0.2 + Math.random() * 0.8, Math.sin(angle) * speed, 1.2 + Math.random(), 0.7, (2 + Math.random() * 1.2) * s, 0.62, 0.6, 0.56, 0.3, DUST);
      }
    }
    for (let index = 0; index < Math.min(DEBRIS, Math.round(9 * s)); index += 1) {
      const d = this.scatter(0, 1, 0, 0.9);
      const speed = 6 + Math.random() * 10;
      const piece = this.debris[this.debrisNext]!;
      this.debrisNext = (this.debrisNext + 1) % DEBRIS;
      piece.life = 0.7 + Math.random() * 0.6;
      piece.x = at.x;
      piece.y = at.y + 0.5;
      piece.z = at.z;
      piece.vx = d.x * speed;
      piece.vy = d.y * speed;
      piece.vz = d.z * speed;
      piece.floor = floor;
      piece.clock = 0;
      p.emit(piece.x, piece.y, piece.z, piece.vx, piece.vy, piece.vz, 2.4, 0.09, 0.03, 6, 2.6, 0.7, 1, DEBRIS_EMBER, floor);
    }
    this.blastAt.set(at.x, at.y + 2, at.z);
    this.blastLight = Math.max(this.blastLight, 1.5 * s);
    this.shockAt.set(at.x, at.y + 0.6, at.z);
    this.shockAge = 0;
    this.shockStrength = s;
  }

  update(delta: number): void {
    const p = this.particles;
    // Burning debris draws a line of smoke behind it as it flies.
    for (const piece of this.debris) {
      if (piece.life <= 0) continue;
      piece.life -= delta;
      const damp = Math.exp(-0.2 * delta);
      piece.vx *= damp;
      piece.vz *= damp;
      piece.vy = piece.vy * damp - 9.8 * delta;
      piece.x += piece.vx * delta;
      piece.y += piece.vy * delta;
      piece.z += piece.vz * delta;
      if (piece.floor > NO_FLOOR + 1 && piece.y < piece.floor) {
        piece.y = piece.floor;
        piece.vy = Math.abs(piece.vy) * 0.3;
        piece.vx *= 0.5;
        piece.vz *= 0.5;
      }
      piece.clock -= delta;
      if (piece.clock <= 0) {
        piece.clock = 0.028;
        p.emit(piece.x, piece.y, piece.z, (Math.random() - 0.5) * 0.5, Math.random() * 0.5, (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.6, 0.2, 0.75 + Math.random() * 0.4, 0.3, 0.29, 0.29, 0.42, DUST);
      }
    }
    this.blastLight *= Math.exp(-delta * 5.5);
    this.fireGlow *= Math.exp(-delta * 3);
    if (this.shockAge < SHOCK_SECONDS) this.shockAge += delta;
    p.setLight(this.ambient, this.sun);
    p.setFire(0, this.blastAt.x, this.blastAt.y, this.blastAt.z, this.blastLight * 5, this.blastLight * 2.6, this.blastLight * 1);
    p.setFire(1, this.fireAt.x, this.fireAt.y + 0.6, this.fireAt.z, this.fireGlow * 2.2, this.fireGlow * 1.05, this.fireGlow * 0.35);
    p.update(delta);
  }

  /** Everything in the air gone (a new game, a restored checkpoint). */
  clear(): void {
    this.particles.clear();
    for (const piece of this.debris) piece.life = 0;
    this.blastLight = 0;
    this.fireGlow = 0;
    this.shockAge = SHOCK_SECONDS;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.particles.dispose();
  }
}
