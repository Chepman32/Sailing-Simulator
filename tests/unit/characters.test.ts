import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { isAuthoredModel } from "../../src/simulator/actors/ActorLooks";
import { INSPECT_SECONDS, WeaponView } from "../../src/simulator/combat/WeaponView";
import { MARK_LOOK, VANGUARD_CREW, contractor } from "../../src/simulator/story/content/looks";
import { M01_ACTORS } from "../../src/simulator/story/content/m01Cast";

test("Mark and the Vanguard men are the authored characters; the women and civilians keep the base figures", () => {
  assert.equal(MARK_LOOK.model, "mark");
  assert.ok(isAuthoredModel("mark") && isAuthoredModel("guardA") && isAuthoredModel("guardB"));
  assert.ok(!isAuthoredModel("man") && !isAuthoredModel("woman"));
  // A contractor is always the same man, and both soldiers are used.
  const a = contractor("man", 0xa8714c, 0x6f7550, "helmet");
  const b = contractor("man", 0xa8714c, 0x6f7550, "helmet", { glasses: true });
  assert.equal(a.model, b.model);
  assert.equal(contractor("woman", 0xa8714c, 0x6f7550, "none").model, "woman");
  const men = new Set([...M01_ACTORS, ...VANGUARD_CREW.map((look) => ({ look }))].map((entry) => entry.look.model).filter(isAuthoredModel));
  assert.ok(men.has("guardA") && men.has("guardB"), `both soldiers appear (${[...men].join(", ")})`);
});

test("a gun just handed over is looked over in a straight arm, then held ready; a shot ends the look", () => {
  const scene = new THREE.Scene();
  const view = new WeaponView(scene);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  camera.updateMatrixWorld(true);
  const input = { weapon: "pistol" as const, firstPerson: true, speed: 0, crouched: false, ammo: 7, reload: 1, floor: 0 };
  // Raised first.
  for (let frame = 0; frame < 90; frame += 1) view.update(1 / 60, camera, input);
  const rig = (view as unknown as { rig: THREE.Group }).rig;
  const ready = rig.position.clone();
  view.inspect();
  assert.ok(view.inspecting);
  let farthest = 0;
  let turned = 0;
  for (let time = 0; time < INSPECT_SECONDS + 0.2; time += 1 / 60) {
    view.update(1 / 60, camera, input);
    farthest = Math.max(farthest, ready.z - rig.position.z);
    turned = Math.max(turned, Math.abs(rig.rotation.z), Math.abs(rig.rotation.y));
  }
  assert.ok(!view.inspecting, "the look is over");
  assert.ok(farthest > 0.1, `the arm goes out (${farthest.toFixed(3)} m)`);
  assert.ok(turned > 0.4, `the gun is turned to show its sides (${turned.toFixed(2)} rad)`);
  assert.ok(rig.position.distanceTo(ready) < 0.02, "back at the ready");
  view.inspect();
  for (let frame = 0; frame < 20; frame += 1) view.update(1 / 60, camera, input);
  view.fire();
  assert.ok(!view.inspecting, "a shot ends it");
  view.dispose();
});
