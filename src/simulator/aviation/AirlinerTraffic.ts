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
import { AircraftLights } from "./AircraftLights";
import { ContrailField } from "./ContrailField";

const MAX_AIRLINERS = 2;
const CONTRAIL_CAPACITY = 2304;
const ENGINE_MARKERS = ["EngineExhaustPort", "EngineExhaustStarboard"] as const;
// Light glows are sized in model units; the visually scaled airliner needs
// them much larger to read as distant strobes rather than sub-pixel sparks.
const LIGHT_SCALE = 7;

type Airliner = {
  root: THREE.Group;
  engines: THREE.Vector3[];
  lights: AircraftLights;
  route?: AirlinerRoute;
  elapsed: number;
  trails: number[];
};

/**
 * High-altitude airliners and their contrails. Everything lives in a sky
 * layer that follows the focus at AIRLINER_LAYER_FOLLOW, so the compressed
 * 600 m layer shows the slow parallax of cruise traffic near 10 km.
 */
export class AirlinerTraffic {
  readonly layer = new THREE.Group();
  private readonly contrails: ContrailField;
  private readonly airliners: Airliner[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private reflection: THREE.Texture | null = null;
  private readonly forward = new THREE.Vector3();
  private readonly engineLocal = new THREE.Vector3();
  private readonly contrailColor = new THREE.Color();
  private readonly dayContrail = new THREE.Color(0xffffff);
  private readonly nightContrail = new THREE.Color(0x9fb4d6);
  private readonly shadowColor = new THREE.Color();
  private readonly dayShadow = new THREE.Color(0x9fb3c8);
  private readonly nightShadow = new THREE.Color(0x3b4c66);
  private readonly lightDirection = new THREE.Vector3(0.6, 0.7, -0.5);
  private readonly worldScratch = new THREE.Vector3();
  private nextLaunch = 0;

  constructor(
    scene: THREE.Scene,
    template: THREE.Group | undefined,
    private readonly glowTexture: THREE.Texture,
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

  /** Direction toward the sun (or moon at night) that lights the contrails. */
  setLightDirection(direction: THREE.Vector3): void {
    this.lightDirection.copy(direction);
  }

  /** Sky reflections give the distant fuselage its characteristic sun glint. */
  setReflection(map: THREE.Texture | null): void {
    if (map === this.reflection) return;
    const first = this.reflection === null || map === null;
    this.reflection = map;
    this.materials.forEach((material) => {
      material.envMap = map;
      material.envMapIntensity = 1.2;
      if (first) material.needsUpdate = true;
    });
  }

  update(delta: number, focus: THREE.Vector3, nightFactor: number, camera: THREE.Camera): void {
    this.layer.position.set(focus.x * AIRLINER_LAYER_FOLLOW, 0, focus.z * AIRLINER_LAYER_FOLLOW);
    this.contrails.advance(delta);
    this.contrailColor.copy(this.dayContrail).lerp(this.nightContrail, nightFactor);
    this.shadowColor.copy(this.dayShadow).lerp(this.nightShadow, nightFactor);
    this.contrails.setAppearance(this.contrailColor, this.shadowColor, THREE.MathUtils.lerp(1, 0.42, nightFactor), this.lightDirection);

    this.nextLaunch -= delta;
    if (this.nextLaunch <= 0) {
      const idle = this.airliners.find((airliner) => !airliner.route);
      if (idle) this.launch(idle);
      this.nextLaunch = nextAirlinerDelay(this.random);
    }
    this.airliners.forEach((airliner) => {
      if (airliner.route) this.fly(airliner, delta, nightFactor, camera);
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
    this.airliners.forEach((airliner) => {
      airliner.lights.dispose();
      airliner.root.removeFromParent();
    });
    this.airliners.length = 0;
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
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial && !this.materials.includes(material)) this.materials.push(material);
      });
    });
    root.add(model);
    const engines = ENGINE_MARKERS.map((name) => {
      const marker = model.getObjectByName(name);
      return (marker?.position.clone() ?? new THREE.Vector3(name.endsWith("Port") ? -5.8 : 5.8, -2.25, 2)).multiplyScalar(
        AIRLINER_VISUAL_SCALE,
      );
    });
    const lights = new AircraftLights(model, this.glowTexture, LIGHT_SCALE, index * 0.37);
    root.visible = false;
    this.layer.add(root);
    return { root, engines, lights, elapsed: 0, trails: [] };
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

  private fly(airliner: Airliner, delta: number, nightFactor: number, camera?: THREE.Camera): void {
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

    if (camera) {
      airliner.root.updateMatrixWorld(true);
      airliner.lights.update(this.contrails.clock, nightFactor, airliner.root, camera);
    }

    if (airliner.elapsed >= route.duration) {
      airliner.trails.forEach((trail) => this.contrails.endTrail(trail));
      airliner.trails.length = 0;
      airliner.route = undefined;
      airliner.root.visible = false;
    }
  }
}
