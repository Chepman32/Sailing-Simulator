#!/usr/bin/env node
// Generates the three original aircraft GLBs used by the aviation system.
//
// The models are authored from parametric lofts (NACA wings and tails,
// superellipse fuselages, twisted propeller blades) and their liveries are
// painted on HTML canvases (colour, panel-seam normal map, roughness/metal),
// so the build runs in headless Chromium through Playwright. The runtime
// never builds aircraft geometry; it loads the committed GLBs.
//
// Conventions for every exported model: meters, +Y up, nose along +Z,
// starboard along +X, origin near the centre of gravity. Named empties mark
// runtime attachment points (Propeller, NavPort, NavStarboard, Beacon,
// TailLight, LandingLight, TowHook, EngineExhaustPort/Starboard).
//
// Usage: node scripts/models/build-aircraft-models.mjs [output-directory]
// Requires the `playwright` package and a Chromium build. Set
// PLAYWRIGHT_MODULE to an absolute path when playwright is installed outside
// this project.

import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const OUTPUT_DIRECTORY = resolve(process.argv[2] ?? join(ROOT, "public/models"));
const LICENSE = "CC0-1.0";
const AUTHOR = "Sailing Simulator Pro contributors";
const SOURCE = "scripts/models/build-aircraft-models.mjs";
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json" };

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith("/") ? pathToFileURL(candidate).href : candidate;
      return await import(specifier);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("Playwright is required: install `playwright` or set PLAYWRIGHT_MODULE to its index.mjs.");
}

function serve() {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    const file = join(ROOT, path);
    // Only the generator sources and three.js are served.
    const allowed = file.startsWith(join(ROOT, "scripts/models/aircraft")) || file.startsWith(join(ROOT, "node_modules/three"));
    if (!allowed || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)));
}

function withAssetExtras(glb, extras) {
  // GLTFExporter writes scene extras but not asset extras; patch the JSON
  // chunk so license metadata travels with the binary like the other models.
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  json.asset = { ...json.asset, extras };
  let jsonText = JSON.stringify(json);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += " ";
  const jsonChunk = Buffer.from(jsonText, "utf8");
  const binaryChunk = glb.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + binaryChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, jsonChunk, binaryChunk]);
}

const { chromium } = await loadPlaywright();
const server = await serve();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("generator error:", error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/models/aircraft/index.html`);
  await page.waitForFunction(() => window.aircraftGeneratorReady === true, null, { timeout: 60_000 });
  const models = await page.evaluate(() => window.buildAircraftModels());
  for (const model of models) {
    const output = withAssetExtras(Buffer.from(model.base64, "base64"), { title: model.title, author: AUTHOR, license: LICENSE, source: SOURCE });
    writeFileSync(join(OUTPUT_DIRECTORY, model.fileName), output);
    console.log(`${model.fileName}: ${output.byteLength} bytes, ${model.triangles} triangles`);
  }
} finally {
  await browser.close();
  server.close();
}
