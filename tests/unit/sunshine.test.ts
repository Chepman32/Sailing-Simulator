import assert from "node:assert/strict";
import test from "node:test";
import { deriveTimeOfDay } from "../../src/simulator/environment/EnvironmentMath";
import { deriveEnvironmentPalette } from "../../src/simulator/environment/EnvironmentPalette";
import { createWeather } from "../../src/simulator/environment/WeatherMath";

const luminance = (c: readonly number[]) => c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
const saturation = (c: readonly number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);

test("sunny weather is brighter and bluer than a merely fair sky", () => {
  const day = deriveTimeOfDay(0);
  const sunny = deriveEnvironmentPalette(day, createWeather("clear"));
  const plain = deriveEnvironmentPalette(day, { ...createWeather("clear"), sunshine: 0 });
  assert.ok(sunny.sunshine > 0.9);
  assert.ok(luminance(sunny.lightColor) > luminance(plain.lightColor) * 1.25, "the sun shines harder");
  assert.ok(saturation(sunny.zenith) > saturation(plain.zenith), "the sky overhead is a deeper blue");
  assert.ok(luminance(sunny.horizon) > luminance(sunny.zenith), "the sky still brightens toward the horizon");
});

test("sunshine belongs to fair days only, and fades with the sun", () => {
  const day = deriveTimeOfDay(0);
  assert.equal(deriveEnvironmentPalette(day, createWeather("overcast")).sunshine, 0);
  assert.equal(deriveEnvironmentPalette(day, createWeather("storm")).sunshine, 0);
  assert.ok(deriveEnvironmentPalette(day, createWeather("cloudy")).sunshine < 0.35);
  assert.ok(deriveEnvironmentPalette(deriveTimeOfDay(1), createWeather("clear")).sunshine < 0.01, "no sunshine at night");
});
