import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_VISIBLE_TERRAIN_RADIUS_SCALE } from "../../src/simulator/environment/IslandSystem";

type GlbJson = {
  asset?: { extras?: { license?: string; source?: string } };
  accessors?: Array<{ count?: number; max?: number[]; min?: number[] }>;
  animations?: Array<{ name?: string }>;
  materials?: unknown[];
  meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number }; indices?: number }> }>;
  skins?: unknown[];
  textures?: unknown[];
};

function readGlbJson(path: string): { bytes: number; json: GlbJson } {
  const data = readFileSync(path);
  assert.equal(data.toString("ascii", 0, 4), "glTF");
  const jsonLength = data.readUInt32LE(12);
  return {
    bytes: data.byteLength,
    json: JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/u, "")) as GlbJson,
  };
}

test("whale asset stays detailed, rigged, animated, textured, and mobile-safe", () => {
  const { bytes, json } = readGlbJson("public/models/blue-whale-rigged-pbr-v2.glb");
  const triangleCount = (json.meshes ?? []).reduce(
    (total, mesh) => total + (mesh.primitives ?? []).reduce((meshTotal, primitive) => {
      const count = primitive.indices === undefined ? 0 : json.accessors?.[primitive.indices]?.count ?? 0;
      return meshTotal + count / 3;
    }, 0),
    0,
  );

  assert.ok(triangleCount >= 30_000 && triangleCount <= 60_000, `unexpected whale triangle count: ${triangleCount}`);
  assert.ok((json.skins?.length ?? 0) > 0, "whale must remain skinned");
  assert.ok(json.animations?.some((animation) => /swim/i.test(animation.name ?? "")), "whale needs a swim clip");
  assert.ok((json.materials?.length ?? 0) > 0 && (json.textures?.length ?? 0) >= 3, "whale needs PBR textures");
  assert.ok(bytes < 2_000_000, `whale asset is too heavy for mobile: ${bytes} bytes`);
  assert.match(json.asset?.extras?.license ?? "", /CC-BY-4\.0/i, "whale license metadata must remain embedded");
  assert.match(json.asset?.extras?.source ?? "", /sketchfab\.com\/3d-models\/blue-whale-textured/i);

  const bounds = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []).reduce(
    (result, primitive) => {
      const position = primitive.attributes?.POSITION;
      const accessor = position === undefined ? undefined : json.accessors?.[position];
      if (!accessor?.min || !accessor.max) return result;
      for (let axis = 0; axis < 3; axis += 1) {
        result.min[axis] = Math.min(result.min[axis], accessor.min[axis] ?? Number.POSITIVE_INFINITY);
        result.max[axis] = Math.max(result.max[axis], accessor.max[axis] ?? Number.NEGATIVE_INFINITY);
      }
      return result;
    },
    {
      min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    },
  );
  const dimensions = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]);
  const thicknessRatio = Math.min(...dimensions) / Math.max(...dimensions);
  assert.ok(thicknessRatio >= 0.08, `whale geometry looks flat: thickness ratio ${thicknessRatio}`);
});

test("visible island geometry no longer contains the giant submerged shelf", () => {
  assert.ok(MAX_VISIBLE_TERRAIN_RADIUS_SCALE <= 1.06);
});

test("every model is packed for the web: meshopt-compressed geometry, WebP textures", async () => {
  const { readdirSync } = await import("node:fs");
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${directory}/${entry.name}`) : entry.name.endsWith(".glb") ? [`${directory}/${entry.name}`] : [],
    );
  const files = walk("public/models");
  assert.ok(files.length >= 15);
  for (const file of files) {
    const { json } = readGlbJson(file);
    const raw = json as GlbJson & { extensionsUsed?: string[]; images?: Array<{ mimeType?: string }> };
    assert.ok(raw.extensionsUsed?.includes("EXT_meshopt_compression"), `${file} is not packed (node scripts/pack-models.mjs)`);
    for (const image of raw.images ?? []) assert.equal(image.mimeType, "image/webp", `${file} has a ${image.mimeType} texture`);
  }
});

test("the asset manifest matches the files (hashes for the URLs, sizes for the loading bar)", async () => {
  const { ASSET_MANIFEST } = await import("../../src/simulator/core/assetManifest");
  const { listAssets } = (await import("../../scripts/asset-manifest.mjs")) as { listAssets: () => { url: string; v: string; bytes: number }[] };
  const files = listAssets();
  assert.deepEqual(
    Object.fromEntries(files.map((file) => [file.url, { v: file.v, bytes: file.bytes }])),
    ASSET_MANIFEST,
    "stale manifest: run node scripts/asset-manifest.mjs",
  );
});

test("the start downloads little: the first frame waits only for the yacht, her skipper, dolphins and gulls", async () => {
  const { START_ASSET_KEYS, LATER_ASSET_KEYS } = await import("../../src/simulator/core/AssetManager");
  const { ASSET_MANIFEST } = await import("../../src/simulator/core/assetManifest");
  assert.deepEqual([...START_ASSET_KEYS].sort(), ["dolphin", "seagull", "traderMan", "yacht"]);
  // The page prefetches exactly these (startAssets.ts, kept free of three.js).
  const { START_MODEL_URLS } = await import("../../src/simulator/core/startAssets");
  const { START_ASSET_URLS } = await import("../../src/simulator/core/AssetManager");
  assert.deepEqual([...START_MODEL_URLS].sort(), [...START_ASSET_URLS].sort());
  assert.ok(LATER_ASSET_KEYS.includes("shark") && LATER_ASSET_KEYS.includes("fishSchool"));
  const startBytes = Object.entries(ASSET_MANIFEST)
    .filter(([url]) => /yacht-sailboat-pbr|dolphin-animated\.glb|seagull|trader-man/u.test(url))
    .reduce((sum, [, entry]) => sum + entry.bytes, 0);
  assert.ok(startBytes < 3_200_000, `${startBytes} bytes before the first frame`);
});
