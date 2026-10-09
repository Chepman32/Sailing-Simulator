import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { animationInterval } from "./BodyRig";
import { WHALE_NEUTRAL_BENDS } from "./WhaleBehavior";
import { createBreachState, stepBreach, type BreachState } from "./WhaleBreach";
import { createWhaleRig, type WhaleRig } from "./WhaleController";
import { contactIntensity, SurfacePoint, type MarineWorld, type VesselState, type WaterEffects } from "./WaterContact";
import { isDetailedSwimAsset } from "./WildlifeModel";

/**
 * Draws the rare distant breach (`WhaleBreach`) with its own copy of the
 * whale. The copy is hidden between breaches, so it costs nothing then.
 *
 * Water contact comes from points along the body crossing the rendered
 * surface: the head bursting out throws a sheet of spray along the climb,
 * the body falling back blasts out a wall of water, mist and ring waves where
 * it actually meets the sea, and the churned water lingers.
 */

/** Points along the body, whale frame (y up, z toward the head), metres, with the mass behind each. */
const CONTACT_POINTS = [
  { y: 0.6, z: 7.4, mass: 9000 },
  { y: 1.6, z: 3.2, mass: 18000 },
  { y: 1.2, z: -1.5, mass: 18000 },
  { y: 0.5, z: -5.5, mass: 9000 },
  { y: -0.6, z: -8.6, mass: 2600 },
] as const;

type Contact = {
  local: THREE.Vector3;
  world: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  tracker: SurfacePoint;
  mass: number;
};

export class WhaleBreachController {
  private readonly rig?: WhaleRig;
  private readonly state: BreachState = createBreachState(Math.random);
  private readonly contacts: Contact[] = [];
  private readonly cameraPosition = new THREE.Vector3();
  private readonly surfacePoint = new THREE.Vector3();
  private animationClock = 0;
  private shedTime = 0;

  constructor(
    group: THREE.Group,
    private readonly ocean: OceanSystem,
    private readonly world: MarineWorld,
    assets: AssetManager,
    private readonly effects: WaterEffects,
  ) {
    const asset = assets.animated("whale");
    if (!asset || !isDetailedSwimAsset(asset)) return;
    this.rig = createWhaleRig(group, asset);
    this.rig.root.name = "Breaching_Whale_Root";
    this.rig.root.visible = false;
    for (const point of CONTACT_POINTS) {
      this.contacts.push({
        local: new THREE.Vector3(0, point.y, point.z),
        world: new THREE.Vector3(),
        previous: new THREE.Vector3(Number.NaN, 0, 0),
        velocity: new THREE.Vector3(),
        tracker: new SurfacePoint(),
        mass: point.mass,
      });
    }
  }

  /** The breacher's own materials (for the underwater treatment). */
  get materials(): readonly THREE.Material[] {
    return this.rig?.materials ?? [];
  }

  /** Read-only view of the breach, for tests and tuning. */
  get breach(): Readonly<BreachState> {
    return this.state;
  }

  update(delta: number, vessel: VesselState, camera: THREE.Camera): void {
    const rig = this.rig;
    if (!rig || delta <= 0) return;
    const state = this.state;
    const entered = stepBreach(state, this.world, vessel, delta, Math.random);
    if (entered === "splash") {
      // The crash throws up a cloud of spray far above the splash itself.
      this.surfacePoint.set(state.x, this.ocean.sample(state.x, state.z).height, state.z);
      this.effects.splash(this.surfacePoint, 5, "blow");
      this.effects.splash(this.surfacePoint, 6, "slap");
    }
    if (entered === "run") {
      this.contacts.forEach((contact) => {
        contact.tracker.reset();
        contact.previous.set(Number.NaN, 0, 0);
      });
    }
    const active = state.phase !== "waiting";
    rig.root.visible = active;
    if (!active) return;

    rig.root.position.set(state.x, state.y, state.z);
    rig.root.rotation.set(-state.pitch, state.heading, state.roll, "YXZ");

    camera.getWorldPosition(this.cameraPosition);
    const distance = this.cameraPosition.distanceTo(rig.root.position);
    rig.tail.forEach((bone) => bone.restore());
    this.animationClock += delta;
    if (rig.secondary && this.animationClock >= animationInterval(distance)) {
      // Flippers flung wide in the air, sculling in the water.
      rig.secondary.setEffectiveWeight(state.phase === "air" ? 0.95 : 0.6);
      rig.secondary.timeScale = state.phase === "run" ? 1.6 : 0.9;
      rig.visual.mixer?.update(this.animationClock);
      this.animationClock = 0;
      rig.tail.forEach((bone) => bone.capture());
    }
    // Powerful strokes on the run; in the air the tail lags the body and
    // swings through as it falls.
    const airborne = state.phase === "air";
    rig.tail.forEach((bone, index) => {
      const stroke = state.stroke * [0.08, 0.17, 0.3][index]! * Math.sin(state.strokePhase - index * 0.8);
      const follow = airborne ? Math.max(-0.25, state.vy * 0.025) * (index + 1) * 0.5 : 0;
      bone.rotate("pitch", WHALE_NEUTRAL_BENDS[index]! + stroke + follow);
    });
    rig.root.updateMatrixWorld(true);
    this.updateContacts(delta);
  }

  dispose(): void {
    if (!this.rig) return;
    this.rig.visual.mixer?.stopAllAction();
    this.rig.materials.forEach((material) => material.dispose());
    this.rig.root.removeFromParent();
  }

  private updateContacts(delta: number): void {
    const rig = this.rig!;
    const state = this.state;
    let anyAirborne = false;
    for (const contact of this.contacts) {
      contact.world.copy(contact.local).applyMatrix4(rig.root.matrixWorld);
      if (Number.isFinite(contact.previous.x)) {
        contact.velocity.copy(contact.world).sub(contact.previous).divideScalar(Math.max(delta, 1e-3));
      } else {
        contact.velocity.set(0, 0, 0);
      }
      contact.previous.copy(contact.world);
      const surface = this.ocean.sample(contact.world.x, contact.world.z).height;
      const crossing = contact.tracker.update(contact.world.y, surface, delta);
      if (contact.tracker.clearance > 0) anyAirborne = true;
      if (!crossing) continue;
      this.surfacePoint.set(contact.world.x, surface, contact.world.z);
      const speed = contact.velocity.length();
      if (crossing === "exit" && (state.phase === "run" || state.phase === "air")) {
        // Water torn up with the body: a sheet thrown along the climb.
        this.effects.splash(this.surfacePoint, Math.min(4.5, contactIntensity(contact.mass * 0.35, speed)), "exit", contact.velocity);
        this.shedTime = 2.4;
      } else if (crossing === "entry" && (state.phase === "air" || state.phase === "splash")) {
        // Eighty tonnes coming down flat: the largest splash in the sea.
        const intensity = Math.max(3.5, Math.min(6, contactIntensity(contact.mass, speed) * 1.4));
        this.effects.splash(this.surfacePoint, intensity, "slap", contact.velocity);
        this.effects.splash(this.surfacePoint, intensity * 0.8, "entry", contact.velocity);
      }
    }
    // Water pouring off the body while it is in the air.
    if (this.shedTime > 0 && anyAirborne) {
      this.shedTime -= delta;
      for (const contact of this.contacts) {
        if (contact.tracker.clearance <= 0.2 || Math.random() > delta * 30) continue;
        this.effects.shed(contact.world, contact.velocity, 3, 0.2);
      }
    }
    // The churned water left behind keeps boiling for a while.
    if (state.phase === "splash" && Math.random() < delta * 3) {
      this.surfacePoint.set(
        state.x + (Math.random() - 0.5) * 10,
        0,
        state.z + (Math.random() - 0.5) * 10,
      );
      this.surfacePoint.y = this.ocean.sample(this.surfacePoint.x, this.surfacePoint.z).height;
      this.effects.splash(this.surfacePoint, 1.2, "breath");
    }
  }
}
