import * as THREE from "three";
import { FOREARM_LENGTH, HumanFigure, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM_LENGTH, type FigureOutfit } from "../vessel/HumanFigure";
import { RiggedFigure } from "./RiggedFigure";
import { armedKit } from "../story/StoryKit";

/**
 * The island traders: one stands on the sand in front of the stilt hut on
 * every island with a pier, the place a sailor comes ashore. Each is the
 * same rigged figure as the skipper in his own clothes — a straw hat or a
 * cap, a loud shirt — alive at rest: breathing, shifting his weight, hands
 * at his sides or on his hips, looking round; when someone comes up the
 * beach he turns to them, follows them with his eyes and raises a hand.
 *
 * The traders are rigged character models (a man, a woman and a pirate,
 * `public/models/trader-*.glb`) posed procedurally (`RiggedFigure`): a
 * visitor coming up the beach is turned to and greeted with a raised,
 * waving hand and a friendly tilt of the head; while he stands near, the
 * trader shifts from foot to foot, glances round and back at him, nods now
 * and then. Should the models be missing, the project's own procedural
 * figure (the skipper's rig in other clothes) stands in.
 */

export type TraderSpot = {
  id: number;
  x: number;
  z: number;
  facing: number;
  /** What he carries besides his clothes (a story person: `armed`, a vest and a rifle across the chest). */
  kit?: "armed";
};

/** Reach for the trade key, m (from the trader's feet to the player's). */
export const TRADE_REACH = 3.2;
/** Most traders kept built at once (the nearest ones). */
const MAX_TRADERS = 6;
/** Seconds a greeting wave lasts. */
const WAVE_TIME = 2.8;

const OUTFITS: readonly FigureOutfit[] = [
  { skin: 0x8a5a3c, shirt: 0xd9472b, shorts: 0xe8dcc0, shoes: 0x3a2a1e, hair: 0x1c140e, cap: 0xd8c27a, sunglasses: false, sleeve: 0.55 },
  { skin: 0xc48f6a, shirt: 0x2b9a8a, shorts: 0x2e3b4f, shoes: 0x6a4a2c, hair: 0x5a3a20, cap: 0xe0cf8e, sunglasses: true, sleeve: 0.5 },
  { skin: 0x6b4430, shirt: 0xf2c12e, shorts: 0x5b4632, shoes: 0x2a2a2a, hair: 0x101010, cap: null, sunglasses: false, sleeve: 0.35 },
  { skin: 0xa6714f, shirt: 0xf4f1ea, shorts: 0x9a7b53, shoes: 0x7a5432, hair: 0x2a1d14, cap: 0x1f3c64, sunglasses: false, sleeve: 0.6 },
];

type Trader = {
  spot: TraderSpot;
  /** The procedural stand-in (null when the trader is a rigged model). */
  figure: HumanFigure | null;
  rig: RiggedFigure | null;
  /** The scene object placed for him (the stand-in's mesh or the model's root). */
  object: THREE.Object3D;
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
  /** Rigged traders: weight from the right foot (−1) to the left (1), eased, its goal, and when it shifts next. */
  weight: number;
  weightGoal: number;
  shiftIn: number;
  /** A glance away from the visitor (or round about): its direction, how long it lasts, when the next comes. */
  glanceYaw: number;
  glancePitch: number;
  glanceFor: number;
  glanceIn: number;
  /** Seconds into a nod (−1 when none), and 0…1 how warmly the head is tilted in greeting. */
  nod: number;
  warmth: number;
};

/** Where each rigged model comes from: a clone of a loaded trader model, by index (null if not loaded). */
export type TraderModels = { count: number; create: (index: number) => THREE.Object3D | null };

export class Traders {
  readonly group = new THREE.Group();
  private readonly traders = new Map<number, Trader>();
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private time = 0;

  constructor(scene: THREE.Scene, private models: TraderModels | null = null) {
    this.group.name = "Island_Traders";
    scene.add(this.group);
  }

  /**
   * More models have arrived (they load after the first frame): the traders
   * standing are let go and rebuilt from them on the next frame.
   */
  setModels(models: TraderModels): void {
    this.models = models;
    for (const trader of this.traders.values()) {
      this.group.remove(trader.object);
      trader.figure?.dispose();
      trader.rig?.dispose();
    }
    this.traders.clear();
  }

  /** A rigged trader for this spot, or null if the models did not load. */
  private createRig(spot: TraderSpot): RiggedFigure | null {
    if (!this.models || this.models.count === 0) return null;
    const model = this.models.create(Math.abs(spot.id) % this.models.count);
    if (!model) return null;
    try {
      const rig = new RiggedFigure(model);
      rig.root.name = `Trader_${spot.id}`;
      return rig;
    } catch (error) {
      console.warn("A trader model has not the expected skeleton; the procedural figure stands in.", error);
      return null;
    }
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
      this.group.remove(trader.object);
      trader.figure?.dispose();
      trader.rig?.dispose();
      this.traders.delete(id);
    }
    for (const spot of wanted) {
      let trader = this.traders.get(spot.id);
      if (!trader) {
        const rig = this.createRig(spot);
        const figure = rig ? null : new HumanFigure(OUTFITS[Math.abs(spot.id) % OUTFITS.length]);
        const object = rig ? rig.root : figure!.mesh;
        if (figure) {
          figure.mesh.name = `Trader_${spot.id}`;
          figure.mesh.castShadow = true;
        }
        if (spot.kit === "armed") object.add(armedKit());
        this.group.add(object);
        const seed = Math.abs(spot.id) % 97;
        trader = {
          spot,
          figure,
          rig,
          object,
          facing: spot.facing,
          gazeYaw: 0,
          gazePitch: 0,
          wave: -1,
          greeted: false,
          hips: 0,
          phase: seed * 0.37,
          ground: ground(spot.x, spot.z),
          weight: 0,
          weightGoal: seed % 2 === 0 ? 0.8 : -0.8,
          shiftIn: 1 + (seed % 5),
          glanceYaw: 0,
          glancePitch: 0,
          glanceFor: 0,
          glanceIn: 2 + (seed % 3),
          nod: -1,
          warmth: 0,
        };
        // Stood at his place at once: a trader only posed when near would
        // otherwise wait at the world's origin, out at sea.
        object.position.set(spot.x, trader.ground - (rig ? 0 : 0.02), spot.z);
        object.rotation.y = spot.facing;
        object.updateMatrixWorld(true);
        // A rigged one stands posed from the start (not in the model's A-pose).
        if (rig) this.poseRigged(trader, 0, null);
        this.traders.set(spot.id, trader);
      }
      trader.spot = spot;
      const distanceToEye = Math.hypot(spot.x - eye.x, spot.z - eye.z);
      // Never one standing in the water (an island whose beach is all swash there).
      trader.object.visible = distanceToEye < 600 && trader.ground > 0.2;
      if (distanceToEye > 160) continue;
      if (trader.rig) this.poseRigged(trader, step, visitor);
      else this.pose(trader, step, visitor);
    }
  }

  private readonly offset = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly handTarget = new THREE.Vector3();
  private readonly handPole = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();

  /**
   * A rigged trader for this frame. His moods: alone, he stands at ease,
   * looking round, now and then with his hands on his hips; when someone
   * comes up the beach he turns to him, looks at him, raises a hand and
   * waves, his head tilted a little; while the visitor stands by, he
   * shifts his weight from foot to foot more often, glances round and back,
   * nods now and then.
   */
  private poseRigged(trader: Trader, step: number, visitor: THREE.Vector3 | null): void {
    const rig = trader.rig!;
    const { spot } = trader;
    const t = this.time + trader.phase;
    const random = (salt: number) => {
      const n = Math.sin((t * 12.9898 + salt * 78.233 + spot.id * 0.0137) * 43.17) * 43758.5453;
      return n - Math.floor(n);
    };

    // --- What he is doing ---------------------------------------------------
    let distance = Number.POSITIVE_INFINITY;
    let toward = spot.facing;
    let visitorPitch = 0;
    if (visitor) {
      const dx = visitor.x - spot.x;
      const dz = visitor.z - spot.z;
      distance = Math.hypot(dx, dz);
      toward = Math.atan2(dx, dz);
      visitorPitch = Math.atan2(visitor.y - (trader.ground + rig.height * 0.93), Math.max(distance, 0.5));
    }
    const noticed = distance < 16;
    const close = distance < 5.5;
    if (noticed && !trader.greeted && distance < 12) {
      trader.greeted = true;
      // An armed man on watch nods; he does not wave.
      if (trader.spot.kit !== "armed") trader.wave = 0;
      trader.nod = 0;
    } else if (distance > 26) {
      trader.greeted = false;
    }
    let goalFacing = spot.facing + Math.sin(t * 0.07) * 0.2;
    if (noticed && distance < 12) goalFacing = toward;
    trader.facing += Math.atan2(Math.sin(goalFacing - trader.facing), Math.cos(goalFacing - trader.facing)) * (1 - Math.exp(-step * 2.4));
    // Weight from foot to foot: every few seconds, more often with a visitor close.
    trader.shiftIn -= step;
    if (trader.shiftIn <= 0) {
      trader.weightGoal = -Math.sign(trader.weightGoal || 1) * (0.55 + random(1) * 0.45);
      trader.shiftIn = close ? 2 + random(2) * 2.2 : 4 + random(3) * 5;
    }
    trader.weight += (trader.weightGoal - trader.weight) * (1 - Math.exp(-step * 2.2));
    // Glances: round about when alone; with a visitor, mostly at him, now and then aside.
    trader.glanceIn -= step;
    if (trader.glanceFor > 0) trader.glanceFor -= step;
    // Never looking away in the middle of a greeting.
    if (trader.wave >= 0) trader.glanceFor = 0;
    if (trader.glanceIn <= 0) {
      trader.glanceYaw = (random(4) < 0.5 ? -1 : 1) * (0.45 + random(5) * 0.65);
      trader.glancePitch = (random(6) - 0.6) * 0.25;
      trader.glanceFor = noticed ? 0.9 + random(7) * 0.9 : 2 + random(8) * 3;
      trader.glanceIn = trader.glanceFor + (noticed ? (close ? 2.5 : 4) + random(9) * 3 : 0.5 + random(10) * 2);
      if (close && random(11) < 0.3) trader.nod = 0;
    }
    let lookYaw = Math.sin(t * 0.21) * 0.25;
    let lookPitch = Math.sin(t * 0.17) * 0.05;
    if (trader.glanceFor > 0) {
      lookYaw = trader.glanceYaw;
      lookPitch = trader.glancePitch;
    } else if (noticed) {
      lookYaw = Math.atan2(Math.sin(toward - trader.facing), Math.cos(toward - trader.facing));
      lookPitch = visitorPitch;
    }
    lookYaw = Math.max(-1.25, Math.min(1.25, lookYaw));
    lookPitch = Math.max(-0.5, Math.min(0.45, lookPitch));
    const ease = 1 - Math.exp(-step * 6);
    trader.gazeYaw += (lookYaw - trader.gazeYaw) * ease;
    trader.gazePitch += (lookPitch - trader.gazePitch) * ease;
    if (trader.wave >= 0) {
      trader.wave += step;
      if (trader.wave > WAVE_TIME) trader.wave = -1;
    }
    if (trader.nod >= 0) {
      trader.nod += step;
      if (trader.nod > 0.9) trader.nod = -1;
    }
    trader.warmth += ((noticed ? 1 : 0) - trader.warmth) * (1 - Math.exp(-step * 1.5));
    // Hands on his hips for a while when no one is about.
    const hipsGoal = !noticed && trader.wave < 0 && Math.sin(t * 0.08 + 1.3) > 0.35 ? 1 : 0;
    trader.hips += (hipsGoal - trader.hips) * (1 - Math.exp(-step * 1.6));

    // --- The pose -------------------------------------------------------------
    rig.resetPose();
    const root = rig.root;
    root.position.set(spot.x, trader.ground, spot.z);
    root.rotation.set(0, trader.facing, 0);
    root.updateMatrixWorld(true);
    const s = rig.height / 1.8;
    const up = this.up;
    const forward = rig.axis(0, 0, 1, this.forward);
    const left = rig.axis(1, 0, 0, this.left);
    const w = trader.weight;
    const breath = Math.sin(t * 1.35);
    // Hips over the loaded foot, the free side dropping a little.
    this.offset.copy(left).multiplyScalar(w * 0.038 * s).addScaledVector(up, (-0.006 - Math.abs(w) * 0.012) * s);
    rig.shiftBone("Hips", this.offset);
    rig.turnBone("Hips", forward, w * 0.055);
    rig.turnBone("Hips", up, w * 0.05);
    // The torso back upright over the hips, breathing.
    rig.turnBone("Spine02", forward, -w * 0.04);
    rig.turnBone("Spine01", left, breath * 0.012 + 0.015);
    rig.turnBone("Spine", left, breath * 0.01);
    // Look: the turn shared down the neck, the head tilted kindly when greeting, a nod.
    const nod = trader.nod >= 0 ? Math.sin((trader.nod / 0.9) * Math.PI) * 0.22 : 0;
    rig.turnBone("Spine", up, trader.gazeYaw * 0.15);
    rig.turnBone("neck", up, trader.gazeYaw * 0.35);
    rig.turnBone("Head", up, trader.gazeYaw * 0.5);
    rig.turnBone("neck", rig.axis(1, 0, 0, this.scratch), -trader.gazePitch * 0.4 + nod * 0.35);
    rig.turnBone("Head", rig.axis(1, 0, 0, this.scratch), -trader.gazePitch * 0.6 + nod * 0.65);
    rig.turnBone("Head", forward, trader.warmth * 0.07 + Math.sin(t * 0.31) * 0.02);

    // Legs: feet planted where they stand at rest, the free heel lifted a little.
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      const free = Math.max(0, -w * sign);
      const foot = rig.restPoint.get(`${side}Foot`)!;
      this.scratch.set(foot.x, foot.y + free * 0.025 * s, foot.z + free * 0.02 * s);
      rig.toWorld(this.scratch, this.handTarget);
      const knee = rig.restPoint.get(`${side}Leg`)!;
      this.scratch.set(knee.x + sign * 0.05, knee.y, knee.z + 0.6);
      rig.toWorld(this.scratch, this.handPole);
      rig.solveLimb(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, this.handTarget, this.handPole);
      rig.levelFoot(`${side}Foot`);
    }

    // Arms: at his sides (swinging a hair with his breath), on his hips, or
    // the right one raised and waving.
    const hips = rig.restPoint.get("Hips")!;
    for (const side of ["Left", "Right"] as const) {
      const sign = side === "Left" ? 1 : -1;
      const shoulder = rig.restPoint.get(`${side}Arm`)!;
      // At the side, the arm hanging nearly straight, a little forward.
      const hang = 0.52 * s;
      this.handTarget.set(shoulder.x + sign * 0.035 * s, shoulder.y - hang + breath * 0.004, shoulder.z + 0.06 * s);
      this.handPole.set(shoulder.x + sign * 0.15, shoulder.y - 0.25 * s, shoulder.z - 0.6);
      // On the hip, the elbow out and back.
      this.scratch.set(hips.x + sign * 0.17 * s, hips.y + 0.04 * s, hips.z + 0.01);
      this.scratch2.set(shoulder.x + sign * 0.65, shoulder.y - 0.15, shoulder.z - 0.35);
      this.handTarget.lerp(this.scratch, trader.hips);
      this.handPole.lerp(this.scratch2, trader.hips);
      let waving = 0;
      if (side === "Right" && trader.wave >= 0) {
        // Raised beside the head, the forearm swinging side to side from the elbow.
        waving = Math.min(1, trader.wave / 0.45, (WAVE_TIME - trader.wave) / 0.45);
        waving = waving * waving * (3 - 2 * waving);
        const swing = Math.sin(trader.wave * 10.5) * 0.11 * s;
        this.scratch.set(shoulder.x - 0.16 * s + swing, shoulder.y + 0.4 * s, shoulder.z + 0.13 * s);
        this.scratch2.set(shoulder.x - 0.7, shoulder.y - 0.2, shoulder.z - 0.05);
        this.handTarget.lerp(this.scratch, waving);
        this.handPole.lerp(this.scratch2, waving);
      }
      rig.toWorld(this.handTarget, this.handTarget);
      rig.toWorld(this.handPole, this.handPole);
      rig.solveLimb(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, this.handTarget, this.handPole);
      if (waving > 0) rig.turnBone(`${side}Hand`, forward, Math.sin(trader.wave * 10.5) * 0.35 * waving);
    }
  }

  private pose(trader: Trader, step: number, visitor: THREE.Vector3 | null): void {
    const { spot } = trader;
    const figure = trader.figure!;
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
          if (trader.spot.kit !== "armed") trader.wave = 0;
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
    for (const trader of this.traders.values()) {
      trader.figure?.dispose();
      trader.rig?.dispose();
    }
    this.traders.clear();
    this.group.removeFromParent();
  }
}
