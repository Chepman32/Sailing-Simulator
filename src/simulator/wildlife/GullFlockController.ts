import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { createAnimatedVisual, dampAngle, type AnimatedVisual } from "./WildlifeModel";

type Gull = {
  root: THREE.Group;
  visual: AnimatedVisual;
  center: THREE.Vector3;
  radius: number;
  direction: number;
  heading: number;
  altitude: number;
  speed: number;
  age: number;
  phase: number;
  flap?: THREE.AnimationAction;
  glide?: THREE.AnimationAction;
  initialized: boolean;
};

export class GullFlockController {
  private readonly gulls: Gull[] = [];

  constructor(
    private readonly group: THREE.Group,
    assets: AssetManager,
    qualityCount: number,
  ) {
    const gullCount = qualityCount > 1 ? 4 : 2;
    for (let index = 0; index < gullCount; index += 1) {
      const asset = assets.animated("seagull");
      if (!asset) break;
      const visual = createAnimatedVisual(
        asset,
        { targetSize: 1.4, measureAxis: "x", pitch: -Math.PI / 2, castShadow: false },
      );
      visual.model.name = `Rigged_Seagull_${index + 1}`;
      const flapClip = visual.clips.find((clip) => /^flap$/i.test(clip.name));
      const glideClip = visual.clips.find((clip) => /planer|glide/i.test(clip.name));
      let flap: THREE.AnimationAction | undefined;
      let glide: THREE.AnimationAction | undefined;
      if (visual.mixer && flapClip) {
        flap = visual.mixer.clipAction(flapClip).reset().play();
        flap.time = Math.random() * Math.max(0.01, flapClip.duration);
      }
      if (visual.mixer && glideClip) {
        glide = visual.mixer.clipAction(glideClip).reset().play();
        glide.time = Math.random() * Math.max(0.01, glideClip.duration);
        glide.setEffectiveWeight(0);
      }
      const root = new THREE.Group();
      root.name = `Seagull_Flight_Root_${index + 1}`;
      root.rotation.order = "YXZ";
      root.add(visual.model);
      group.add(root);
      this.gulls.push({
        root,
        visual,
        center: new THREE.Vector3(),
        radius: 24 + index * 3.4 + Math.random() * 7,
        direction: index % 2 === 0 ? 1 : -1,
        heading: index * 1.3,
        altitude: 12 + index * 1.25 + Math.random() * 4,
        speed: 7 + Math.random() * 3.5,
        age: 0,
        phase: index * 1.7 + Math.random(),
        flap,
        glide,
        initialized: false,
      });
    }
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    this.gulls.forEach((gull, index) => {
      if (!gull.initialized) this.initialize(gull, physics, index);
      if (gull.root.position.distanceToSquared(physics.position) > 190 * 190) {
        gull.initialized = false;
        this.initialize(gull, physics, index);
      }
      gull.age += delta;
      gull.center.lerp(physics.position, 1 - Math.exp(-0.06 * delta));

      const offsetX = gull.root.position.x - gull.center.x;
      const offsetZ = gull.root.position.z - gull.center.z;
      const radialAngle = Math.atan2(offsetX, offsetZ);
      const tangentHeading = radialAngle + gull.direction * Math.PI * 0.5;
      const radialError = Math.hypot(offsetX, offsetZ) - gull.radius;
      const desiredHeading = tangentHeading + gull.direction * THREE.MathUtils.clamp(radialError * 0.045, -0.42, 0.42);
      gull.heading = dampAngle(gull.heading, desiredHeading, 2.1, delta);
      gull.root.position.x += Math.sin(gull.heading) * gull.speed * delta;
      gull.root.position.z += Math.cos(gull.heading) * gull.speed * delta;
      gull.root.position.y = gull.altitude + Math.sin(gull.age * 0.34 + gull.phase) * 1.8;

      const glide = THREE.MathUtils.smoothstep(Math.sin(gull.age * 0.42 + gull.phase), -0.15, 0.72);
      if (gull.flap) {
        gull.flap.timeScale = 1.05 + (1 - glide) * 0.38;
        gull.flap.setEffectiveWeight(1 - glide * 0.88);
      }
      gull.glide?.setEffectiveWeight(glide);
      if (animationDelta > 0) gull.visual.mixer?.update(animationDelta);
      gull.root.rotation.y = gull.heading;
      gull.root.rotation.x = Math.sin(gull.age * 0.21 + gull.phase) * 0.035;
      gull.root.rotation.z = -gull.direction * (0.16 + Math.abs(radialError) * 0.005);
    });
  }

  dispose(): void {
    this.gulls.forEach((gull) => {
      gull.visual.mixer?.stopAllAction();
      this.group.remove(gull.root);
    });
    this.gulls.length = 0;
  }

  private initialize(gull: Gull, physics: VesselPhysics, index: number): void {
    gull.center.copy(physics.position).add(new THREE.Vector3(index % 2 === 0 ? 18 : -18, 0, 25));
    const angle = index / Math.max(1, this.gulls.length) * Math.PI * 2;
    gull.root.position.set(
      gull.center.x + Math.sin(angle) * gull.radius,
      gull.altitude,
      gull.center.z + Math.cos(angle) * gull.radius,
    );
    gull.heading = angle + gull.direction * Math.PI * 0.5;
    gull.root.rotation.y = gull.heading;
    gull.initialized = true;
  }
}
