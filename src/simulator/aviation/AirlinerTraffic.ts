import * as THREE from "three";
import {
  AIRLINER_LAYER_FOLLOW,
  AIRLINER_VISUAL_SCALE,
  CONTRAIL_SAMPLE_SPACING,
  distanceGain,
  nextAirlinerDelay,
  planAirlinerRoute,
  type AirlinerRoute,
  type RandomSource,
} from "./AviationMath";
import { ContrailField } from "./ContrailField";

const MAX_AIRLINERS = 2;
const CONTRAIL_CAPACITY = 2304;
const ENGINE_MARKERS = ["EngineExhaustPort", "EngineExhaustStarboard"] as const;

type Airliner = {
  root: THREE.Group;
  engines: THREE.Vector3[];
  lights: { port: THREE.Sprite; starboard: THREE.Sprite; beacon: THREE.Sprite };
  route?: AirlinerRoute;
  elapsed: number;
  trails: number[];
  strobePhase: number;
};

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,.65)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * High-altitude airliners and their contrails. Everything lives in a sky
 * layer that follows the focus at AIRLINER_LAYER_FOLLOW, so the compressed
 * 600 m layer shows the slow parallax of cruise traffic near 10 km.
 */
export class AirlinerTraffic {
  readonly layer = new THREE.Group();
  private readonly contrails: ContrailField;
  private readonly airliners: Airliner[] = [];
  private readonly lightTexture = glowTexture();
  private readonly lightMaterials: THREE.SpriteMaterial[] = [];
  private readonly forward = new THREE.Vector3();
  private readonly engineLocal = new THREE.Vector3();
  private readonly contrailColor = new THREE.Color();
  private readonly dayContrail = new THREE.Color(0xffffff);
  private readonly nightContrail = new THREE.Color(0x9fb4d6);
  private readonly worldScratch = new THREE.Vector3();
  private nextLaunch = 0;

  constructor(
    scene: THREE.Scene,
    template: THREE.Group | undefined,
    private readonly random: RandomSource = Math.random,
  ) {
    this.layer.name = "High_Altitude_Traffic_Layer";
    scene.add(this.layer);
    this.contrails = new ContrailField(this.layer, CONTRAIL_CAPACITY);
    if (!template) return;
    for (let index = 0; index < MAX_AIRLINERS; index += 1) {
      const model = index === 0 ? template : template.clone(true);
      this.airliners.push(this.createAirliner(model, index));
    }
  }

  /** Puts one airliner mid-route with an established trail so the sky is not empty at load. */
  prewarm(seconds: number): void {
    if (this.airliners.length === 0) return;
    this.launch(this.airliners[0]);
    const step = 0.25;
    for (let time = 0; time < seconds; time += step) {
      this.contrails.advance(step);
      this.fly(this.airliners[0], step, 0);
    }
    this.nextLaunch = 18 + this.random() * 20;
  }

  update(delta: number, focus: THREE.Vector3, nightFactor: number): void {
    this.layer.position.set(focus.x * AIRLINER_LAYER_FOLLOW, 0, focus.z * AIRLINER_LAYER_FOLLOW);
    this.contrails.advance(delta);
    this.contrailColor.copy(this.dayContrail).lerp(this.nightContrail, nightFactor);
    this.contrails.setAppearance(this.contrailColor, THREE.MathUtils.lerp(1, 0.42, nightFactor));

    this.nextLaunch -= delta;
    if (this.nextLaunch <= 0) {
      const idle = this.airliners.find((airliner) => !airliner.route);
      if (idle) this.launch(idle);
      this.nextLaunch = nextAirlinerDelay(this.random);
    }
    this.airliners.forEach((airliner) => {
      if (airliner.route) this.fly(airliner, delta, nightFactor);
    });
  }

  /**
   * Loudness (0..1) of distant jet roar at the listener. It is strongest while
   * an airliner is high overhead and fades with slant distance.
   */
  roarLevel(listener: THREE.Vector3): number {
    let level = 0;
    this.airliners.forEach((airliner) => {
      if (!airliner.route) return;
      airliner.root.getWorldPosition(this.worldScratch);
      const distance = this.worldScratch.distanceTo(listener);
      level += distanceGain(distance, 640) ** 2;
    });
    return Math.min(1, level);
  }

  dispose(): void {
    this.contrails.dispose();
    this.airliners.forEach((airliner) => airliner.root.removeFromParent());
    this.airliners.length = 0;
    this.lightMaterials.forEach((material) => material.dispose());
    this.lightTexture.dispose();
    this.layer.removeFromParent();
  }

  private createAirliner(model: THREE.Group, index: number): Airliner {
    const root = new THREE.Group();
    root.name = `Airliner_${index + 1}`;
    root.rotation.order = "YXZ";
    // The GLB is authored in meters with +Z forward. The sky layer is
    // distance-compressed, so the aircraft is scaled by the same idea to keep
    // its apparent size close to cruise traffic.
    model.scale.setScalar(AIRLINER_VISUAL_SCALE);
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    root.add(model);
    const engines = ENGINE_MARKERS.map((name) => {
      const marker = model.getObjectByName(name);
      return (marker?.position.clone() ?? new THREE.Vector3(name.endsWith("Port") ? -5.8 : 5.8, -2.25, 2)).multiplyScalar(
        AIRLINER_VISUAL_SCALE,
      );
    });
    const light = (color: number, markerName: string, size: number): THREE.Sprite => {
      const material = new THREE.SpriteMaterial({
        map: this.lightTexture,
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      });
      this.lightMaterials.push(material);
      const sprite = new THREE.Sprite(material);
      const marker = model.getObjectByName(markerName);
      if (marker) sprite.position.copy(marker.position).multiplyScalar(AIRLINER_VISUAL_SCALE);
      sprite.scale.setScalar(size);
      root.add(sprite);
      return sprite;
    };
    const lights = {
      port: light(0xff4b3a, "NavPort", 2.4),
      starboard: light(0x5dff8a, "NavStarboard", 2.4),
      beacon: light(0xff2a1a, "Beacon", 2.0),
    };
    root.visible = false;
    this.layer.add(root);
    return { root, engines, lights, elapsed: 0, trails: [], strobePhase: index * 0.37 };
  }

  private launch(airliner: Airliner): void {
    const route = planAirlinerRoute(this.random);
    airliner.route = route;
    airliner.elapsed = 0;
    airliner.root.position.set(route.startX, route.altitude, route.startZ);
    airliner.root.rotation.set(0, route.heading, 0);
    airliner.root.visible = true;
    airliner.root.updateMatrix();
    this.forward.set(Math.sin(route.heading), 0, Math.cos(route.heading));
    airliner.trails = airliner.engines.map((engine) => {
      this.engineLocal.copy(engine).applyQuaternion(airliner.root.quaternion).add(airliner.root.position);
      return this.contrails.startTrail(this.engineLocal, this.forward, route.contrailLifetime);
    });
  }

  private fly(airliner: Airliner, delta: number, nightFactor: number): void {
    const route = airliner.route;
    if (!route) return;
    airliner.elapsed += delta;
    // Grow in and out of the haze at the route ends instead of popping.
    const presence = THREE.MathUtils.smoothstep(airliner.elapsed, 0, 30) *
      (1 - THREE.MathUtils.smoothstep(airliner.elapsed, route.duration - 30, route.duration));
    airliner.root.scale.setScalar(Math.max(0.001, presence));
    this.forward.set(Math.sin(route.heading), 0, Math.cos(route.heading));
    airliner.root.position.addScaledVector(this.forward, route.speed * delta);
    airliner.engines.forEach((engine, index) => {
      this.engineLocal.copy(engine).applyQuaternion(airliner.root.quaternion).add(airliner.root.position);
      const trail = airliner.trails[index];
      if (trail !== undefined) this.contrails.extendTrail(trail, this.engineLocal, this.forward, CONTRAIL_SAMPLE_SPACING);
    });

    // Anti-collision strobes on the wingtips and a red beacon, mostly visible at night.
    const time = this.contrails.clock + airliner.strobePhase;
    const strobe = (time % 1.2) < 0.06 || ((time + 0.14) % 1.2) < 0.05 ? 1 : 0;
    const beacon = Math.max(0, Math.sin(time * Math.PI * 2 * 0.9)) ** 6;
    const visibility = 0.18 + nightFactor * 0.82;
    (airliner.lights.port.material as THREE.SpriteMaterial).opacity = (0.35 + strobe * 0.65) * visibility;
    (airliner.lights.starboard.material as THREE.SpriteMaterial).opacity = (0.35 + strobe * 0.65) * visibility;
    (airliner.lights.beacon.material as THREE.SpriteMaterial).opacity = beacon * visibility;

    if (airliner.elapsed >= route.duration) {
      airliner.trails.forEach((trail) => this.contrails.endTrail(trail));
      airliner.trails.length = 0;
      airliner.route = undefined;
      airliner.root.visible = false;
    }
  }
}
