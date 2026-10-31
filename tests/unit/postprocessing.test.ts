import assert from "node:assert/strict";
import test from "node:test";
import { LuminosityHighPassShader } from "three/addons/shaders/LuminosityHighPassShader.js";
import { HDR_CEILING, hardenBrightPass, SANE_COLOR_GLSL } from "../../src/simulator/core/PostProcessing";

test("the bloom bright-pass reads its input through the finite-colour guard", () => {
  const source = LuminosityHighPassShader.fragmentShader;
  const hardened = hardenBrightPass(source);
  assert.ok(hardened.includes("saneColor(texel.rgb)"));
  assert.ok(hardened.indexOf("vec3 saneColor") < hardened.indexOf("void main"), "the guard is declared before it is used");
  // A shader that is not the expected one is left alone rather than broken.
  assert.equal(hardenBrightPass("void main() {}"), "void main() {}");
});

test("the guard maps NaN and negatives to zero and caps what could overflow a half float", () => {
  assert.ok(SANE_COLOR_GLSL.includes(`min(c.r, ${HDR_CEILING.toFixed(1)})`));
  assert.ok(SANE_COLOR_GLSL.includes("c.r >= 0.0"), "a NaN fails the comparison and becomes zero");
  assert.ok(HDR_CEILING > 20 && HDR_CEILING < 65504, "above any real light, far below half-float overflow");
});

test("the ultra preset is everything at its best, and automatic mode steps down from it", async () => {
  const { QUALITY_SETTINGS, stepDown } = await import("../../src/simulator/core/QualityManager");
  const { high, ultra } = QUALITY_SETTINGS;
  assert.equal(ultra.shadowMapSize, 4096);
  assert.equal(ultra.anisotropy, 16);
  assert.equal(ultra.msaaSamples, 8);
  assert.ok(ultra.ambientOcclusion && ultra.godRays && ultra.oceanMicro && ultra.fullDetail);
  assert.ok(!high.ambientOcclusion && !high.godRays && !high.fullDetail, "the high preset stays affordable");
  for (const key of ["pixelBudget", "oceanSegments", "reflectionScale", "grassRadius", "grassDensity", "maxDpr"] as const) {
    assert.ok(ultra[key] >= high[key], `${key} is no lower than on high`);
  }
  assert.equal(QUALITY_SETTINGS.low.grassRadius, 0, "no dense grass on the low preset");
  assert.equal(stepDown("ultra"), "high");
  assert.equal(stepDown("high"), "medium");
  assert.equal(stepDown("medium"), "low");
  assert.equal(stepDown("low"), "low");
});
