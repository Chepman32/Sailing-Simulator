import * as THREE from "three";
import { ActorBody, restPose, type BodyPose } from "./ActorBody";
import type { ActorLook, GunKind } from "./ActorLooks";
import type { DroneCrew } from "../combat/DroneSystem";
import type { CrewSeat } from "../combat/PatrolBoatModel";
import type { CraftSeat } from "../vessel/CraftModels";

/**
 * People in boats: the crews of Vanguard's patrol boats (a helmsman at the
 * console, a gunner behind the bow gun, a lookout aft), and the skipper's
 * own party in the story's boats (the skipper at the wheel or the tiller,
 * Mark and Luis on the thwarts). Their bodies are the story's rigged
 * figures (`ActorBody`), parented to the boat and posed in her frame.
 */

export type FigureSource = (model: "man" | "woman") => { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] } | null;

const local = new THREE.Vector3();

function makeBody(source: FigureSource, look: ActorLook, gun: GunKind | null): ActorBody | null {
  const model = source(look.model);
  if (!model) return null;
  try {
    return new ActorBody(model.scene, model.animations, look, gun);
  } catch (error) {
    console.warn("A boat's figure could not be made.", error);
    return null;
  }
}

/** A patrol boat's crew. */
export class PatrolCrew implements DroneCrew {
  private readonly bodies: { body: ActorBody; seat: CrewSeat; pose: BodyPose; sway: number }[] = [];

  constructor(
    private readonly root: THREE.Group,
    seats: readonly CrewSeat[],
    looks: readonly ActorLook[],
    source: FigureSource,
  ) {
    seats.forEach((seat, index) => {
      const look = looks[index % looks.length]!;
      const body = makeBody(source, look, seat.role === "helm" ? "pistol" : "carbine");
      if (!body) return;
      const pose = restPose();
      if (seat.role === "lookout") {
        pose.sit = 1;
        pose.seat = 0.42;
      }
      root.add(body.root);
      this.bodies.push({ body, seat, pose, sway: Math.random() * 6 });
    });
  }

  /** True once there is someone aboard to draw. */
  get manned(): boolean {
    return this.bodies.length > 0;
  }

  update(delta: number, aim: THREE.Vector3 | null): void {
    for (const entry of this.bodies) {
      const { body, seat, pose } = entry;
      entry.sway += delta;
      if (seat.role === "gunner") {
        // Behind the gun, aiming where it points; braced against the boat's motion.
        pose.ready = aim ? 1 : 0.4;
        pose.crouch = 0.25;
        pose.aim = aim ? this.root.worldToLocal(local.copy(aim)).clone() : null;
      } else if (seat.role === "helm") {
        pose.ready = 0;
        pose.crouch = 0.12 + Math.sin(entry.sway * 1.7) * 0.03;
        pose.aim = null;
      } else {
        pose.aim = aim ? this.root.worldToLocal(local.copy(aim)).clone() : null;
      }
      body.update(delta, seat.x, seat.y, seat.z, seat.yaw, pose);
    }
  }

  dispose(): void {
    for (const { body } of this.bodies) {
      body.root.removeFromParent();
      body.dispose();
    }
    this.bodies.length = 0;
  }
}

/** Who sits in the skipper's boat (the skipper himself first). */
export type PartyMember = { id: string; look: ActorLook; gun?: GunKind | null };

/** The skipper's party in the story's boats: posed on the craft's seats, in her frame. */
export class BoatParty {
  readonly group = new THREE.Group();
  private readonly bodies = new Map<string, { body: ActorBody; pose: BodyPose }>();
  private wanted: readonly PartyMember[] = [];

  constructor(private readonly source: FigureSource) {
    this.group.name = "BoatParty";
  }

  /** Who is aboard now (an empty list: nobody to draw, as on the catamaran, whose skipper is her own). */
  set(members: readonly PartyMember[]): void {
    this.wanted = members;
    const ids = new Set(members.map((member) => member.id));
    for (const [id, entry] of this.bodies) {
      if (ids.has(id)) continue;
      entry.body.root.removeFromParent();
      entry.body.dispose();
      this.bodies.delete(id);
    }
  }

  /** Poses them on `seats` (the helmsman's first); `skipperVisible` false hides the skipper (seen through his own eyes). */
  update(delta: number, seats: readonly CraftSeat[], skipperVisible: boolean, rudder: number, time: number): void {
    this.wanted.forEach((member, index) => {
      let entry = this.bodies.get(member.id);
      if (!entry) {
        const body = makeBody(this.source, member.look, member.gun ?? null);
        if (!body) return;
        entry = { body, pose: restPose() };
        this.group.add(body.root);
        this.bodies.set(member.id, entry);
      }
      const seat = seats[Math.min(index, seats.length - 1)];
      if (!seat) return;
      const { body, pose } = entry;
      body.root.visible = index > 0 || skipperVisible;
      pose.sit = seat.sit ? 1 : 0;
      pose.seat = seat.seat;
      pose.ready = index === 1 ? 0.35 : 0;
      // The helmsman leans into the turn with the tiller.
      const yaw = seat.yaw + (index === 0 ? -rudder * 0.25 : Math.sin(time * 0.6 + index) * 0.15);
      body.update(delta, seat.x, seat.y, seat.z, yaw, pose);
    });
  }

  dispose(): void {
    this.set([]);
    this.group.removeFromParent();
  }
}
