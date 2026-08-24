import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp, damp } from "../math";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { canStartBreach, DOLPHIN_STATE_DURATION, nextDolphinState, type DolphinState } from "./WildlifeState";
import { createAnimatedVisual, dampAngle, headingTo, setRandomAnimationTime, type AnimatedVisual } from "./WildlifeModel";

type Dolphin = {
  root: THREE.Group;
  visual: AnimatedVisual;
  state: DolphinState;
  stateElapsed: number;
  cooldown: number;
  jumpElapsed: number;
  side: number;
  phase: number;
  swimPhase: number;
  swimSpeed: number;
  initialized: boolean;
  jumpOrigin: THREE.Vector3;
  jumpDirection: THREE.Vector3;
  jumpHeading: number;
  splashTriggered: boolean;
};

export class DolphinController {
  private readonly dolphins: Dolphin[] = [];
  private readonly target = new THREE.Vector3();
  private readonly jumpPosition = new THREE.Vector3();
  private readonly swimTangent = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    count: number,
    private readonly onSplash: (position: THREE.Vector3, intensity: number) => void,
  ) {
    for (let index = 0; index < count; index += 1) {
      this.dolphins.push(this.createDolphin(assets, index));
    }
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    this.dolphins.forEach((dolphin, index) => {
      const animationRate = dolphin.state === "swim" ? 1 : dolphin.state === "approach" ? 1.16 : 0.9;
      if (animationDelta > 0) dolphin.visual.mixer?.update(animationDelta * animationRate);
      dolphin.stateElapsed += delta;
      dolphin.cooldown -= delta;

      if (dolphin.state === "swim") {
        this.updateSwim(dolphin, index, delta, physics);
        if (canStartBreach(physics.telemetry.forwardSpeed, dolphin.cooldown)) {
          this.transition(dolphin, "approach");
        }
      } else if (dolphin.state === "approach") {
        this.updateApproach(dolphin, delta, physics);
        if (dolphin.stateElapsed >= DOLPHIN_STATE_DURATION.approach) {
          dolphin.jumpOrigin.copy(dolphin.root.position);
          dolphin.jumpDirection.copy(physics.forward).normalize();
          dolphin.jumpHeading = physics.heading;
          dolphin.jumpElapsed = 0;
          dolphin.splashTriggered = false;
          this.transition(dolphin, "breach_ascent");
        }
      } else if (
        dolphin.state === "breach_ascent" ||
        dolphin.state === "airborne" ||
        dolphin.state === "reentry"
      ) {
        this.updateJump(dolphin, delta);
        const duration = DOLPHIN_STATE_DURATION[dolphin.state];
        if (dolphin.stateElapsed >= duration) this.transition(dolphin, nextDolphinState(dolphin.state));
      } else if (dolphin.state === "splash") {
        if (!dolphin.splashTriggered) {
          dolphin.splashTriggered = true;
          this.onSplash(dolphin.root.position, 0.8);
        }
        if (dolphin.stateElapsed >= DOLPHIN_STATE_DURATION.splash) this.transition(dolphin, "dive");
      } else if (dolphin.state === "dive") {
        this.updateDive(dolphin, delta);
        if (dolphin.stateElapsed >= DOLPHIN_STATE_DURATION.dive) {
          dolphin.cooldown = 7 + index * 3.4 + Math.random() * 5;
          this.transition(dolphin, "swim");
        }
      }
    });
  }

  dispose(): void {
    this.dolphins.forEach((dolphin) => {
      dolphin.visual.mixer?.stopAllAction();
      this.group.remove(dolphin.root);
    });
    this.dolphins.length = 0;
  }

  private createDolphin(assets: AssetManager, index: number): Dolphin {
    const visual = createAnimatedVisual(
      assets.dolphin(),
      {
        targetSize: 2.8,
        measureAxis: "x",
        // The authored model swims nose-first along -X; the simulator uses +Z.
        yaw: Math.PI / 2,
        castShadow: false,
      },
      [/swim/i],
    );
    setRandomAnimationTime(visual, 1.85 + index * 0.14);
    visual.model.name = `Rigged_Dolphin_${index + 1}`;
    const root = new THREE.Group();
    root.rotation.order = "YXZ";
    root.add(visual.model);
    this.group.add(root);

    return {
      root,
      visual,
      state: "swim",
      stateElapsed: 0,
      cooldown: 4 + index * 4,
      jumpElapsed: 0,
      side: index % 2 === 0 ? -1 : 1,
      phase: index * 2.4,
      swimPhase: index * Math.PI + Math.random() * 0.35,
      swimSpeed: 6.5 + index * 1.15 + Math.random() * 0.55,
      initialized: false,
      jumpOrigin: new THREE.Vector3(),
      jumpDirection: new THREE.Vector3(0, 0, 1),
      jumpHeading: 0,
      splashTriggered: false,
    };
  }

  private updateSwim(dolphin: Dolphin, index: number, delta: number, physics: VesselPhysics): void {
    const lateralRadius = 3.2 + index * 0.45;
    const longitudinalRadius = 10.8 + index * 1.6;
    const previousSin = Math.sin(dolphin.swimPhase);
    const previousCos = Math.cos(dolphin.swimPhase);
    const tangentLength = Math.hypot(lateralRadius * previousSin, longitudinalRadius * previousCos);
    dolphin.swimPhase += dolphin.side * dolphin.swimSpeed / Math.max(0.8, tangentLength) * delta;
    const sine = Math.sin(dolphin.swimPhase);
    const cosine = Math.cos(dolphin.swimPhase);
    this.target
      .copy(physics.position)
      .addScaledVector(physics.right, dolphin.side * 5.8 + lateralRadius * cosine)
      .addScaledVector(physics.forward, 7.5 + longitudinalRadius * sine);
    this.target.y = this.ocean.sample(this.target.x, this.target.z).height - 0.52
      + Math.sin(dolphin.swimPhase * 2 + dolphin.phase) * 0.08;

    if (!dolphin.initialized || dolphin.root.position.distanceToSquared(this.target) > 55 * 55) {
      dolphin.root.position.copy(this.target);
      dolphin.initialized = true;
    } else {
      dolphin.root.position.lerp(this.target, 1 - Math.exp(-8.2 * delta));
    }

    this.swimTangent
      .copy(physics.right)
      .multiplyScalar(-lateralRadius * sine)
      .addScaledVector(physics.forward, longitudinalRadius * cosine)
      .multiplyScalar(dolphin.side);
    const tangentHeading = Math.atan2(this.swimTangent.x, this.swimTangent.z);
    dolphin.root.rotation.y = dampAngle(dolphin.root.rotation.y, tangentHeading, 7.5, delta);
    dolphin.root.rotation.x = Math.sin(dolphin.swimPhase * 2 + dolphin.phase) * 0.055;
  }

  private updateApproach(dolphin: Dolphin, delta: number, physics: VesselPhysics): void {
    this.target
      .copy(physics.position)
      .addScaledVector(physics.right, dolphin.side * 3.8)
      .addScaledVector(physics.forward, 5.5);
    this.target.y = this.ocean.sample(this.target.x, this.target.z).height - 0.18;
    dolphin.root.position.lerp(this.target, 1 - Math.exp(-4.1 * delta));
    dolphin.root.rotation.y = dampAngle(dolphin.root.rotation.y, headingTo(dolphin.root.position, this.target), 5.2, delta);
  }

  private updateJump(dolphin: Dolphin, delta: number): void {
    dolphin.jumpElapsed += delta;
    const totalDuration =
      DOLPHIN_STATE_DURATION.breach_ascent + DOLPHIN_STATE_DURATION.airborne + DOLPHIN_STATE_DURATION.reentry;
    const t = clamp(dolphin.jumpElapsed / totalDuration, 0, 1);
    const travel = 10.8;
    this.jumpPosition.copy(dolphin.jumpOrigin).addScaledVector(dolphin.jumpDirection, travel * t);
    const waterHeight = this.ocean.sample(this.jumpPosition.x, this.jumpPosition.z).height;
    const arcHeight = Math.sin(Math.PI * t) * 4.6;
    this.jumpPosition.y = waterHeight + arcHeight - 0.18;
    dolphin.root.position.copy(this.jumpPosition);
    const verticalDerivative = Math.cos(Math.PI * t) * Math.PI * 4.6;
    dolphin.root.rotation.y = dolphin.jumpHeading;
    dolphin.root.rotation.x = -Math.atan2(verticalDerivative, travel / totalDuration) * 1.08;
  }

  private updateDive(dolphin: Dolphin, delta: number): void {
    dolphin.root.position.addScaledVector(dolphin.jumpDirection, 4.2 * delta);
    const targetDepth = this.ocean.sample(dolphin.root.position.x, dolphin.root.position.z).height - 1.8;
    dolphin.root.position.y = damp(dolphin.root.position.y, targetDepth, 3.2, delta);
    dolphin.root.rotation.x = damp(dolphin.root.rotation.x, 0.22, 4.4, delta);
  }

  private transition(dolphin: Dolphin, state: DolphinState): void {
    dolphin.state = state;
    dolphin.stateElapsed = 0;
  }
}
