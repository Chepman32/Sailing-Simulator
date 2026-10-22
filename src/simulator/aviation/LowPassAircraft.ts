import * as THREE from "three";
import { AircraftLights } from "./AircraftLights";
import {
  coordinatedBank,
  LOW_PASS_FIRST_DELAY,
  lowPassTurnRate,
  lowPassVisibility,
  nextLowPassDelay,
  planLowPass,
  planOrbit,
  turbulence,
  type LightAircraftKind,
  type LowPassPlan,
  type RandomSource,
} from "./AviationMath";
import { BannerTow } from "./BannerTow";

// Apparent blade rotation: slow enough to read as a filmed propeller instead
// of frame-rate aliasing; the motion disc carries the sense of speed.
const PROPELLER_VISUAL_RATE = 7.5;
const NIGHT_GROUNDING = 0.5;
const ORBIT_SHARE = 0.65;
const ROLL_RESPONSE = 1.6;

type AircraftVisual = {
  kind: LightAircraftKind;
  root: THREE.Group;
  propeller?: THREE.Object3D;
  hook: THREE.Vector3;
  lights: AircraftLights;
  materials: THREE.MeshStandardMaterial[];
};

export type LowPassAudioState = {
  active: boolean;
  kind: LightAircraftKind;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  presence: number;
};

function propellerDiscTexture(): THREE.CanvasTexture {
  // Radial motion blur of a two-blade propeller with yellow-and-white tips:
  // a faint hub haze, a darker blade band and bright tip rings.
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, "rgba(30,32,35,0)");
    gradient.addColorStop(0.2, "rgba(30,32,35,0.12)");
    gradient.addColorStop(0.62, "rgba(30,32,35,0.16)");
    gradient.addColorStop(0.8, "rgba(30,32,35,0.1)");
    gradient.addColorStop(0.84, "rgba(240,240,240,0.32)");
    gradient.addColorStop(0.88, "rgba(245,196,0,0.42)");
    gradient.addColorStop(0.97, "rgba(245,196,0,0.3)");
    gradient.addColorStop(1, "rgba(245,196,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One sightseeing floatplane or banner-tow plane at a time. The floatplane
 * usually flies a banked sightseeing circle around the yacht; otherwise an
 * aircraft makes a straight low pass beside it. Flights are daytime only: a
 * pass already under way when night falls is allowed to finish.
 */
export class LowPassAircraft {
  private readonly visuals: AircraftVisual[] = [];
  private readonly banner: BannerTow;
  private readonly discTexture = propellerDiscTexture();
  private readonly discMaterial = new THREE.MeshBasicMaterial({
    map: this.discTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly discGeometry = new THREE.CircleGeometry(1, 48);
  private readonly hookWorld = new THREE.Vector3();
  private readonly audio: LowPassAudioState = {
    active: false,
    kind: "seaplane",
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    presence: 0,
  };
  private reflection: THREE.Texture | null = null;
  private active?: AircraftVisual;
  private plan?: LowPassPlan;
  private heading = 0;
  private bank = 0;
  private elapsed = 0;
  private flightTime = 0;
  private turbulenceSeed = 0;
  private wait = LOW_PASS_FIRST_DELAY;
  private lastKind: LightAircraftKind = Math.random() < 0.5 ? "seaplane" : "banner";

  constructor(
    scene: THREE.Scene,
    templates: Partial<Record<LightAircraftKind, THREE.Group>>,
    glowTexture: THREE.Texture,
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
      const materials: THREE.MeshStandardMaterial[] = [];
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = false;
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial && !materials.includes(material)) materials.push(material);
        });
      });
      root.add(model);
      const propeller = model.getObjectByName("Propeller") ?? undefined;
      if (propeller) {
        const disc = new THREE.Mesh(this.discGeometry, this.discMaterial);
        disc.name = "Propeller_Motion_Disc";
        disc.position.z = 0.16;
        disc.renderOrder = 3;
        propeller.add(disc);
        // Ghosted blades under the motion disc read as a spinning propeller.
        const blades = propeller.getObjectByName("Propeller_Blades");
        if (blades instanceof THREE.Mesh && blades.material instanceof THREE.MeshStandardMaterial) {
          blades.material.transparent = true;
          blades.material.opacity = 0.32;
          blades.material.depthWrite = false;
        }
      }
      const hookMarker = model.getObjectByName("TowHook");
      const hook = hookMarker ? hookMarker.position.clone() : new THREE.Vector3(0, 0.2, -3.8);
      root.visible = false;
      scene.add(root);
      this.visuals.push({ kind, root, propeller, hook, lights: new AircraftLights(model, glowTexture, 1), materials });
    });
  }

  get audioState(): LowPassAudioState {
    return this.audio;
  }

  /** Applies the sky reflection map to every paint and glass material. */
  setReflection(map: THREE.Texture | null): void {
    if (map === this.reflection) return;
    const first = this.reflection === null || map === null;
    this.reflection = map;
    this.visuals.forEach((visual) =>
      visual.materials.forEach((material) => {
        material.envMap = map;
        material.envMapIntensity = /glass/i.test(material.name) ? 1.9 : /lens/i.test(material.name) ? 0.6 : 1.1;
        if (first) material.needsUpdate = true;
      }),
    );
  }

  update(delta: number, focus: THREE.Vector3, nightFactor: number, camera: THREE.Camera): void {
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
    this.fly(delta, nightFactor, camera);
  }

  reset(): void {
    this.finish();
    this.wait = 6;
  }

  dispose(): void {
    this.visuals.forEach((visual) => {
      visual.lights.dispose();
      visual.root.removeFromParent();
    });
    this.visuals.length = 0;
    this.banner.dispose();
    this.discGeometry.dispose();
    this.discMaterial.dispose();
    this.discTexture.dispose();
  }

  private launch(focus: THREE.Vector3): void {
    const available = this.visuals.map((visual) => visual.kind);
    const preferred: LightAircraftKind = this.lastKind === "banner" ? "seaplane" : "banner";
    const kind = available.includes(preferred) && this.random() < 0.7 ? preferred : available[Math.floor(this.random() * available.length)];
    const visual = this.visuals.find((candidate) => candidate.kind === kind);
    if (!visual) return;
    this.lastKind = kind;
    this.plan = kind === "seaplane" && this.random() < ORBIT_SHARE ? planOrbit(this.random, focus.x, focus.z) : planLowPass(this.random, focus.x, focus.z, kind);
    this.active = visual;
    this.heading = this.plan.heading;
    this.bank = 0;
    this.elapsed = 0;
    this.turbulenceSeed = this.random() * 100;
    visual.root.position.set(this.plan.startX, this.plan.altitude, this.plan.startZ);
    visual.root.rotation.set(0, this.heading, 0);
    visual.root.visible = true;
    if (kind === "banner") {
      this.hookPosition(visual);
      this.banner.prepare(this.hookWorld, this.heading, this.plan.observerSide);
      this.banner.setVisible(true);
    }
  }

  private fly(delta: number, nightFactor: number, camera: THREE.Camera): void {
    const plan = this.plan;
    const visual = this.active;
    if (!plan || !visual) return;
    this.elapsed += delta;
    this.flightTime += delta;
    const turnRate = lowPassTurnRate(plan, this.elapsed);
    this.heading += turnRate * delta;
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);
    const gust = turbulence(this.elapsed, this.turbulenceSeed);
    // Roll follows the coordinated bank with a pilot-like lag; positive turn
    // rate (right turn) means right wing down, i.e. negative roll about +Z.
    this.bank = THREE.MathUtils.damp(this.bank, coordinatedBank(plan.speed, turnRate), ROLL_RESPONSE, delta);
    // A slow descent through the sightseeing circle, then a climb-out.
    const orbitSink = plan.mode === "orbit" ? -8 * Math.sin(Math.PI * THREE.MathUtils.clamp((this.elapsed - plan.turnStart) / Math.max(1, plan.turnEnd - plan.turnStart), 0, 1)) : 0;
    const altitude = plan.altitude + orbitSink + Math.sin(this.elapsed * 0.11) * 2 + gust.heave;
    const climbRate = (altitude - visual.root.position.y) / Math.max(delta, 1e-3);
    visual.root.position.x += forwardX * plan.speed * delta;
    visual.root.position.z += forwardZ * plan.speed * delta;
    visual.root.position.y = altitude;
    // Nose attitude: cruise trim, extra back pressure in the turn, flight path angle.
    const turnLoad = 1 / Math.max(0.5, Math.cos(this.bank)) - 1;
    const pitch = 0.035 + turnLoad * 0.12 + Math.atan2(THREE.MathUtils.clamp(climbRate, -4, 4), plan.speed) + gust.pitch;
    visual.root.rotation.set(-pitch, this.heading, -this.bank + gust.roll);
    if (visual.propeller) visual.propeller.rotation.z += PROPELLER_VISUAL_RATE * delta;

    const presence = lowPassVisibility(this.elapsed, plan.duration);
    visual.root.updateMatrixWorld(true);
    visual.lights.update(this.flightTime, nightFactor, visual.root, camera, presence);

    if (visual.kind === "banner") {
      this.hookPosition(visual);
      this.banner.update(delta, this.hookWorld, plan.speed);
    }

    this.audio.active = true;
    this.audio.kind = visual.kind;
    this.audio.position.copy(visual.root.position);
    this.audio.velocity.set(forwardX * plan.speed, THREE.MathUtils.clamp(climbRate, -4, 4), forwardZ * plan.speed);
    this.audio.presence = presence;

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
