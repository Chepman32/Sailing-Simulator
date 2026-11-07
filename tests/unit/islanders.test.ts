import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGURE_BONES, RiggedFigure } from "../../src/simulator/economy/RiggedFigure";
import { crabKit } from "../../src/simulator/diver/SeabedCrabs";
import { islandsInCell, isVolcanoCell, VOLCANO_RIM, volcanoHeight } from "../../src/simulator/environment/IslandMath";
import { leafMass, LEAF_ATLAS_SPLIT, type LeafBuffers } from "../../src/simulator/environment/IslandVegetation";
import { furnishIsland, islandProfile } from "../../src/simulator/environment/IslandProps";
import { planLowPass } from "../../src/simulator/aircraft/AircraftMath";

/** A humanoid skeleton like the traders' (Mixamo names, A-pose, metres, facing +z). */
function skeleton(): THREE.Group {
  const root = new THREE.Group();
  const joints: Record<string, [string | null, number, number, number]> = {
    Hips: [null, 0, 0.98, -0.04],
    Spine02: ["Hips", 0, 1.11, -0.04],
    Spine01: ["Spine02", 0, 1.24, -0.04],
    Spine: ["Spine01", 0, 1.36, -0.04],
    neck: ["Spine", 0, 1.45, -0.04],
    Head: ["neck", 0, 1.53, -0.04],
    head_end: ["Head", 0, 1.79, -0.01],
    LeftShoulder: ["Spine", 0.04, 1.39, -0.04],
    LeftArm: ["LeftShoulder", 0.21, 1.39, -0.08],
    LeftForeArm: ["LeftArm", 0.32, 1.17, -0.09],
    LeftHand: ["LeftForeArm", 0.47, 0.99, 0.01],
    RightShoulder: ["Spine", -0.04, 1.4, -0.04],
    RightArm: ["RightShoulder", -0.21, 1.4, -0.08],
    RightForeArm: ["RightArm", -0.33, 1.17, -0.09],
    RightHand: ["RightForeArm", -0.47, 0.99, 0.01],
    LeftUpLeg: ["Hips", 0.09, 0.89, -0.04],
    LeftLeg: ["LeftUpLeg", 0.14, 0.51, -0.02],
    LeftFoot: ["LeftLeg", 0.16, 0.12, -0.07],
    LeftToeBase: ["LeftFoot", 0.2, 0.03, 0.02],
    RightUpLeg: ["Hips", -0.1, 0.89, -0.04],
    RightLeg: ["RightUpLeg", -0.14, 0.51, -0.02],
    RightFoot: ["RightLeg", -0.16, 0.12, -0.05],
    RightToeBase: ["RightFoot", -0.18, 0.03, 0.06],
  };
  const bones = new Map<string, THREE.Bone>();
  for (const [name, [parent, x, y, z]] of Object.entries(joints)) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    bones.set(name, bone);
    if (parent) {
      const up = bones.get(parent)!;
      const [, px, py, pz] = joints[parent]!;
      bone.position.set(x - px, y - py, z - pz);
      up.add(bone);
    } else {
      root.add(bone);
    }
  }
  return root;
}

const world = (figure: RiggedFigure, name: (typeof FIGURE_BONES)[number]) => figure.bone(name).getWorldPosition(new THREE.Vector3());

test("a rigged trader's arms and legs reach where the poser puts them, elbows and knees bent the right way", () => {
  const figure = new RiggedFigure(skeleton());
  assert.ok(Math.abs(figure.height - 1.79) < 0.02, "height from the skeleton");
  figure.root.position.set(10, 2, -5);
  figure.root.rotation.y = 0.8;
  figure.resetPose();
  // A hand hanging at the side, the elbow behind.
  const shoulder = figure.restPoint.get("LeftArm")!;
  const target = figure.toWorld(new THREE.Vector3(shoulder.x + 0.03, shoulder.y - 0.5, shoulder.z + 0.05), new THREE.Vector3());
  const pole = figure.toWorld(new THREE.Vector3(shoulder.x + 0.1, shoulder.y - 0.25, shoulder.z - 0.6), new THREE.Vector3());
  figure.solveLimb("LeftArm", "LeftForeArm", "LeftHand", target, pole);
  assert.ok(world(figure, "LeftHand").distanceTo(target) < 0.01, "the hand is where it was put");
  // The elbow bends backward (toward the pole), not forward.
  const elbow = figure.root.worldToLocal(world(figure, "LeftForeArm"));
  assert.ok(elbow.z < shoulder.z + 0.02, `elbow behind (${elbow.z.toFixed(3)})`);
  // A foot planted and a knee forward.
  const foot = figure.restPoint.get("RightFoot")!;
  const footTarget = figure.toWorld(new THREE.Vector3(foot.x, foot.y + 0.03, foot.z + 0.02), new THREE.Vector3());
  const kneePole = figure.toWorld(new THREE.Vector3(-0.15, 0.5, 0.6), new THREE.Vector3());
  figure.shiftBone("Hips", new THREE.Vector3(0, -0.04, 0));
  figure.solveLimb("RightUpLeg", "RightLeg", "RightFoot", footTarget, kneePole);
  assert.ok(world(figure, "RightFoot").distanceTo(footTarget) < 0.01, "the foot stays planted as the hips drop");
  const knee = figure.root.worldToLocal(world(figure, "RightLeg"));
  assert.ok(knee.z > -0.02, `knee forward (${knee.z.toFixed(3)})`);
  // Out of reach: the limb points straight at the target.
  const far = figure.toWorld(new THREE.Vector3(1.5, 1.39, 0), new THREE.Vector3());
  figure.solveLimb("LeftArm", "LeftForeArm", "LeftHand", far, pole);
  const hand = world(figure, "LeftHand");
  const reach = world(figure, "LeftArm").distanceTo(hand);
  const rest = (name: string) => figure.restPoint.get(name as (typeof FIGURE_BONES)[number])!;
  const length = rest("LeftArm").distanceTo(rest("LeftForeArm")) + rest("LeftForeArm").distanceTo(rest("LeftHand"));
  assert.ok(Math.abs(reach - length) < 0.01, `stretched to its length (${reach.toFixed(3)} of ${length.toFixed(3)})`);
  // Every frame starts from the bind pose.
  figure.resetPose();
  assert.ok(figure.root.worldToLocal(world(figure, "LeftHand")).distanceTo(figure.restPoint.get("LeftHand")!) < 1e-6);
});

test("crab models are turned legs-sideways, set on the ground and scaled to a body a metre across", () => {
  const model = new THREE.Group();
  // A body long in x (its legs reach along z) and an eye on a separate mesh.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.2), new THREE.MeshStandardMaterial());
  body.position.set(0.01, 0.025, 0);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshStandardMaterial());
  eye.position.set(0.07, 0.05, 0.02);
  model.add(body, eye);
  const kit = crabKit(model, -Math.PI / 2)!;
  assert.equal(kit.parts.length, 2, "one part per material");
  const box = new THREE.Box3();
  for (const part of kit.parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox!);
  }
  assert.ok(Math.abs(box.max.x - box.min.x - 1) < 1e-3, "a metre across");
  assert.ok(Math.abs(box.min.y) < 1e-4, "on the ground");
  assert.ok(Math.abs(box.max.x + box.min.x) < 1e-3, "centred across");
  // The eye (its front, +x before) now faces +z.
  const eyePart = kit.parts[1]!.geometry;
  eyePart.computeBoundingBox();
  assert.ok(eyePart.boundingBox!.min.z > 0.1, "the front faces +z");
});

test("a volcano's rim is a smooth crest (no step to fall down and be stuck under)", () => {
  let volcano = null;
  for (let row = -2; row <= 2 && !volcano; row += 1) {
    for (let column = -2; column <= 2 && !volcano; column += 1) {
      if (isVolcanoCell(column, row)) volcano = islandsInCell(column, row).find((island) => island.volcano) ?? null;
    }
  }
  assert.ok(volcano, "there is a volcano");
  const step = 0.0005;
  const inside = volcanoHeight(VOLCANO_RIM - step, 0, volcano.height, volcano.seed);
  const outside = volcanoHeight(VOLCANO_RIM + step, 0, volcano.height, volcano.seed);
  assert.ok(Math.abs(inside - outside) < 0.15, `continuous across the rim (${inside.toFixed(2)} vs ${outside.toFixed(2)})`);
  // The crest is the highest ground: inside it drops into the crater.
  assert.ok(volcanoHeight(VOLCANO_RIM * 0.8, 0, volcano.height, volcano.seed) < volcanoHeight(VOLCANO_RIM, 0, volcano.height, volcano.seed));
  // And no bush grows on its ash.
  const furniture = furnishIsland(volcano, islandProfile(volcano), (radial, angle) => volcanoHeight(radial, angle, volcano.height, volcano.seed));
  assert.equal(furniture.bushes.length, 0);
});

test("a bush is a rounded mass of leaf clumps over a solid core, swaying more toward its top", () => {
  const out: LeafBuffers = { positions: [], uvs: [], colors: [], normals: [], sway: [] };
  leafMass(0, 1, 0, 0.8, 0.3, new THREE.Color(0x3b7a30), 7, out);
  const vertices = out.positions.length / 3;
  assert.ok(vertices > 200, "dozens of clumps");
  assert.equal(out.sway.length, vertices);
  let coreVertices = 0;
  for (let index = 0; index < vertices; index += 1) {
    const normal = new THREE.Vector3().fromArray(out.normals, index * 3);
    assert.ok(Math.abs(normal.length() - 1) < 1e-3, "unit normals");
    const sway = out.sway[index]!;
    assert.ok(sway >= 0 && sway <= 1);
    if (out.uvs[index * 2]! > LEAF_ATLAS_SPLIT) coreVertices += 1;
    // Normals point out of the mass (lit as a ball of leaves).
    const offset = new THREE.Vector3().fromArray(out.positions, index * 3).sub(new THREE.Vector3(0, 1, 0));
    if (offset.length() > 0.3) assert.ok(offset.normalize().dot(normal) > 0, "outward");
  }
  assert.ok(coreVertices > 0, "the core uses the solid strip of the atlas");
  // Higher leaves sway more.
  const byHeight = Array.from({ length: vertices }, (_, index) => ({ y: out.positions[index * 3 + 1]!, sway: out.sway[index]! })).sort((a, b) => a.y - b.y);
  const fifth = Math.floor(vertices / 5);
  const mean = (list: { sway: number }[]) => list.reduce((sum, item) => sum + item.sway, 0) / list.length;
  assert.ok(mean(byHeight.slice(-fifth)) > mean(byHeight.slice(0, fifth)) + 0.3);
});

test("the banner plane flies low and close enough to read, never into a hill", () => {
  let seed = 3;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let index = 0; index < 20; index += 1) {
    const pass = planLowPass(0, 0, random, "banner");
    const miss = Math.abs(pass.centerX * Math.cos(pass.heading) - pass.centerZ * Math.sin(pass.heading));
    assert.ok(pass.altitude >= 38 && pass.altitude <= 52, `altitude ${pass.altitude.toFixed(0)}`);
    assert.ok(miss <= 140, `passes ${miss.toFixed(0)} m off`);
    assert.ok(pass.speed <= 34);
  }
});
