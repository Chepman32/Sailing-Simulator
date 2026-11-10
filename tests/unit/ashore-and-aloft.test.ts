import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CONTRAIL_NIGHT_OPACITY, contrailNightDim, LOW_PASS_NIGHT_END, LOW_PASS_NIGHT_START, lowPassesFly } from "../../src/simulator/aircraft/AircraftMath";
import { wadeDepthMix, wadeTone } from "../../src/simulator/audio/BodySounds";
import { sunShadowsOn, QUALITY_SETTINGS } from "../../src/simulator/core/QualityManager";
import { blobShadowShape } from "../../src/simulator/diver/BlobShadows";
import { WADE_STEP_DEPTH } from "../../src/simulator/diver/DiverMath";
import { CRAB_SETTINGS } from "../../src/simulator/diver/SeabedCrabs";

test("no light plane flies at night, and an airliner's trail is a little fainter under the moon", () => {
  assert.equal(lowPassesFly(0), true);
  assert.equal(lowPassesFly(LOW_PASS_NIGHT_START - 0.01), true);
  // From dusk on none sets out; one still up when night has fallen is gone.
  assert.equal(lowPassesFly(LOW_PASS_NIGHT_START), false);
  assert.equal(lowPassesFly(1), false);
  assert.ok(LOW_PASS_NIGHT_START < 0.5 && LOW_PASS_NIGHT_END > LOW_PASS_NIGHT_START && LOW_PASS_NIGHT_END < 0.8);
  // The trail: all of it by day, fainter than the 0.35 it used to keep at night, but still there.
  assert.equal(contrailNightDim(0), 1);
  assert.equal(contrailNightDim(1), CONTRAIL_NIGHT_OPACITY);
  assert.ok(CONTRAIL_NIGHT_OPACITY < 0.35 && CONTRAIL_NIGHT_OPACITY > 0.15);
  // Through dusk it fades without a step.
  let last = 1;
  for (let night = 0; night <= 1.0001; night += 0.02) {
    const dim = contrailNightDim(night);
    assert.ok(dim <= last + 1e-9 && last - dim < 0.03, `a step at ${night.toFixed(2)}`);
    last = dim;
  }
});

test("a step at the water's edge is soft and dull; the splash and its sparkle come in with the depth", () => {
  // A film of water: the recording is quiet, short and under a low low-pass (nothing that crackles like ice).
  assert.ok(WADE_STEP_DEPTH <= 0.06);
  const film = wadeTone(wadeDepthMix(WADE_STEP_DEPTH));
  assert.ok(film.lowpass !== null && film.lowpass < 1500, `the film of water is played under ${film.lowpass} Hz`);
  assert.ok(film.gain < 0.16 && film.length < 0.5);
  // Ankle-deep: still muffled.
  const ankle = wadeTone(wadeDepthMix(0.15));
  assert.ok(ankle.lowpass !== null && ankle.lowpass < 2200 && ankle.gain < 0.22);
  // Knee-deep: the full slosh as recorded.
  const knee = wadeTone(wadeDepthMix(0.5));
  assert.equal(knee.lowpass, null);
  assert.ok(knee.gain > 0.45 && knee.length === 1);
  // It grows with the depth, never jumps.
  let last = wadeTone(0);
  for (let depth = 0; depth <= 0.5; depth += 0.01) {
    const tone = wadeTone(wadeDepthMix(depth));
    assert.ok(tone.gain >= last.gain - 1e-9 && tone.gain - last.gain < 0.03);
    assert.ok((tone.lowpass ?? 1e9) >= (last.lowpass ?? 1e9) - 1e-6 || last.lowpass === null);
    last = tone;
  }
});

test("the sun casts shadows at every preset on a computer; a phone below high gets blob shadows", () => {
  for (const preset of ["low", "medium", "high", "ultra"] as const) assert.equal(sunShadowsOn(preset, false), true, preset);
  assert.equal(sunShadowsOn("low", true), false);
  assert.equal(sunShadowsOn("medium", true), false);
  assert.equal(sunShadowsOn("high", true), true);
  assert.ok(QUALITY_SETTINGS.low.shadowMapSize >= 1024);
  // A blob shadow lies away from the sun, as long as the sun is low, within bounds.
  const sun = new THREE.Vector3(1, 1, 0).normalize();
  const noon = blobShadowShape(1.75, 0, 1, 0);
  assert.ok(noon.length < 1);
  const morning = { ...blobShadowShape(1.75, sun.x, sun.y, sun.z) };
  assert.ok(Math.abs(morning.dirX + 1) < 1e-9 && Math.abs(morning.dirZ) < 1e-9, "away from the sun");
  assert.ok(Math.abs(morning.length - 1.75) < 1e-6, "45°: as long as he is tall");
  const low = new THREE.Vector3(0, 0.1, 1).normalize();
  const evening = blobShadowShape(1.75, low.x, low.y, low.z);
  assert.ok(evening.length <= 1.75 * 2.4 + 1e-9 && evening.dirZ < -0.99);
});

test("the crabs of the seabed are far bigger than those of the beach", () => {
  const { seabed, beach } = CRAB_SETTINGS;
  assert.ok(seabed.size[0] >= 1.1 && seabed.size[1] >= 2, `seabed crabs ${seabed.size[0]}–${seabed.size[1]} m`);
  assert.ok(seabed.size[0] > beach.size[1] * 5, "the smallest of the deep dwarfs the largest ashore");
  // Fewer of them than there were (40), spread wider, so the floor is not paved with shells.
  assert.ok(seabed.range >= 28 && seabed.count <= 32);
  // A big crab's walk covers ground in proportion (it is not a giant creeping at a small crab's pace).
  assert.ok(seabed.speed[1] >= 0.4);
});
