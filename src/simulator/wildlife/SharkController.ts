import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import type { OceanSystem } from "../environment/OceanSystem";
import { animationInterval, BodyPoint, findBone, ProceduralBone } from "./BodyRig";
import {
  createSharkAgent,
  SHARK_CAUDAL_TIP,
  SHARK_DORSAL_TIP,
  stepShark,
  type SharkAgent,
} from "./SharkBehavior";
import { SurfacePoint, type MarineWorld, type VesselState, type WaterEffects } from "./WaterContact";
import { createAnimatedVisual, type AnimatedVisual } from "./WildlifeModel";

/**
 * Renders the shark described by {@link SharkBehavior}.
 *
 * The authored swim clip already beats the tail from side to side with the
 * body following, so it is kept, but driven by the behaviour: its phase is
 * the shark's own tail-beat phase (faster with speed and effort) and its
 * weight is how hard the shark is working, so a gliding shark barely moves
 * its tail and a bursting one thrashes. On top, the spine curves into turns
 * and the head leads them.
 */

/** Spine from the head back, with each segment's centre along the body (m). */
const SPINE = [
  { name: "Spine1.13", centre: 1.03 },
  { name: "Spine2.14", centre: 0.25 },
  { name: "Spine3.15", centre: -0.44 },
  { name: "Spine4.16", centre: -1 },
  { name: "Spine5.17", centre: -1.56 },
  { name: "Spine6.18", centre: -2 },
] as const;
const HEAD = { name: "Head.5", centre: 2.1 } as const;

/** Scene-linear albedo of a grey reef shark's back and belly. */
const SHARK_BACK = new THREE.Color().setRGB(0.085, 0.1, 0.11, THREE.LinearSRGBColorSpace);
const SHARK_BELLY_COLOUR = new THREE.Color().setRGB(0.6, 0.62, 0.62, THREE.LinearSRGBColorSpace);

/**
 * Dark above, pale below, with a soft line along the flank, from the
 * rest-pose normal so the boundary stays on the body as it bends.
 */
function applyCountershading(material: THREE.MeshStandardMaterial, back: THREE.Color, belly: THREE.Color): void {
  patchMaterialShader(material, "countershading-v1", (shader) => {
    shader.uniforms.uBackColour = { value: back };
    shader.uniforms.uBellyColour = { value: belly };
    shader.vertexShader = injectAfter(shader.vertexShader, "common", "varying float vCountershade;");
    shader.vertexShader = injectAfter(shader.vertexShader, "beginnormal_vertex", "vCountershade = normalize(objectNormal).y;");
    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "common",
      `uniform vec3 uBackColour;
      uniform vec3 uBellyColour;
      varying float vCountershade;`,
    );
    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "color_fragment",
      "diffuseColor.rgb *= mix(uBellyColour, uBackColour, smoothstep(-0.35, 0.25, vCountershade));",
    );
  });
}

type TrackedPoint = {
  point: BodyPoint;
  tracker: SurfacePoint;
  position: THREE.Vector3;
  trailDistance: number;
};

type Shark = {
  agent?: SharkAgent;
  root: THREE.Group;
  visual: AnimatedVisual;
  swim?: THREE.AnimationAction;
  spine: ProceduralBone[];
  head?: ProceduralBone;
  dorsal?: TrackedPoint;
  caudal?: TrackedPoint;
  animationClock: number;
};

export class SharkController {
  private readonly shark?: Shark;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly surfacePoint = new THREE.Vector3();
  private readonly materials: THREE.Material[] = [];

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    private readonly world: MarineWorld,
    assets: AssetManager,
    private readonly effects: WaterEffects,
  ) {
    const asset = assets.animated("shark");
    if (!asset) return;
    const visual = createAnimatedVisual(asset, { targetSize: 5.6, measureAxis: "z", castShadow: false }, [
      /^swimming$/iu,
      /swim/iu,
    ]);
    visual.model.name = "Rigged_Shark";
    // The source ships without a base colour, which renders white and turns
    // into a pale ghost under water. Sharks are countershaded: a dark back
    // that makes them a shadow from above, a pale belly from below.
    visual.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      const shaded = sources.map((source) => {
        const material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.setRGB(1, 1, 1);
          material.roughness = 0.52;
          material.metalness = 0;
          applyCountershading(material, SHARK_BACK, SHARK_BELLY_COLOUR);
        }
        this.materials.push(material);
        return material;
      });
      object.material = Array.isArray(object.material) ? shaded : shaded[0]!;
    });
    const swim = visual.actions[0];
    if (swim) {
      // The behaviour sets the clip's phase directly every update.
      swim.timeScale = 0;
      swim.time = 0;
    }
    const root = new THREE.Group();
    root.name = "Shark_Behaviour_Root";
    root.rotation.order = "YXZ";
    root.add(visual.model);
    group.add(root);
    visual.mixer?.update(0);
    root.updateMatrixWorld(true);

    const spine = SPINE.flatMap(({ name }) => {
      const bone = findBone(visual.model, name);
      return bone ? [new ProceduralBone(bone, root)] : [];
    });
    const headBone = findBone(visual.model, HEAD.name);
    const track = (boneName: string, y: number, z: number): TrackedPoint | undefined => {
      const bone = findBone(visual.model, boneName);
      return bone
        ? {
            point: new BodyPoint(bone, root, new THREE.Vector3(0, y, z)),
            tracker: new SurfacePoint(),
            position: new THREE.Vector3(),
            trailDistance: 0,
          }
        : undefined;
    };
    this.shark = {
      root,
      visual,
      swim,
      spine: spine.length === SPINE.length ? spine : [],
      head: headBone ? new ProceduralBone(headBone, root) : undefined,
      dorsal: track("DorsalFin3.28", SHARK_DORSAL_TIP.y, SHARK_DORSAL_TIP.z),
      caudal: track("BackFinT3.22", SHARK_CAUDAL_TIP.y, SHARK_CAUDAL_TIP.z),
      animationClock: 0,
    };
  }

  /** World position of the shark, for prey that must avoid it. */
  collectPositions(target: THREE.Vector3[]): void {
    if (this.shark) target.push(this.shark.root.position);
  }

  obstacle(): { position: THREE.Vector3; radius: number } | undefined {
    return this.shark ? { position: this.shark.root.position, radius: 3.5 } : undefined;
  }

  get state(): SharkAgent | undefined {
    return this.shark?.agent;
  }

  update(
    delta: number,
    vessel: VesselState,
    avoid: readonly { x: number; z: number; radius: number }[],
    camera: THREE.Camera,
  ): void {
    const shark = this.shark;
    if (!shark || delta <= 0) return;
    shark.agent ??= createSharkAgent(vessel, Math.random);
    const agent = shark.agent;
    stepShark(agent, this.world, vessel, avoid, delta, Math.random);
    const motion = agent.motion;
    const root = shark.root;
    root.position.set(motion.x, motion.y + agent.heave, motion.z);
    const bank = THREE.MathUtils.clamp(-motion.yawRate * motion.speed * 0.35, -0.16, 0.16);
    root.rotation.set(-motion.pitch, motion.heading, bank, "YXZ");

    camera.getWorldPosition(this.cameraPosition);
    const cameraDistance = this.cameraPosition.distanceTo(root.position);
    const depth = this.ocean.sample(motion.x, motion.z).height - root.position.y;
    // Deep or far, the water has swallowed it completely.
    const visible = cameraDistance < 300 && !(depth > 11 && cameraDistance > 40);
    shark.visual.model.visible = visible;
    if (!visible) {
      root.updateMatrixWorld(true);
      return;
    }

    shark.spine.forEach((bone) => bone.restore());
    shark.head?.restore();
    shark.animationClock += delta;
    if (shark.swim && shark.animationClock >= animationInterval(cameraDistance)) {
      const clip = shark.swim.getClip();
      const cycle = agent.strokePhase / (Math.PI * 2);
      shark.swim.time = (cycle - Math.floor(cycle)) * clip.duration;
      shark.swim.setEffectiveWeight(agent.strokeEffort);
      shark.visual.mixer?.update(0);
      shark.animationClock = 0;
      shark.spine.forEach((bone) => bone.capture());
      shark.head?.capture();
    }
    // The body curves into a turn and the head leads it.
    let previous = 0;
    shark.spine.forEach((bone, index) => {
      const angle = agent.lateralCurvature * (SPINE[index]?.centre ?? 0);
      bone.rotate("yaw", angle - previous);
      previous = angle;
    });
    shark.head?.rotate("yaw", agent.lateralCurvature * HEAD.centre);
    root.updateMatrixWorld(true);

    this.updateContacts(shark, agent, delta);
  }

  dispose(): void {
    if (!this.shark) return;
    this.shark.visual.mixer?.stopAllAction();
    this.materials.forEach((material) => material.dispose());
    this.group.remove(this.shark.root);
  }

  private updateContacts(shark: Shark, agent: SharkAgent, delta: number): void {
    const speed = agent.motion.speed;
    // The fin cutting the surface: a thin bow ripple and a foam line behind it.
    if (shark.dorsal) {
      const dorsal = shark.dorsal;
      dorsal.point.world(dorsal.position);
      const surface = this.ocean.sample(dorsal.position.x, dorsal.position.z).height;
      const crossing = dorsal.tracker.update(dorsal.position.y, surface, delta);
      this.surfacePoint.set(dorsal.position.x, surface, dorsal.position.z);
      if (crossing) this.effects.splash(this.surfacePoint, 0.18 + speed * 0.04, "breath");
      if (dorsal.tracker.clearance > -0.05) {
        dorsal.trailDistance += speed * delta;
        if (dorsal.trailDistance > 0.55) {
          dorsal.trailDistance = 0;
          this.effects.trail(this.surfacePoint, agent.motion.heading, 0.42 + speed * 0.08, 0.32);
        }
      }
    }
    if (shark.caudal) {
      const caudal = shark.caudal;
      caudal.point.world(caudal.position);
      const surface = this.ocean.sample(caudal.position.x, caudal.position.z).height;
      caudal.tracker.update(caudal.position.y, surface, delta);
      if (caudal.tracker.clearance > -0.05) {
        caudal.trailDistance += speed * delta;
        if (caudal.trailDistance > 0.9) {
          caudal.trailDistance = 0;
          this.surfacePoint.set(caudal.position.x, surface, caudal.position.z);
          this.effects.trail(this.surfacePoint, agent.motion.heading, 0.3, 0.38);
        }
      }
    }
  }
}
