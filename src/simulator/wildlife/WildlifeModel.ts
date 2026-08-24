import * as THREE from "three";
import type { AnimatedAssetInstance } from "../core/AssetManager";

type HorizontalAxis = "x" | "z" | "longest";

type ModelSetup = {
  targetSize: number;
  measureAxis: HorizontalAxis;
  yaw?: number;
  pitch?: number;
  roll?: number;
  castShadow?: boolean;
};

export type AnimatedVisual = {
  model: THREE.Group;
  mixer?: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  actions: THREE.AnimationAction[];
};

export function createAnimatedVisual(
  asset: AnimatedAssetInstance,
  setup: ModelSetup,
  preferredClips: RegExp[] = [],
): AnimatedVisual {
  const model = asset.scene;
  model.rotation.set(setup.pitch ?? 0, setup.yaw ?? 0, setup.roll ?? 0, "YXZ");
  model.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const measuredSize =
    setup.measureAxis === "x"
      ? initialSize.x
      : setup.measureAxis === "z"
        ? initialSize.z
        : Math.max(initialSize.x, initialSize.z);
  model.scale.setScalar(setup.targetSize / Math.max(measuredSize, 0.001));
  model.updateMatrixWorld(true);

  const centeredBounds = new THREE.Box3().setFromObject(model);
  const center = centeredBounds.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = setup.castShadow ?? false;
    object.receiveShadow = false;
  });

  if (asset.animations.length === 0) {
    return { model, clips: asset.animations, actions: [] };
  }

  const mixer = new THREE.AnimationMixer(model);
  const selected = selectClips(asset.animations, preferredClips);
  const actions = selected.map((clip) => {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.play();
    if (clip.duration > 0) action.time = Math.random() * clip.duration;
    return action;
  });
  return { model, mixer, clips: asset.animations, actions };
}

export function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-lambda * delta));
}

export function moveAngle(current: number, target: number, maxStep: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + THREE.MathUtils.clamp(difference, -maxStep, maxStep);
}

export function headingTo(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function setRandomAnimationTime(visual: AnimatedVisual, speed = 1): void {
  visual.actions.forEach((action) => {
    action.timeScale = speed * THREE.MathUtils.lerp(0.92, 1.08, Math.random());
  });
}

function selectClips(clips: THREE.AnimationClip[], preferred: RegExp[]): THREE.AnimationClip[] {
  for (const matcher of preferred) {
    const clip = clips.find((candidate) => matcher.test(candidate.name));
    if (clip) return [clip];
  }
  return clips[0] ? [clips[0]] : [];
}
