import * as THREE from "three";
import {
  coordinatedBank,
  LOW_PASS_FIRST_DELAY,
  lowPassVisibility,
  nextLowPassDelay,
  planLowPass,
  type LightAircraftKind,
  type LowPassPlan,
  type RandomSource,
} from "./AviationMath";
import { BannerTow } from "./BannerTow";

const PROPELLER_VISUAL_RATE = 47;
const NIGHT_GROUNDING = 0.5;

type AircraftVisual = {
  kind: LightAircraftKind;
  root: THREE.Group;
  propeller?: THREE.Object3D;
  hook: THREE.Vector3;
};

export type LowPassAudioState = {
  active: boolean;
  kind: LightAircraftKind;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  presence: number;
};

/**
 * One sightseeing floatplane or banner-tow plane at a time makes a low pass
 * beside the yacht, then the sky stays quiet for a while. Flights are daytime
 * only: a pass already under way when night falls is allowed to finish.
 */
export class LowPassAircraft {
  private readonly visuals: AircraftVisual[] = [];
  private readonly banner: BannerTow;
  private readonly propDiscMaterial = new THREE.MeshBasicMaterial({
    color: 0x2b2f35,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly propDiscGeometry = new THREE.CircleGeometry(1, 28);
  private readonly hookWorld = new THREE.Vector3();
  private readonly audio: LowPassAudioState = {
    active: false,
    kind: "seaplane",
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    presence: 0,
  };
  private active?: AircraftVisual;
  private plan?: LowPassPlan;
  private heading = 0;
  private elapsed = 0;
  private wait = LOW_PASS_FIRST_DELAY;
  private lastKind: LightAircraftKind = Math.random() < 0.5 ? "seaplane" : "banner";

  constructor(
    scene: THREE.Scene,
    templates: Partial<Record<LightAircraftKind, THREE.Group>>,
    private readonly random: RandomSource = Math.random,
  ) {
    this.banner = new BannerTow(scene);
    (Object.entries(templates) as Array<[LightAircraftKind, THREE.Group | undefined]>).forEach(([kind, model]) => {
      if (!model) return;
      const root = new THREE.Group();
      root.name = kind === "banner" ? "Banner_Tow_Flight_Root" : "Tourist_Seaplane_Flight_Root";
      root.rotation.order = "YXZ";
      // Authored in meters with +Y up and the nose along +Z, matching the
      // simulator axes, so no corrective rotation is applied here.
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = false;
          object.receiveShadow = false;
        }
      });
      root.add(model);
      const propeller = model.getObjectByName("Propeller") ?? undefined;
      if (propeller) {
        const disc = new THREE.Mesh(this.propDiscGeometry, this.propDiscMaterial);
        disc.name = "Propeller_Motion_Disc";
        disc.position.z = 0.16;
        propeller.add(disc);
      }
      const hookMarker = model.getObjectByName("TowHook");
      const hook = hookMarker ? hookMarker.position.clone() : new THREE.Vector3(0, 0.2, -3.8);
      root.visible = false;
      scene.add(root);
      this.visuals.push({ kind, root, propeller, hook });
    });
  }

  get audioState(): LowPassAudioState {
    return this.audio;
  }

  update(delta: number, focus: THREE.Vector3, nightFactor: number): void {
    if (this.visuals.length === 0) return;
    if (!this.plan) {
      this.wait -= delta;
      if (this.wait <= 0) {
        if (nightFactor < NIGHT_GROUNDING) this.launch(focus);
        else this.wait = 10;
      }
      this.audio.active = false;
      this.audio.presence = 0;
      return;
    }
    this.fly(delta);
  }

  reset(): void {
    this.finish();
    this.wait = 6;
  }

  dispose(): void {
    this.visuals.forEach((visual) => visual.root.removeFromParent());
    this.visuals.length = 0;
    this.banner.dispose();
    this.propDiscGeometry.dispose();
    this.propDiscMaterial.dispose();
  }

  private launch(focus: THREE.Vector3): void {
    const available = this.visuals.map((visual) => visual.kind);
    const preferred: LightAircraftKind = this.lastKind === "banner" ? "seaplane" : "banner";
    const kind = available.includes(preferred) && this.random() < 0.7 ? preferred : available[Math.floor(this.random() * available.length)];
    const visual = this.visuals.find((candidate) => candidate.kind === kind);
    if (!visual) return;
    this.lastKind = kind;
    this.plan = planLowPass(this.random, focus.x, focus.z, kind);
    this.active = visual;
    this.heading = this.plan.heading;
    this.elapsed = 0;
    visual.root.position.set(this.plan.startX, this.plan.altitude, this.plan.startZ);
    visual.root.rotation.set(0, this.heading, 0);
    visual.root.visible = true;
    if (kind === "banner") {
      this.hookPosition(visual);
      this.banner.prepare(this.hookWorld, this.heading, this.plan.observerSide);
      this.banner.setVisible(true);
    }
  }

  private fly(delta: number): void {
    const plan = this.plan;
    const visual = this.active;
    if (!plan || !visual) return;
    this.elapsed += delta;
    this.heading += plan.turnRate * delta;
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);
    const climb = Math.cos(this.elapsed * 0.11) * 0.22;
    visual.root.position.x += forwardX * plan.speed * delta;
    visual.root.position.z += forwardZ * plan.speed * delta;
    visual.root.position.y = plan.altitude + Math.sin(this.elapsed * 0.11) * 2;
    // Rudder/aileron trim wobble keeps the pass from looking rail-guided.
    const wobble = Math.sin(this.elapsed * 0.7 + plan.speed) * 0.025;
    visual.root.rotation.set(
      -Math.atan2(climb, plan.speed) - 0.035,
      this.heading,
      -coordinatedBank(plan.speed, plan.turnRate) + wobble,
    );
    if (visual.propeller) visual.propeller.rotation.z += PROPELLER_VISUAL_RATE * delta;

    if (visual.kind === "banner") {
      this.hookPosition(visual);
      this.banner.update(delta, this.hookWorld, plan.speed);
    }

    this.audio.active = true;
    this.audio.kind = visual.kind;
    this.audio.position.copy(visual.root.position);
    this.audio.velocity.set(forwardX * plan.speed, climb, forwardZ * plan.speed);
    this.audio.presence = lowPassVisibility(this.elapsed, plan.duration);

    if (this.elapsed >= plan.duration) {
      this.finish();
      this.wait = nextLowPassDelay(this.random);
    }
  }

  private hookPosition(visual: AircraftVisual): void {
    visual.root.updateMatrixWorld(true);
    this.hookWorld.copy(visual.hook).applyMatrix4(visual.root.matrixWorld);
  }

  private finish(): void {
    if (this.active) this.active.root.visible = false;
    this.banner.setVisible(false);
    this.active = undefined;
    this.plan = undefined;
    this.audio.active = false;
    this.audio.presence = 0;
  }
}
