import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCloudNoise,
  CLOUD_NOISE_SIZE,
  cloudWeatherAt,
  sampleCloudNoise,
  WEATHER_LAYERS,
  weatherThresholdFor,
  weatherThresholds,
} from "../../src/simulator/environment/CloudNoise";
import {
  cloudAerialFor,
  cloudMapDirection,
  cloudMapUv,
  cloudStepsFor,
  cloudTile,
  cloudTilesFor,
  cloudTopFor,
} from "../../src/simulator/environment/CloudMap";
import { CLOUD_BASE, CLOUD_MAP_RIM, cloudMarchFragment } from "../../src/simulator/environment/shaders/cloudShader";
import { skyFragmentShader } from "../../src/simulator/environment/shaders/skyShader";
import { cloudMapSizeFor, QUALITY_SETTINGS } from "../../src/simulator/core/QualityManager";
import { WEATHER_PRESETS } from "../../src/simulator/environment/WeatherMath";

const noise = buildCloudNoise();
const size = CLOUD_NOISE_SIZE;

test("the cloud noise fills its range in every channel and is built once", () => {
  assert.equal(noise.length, size * size * size * 4);
  assert.equal(buildCloudNoise(), noise, "a second call returns the same array");
  for (let channel = 0; channel < 4; channel += 1) {
    const values: number[] = [];
    for (let index = channel; index < noise.length; index += 4 * 5) values.push(noise[index]! / 255);
    values.sort((a, b) => a - b);
    const low = values[Math.floor(values.length * 0.05)]!;
    const high = values[Math.floor(values.length * 0.95)]!;
    assert.ok(high - low > 0.3, `channel ${channel} spans a useful range (${low.toFixed(2)}…${high.toFixed(2)})`);
  }
});

test("the cloud noise repeats without a seam in all three directions", () => {
  // Across the wrap, neighbouring texels differ no more than neighbours inside do.
  const step = (axis: number, from: number): number => {
    let total = 0;
    let count = 0;
    for (let a = 0; a < size; a += 3) {
      for (let b = 0; b < size; b += 3) {
        const at = (i: number): number => {
          const x = axis === 0 ? i : a;
          const y = axis === 1 ? i : axis === 0 ? a : b;
          const z = axis === 2 ? i : b;
          return ((z * size + y) * size + x) * 4;
        };
        for (let channel = 0; channel < 4; channel += 1) {
          total += Math.abs(noise[at(from) + channel]! - noise[at((from + 1) % size) + channel]!);
          count += 1;
        }
      }
    }
    return total / count;
  };
  for (let axis = 0; axis < 3; axis += 1) {
    const inside = (step(axis, 20) + step(axis, 41)) / 2;
    const across = step(axis, size - 1);
    assert.ok(across < inside * 1.6, `axis ${axis}: ${across.toFixed(2)} across the wrap, ${inside.toFixed(2)} inside`);
  }
  // And the sampler itself is periodic.
  for (const [u, v, w] of [[0.13, 0.52, 0.81], [0.97, 0.02, 0.44]] as const) {
    for (let channel = 0; channel < 4; channel += 1) {
      const here = sampleCloudNoise(noise, size, u, v, w, channel);
      assert.ok(Math.abs(here - sampleCloudNoise(noise, size, u + 1, v - 2, w + 3, channel)) < 1e-9);
      assert.ok(here >= 0 && here <= 1);
    }
  }
});

test("a cover fraction puts cloud fields over that fraction of the sea", () => {
  const thresholds = weatherThresholds(noise);
  for (let index = 1; index < thresholds.length; index += 1) {
    assert.ok(thresholds[index]! <= thresholds[index - 1]!, "more cover never raises the threshold");
  }
  // Counted over a different stretch of sea than the table was made from.
  const count = 70;
  const span = WEATHER_LAYERS[0].scale * 2.3;
  const samples: number[] = [];
  for (let j = 0; j < count; j += 1) {
    for (let i = 0; i < count; i += 1) samples.push(cloudWeatherAt(noise, size, 9000 + (i / count) * span, -4000 + (j / count) * span));
  }
  for (const kind of ["clear", "cloudy", "overcast", "storm"] as const) {
    const cover = WEATHER_PRESETS[kind].cloudCover;
    const threshold = weatherThresholdFor(thresholds, cover);
    const fraction = samples.filter((value) => value > threshold).length / samples.length;
    assert.ok(Math.abs(fraction - cover) < 0.09, `${kind}: fields over ${(fraction * 100).toFixed(0)} % for a cover of ${(cover * 100).toFixed(0)} %`);
  }
  assert.ok(weatherThresholdFor(thresholds, 0) > Math.max(...samples), "no cover: no fields anywhere");
  assert.ok(weatherThresholdFor(thresholds, 1) < Math.min(...samples), "full cover: fields everywhere");
});

test("the map of the sky is one chart of the upper hemisphere, finest at the horizon", () => {
  const zenith = cloudMapUv(0, 1, 0);
  assert.ok(Math.abs(zenith.u - 0.5) < 1e-12 && Math.abs(zenith.v - 0.5) < 1e-12);
  for (let step = 0; step < 24; step += 1) {
    const azimuth = (step / 24) * Math.PI * 2;
    for (const elevation of [0, 0.02, 0.3, 0.9, 1.4]) {
      const x = Math.sin(azimuth) * Math.cos(elevation);
      const y = Math.sin(elevation);
      const z = Math.cos(azimuth) * Math.cos(elevation);
      const { u, v } = cloudMapUv(x, y, z);
      assert.ok(u > 0.01 && u < 0.99 && v > 0.01 && v < 0.99, "everything above the horizon is inside the map, with a margin");
      const back = cloudMapDirection(u, v);
      assert.ok(Math.hypot(back.x - x, back.y - y, back.z - z) < 1e-9, "the shader's inverse returns the direction");
      if (elevation === 0) assert.ok(Math.abs(Math.hypot(u - 0.5, v - 0.5) - 0.5 * CLOUD_MAP_RIM) < 1e-9, "the horizon is the rim circle");
    }
  }
  // A degree of elevation takes more of the map at the horizon than overhead.
  const radius = (elevation: number): number => Math.hypot(cloudMapUv(Math.cos(elevation), Math.sin(elevation), 0).u - 0.5, 0);
  assert.ok(radius(0) - radius(0.02) > (radius(1.5) - radius(1.52)) * 1.8);
});

test("a pass of the map is drawn in tiles that cover it once", () => {
  for (const mapSize of [768, 1024, 1536]) {
    const perSide = cloudTilesFor(mapSize);
    const seen = new Set<string>();
    let area = 0;
    for (let index = 0; index < perSide * perSide; index += 1) {
      const tile = cloudTile(index, perSide);
      seen.add(`${tile.x.toFixed(4)}:${tile.y.toFixed(4)}`);
      area += tile.size * tile.size;
      assert.ok(tile.x >= 0 && tile.y >= 0 && tile.x + tile.size <= 1 + 1e-9 && tile.y + tile.size <= 1 + 1e-9);
    }
    assert.equal(seen.size, perSide * perSide);
    assert.ok(Math.abs(area - 1) < 1e-9);
    assert.deepEqual(cloudTile(perSide * perSide, perSide), cloudTile(0, perSide), "the next pass starts over");
    // A frame's tile is a bounded piece of work, and a pass is over in about a second at 60 fps.
    const texels = (mapSize / perSide) ** 2;
    assert.ok(texels <= 70_000, `${mapSize}: ${texels} texels a frame`);
    assert.ok(perSide * perSide <= 64);
    assert.ok(cloudStepsFor(mapSize) >= 32 && cloudStepsFor(mapSize) * 3 <= 224, "the march fits the shader's loop");
  }
});

test("fair-weather cumulus are shallow, a storm sky towers, and haze takes far clouds sooner under it", () => {
  const fair = cloudTopFor(WEATHER_PRESETS.clear.cloudCover);
  const storm = cloudTopFor(WEATHER_PRESETS.storm.cloudCover);
  assert.ok(fair > CLOUD_BASE + 800 && fair < CLOUD_BASE + 2200);
  assert.ok(storm > fair + 1500);
  let previous = 0;
  for (let cover = 0; cover <= 1.0001; cover += 0.05) {
    const top = cloudTopFor(cover);
    assert.ok(top >= previous && Number.isFinite(top));
    previous = top;
  }
  assert.ok(cloudAerialFor(0.19, 0) > cloudAerialFor(0.94, 0));
  assert.ok(cloudAerialFor(0.19, 1) > 10_000 && cloudAerialFor(0.94, 1) > 8_000, "never so near that the clouds overhead fade");
});

test("volumetric clouds are a matter of the preset: none on low, none on a phone below high", () => {
  assert.equal(QUALITY_SETTINGS.low.cloudMapSize, 0);
  assert.ok(QUALITY_SETTINGS.medium.cloudMapSize > 0);
  assert.ok(QUALITY_SETTINGS.high.cloudMapSize >= QUALITY_SETTINGS.medium.cloudMapSize);
  assert.ok(QUALITY_SETTINGS.ultra.cloudMapSize >= QUALITY_SETTINGS.high.cloudMapSize);
  assert.equal(cloudMapSizeFor("low", false), 0);
  assert.equal(cloudMapSizeFor("medium", true), 0, "a phone on medium keeps the flat clouds");
  assert.equal(cloudMapSizeFor("medium", false), QUALITY_SETTINGS.medium.cloudMapSize);
  assert.equal(cloudMapSizeFor("high", true), QUALITY_SETTINGS.high.cloudMapSize);
});

test("every consumer of the sky reads its clouds from the one map", () => {
  // skyClouds is shared by the dome, the ocean's mirror and the lighting capture.
  assert.ok(skyFragmentShader.includes("uCloudVolume > 0.5"));
  assert.ok(skyFragmentShader.includes("textureLod(uCloudMap, uv, lod)") && skyFragmentShader.includes("textureLod(uCloudMapPrev, uv, lod)"));
  assert.ok(skyFragmentShader.includes("uCloudMapBlend"), "two passes are blended, so the sky moves smoothly");
  // The march and the lookup agree on the chart.
  assert.ok(cloudMarchFragment.includes(CLOUD_MAP_RIM.toFixed(3)) && skyFragmentShader.includes(CLOUD_MAP_RIM.toFixed(3)));
  // The march writes plain scene-linear radiance into the map: no tone curve in it.
  assert.ok(!cloudMarchFragment.includes("tonemapping_fragment"));
});
