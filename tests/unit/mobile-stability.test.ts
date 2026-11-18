import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AssetManager, laterAssetKeys } from "../../src/simulator/core/AssetManager";
import { ContextRecoveryClock, contextRecovery } from "../../src/simulator/core/RenderHealth";
import { disposeModel, limitModelTextures, MOBILE_MODEL_TEXTURE_BYTES, modelTextureSizes } from "../../src/simulator/core/ModelResources";
import { QualityManager } from "../../src/simulator/core/QualityManager";
import { ScreenLod } from "../../src/simulator/core/ScreenLod";
import { MeshoptSimplifier } from "meshoptimizer";

test("mobile texture budgets account for every decoded image, mipmaps and aspect ratio", () => {
  const originals = Array.from({ length: 40 }, (_, i) => ({ width: 768, height: i % 2 ? 384 : 768 }));
  const sizes = modelTextureSizes(originals);
  const bytes = sizes.reduce((sum, image) => sum + image.width * image.height * 4 * 4 / 3, 0);
  assert.ok(bytes <= MOBILE_MODEL_TEXTURE_BYTES);
  for (let i = 0; i < sizes.length; i++) {
    const before = originals[i]!;
    const after = sizes[i]!;
    assert.ok(after.width <= before.width && after.height <= before.height);
    assert.ok(Math.abs(after.width / after.height - before.width / before.height) < 0.02);
  }
  assert.deepEqual(modelTextureSizes([{ width: 32, height: 16 }]), [{ width: 32, height: 16 }]);
  assert.deepEqual(modelTextureSizes([{ width: 4096, height: 2048 }]), [{ width: 1024, height: 512 }]);
});

test("resizing shared GLTF textures preserves sampling, sharing and releases the original bitmap once", async () => {
  let closed = 0;
  let resized = 0;
  const original = { width: 2048, height: 1024, close: () => closed++ };
  const texture = new THREE.Texture(original as unknown as TexImageSource);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.offset.set(0.2, 0.3);
  const clone = texture.clone();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture, normalMap: clone })));
  await limitModelTextures([root], async (_image, size) => {
    resized++;
    return { ...size };
  });
  assert.equal(resized, 1);
  assert.equal(closed, 1);
  assert.equal(texture.source, clone.source);
  assert.equal(texture.image.width, 1024);
  assert.equal(texture.flipY, false);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.deepEqual(texture.offset.toArray(), [0.2, 0.3]);
});

test("disposing shared model instances closes each bitmap and geometry once", () => {
  let closed = 0;
  let freed = 0;
  const texture = new THREE.Texture({ width: 16, height: 16, close: () => closed++ } as unknown as TexImageSource);
  const geometry = new THREE.BoxGeometry();
  geometry.addEventListener("dispose", () => freed++);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, normalMap: texture.clone() })));
  disposeModel([root, root.clone(true)]);
  assert.equal(closed, 1);
  assert.equal(freed, 1);
});

test("free sailing does not request campaign boats, characters or weapons", () => {
  const free = laterAssetKeys(false);
  for (const key of ["figMark", "figGuardA", "figGuardB", "viewPistol", "viewRifle", "sportYacht", "skiff"] as const) {
    assert.ok(!free.includes(key));
    assert.ok(laterAssetKeys(true).includes(key));
  }
  for (const key of ["shark", "whale", "crabRed", "traderWoman", "fishSchool"] as const) assert.ok(free.includes(key));
});

test("a model arriving after teardown is released without adopting it or starting another download", async () => {
  const manager = new AssetManager();
  let resolve!: (model: GLTF) => void;
  let downloads = 0;
  let adopted = 0;
  let closed = 0;
  const root = new THREE.Group();
  const texture = new THREE.Texture({ width: 16, height: 16, close: () => closed++ } as unknown as TexImageSource);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: texture })));
  (manager as unknown as { loader: Pick<GLTFLoader, "loadAsync"> }).loader = {
    loadAsync: () => { downloads++; return new Promise<GLTF>((done) => { resolve = done; }); },
  };
  const loading = manager.loadLater(() => { adopted++; }, false);
  manager.dispose();
  resolve({ scene: root, scenes: [root], animations: [] } as unknown as GLTF);
  await loading;
  assert.equal(downloads, 1);
  assert.equal(adopted, 0);
  assert.equal(closed, 1);
  assert.equal(manager.has("shark"), false);
});

test("background assets wait for adoption and shader compilation before the next model", async () => {
  const manager = new AssetManager();
  let downloads = 0;
  let continueAdoption!: () => void;
  const adoption = new Promise<void>((resolve) => { continueAdoption = resolve; });
  const root = new THREE.Group();
  (manager as unknown as { loader: Pick<GLTFLoader, "loadAsync"> }).loader = {
    loadAsync: async () => {
      downloads++;
      return { scene: root, scenes: [root], animations: [] } as unknown as GLTF;
    },
  };
  const loading = manager.loadLater(() => adoption, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(downloads, 1);
  manager.dispose();
  continueAdoption();
  await loading;
  assert.equal(downloads, 1);
});

test("mobile automatic quality never enables HDR just because FPS or GPU time looks good", () => {
  const globals = globalThis as unknown as { window?: unknown };
  const previous = globals.window;
  globals.window = { matchMedia: () => ({ matches: true }), devicePixelRatio: 3 };
  try {
    const renderer = { shadowMap: { enabled: false, type: 0 } } as THREE.WebGLRenderer;
    const quality = new QualityManager(renderer, "low");
    for (let i = 0; i < 300; i++) { quality.observeFps(60); quality.observeGpu("idle"); }
    assert.equal(quality.current, "low");
    assert.equal(quality.settings.postProcessing, false);
    quality.setPreset("medium");
    assert.equal(quality.current, "medium", "manual selection remains available");
    quality.observeGpu("overloaded");
    assert.equal(quality.current, "low", "automatic fallback still works");
  } finally { globals.window = previous; }
});

test("an hour in the background does not exhaust a lost context's recovery time", () => {
  const clock = new ContextRecoveryClock();
  clock.start(0, true);
  assert.equal(clock.read(500, false), 0.5);
  assert.equal(clock.read(3_600_000, false), 0.5);
  assert.equal(clock.read(3_600_500, true), 0.5);
  assert.equal(contextRecovery(clock.read(3_602_000, true), false), "restore");
  assert.equal(contextRecovery(clock.read(3_603_000, true), true), "none");
  clock.start(0, false);
  assert.equal(clock.read(3_600_000, true), 0);
});

test("streamed-out nested models leave the LOD registry and release their index buffers", async () => {
  const lod = new ScreenLod();
  await MeshoptSimplifier.ready;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 32, 24);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  group.add(mesh);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 1000;
  lod.register(group, 1);
  lod.update(camera);
  assert.ok(lod.stats.full > 0);
  assert.notEqual(mesh.geometry, geometry);
  let freed = 0;
  mesh.geometry.addEventListener("dispose", () => freed++);
  scene.remove(group);
  lod.update(camera);
  assert.equal(mesh.parent, group, "the nested mesh still has a parent");
  assert.equal(lod.stats.full, 0);
  assert.equal(mesh.geometry, geometry);
  assert.equal(freed, 1);
  assert.ok(geometry.getAttribute("position"), "shared source data survives");
  lod.dispose();
});
