// Browser entry for the aircraft generator: builds every model and exports it
// as a binary glTF. Driven by scripts/models/build-aircraft-models.mjs.

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { triangleCount } from "./geometry.mjs";
import { buildAirliner, buildLightAircraft } from "./models.mjs";

const MODELS = [
  ["tourist-seaplane.glb", "Tourist floatplane", () => buildLightAircraft("seaplane")],
  ["banner-tow-plane.glb", "Banner-tow bush plane", () => buildLightAircraft("banner")],
  ["narrowbody-airliner.glb", "Narrow-body airliner", buildAirliner],
];

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

window.buildAircraftModels = async () => {
  await document.fonts.ready;
  const exporter = new GLTFExporter();
  const results = [];
  for (const [fileName, title, build] of MODELS) {
    const root = build();
    const scene = new THREE.Scene();
    scene.add(root);
    const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
    results.push({ fileName, title, triangles: triangleCount(root), base64: toBase64(glb) });
  }
  return results;
};

window.aircraftGeneratorReady = true;
