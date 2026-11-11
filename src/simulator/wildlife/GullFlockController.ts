import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import { mergeSkinnedParts, smoothNormalsByPosition } from "../core/SkinnedMerge";
import { subdivideSkinnedLoop } from "../core/Subdivision";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { ProceduralBone } from "./BodyRig";
import {
  createGullState,
  glideDihedral,
  gullLost,
  placeGull,
  stepGull,
  type GullEvent,
  type GullState,
  type GullVessel,
  type GullWorld,
} from "./GullBehavior";
import { createAnimatedVisual, type AnimatedVisual } from "./WildlifeModel";

type WingJoint = { joint: ProceduralBone; side: number; segment: 1 | 2 | 3 };

type Gull = {
  root: THREE.Group;
  visual: AnimatedVisual;
  state: GullState;
  flap?: THREE.AnimationAction;
  /** Window of the flap clip that makes one full, cleanly looping wing beat. */
  flapCycle: { start: number; length: number };
  /** Shoulder, hand and tip joints of each wing, with the side they are on (+1 starboard). */
  wingJoints: WingJoint[];
  glide?: THREE.AnimationAction;
  initialized: boolean;
};

/** Shoulder, hand and tip swing of a full wing beat, radians either side. */
const GULL_SHOULDER_SWING = 0.52;
const GULL_HAND_SWING = 0.3;
const GULL_TIP_SWING = 0.22;

/**
 * The shoulder ("aile1"), hand ("aile2") and tip ("aile3") joints of each
 * wing, with the side each wing is on, measured from where it lies in the
 * bird's frame.
 */
function findWingJoints(model: THREE.Object3D, frame: THREE.Object3D): WingJoint[] {
  const joints: WingJoint[] = [];
  const inverse = frame.matrixWorld.clone().invert();
  const position = new THREE.Vector3();
  model.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const match = /aile([123])/i.exec(object.name);
    if (!match) return;
    const tip = object.children.find((child) => child instanceof THREE.Bone) ?? object;
    position.setFromMatrixPosition(tip.matrixWorld).applyMatrix4(inverse);
    const side = position.x >= 0 ? 1 : -1;
    joints.push({ joint: new ProceduralBone(object, frame), side, segment: Number(match[1]) as 1 | 2 | 3 });
  });
  return joints;
}

const MANTLE_GREY = new THREE.Color(0x9ba7b2);
const WHITE = new THREE.Color(0xf2f3f0);
const BILL_SPOT = new THREE.Color(0xc23a22);

/**
 * Paints a herring gull's plumage onto the (subdivided) bird, triangle by
 * triangle so the boundaries stay crisp: a pale silver-grey mantle and
 * upper wing, a white trailing edge, white "mirrors" in the black wing
 * tips, and the red spot near the tip of the yellow bill. Also stores, per
 * vertex, where it lies along the span and across the chord (`plumage`),
 * for the feather detail in the shader.
 */
function paintPlumage(geometry: THREE.BufferGeometry, toBird: (vertex: number, target: THREE.Vector3) => THREE.Vector3): void {
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const count = position.count;
  const bird = new Float32Array(count * 3);
  const point = new THREE.Vector3();
  let halfSpan = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let vertex = 0; vertex < count; vertex += 1) {
    toBird(vertex, point);
    point.toArray(bird, vertex * 3);
    halfSpan = Math.max(halfSpan, Math.abs(point.x));
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const body = halfSpan * 0.16;
  // Leading and trailing edge of the wing in bins along the span.
  const bins = 24;
  const lead = new Float32Array(bins * 2).fill(-Infinity);
  const trail = new Float32Array(bins * 2).fill(Infinity);
  // Separate bins for each wing, which may not be posed symmetrically.
  const binOf = (x: number): number => Math.min(bins - 1, Math.floor((Math.abs(x) / halfSpan) * bins)) + (x < 0 ? bins : 0);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = bird[vertex * 3]!;
    if (Math.abs(x) < body) continue;
    const bin = binOf(x);
    lead[bin] = Math.max(lead[bin]!, bird[vertex * 3 + 2]!);
    trail[bin] = Math.min(trail[bin]!, bird[vertex * 3 + 2]!);
  }
  const plumage = new Float32Array(count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const colour = new THREE.Color();
  for (let triangle = 0; triangle < count / 3; triangle += 1) {
    a.fromArray(bird, triangle * 9);
    b.fromArray(bird, triangle * 9 + 3);
    c.fromArray(bird, triangle * 9 + 6);
    normal.subVectors(b, a).cross(point.subVectors(c, a)).normalize();
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const span = cx / halfSpan;
    const bin = binOf(cx);
    const chord = Number.isFinite(lead[bin]!) && lead[bin]! > trail[bin]! ? (cz - trail[bin]!) / (lead[bin]! - trail[bin]!) : 0.5;
    colour.fromBufferAttribute(color, triangle * 3);
    const white = colour.r > 0.45 && colour.g > 0.45 && colour.b > 0.45;
    const black = colour.r < 0.06 && colour.g < 0.06 && colour.b < 0.06;
    const yellow = colour.r > 0.5 && colour.g > 0.35 && colour.b < 0.1;
    const onWing = Math.abs(cx) > body;
    // The wings are single sheets seen from both sides, so which side is
    // grey is decided per fragment: `greySide` says whether the upper (grey)
    // surface is this triangle's front (+1) or back (−1) face; 0 is never grey.
    const back = !onWing && normal.y > 0.3 && cy > (minY + maxY) / 2 && cz < maxZ - (maxZ - minZ) * 0.35;
    const greySide = white && (onWing || back) ? (normal.y >= 0 ? 1 : -1) : 0;
    if (white) {
      colour.copy(WHITE);
    } else if (black && Math.abs(span) > 0.9 && chord > 0.25 && chord < 0.7) {
      // The white "mirror" near each wing tip.
      colour.copy(WHITE);
    } else if (yellow && cz > maxZ - (maxZ - minZ) * 0.05 && cy < (minY + maxY) / 2 + (maxY - minY) * 0.05) {
      colour.copy(BILL_SPOT);
    } else if (white) {
      colour.copy(WHITE);
    }
    for (let k = 0; k < 3; k += 1) {
      color.setXYZ(triangle * 3 + k, colour.r, colour.g, colour.b);
      const vx = bird[(triangle * 3 + k) * 3]!;
      const vz = bird[(triangle * 3 + k) * 3 + 2]!;
      const vBin = binOf(vx);
      plumage[(triangle * 3 + k) * 3] = vx / halfSpan;
      plumage[(triangle * 3 + k) * 3 + 1] =
        Math.abs(vx) > body && lead[vBin]! > trail[vBin]! ? (vz - trail[vBin]!) / (lead[vBin]! - trail[vBin]!) : 0.5;
      plumage[(triangle * 3 + k) * 3 + 2] = greySide;
    }
  }
  color.needsUpdate = true;
  geometry.setAttribute("plumage", new THREE.BufferAttribute(plumage, 3));
}

/**
 * The rotation that turns the posed bird into the flight frame (+Z toward
 * the bill, +X along the right wing, +Y up its back). The source rig is
 * built upright and only lies down in its clips, so the frame is measured
 * from the posed skeleton rather than assumed: the bill's direction from
 * the body's centre, and the line between the two wing tips.
 */
function measureFlightFrame(mesh: THREE.SkinnedMesh, root: THREE.Object3D, model: THREE.Object3D): THREE.Quaternion | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  if (!position || !color) return null;
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const point = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const bill = new THREE.Vector3();
  const feet = new THREE.Vector3();
  let bills = 0;
  let feetCount = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex);
    mesh.applyBoneTransform(vertex, point);
    point.applyMatrix4(toRoot);
    centre.add(point);
    const r = color.getX(vertex);
    const g = color.getY(vertex);
    const b = color.getZ(vertex);
    if (r > 0.5 && g > 0.35 && b < 0.1) {
      bill.add(point);
      bills += 1;
    } else if (r > 0.5 && g < 0.3 && b < 0.1) {
      feet.add(point);
      feetCount += 1;
    }
  }
  if (bills === 0) return null;
  centre.divideScalar(position.count);
  bill.divideScalar(bills);
  const tip = (pattern: RegExp): THREE.Vector3 | null => {
    let found: THREE.Vector3 | null = null;
    model.traverse((object) => {
      if (!found && object instanceof THREE.Bone && pattern.test(object.name)) {
        found = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
      }
    });
    return found;
  };
  const left = tip(/aile3\.?L/i) ?? tip(/aile2\.?L/i);
  const right = tip(/aile3\.?R/i) ?? tip(/aile2\.?R/i);
  if (!left || !right) return null;
  const forward = bill.clone().sub(centre).normalize();
  const across = right.clone().sub(left);
  across.addScaledVector(forward, -across.dot(forward)).normalize();
  const up = new THREE.Vector3().crossVectors(forward, across).normalize();
  // The feet hang below the body.
  if (feetCount > 0 && feet.divideScalar(feetCount).sub(centre).dot(up) > 0) {
    across.negate();
    up.negate();
  }
  const basis = new THREE.Matrix4().makeBasis(across, up, forward);
  return new THREE.Quaternion().setFromRotationMatrix(basis).invert();
}

/**
 * Feather detail the mesh is too coarse to carry: the shafts and edges of
 * the primaries across the outer wing, scalloped secondaries along the
 * trailing edge, and light passing through the thin wing when the sun is
 * behind it.
 */
function decorateFeathers(material: THREE.MeshStandardMaterial, light: { value: THREE.Vector3 }): void {
  patchMaterialShader(material, "gull-feathers-v3", (shader) => {
    shader.uniforms.uGullLight = light;
    shader.uniforms.uGullMantle = { value: MANTLE_GREY };
    shader.vertexShader = injectAfter(
      shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 plumage;\nvarying vec3 vPlumage;"),
      "begin_vertex",
      "vPlumage = plumage;",
    );
    shader.fragmentShader = injectAfter(
      shader.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uGullLight;\nuniform vec3 uGullMantle;\nvarying vec3 vPlumage;",
      ),
      "color_fragment",
      `
      float gullSpan = abs(vPlumage.x);
      float gullWing = smoothstep(0.18, 0.3, gullSpan);
      // Primaries: dark shafts fanning across the outer wing.
      float primaries = smoothstep(0.55, 0.7, gullSpan) * pow(abs(sin(gullSpan * 3.14159 * 16.0)), 18.0);
      // Secondaries: scalloped feather ends along the trailing edge.
      float scallop = (1.0 - smoothstep(0.0, 0.18, vPlumage.y)) * pow(abs(sin(gullSpan * 3.14159 * 30.0)), 6.0);
      diffuseColor.rgb *= 1.0 - gullWing * (primaries * 0.16 + scallop * 0.08);
      // Silver-grey mantle and upper wing on whichever face shows the top,
      // with a white trailing edge.
      float gullTop = gl_FrontFacing ? step(0.5, vPlumage.z) : step(0.5, -vPlumage.z);
      float trailingEdge = (1.0 - smoothstep(0.07, 0.15, vPlumage.y)) * smoothstep(0.25, 0.32, gullSpan) * (1.0 - smoothstep(0.8, 0.88, gullSpan));
      diffuseColor.rgb = mix(diffuseColor.rgb, uGullMantle, gullTop * (1.0 - trailingEdge));
      `,
    );
    shader.fragmentShader = injectAfter(
      shader.fragmentShader,
      "emissivemap_fragment",
      `
      // Sun shining through the wing toward the eye.
      vec3 gullToEye = normalize(vViewPosition);
      vec3 gullLight = normalize((viewMatrix * vec4(uGullLight, 0.0)).xyz);
      float gullThrough = pow(max(dot(-gullToEye, gullLight), 0.0), 5.0) * smoothstep(0.2, 0.35, abs(vPlumage.x));
      totalEmissiveRadiance += diffuseColor.rgb * gullThrough * 0.35;
      `,
    );
  });
}

/**
 * Length of one complete wing beat in the flap clip. The authored clip holds
 * about one and a half beats, so looping it whole makes the wings snap at the
 * seam; one measured cycle loops cleanly.
 */
function measureBeatCycle(
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction,
  model: THREE.Object3D,
): { start: number; length: number } {
  const duration = action.getClip().duration;
  const bones: THREE.Bone[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Bone) bones.push(object);
  });
  const samples = 96;
  // Every bone's rotation over the clip, sign-aligned so q and −q compare equal.
  const poses: number[][] = [];
  for (let index = 0; index <= samples; index += 1) {
    action.time = (duration * index) / samples;
    mixer.update(0);
    const pose: number[] = [];
    bones.forEach((bone, boneIndex) => {
      const q = bone.quaternion;
      const reference = poses[0]?.slice(boneIndex * 4, boneIndex * 4 + 4);
      const sign = reference && reference[0] * q.x + reference[1] * q.y + reference[2] * q.z + reference[3] * q.w < 0 ? -1 : 1;
      pose.push(q.x * sign, q.y * sign, q.z * sign, q.w * sign);
    });
    poses.push(pose);
  }
  action.time = 0;
  // Only the wing defines the cycle; the tail and head drift on their own.
  const ranges = bones.map((_, boneIndex) => {
    let range = 0;
    for (const pose of poses) {
      range = Math.max(range, Math.hypot(...[0, 1, 2, 3].map((c) => pose[boneIndex * 4 + c] - poses[0][boneIndex * 4 + c])));
    }
    return range;
  });
  const widest = Math.max(...ranges);
  // The shoulder joint that sweeps furthest carries the beat.
  const beating = [ranges.indexOf(widest)];
  const distance = (a: number[], b: number[]): number =>
    beating.reduce((sum, boneIndex) => {
      let part = 0;
      for (let c = 0; c < 4; c += 1) part += (a[boneIndex * 4 + c] - b[boneIndex * 4 + c]) ** 2;
      return sum + part;
    }, 0);
  let spread = 0;
  for (const pose of poses) spread = Math.max(spread, distance(pose, poses[0]));
  if (spread < 1e-4) return { start: 0, length: duration };
  // The beat is the lag at which the whole pose best repeats itself.
  let bestLag = samples;
  let bestError = Number.POSITIVE_INFINITY;
  for (let lag = Math.floor(samples * 0.25); lag <= Math.floor(samples * 0.8); lag += 1) {
    let error = 0;
    for (let index = 0; index + lag <= samples; index += 1) error += distance(poses[index], poses[index + lag]);
    error /= samples + 1 - lag;
    if (error < bestError) {
      bestError = error;
      bestLag = lag;
    }
  }
  if (bestError > spread * 0.3) return { start: 0, length: duration };
  // Loop the window whose ends match best, so the seam is invisible.
  let start = 0;
  let seam = Number.POSITIVE_INFINITY;
  for (let index = 0; index + bestLag <= samples; index += 1) {
    const mismatch = distance(poses[index], poses[index + bestLag]);
    if (mismatch < seam) {
      seam = mismatch;
      start = index;
    }
  }
  return { start: (duration * start) / samples, length: (duration * bestLag) / samples };
}

export class GullFlockController {
  private readonly gulls: Gull[] = [];
  private readonly positionList: THREE.Vector3[] = [];
  private readonly flockPoints: { x: number; y: number; z: number }[] = [];
  private readonly vessel: GullVessel = { x: 0, z: 0, heading: 0, speed: 0 };
  private readonly light = { value: new THREE.Vector3(0.4, 0.8, 0.3) };
  /** Calls a disturbed or departing bird gives, for the audio system. */
  readonly calls: { position: THREE.Vector3; variant: number }[] = [];
  private readonly splashAt = new THREE.Vector3();
  private readonly splashVelocity = new THREE.Vector3();

  /** Positions of the birds (live references to their roots). */
  get positions(): readonly THREE.Vector3[] {
    if (this.positionList.length !== this.gulls.length) {
      this.positionList.length = 0;
      this.gulls.forEach((gull) => this.positionList.push(gull.root.position));
    }
    return this.positionList;
  }
  /** Shared bird geometry and material (see `mergeSkinnedParts`, `subdivideSkinnedLoop`). */
  private shared?: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial };
  /** Scale each wing bone had from the clips, before tucking (see `update`). */
  private readonly boneScales = new Map<THREE.Object3D, THREE.Vector3>();
  /** Rotation of the rig into the flight frame (see `measureFlightFrame`). */
  private flightFrame = new THREE.Quaternion();

  constructor(
    private readonly group: THREE.Group,
    assets: AssetManager,
    qualityCount: number,
    private readonly world: GullWorld,
    private readonly effects?: {
      splash(position: THREE.Vector3, intensity: number, kind: "entry" | "exit", velocity?: THREE.Vector3): void;
      ripple(position: THREE.Vector3, strength: number): void;
    },
  ) {
    const gullCount = qualityCount > 1 ? 6 : 3;
    for (let index = 0; index < gullCount; index += 1) {
      const asset = assets.animated("seagull");
      if (!asset) break;
      const visual = createAnimatedVisual(
        asset,
        { targetSize: 1.4, measureAxis: "x", pitch: -Math.PI / 2, castShadow: false },
      );
      visual.model.name = `Rigged_Seagull_${index + 1}`;
      const root = new THREE.Group();
      root.name = `Seagull_Flight_Root_${index + 1}`;
      root.rotation.order = "YXZ";
      // The rig's own orientation is corrected once, on this node, so the
      // flight frame of the root is the bird's: +Z bill, +X right wing, +Y back.
      const body = new THREE.Group();
      body.name = `Seagull_Body_${index + 1}`;
      body.add(visual.model);
      root.add(body);
      group.add(root);
      // Only the beat and the glide drive the rig; the second glide clip
      // would turn the whole body, so it is stopped.
      const flapClip = visual.clips.find((clip) => /^flap$/i.test(clip.name));
      const glideClip = visual.clips.find((clip) => /^planer$/i.test(clip.name)) ?? visual.clips.find((clip) => /planer|glide/i.test(clip.name));
      visual.mixer?.stopAllAction();
      let flap: THREE.AnimationAction | undefined;
      let glide: THREE.AnimationAction | undefined;
      if (visual.mixer && flapClip) {
        flap = visual.mixer.clipAction(flapClip).reset().play();
        flap.timeScale = 0;
        flap.setEffectiveWeight(0.5);
      }
      if (visual.mixer && glideClip) {
        glide = visual.mixer.clipAction(glideClip).reset().play();
        glide.time = Math.random() * Math.max(0.01, glideClip.duration);
        glide.setEffectiveWeight(0.5);
      }
      visual.mixer?.update(0);
      root.updateMatrixWorld(true);
      // Fourteen flat-coloured parts become one mesh: one draw call and one
      // bone upload per bird. The low-poly source is then subdivided once,
      // painted as a herring gull and given feather detail; every bird
      // shares that geometry and material.
      const merged = mergeSkinnedParts(visual.model);
      if (merged) {
        merged.updateMatrixWorld(true);
        merged.skeleton.update();
        if (!this.shared) {
          this.flightFrame = measureFlightFrame(merged, root, visual.model) ?? new THREE.Quaternion();
          body.quaternion.copy(this.flightFrame);
          root.updateMatrixWorld(true);
          merged.skeleton.update();
          const geometry = subdivideSkinnedLoop(merged.geometry);
          smoothNormalsByPosition(geometry, 0.95);
          const original = merged.geometry;
          merged.geometry = geometry;
          const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(merged.matrixWorld);
          paintPlumage(geometry, (vertex, target) =>
            merged.applyBoneTransform(vertex, target.fromBufferAttribute(geometry.getAttribute("position"), vertex)).applyMatrix4(toRoot),
          );
          merged.geometry = original;
          const material = merged.material as THREE.MeshStandardMaterial;
          material.roughness = 0.82;
          material.metalness = 0;
          // Thin wings are seen from below as often as from above.
          material.side = THREE.DoubleSide;
          decorateFeathers(material, this.light);
          this.shared = { geometry, material };
        } else {
          (merged.material as THREE.Material).dispose();
          merged.material = this.shared.material;
        }
        merged.geometry.dispose();
        merged.geometry = this.shared.geometry;
        merged.frustumCulled = false;
      }
      body.quaternion.copy(this.flightFrame);
      root.updateMatrixWorld(true);
      const wingJoints = findWingJoints(visual.model, root);
      wingJoints.forEach(({ joint }) => this.boneScales.set(joint.bone, joint.bone.scale.clone()));
      this.gulls.push({
        root,
        visual,
        state: createGullState(index, Math.random),
        flap,
        flapCycle: flap && visual.mixer ? measureBeatCycle(visual.mixer, flap, visual.model) : { start: 0, length: 1 },
        wingJoints,
        glide,
        initialized: false,
      });
    }
  }

  /** Direction toward the sun (or moon), for light through the wings. */
  setLightDirection(direction: THREE.Vector3): void {
    this.light.value.copy(direction);
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    const scales = this.boneScales;
    const vessel = this.vessel;
    vessel.x = physics.position.x;
    vessel.z = physics.position.z;
    vessel.heading = physics.heading;
    vessel.speed = Math.max(0, physics.telemetry.forwardSpeed);
    this.gulls.forEach((gull, index) => {
      const state = gull.state;
      if (!gull.initialized || gullLost(state, vessel)) {
        placeGull(state, vessel, index, this.gulls.length);
        gull.initialized = true;
      }
      this.flockPoints.length = 0;
      this.gulls.forEach((other) => {
        if (other !== gull) this.flockPoints.push(other.state);
      });
      const before = state.mode;
      const event = stepGull(state, this.world, vessel, this.flockPoints, delta, Math.random);
      this.react(gull, event, before);
      gull.root.position.set(state.x, state.y, state.z);
      gull.root.rotation.set(-state.pitch, state.heading, -state.bank, "YXZ");

      if (gull.flap) {
        // The clip is driven by the bird's own beat phase and effort.
        gull.flap.time = gull.flapCycle.start + state.flapPhase * gull.flapCycle.length;
        gull.flap.setEffectiveWeight(Math.max(0.001, state.flap));
      }
      // The clips always carry the full pose (their weights sum to one), so
      // the body never sags toward the rig's upright bind pose.
      gull.glide?.setEffectiveWeight(Math.max(0.001, 1 - state.flap));
      if (animationDelta > 0) {
        gull.visual.mixer?.update(animationDelta);
        gull.wingJoints.forEach(({ joint }) => {
          joint.capture();
          scales.set(joint.bone, (scales.get(joint.bone) ?? new THREE.Vector3()).copy(joint.bone.scale));
        });
      }
      // A full stroke from the shoulder on top of the clip; the hand follows
      // a beat later and the tip later still, so the wing whips. Gliding,
      // the wing holds a shallow "M"; diving or afloat, it folds back.
      const stroke = Math.PI * 2 * state.flapPhase;
      const strength = state.flap * (1 - state.fold);
      const dihedral = glideDihedral(state);
      gull.wingJoints.forEach(({ joint, side, segment }) => {
        joint.restore();
        let angle: number;
        let sweep: number;
        // Folded, each wing is swept back to lie along the body, the hand
        // tucked into the arm, the black tip crossing over the tail as on a
        // gull sitting on the water.
        if (segment === 1) {
          angle = (Math.sin(stroke) * GULL_SHOULDER_SWING + 0.08) * strength + dihedral.shoulder - state.fold * 0.3;
          sweep = state.fold * 1.3;
        } else if (segment === 2) {
          angle = Math.sin(stroke - 0.9) * GULL_HAND_SWING * strength + dihedral.hand - state.fold * 0.1;
          sweep = state.fold * 0.35;
        } else {
          angle = Math.sin(stroke - 1.6) * GULL_TIP_SWING * strength;
          sweep = state.fold * 0.2;
        }
        const tuck = segment === 1 ? 1 : 1 - state.fold * (segment === 2 ? 0.45 : 0.55);
        joint.bone.scale.copy(scales.get(joint.bone)!).multiplyScalar(tuck);
        joint.rotate("roll", side * angle);
        if (Math.abs(sweep) > 0.001) joint.rotate("yaw", side * sweep);
      });
    });
  }

  dispose(): void {
    this.gulls.forEach((gull) => {
      gull.visual.mixer?.stopAllAction();
      this.group.remove(gull.root);
    });
    this.gulls.length = 0;
    if (this.shared) {
      this.shared.geometry.dispose();
      this.shared.material.dispose();
      this.shared = undefined;
    }
  }

  /** Splash and ripples where a bird meets the water; the calls it gives. */
  private react(gull: Gull, event: GullEvent, before: GullState["mode"]): void {
    const state = gull.state;
    if (event === "splash") {
      this.splashAt.set(state.x, state.y, state.z);
      this.splashVelocity.set(Math.sin(state.heading) * state.speed, -6, Math.cos(state.heading) * state.speed);
      // A plunge throws water; a landing only parts it.
      this.effects?.splash(this.splashAt, before === "land" ? 0.12 : 0.35, "entry", this.splashVelocity);
    } else if (event === "takeoff" || event === "alarm") {
      this.splashAt.set(state.x, state.y, state.z);
      this.effects?.ripple(this.splashAt, 0.3);
      this.calls.push({ position: gull.root.position, variant: event === "alarm" ? 2 : 1 });
    }
    // Feet pattering on the surface during the take-off run.
    if (state.mode === "takeoff" && state.y < this.world.surfaceHeight(state.x, state.z) + 0.3 && Math.random() < 0.15) {
      this.splashAt.set(state.x, state.y, state.z);
      this.effects?.ripple(this.splashAt, 0.12);
    }
  }
}
