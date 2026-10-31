import * as THREE from "three";
import { FOREARM_LENGTH, HumanFigure, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM_LENGTH, type FigureOutfit } from "../vessel/HumanFigure";

/**
 * The island traders: one stands on the sand in front of the stilt hut on
 * every island with a pier, the place a sailor comes ashore. Each is the
 * same rigged figure as the skipper in his own clothes — a straw hat or a
 * cap, a loud shirt — alive at rest: breathing, shifting his weight, hands
 * at his sides or on his hips, looking round; when someone comes up the
 * beach he turns to them, follows them with his eyes and raises a hand.
 *
 * The figure is the project's own procedural rig (no model to download, so
 * nothing can fail to load, and it matches the skipper exactly).
 */

export type TraderSpot = { id: number; x: number; z: number; facing: number };

/** Reach for the trade key, m (from the trader's feet to the player's). */
export const TRADE_REACH = 3.2;
/** Most traders kept built at once (the nearest ones). */
const MAX_TRADERS = 6;

const OUTFITS: readonly FigureOutfit[] = [
  { skin: 0x8a5a3c, shirt: 0xd9472b, shorts: 0xe8dcc0, shoes: 0x3a2a1e, hair: 0x1c140e, cap: 0xd8c27a, sunglasses: false, sleeve: 0.55 },
  { skin: 0xc48f6a, shirt: 0x2b9a8a, shorts: 0x2e3b4f, shoes: 0x6a4a2c, hair: 0x5a3a20, cap: 0xe0cf8e, sunglasses: true, sleeve: 0.5 },
  { skin: 0x6b4430, shirt: 0xf2c12e, shorts: 0x5b4632, shoes: 0x2a2a2a, hair: 0x101010, cap: null, sunglasses: false, sleeve: 0.35 },
  { skin: 0xa6714f, shirt: 0xf4f1ea, shorts: 0x9a7b53, shoes: 0x7a5432, hair: 0x2a1d14, cap: 0x1f3c64, sunglasses: false, sleeve: 0.6 },
];

type Trader = {
  spot: TraderSpot;
  figure: HumanFigure;
  /** Where he faces now (eases toward the visitor), and where his eyes are turned. */
  facing: number;
  gazeYaw: number;
  gazePitch: number;
  /** Seconds into a wave of greeting (−1 when not waving), and whether this visit has been greeted. */
  wave: number;
  greeted: boolean;
  /** 0 hands at his sides … 1 on his hips, eased. */
  hips: number;
  phase: number;
  ground: number;
};

export class Traders {
  readonly group = new THREE.Group();
  private readonly traders = new Map<number, Trader>();
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = "Island_Traders";
    scene.add(this.group);
  }

  /** The traders standing now (built and placed). */
  get spots(): TraderSpot[] {
    return [...this.traders.values()].map((trader) => trader.spot);
  }

  /** The trader within reach of someone standing at (x, z), or null. */
  within(x: number, z: number, reach = TRADE_REACH): TraderSpot | null {
    let best: TraderSpot | null = null;
    let bestDistance = reach;
    for (const trader of this.traders.values()) {
      const distance = Math.hypot(trader.spot.x - x, trader.spot.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = trader.spot;
      }
    }
    return best;
  }

  /**
   * One frame. `spots` are the traders of the islands built round here,
   * `ground(x, z)` the height of the sand, `visitor` the skipper's eyes when
   * he is ashore or wading (null otherwise), `eye` the camera (only traders
   * near enough to be seen are animated).
   */
  update(
    delta: number,
    spots: readonly TraderSpot[],
    ground: (x: number, z: number) => number,
    visitor: THREE.Vector3 | null,
    eye: THREE.Vector3,
  ): void {
    const step = Math.min(0.05, Math.max(0, delta));
    this.time += step;
    // Keep the nearest few built; the rest are released.
    const wanted = [...spots].sort((a, b) => Math.hypot(a.x - eye.x, a.z - eye.z) - Math.hypot(b.x - eye.x, b.z - eye.z)).slice(0, MAX_TRADERS);
    const keep = new Set(wanted.map((spot) => spot.id));
    for (const [id, trader] of this.traders) {
      if (keep.has(id)) continue;
      this.group.remove(trader.figure.mesh);
      trader.figure.dispose();
      this.traders.delete(id);
    }
    for (const spot of wanted) {
      let trader = this.traders.get(spot.id);
      if (!trader) {
        const figure = new HumanFigure(OUTFITS[Math.abs(spot.id) % OUTFITS.length]);
        figure.mesh.name = `Trader_${spot.id}`;
        figure.mesh.castShadow = true;
        this.group.add(figure.mesh);
        trader = {
          spot,
          figure,
          facing: spot.facing,
          gazeYaw: 0,
          gazePitch: 0,
          wave: -1,
          greeted: false,
          hips: 0,
          phase: (Math.abs(spot.id) % 97) * 0.37,
          ground: ground(spot.x, spot.z),
        };
        this.traders.set(spot.id, trader);
      }
      trader.spot = spot;
      const distanceToEye = Math.hypot(spot.x - eye.x, spot.z - eye.z);
      trader.figure.mesh.visible = distanceToEye < 600;
      if (distanceToEye > 160) continue;
      this.pose(trader, step, visitor);
    }
  }

  private pose(trader: Trader, step: number, visitor: THREE.Vector3 | null): void {
    const { figure, spot } = trader;
    const mesh = figure.mesh;
    const t = this.time + trader.phase;
    figure.uniforms.uFigureTime.value = t;
    figure.uniforms.uFigureWind.value = 0.45;
    figure.resetPose();

    // Someone coming up the beach: turn to him, look at him, greet him once.
    let lookYaw = Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.61) * 0.15;
    let lookPitch = Math.sin(t * 0.17) * 0.06;
    let goalFacing = spot.facing + Math.sin(t * 0.07) * 0.25;
    if (visitor) {
      const dx = visitor.x - spot.x;
      const dz = visitor.z - spot.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 14) {
        const toward = Math.atan2(dx, dz);
        if (distance < 9) goalFacing = toward;
        const relative = Math.atan2(Math.sin(toward - trader.facing), Math.cos(toward - trader.facing));
        lookYaw = Math.max(-1.1, Math.min(1.1, relative));
        lookPitch = Math.atan2(visitor.y - (trader.ground + 1.6), Math.max(distance, 0.5)) * 0.7;
        if (!trader.greeted && distance < 9) {
          trader.greeted = true;
          trader.wave = 0;
        }
      } else if (distance > 24) {
        trader.greeted = false;
      }
    }
    const turn = Math.atan2(Math.sin(goalFacing - trader.facing), Math.cos(goalFacing - trader.facing));
    trader.facing += turn * (1 - Math.exp(-step * 2.2));
    const ease = 1 - Math.exp(-step * 5);
    trader.gazeYaw += (lookYaw - trader.gazeYaw) * ease;
    trader.gazePitch += (lookPitch - trader.gazePitch) * ease;
    if (trader.wave >= 0) {
      trader.wave += step;
      if (trader.wave > 2.6) trader.wave = -1;
    }
    // Hands on his hips for a while, then at his sides again.
    const hipsGoal = Math.sin(t * 0.09) > 0.2 && trader.wave < 0 ? 1 : 0;
    trader.hips += (hipsGoal - trader.hips) * (1 - Math.exp(-step * 1.5));

    mesh.position.set(spot.x, trader.ground - 0.02, spot.z);
    mesh.rotation.set(0, trader.facing, 0);
    const breath = Math.sin(t * 1.4);
    const shift = Math.sin(t * 0.5 + Math.sin(t * 0.13) * 1.4) * 0.025;
    const hips = figure.bone("hips");
    hips.position.set(shift, 0.955 - Math.abs(shift) * 0.3, 0);
    hips.rotation.set(0.01, 0, -shift * 1.6);
    figure.bone("spine").rotation.set(0.03, trader.gazeYaw * 0.18, shift * 1.2);
    figure.bone("chest").rotation.set(0.02 + breath * 0.016, trader.gazeYaw * 0.12, 0);
    figure.bone("neck").rotation.set(-trader.gazePitch * 0.4, trader.gazeYaw * 0.3, 0);
    figure.bone("head").rotation.set(-trader.gazePitch * 0.6, trader.gazeYaw * 0.4, Math.sin(t * 0.31) * 0.03);
    mesh.updateMatrixWorld(true);

    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      this.target.set(sign * 0.13, 0.04, 0.03);
      this.pole.set(sign * 0.18, 0.5, 0.9);
      mesh.localToWorld(this.target);
      mesh.localToWorld(this.pole);
      figure.solveTwoBone(`thigh${side}`, `shin${side}`, THIGH_LENGTH, SHIN_LENGTH, this.target, this.pole);
      this.levelFoot(figure, side);
    }
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      const waving = side === "R" && trader.wave >= 0;
      if (waving) {
        // A hand raised high and waved side to side, in and out smoothly.
        const w = Math.min(1, trader.wave / 0.4, (2.6 - trader.wave) / 0.4);
        const sway = Math.sin(trader.wave * 9) * 0.09;
        this.local.set(-0.32 + sway, 1.72, 0.12);
        this.target.set(-0.24, 0.86, 0.06).lerp(this.local, w);
        this.pole.set(-0.6, 1.1, -0.2);
      } else {
        // At his sides, swinging a hair with his breath, or on his hips with the elbows out.
        this.target.set(sign * 0.24, 0.86 + breath * 0.005, 0.06).lerp(this.local.set(sign * 0.17, 1.0, 0.0), trader.hips);
        this.pole.set(sign * (0.5 + trader.hips * 0.3), 1.1, -0.35 + trader.hips * 0.1);
      }
      mesh.localToWorld(this.target);
      mesh.localToWorld(this.pole);
      figure.solveTwoBone(`upperArm${side}`, `forearm${side}`, UPPER_ARM_LENGTH, FOREARM_LENGTH, this.target, this.pole);
      figure.bone(`hand${side}`).rotation.set(waving ? -0.9 : 0.2, 0, sign * 0.3);
    }
  }

  private readonly footQuaternion = new THREE.Quaternion();

  /** Soles flat on the sand. */
  private levelFoot(figure: HumanFigure, side: "L" | "R"): void {
    const foot = figure.bone(`foot${side}`);
    (foot.parent as THREE.Object3D).getWorldQuaternion(this.footQuaternion);
    foot.quaternion.copy(this.footQuaternion.invert());
  }

  dispose(): void {
    for (const trader of this.traders.values()) trader.figure.dispose();
    this.traders.clear();
    this.group.removeFromParent();
  }
}
