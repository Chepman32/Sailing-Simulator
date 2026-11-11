#!/usr/bin/env node
/**
 * Packs the GLB models in `public/models` for the web: a fraction of the
 * download, the same look.
 *
 *   node scripts/pack-models.mjs [file.glb ...]   (default: every model)
 *
 * - Each primitive's vertices are put in the order its triangles use them
 *   (better for the GPU's vertex cache, and much better for compression).
 * - Every buffer of vertices, indices, skins and animation is compressed
 *   with meshoptimizer (`EXT_meshopt_compression`); float data first goes
 *   through the exponential filter at a precision fitting what it holds
 *   (positions to about 1/65 000 of their size, normals and weights to
 *   about 1/4 000, and so on), which is invisible but compresses far better.
 * - PNG and JPEG textures become WebP (`EXT_texture_webp`).
 *
 * The page decodes them with three's `MeshoptDecoder` (`AssetManager`,
 * `ShipModels`). A packed file is recognised and left alone, so the script
 * can be run again after adding a model. It needs only the project's own
 * dependencies (`meshoptimizer`, `sharp`).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MeshoptEncoder } from "meshoptimizer";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODELS = path.join(ROOT, "public/models");

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const FLOAT = 5126;

/** Mantissa bits kept by the exponential filter, by what the data is. */
const BITS = {
  POSITION: 16,
  NORMAL: 12,
  TANGENT: 12,
  TEXCOORD: 14,
  COLOR: 10,
  WEIGHTS: 12,
  TARGET: 14,
  IBM: 20,
  TIME: 20,
  translation: 16,
  rotation: 14,
  scale: 14,
  weights: 12,
};

function readGlb(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = Buffer.from(chunk);
    offset += 8 + length;
  }
  return { json, bin, size: bytes.length };
}

function writeGlb(file, json, bin) {
  const pad = (buffer, fill) => {
    const extra = (4 - (buffer.length % 4)) % 4;
    return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer;
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHeader = (length, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(length, 0);
    head.writeUInt32LE(type, 4);
    return head;
  };
  fs.writeFileSync(file, Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]));
  return total;
}

const elementSize = (accessor) => COMPONENT_SIZE[accessor.componentType] * TYPE_COUNT[accessor.type];

function addExtension(json, name, required) {
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), name])];
  if (required) json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), name])];
}

/** What every accessor holds (for the filter's precision) and which are triangle indices. */
function accessorRoles(json) {
  const roles = new Map();
  const triangleIndices = new Set();
  const lineIndices = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const [semantic, accessor] of Object.entries(primitive.attributes)) roles.set(accessor, semantic.replace(/_\d+$/, ""));
      for (const target of primitive.targets ?? []) for (const accessor of Object.values(target)) roles.set(accessor, "TARGET");
      if (primitive.indices !== undefined) {
        roles.set(primitive.indices, "INDICES");
        ((primitive.mode ?? 4) === 4 ? triangleIndices : lineIndices).add(primitive.indices);
      }
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) roles.set(skin.inverseBindMatrices, "IBM");
  for (const animation of json.animations ?? []) {
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      roles.set(sampler.input, "TIME");
      roles.set(sampler.output, channel.target.path);
    }
  }
  return { roles, triangleIndices, lineIndices };
}

/** Reads accessor `index` as a typed array of its components (tightly packed). */
function readAccessor(json, views, index) {
  const accessor = json.accessors[index];
  const view = views[accessor.bufferView];
  const size = elementSize(accessor);
  const stride = json.bufferViews[accessor.bufferView].byteStride || size;
  const out = Buffer.alloc(accessor.count * size);
  for (let i = 0; i < accessor.count; i += 1) view.copy(out, i * size, (accessor.byteOffset ?? 0) + i * stride, (accessor.byteOffset ?? 0) + i * stride + size);
  return out;
}

/**
 * Accessor `index` copied out tightly; vertex data (`vertex`) has each
 * element padded to 4 bytes, as a vertex stride must be.
 */
function packAccessor(json, views, index, vertex) {
  const accessor = json.accessors[index];
  const size = elementSize(accessor);
  const stride = vertex ? Math.ceil(size / 4) * 4 : size;
  const source = readAccessor(json, views, index);
  if (stride === size) return { data: source, stride };
  const out = Buffer.alloc(accessor.count * stride);
  for (let i = 0; i < accessor.count; i += 1) source.copy(out, i * stride, i * size, i * size + size);
  return { data: out, stride };
}

/**
 * Gives every accessor its own buffer view: views shared by several
 * accessors (animation data packed one after another, vertex attributes
 * interleaved) are split. One kind of data per view, at a uniform stride,
 * is what the compressor and its filters need.
 */
function splitViews(json, views) {
  const users = new Map();
  json.accessors.forEach((accessor, index) => {
    if (accessor.bufferView === undefined || accessor.sparse) return;
    if (!users.has(accessor.bufferView)) users.set(accessor.bufferView, []);
    users.get(accessor.bufferView).push(index);
  });
  for (const [viewIndex, accessors] of users) {
    const viewDef = json.bufferViews[viewIndex];
    if (accessors.length < 2) continue;
    for (const accessorIndex of accessors) {
      const accessor = json.accessors[accessorIndex];
      const { data, stride } = packAccessor(json, views, accessorIndex, Boolean(viewDef.byteStride));
      views.push(data);
      const view = { buffer: 0, byteLength: data.length };
      if (viewDef.target !== undefined) view.target = viewDef.target;
      // Vertex data keeps an explicit stride when it is not the element size.
      if (viewDef.byteStride && stride !== elementSize(accessor)) view.byteStride = stride;
      json.bufferViews.push(view);
      accessor.bufferView = json.bufferViews.length - 1;
      delete accessor.byteOffset;
    }
    views[viewIndex] = null;
  }
}

/**
 * Puts each primitive's vertices in the order its triangles first use them
 * (after optimising that order for the vertex cache), when the primitive
 * owns its vertex data outright.
 */
function reorderPrimitives(json, views) {
  const accessorUsers = new Map();
  const viewUsers = new Map();
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const accessor of Object.values(primitive.attributes)) count(accessorUsers, accessor);
      if (primitive.indices !== undefined) count(accessorUsers, primitive.indices);
    }
  }
  json.accessors.forEach((accessor) => accessor.bufferView !== undefined && count(viewUsers, accessor.bufferView));
  let reordered = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4 || primitive.indices === undefined || primitive.targets?.length) continue;
      const owned = [primitive.indices, ...Object.values(primitive.attributes)];
      const vertexCount = json.accessors[primitive.attributes.POSITION].count;
      const ok = owned.every((index) => {
        const accessor = json.accessors[index];
        return (
          accessorUsers.get(index) === 1 &&
          accessor.bufferView !== undefined &&
          !accessor.sparse &&
          viewUsers.get(accessor.bufferView) === 1 &&
          (index === primitive.indices || accessor.count === vertexCount)
        );
      });
      if (!ok) continue;
      const indexAccessor = json.accessors[primitive.indices];
      const raw = readAccessor(json, views, primitive.indices);
      const indices =
        indexAccessor.componentType === 5125
          ? new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))
          : Uint32Array.from(indexAccessor.componentType === 5123 ? new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)) : raw);
      if (indices.length % 3 !== 0) continue;
      const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
      for (const attributeIndex of Object.values(primitive.attributes)) {
        const accessor = json.accessors[attributeIndex];
        const size = elementSize(accessor);
        const stride = json.bufferViews[accessor.bufferView].byteStride || size;
        const old = readAccessor(json, views, attributeIndex);
        const out = Buffer.alloc(unique * stride);
        for (let vertex = 0; vertex < Math.min(remap.length, accessor.count); vertex += 1) {
          const target = remap[vertex];
          if (target !== 0xffffffff) old.copy(out, target * stride, vertex * size, vertex * size + size);
        }
        views[accessor.bufferView] = out;
        json.bufferViews[accessor.bufferView].byteLength = out.length;
        delete json.bufferViews[accessor.bufferView].byteOffset;
        delete accessor.byteOffset;
        accessor.count = unique;
      }
      const wide = unique > 65535;
      const indexData = wide ? Buffer.from(indices.buffer) : Buffer.from(Uint16Array.from(indices).buffer);
      indexAccessor.componentType = wide ? 5125 : 5123;
      delete indexAccessor.byteOffset;
      views[indexAccessor.bufferView] = indexData;
      json.bufferViews[indexAccessor.bufferView].byteLength = indexData.length;
      reordered += 1;
    }
  }
  return reordered;
}

/**
 * Float normals become 16-bit octahedral ones (the `OCTAHEDRAL` filter,
 * 10 bits a component: smooth on a close-up face, a third of the size).
 * Returns the views to filter that way.
 */
function octahedralNormals(json, views) {
  const octViews = new Set();
  const owners = new Map();
  json.accessors.forEach((accessor) => accessor.bufferView !== undefined && owners.set(accessor.bufferView, (owners.get(accessor.bufferView) ?? 0) + 1));
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const semantic of ["NORMAL", "TANGENT"]) {
      const index = primitive.attributes[semantic];
      if (index === undefined) continue;
      const accessor = json.accessors[index];
      const components = semantic === "NORMAL" ? 3 : 4;
      if (accessor.componentType !== FLOAT || accessor.type !== (components === 3 ? "VEC3" : "VEC4") || accessor.sparse || owners.get(accessor.bufferView) !== 1 || octViews.has(accessor.bufferView)) continue;
      const source = readAccessor(json, views, index);
      const floats = new Float32Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.length));
      const four = new Float32Array(accessor.count * 4);
      for (let i = 0; i < accessor.count; i += 1) {
        let x = floats[i * components];
        let y = floats[i * components + 1];
        let z = floats[i * components + 2];
        const length = Math.hypot(x, y, z) || 1;
        x /= length;
        y /= length;
        z /= length;
        four[i * 4] = x;
        four[i * 4 + 1] = y;
        four[i * 4 + 2] = z;
        // A tangent's handedness (±1) is kept as it is.
        four[i * 4 + 3] = components === 4 ? (floats[i * 4 + 3] < 0 ? -1 : 1) : 1;
      }
      views[accessor.bufferView] = Buffer.from(MeshoptEncoder.encodeFilterOct(four, accessor.count, 8, 10));
      const view = json.bufferViews[accessor.bufferView];
      view.byteLength = accessor.count * 8;
      view.byteStride = 8;
      view.target = 34962;
      delete view.byteOffset;
      accessor.componentType = 5122;
      accessor.normalized = true;
      delete accessor.byteOffset;
      delete accessor.min;
      delete accessor.max;
      octViews.add(accessor.bufferView);
      }
    }
  }
  if (octViews.size > 0) addExtension(json, "KHR_mesh_quantization", true);
  return octViews;
}

/** Tangents serve only a normal map: a primitive whose material has none loses them. */
function dropUnusedTangents(json) {
  let dropped = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.attributes.TANGENT === undefined) continue;
      const material = primitive.material === undefined ? null : json.materials?.[primitive.material];
      if (material && (material.normalTexture || Object.keys(material.extensions ?? {}).length > 0)) continue;
      delete primitive.attributes.TANGENT;
      dropped += 1;
    }
  }
  return dropped;
}

const floatsOf = (buffer) => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));

/**
 * Drops the keyframes of linear animation tracks that their neighbours'
 * interpolation already gives (to 1/10 000), and a still track to its two
 * ends. Each simplified track gets its own time and value accessors.
 */
function simplifyAnimations(json, views) {
  let before = 0;
  let after = 0;
  for (const animation of json.animations ?? []) {
    const rotationSamplers = new Set(animation.channels.filter((channel) => channel.target.path === "rotation").map((channel) => channel.sampler));
    animation.samplers.forEach((sampler, samplerIndex) => {
      if ((sampler.interpolation ?? "LINEAR") !== "LINEAR") return;
      const input = json.accessors[sampler.input];
      const output = json.accessors[sampler.output];
      if (input.sparse || output.sparse || input.componentType !== FLOAT || output.componentType !== FLOAT || input.count !== output.count || input.count < 3) return;
      const times = floatsOf(readAccessor(json, views, sampler.input));
      const values = floatsOf(readAccessor(json, views, sampler.output));
      const n = TYPE_COUNT[output.type];
      const rotation = rotationSamplers.has(samplerIndex) && n === 4;
      let scale = 0;
      for (const value of values) scale = Math.max(scale, Math.abs(value));
      const tolerance = rotation ? 1e-4 : 1e-4 * Math.max(1, scale);
      const keep = [0];
      const lerped = new Float32Array(n);
      for (let i = 1; i < input.count - 1; i += 1) {
        const a = keep[keep.length - 1];
        const b = i + 1;
        const t = (times[i] - times[a]) / Math.max(1e-9, times[b] - times[a]);
        // Quaternions: the shorter way round, renormalised (as the player slerps).
        let dot = 0;
        if (rotation) for (let c = 0; c < 4; c += 1) dot += values[a * 4 + c] * values[b * 4 + c];
        const sign = rotation && dot < 0 ? -1 : 1;
        let length = 0;
        for (let c = 0; c < n; c += 1) {
          lerped[c] = values[a * n + c] * (1 - t) + sign * values[b * n + c] * t;
          length += lerped[c] * lerped[c];
        }
        if (rotation) for (let c = 0; c < 4; c += 1) lerped[c] /= Math.sqrt(length) || 1;
        let error = 0;
        let flip = 1;
        if (rotation) {
          let d = 0;
          for (let c = 0; c < 4; c += 1) d += lerped[c] * values[i * 4 + c];
          flip = d < 0 ? -1 : 1;
        }
        for (let c = 0; c < n; c += 1) error = Math.max(error, Math.abs(flip * lerped[c] - values[i * n + c]));
        if (error > tolerance) keep.push(i);
      }
      keep.push(input.count - 1);
      before += input.count;
      after += keep.length;
      if (keep.length === input.count) return;
      const newTimes = new Float32Array(keep.length);
      const newValues = new Float32Array(keep.length * n);
      keep.forEach((k, j) => {
        newTimes[j] = times[k];
        for (let c = 0; c < n; c += 1) newValues[j * n + c] = values[k * n + c];
      });
      const addAccessor = (array, template, type) => {
        views.push(Buffer.from(array.buffer));
        json.bufferViews.push({ buffer: 0, byteLength: array.byteLength });
        const accessor = { bufferView: json.bufferViews.length - 1, componentType: FLOAT, count: keep.length, type };
        if (template.min && type === "SCALAR") {
          accessor.min = [array[0]];
          accessor.max = [array[array.length - 1]];
        }
        json.accessors.push(accessor);
        return json.accessors.length - 1;
      };
      sampler.input = addAccessor(newTimes, input, "SCALAR");
      sampler.output = addAccessor(newValues, output, output.type);
    });
  }
  return { before, after };
}

/** Removes the accessors and buffer views nothing refers to any more. */
function prune(json, views) {
  const usedAccessors = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      Object.values(primitive.attributes).forEach((index) => usedAccessors.add(index));
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const target of primitive.targets ?? []) Object.values(target).forEach((index) => usedAccessors.add(index));
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers) {
      usedAccessors.add(sampler.input);
      usedAccessors.add(sampler.output);
    }
  }
  const accessorMap = new Map();
  const accessors = [];
  json.accessors.forEach((accessor, index) => {
    if (!usedAccessors.has(index)) return;
    accessorMap.set(index, accessors.length);
    accessors.push(accessor);
  });
  json.accessors = accessors;
  const map = (index) => accessorMap.get(index);
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = map(primitive.attributes[key]);
      if (primitive.indices !== undefined) primitive.indices = map(primitive.indices);
      for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = map(target[key]);
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = map(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers) {
      sampler.input = map(sampler.input);
      sampler.output = map(sampler.output);
    }
  }
  // Views: whatever no accessor or image uses is dropped (left null).
  const usedViews = new Set(json.accessors.map((accessor) => accessor.bufferView));
  for (const image of json.images ?? []) usedViews.add(image.bufferView);
  views.forEach((_, index) => {
    if (!usedViews.has(index)) views[index] = null;
  });
}

/**
 * Rotation tracks become 16-bit quaternions (the `QUATERNION` filter, 12
 * bits: a hundredth of a degree). Returns the views to filter that way.
 */
function quaternionRotations(json, views) {
  const quatViews = new Set();
  const owners = new Map();
  json.accessors.forEach((accessor) => accessor.bufferView !== undefined && owners.set(accessor.bufferView, (owners.get(accessor.bufferView) ?? 0) + 1));
  for (const animation of json.animations ?? []) {
    for (const channel of animation.channels) {
      if (channel.target.path !== "rotation") continue;
      const index = animation.samplers[channel.sampler].output;
      const accessor = json.accessors[index];
      if (accessor.componentType !== FLOAT || accessor.type !== "VEC4" || accessor.sparse || owners.get(accessor.bufferView) !== 1 || quatViews.has(accessor.bufferView)) continue;
      const values = floatsOf(readAccessor(json, views, index));
      views[accessor.bufferView] = Buffer.from(MeshoptEncoder.encodeFilterQuat(values, accessor.count, 8, 12));
      json.bufferViews[accessor.bufferView].byteLength = accessor.count * 8;
      delete json.bufferViews[accessor.bufferView].byteStride;
      accessor.componentType = 5122;
      accessor.normalized = true;
      delete accessor.byteOffset;
      delete accessor.min;
      delete accessor.max;
      quatViews.add(accessor.bufferView);
    }
  }
  if (quatViews.size > 0) addExtension(json, "KHR_mesh_quantization", true);
  return quatViews;
}

/** Re-encodes PNG and JPEG textures as WebP. */
async function webpTextures(json, views) {
  const normalImages = new Set();
  for (const material of json.materials ?? []) {
    const texture = material.normalTexture?.index;
    if (texture !== undefined) normalImages.add(json.textures[texture].source);
  }
  let saved = 0;
  for (const [imageIndex, image] of (json.images ?? []).entries()) {
    if (image.bufferView === undefined || image.mimeType === "image/webp") continue;
    const before = views[image.bufferView];
    const after = await sharp(before)
      .webp({ quality: normalImages.has(imageIndex) ? 92 : 86, effort: 6, smartSubsample: true })
      .toBuffer();
    if (after.length >= before.length) continue;
    saved += before.length - after.length;
    views[image.bufferView] = after;
    json.bufferViews[image.bufferView].byteLength = after.length;
    image.mimeType = "image/webp";
    for (const texture of json.textures ?? []) {
      if (texture.source === imageIndex) {
        texture.extensions = { ...(texture.extensions ?? {}), EXT_texture_webp: { source: imageIndex } };
        delete texture.source;
      }
    }
    addExtension(json, "EXT_texture_webp", true);
  }
  return saved;
}

async function pack(file) {
  const { json, bin, size } = readGlb(file);
  if (json.extensionsUsed?.includes("EXT_meshopt_compression")) {
    console.log(`${path.relative(MODELS, file)}: already packed`);
    return;
  }
  if ((json.buffers ?? []).length !== 1 || json.buffers[0].uri) throw new Error(`${file}: expected one embedded buffer`);
  const views = json.bufferViews.map((view) => bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  const tangentsDropped = dropUnusedTangents(json);
  const keyframes = simplifyAnimations(json, views);
  prune(json, views);
  splitViews(json, views);
  const reordered = reorderPrimitives(json, views);
  const octViews = octahedralNormals(json, views);
  const quatViews = quaternionRotations(json, views);
  await webpTextures(json, views);

  const { roles, triangleIndices } = accessorRoles(json);
  const viewAccessors = new Map();
  json.accessors.forEach((accessor, index) => {
    if (accessor.bufferView === undefined) return;
    if (!viewAccessors.has(accessor.bufferView)) viewAccessors.set(accessor.bufferView, []);
    viewAccessors.get(accessor.bufferView).push(index);
  });
  const images = new Set((json.images ?? []).map((image) => image.bufferView));

  const compressed = [];
  let compressedLength = 0;
  let fallbackLength = 0;
  const align = (value) => Math.ceil(value / 4) * 4;
  const newViews = [];
  const remapView = new Map();
  json.bufferViews.forEach((viewDef, viewIndex) => {
    const data = views[viewIndex];
    if (!data) return;
    const accessors = viewAccessors.get(viewIndex) ?? [];
    let encoded = null;
    let extension = null;
    if (!images.has(viewIndex) && accessors.length > 0 && !accessors.some((index) => json.accessors[index].sparse)) {
      const first = json.accessors[accessors[0]];
      const isIndex = accessors.every((index) => roles.get(index) === "INDICES");
      const stride = viewDef.byteStride || elementSize(first);
      const uniform = viewDef.byteStride || accessors.every((index) => elementSize(json.accessors[index]) === stride);
      if (uniform && data.length % stride === 0) {
        const count = data.length / stride;
        if (isIndex && (stride === 2 || stride === 4)) {
          const whole = accessors.reduce((sum, index) => sum + json.accessors[index].count, 0) === count;
          const mode = whole && count % 3 === 0 && accessors.every((index) => triangleIndices.has(index) && json.accessors[index].count % 3 === 0) ? "TRIANGLES" : "INDICES";
          encoded = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(data.buffer, data.byteOffset, data.length), count, stride, mode, 0);
          extension = { byteStride: stride, count, mode };
        } else if (octViews.has(viewIndex)) {
          // Already filtered (the octahedral normals): only compressed.
          encoded = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(data.buffer, data.byteOffset, data.length), count, stride, "ATTRIBUTES", 0);
          extension = { byteStride: stride, count, mode: "ATTRIBUTES", filter: "OCTAHEDRAL" };
        } else if (quatViews.has(viewIndex)) {
          encoded = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(data.buffer, data.byteOffset, data.length), count, stride, "ATTRIBUTES", 0);
          extension = { byteStride: stride, count, mode: "ATTRIBUTES", filter: "QUATERNION" };
        } else if (!isIndex && stride % 4 === 0 && stride <= 256) {
          let source = new Uint8Array(data.buffer, data.byteOffset, data.length);
          let filter;
          const floats = accessors.every((index) => json.accessors[index].componentType === FLOAT && !json.accessors[index].normalized);
          if (floats) {
            const bits = Math.max(...accessors.map((index) => BITS[roles.get(index)] ?? 20));
            const single = accessors.length === 1 && !viewDef.byteStride;
            const vector = single && roles.get(accessors[0]) === "POSITION" && first.type === "VEC3";
            const aligned = new Float32Array(data.length / 4);
            new Uint8Array(aligned.buffer).set(source);
            source = MeshoptEncoder.encodeFilterExp(aligned, count, stride, bits, vector ? "SharedVector" : "Separate");
            filter = "EXPONENTIAL";
          }
          encoded = MeshoptEncoder.encodeGltfBuffer(source, count, stride, "ATTRIBUTES", 0);
          extension = { byteStride: stride, count, mode: "ATTRIBUTES", ...(filter ? { filter } : {}) };
        }
      }
    }
    const view = { ...viewDef };
    delete view.byteOffset;
    if (encoded && encoded.length < data.length) {
      compressedLength = align(compressedLength);
      const offset = compressedLength;
      compressed.push({ offset, data: Buffer.from(encoded) });
      compressedLength += encoded.length;
      fallbackLength = align(fallbackLength);
      view.buffer = 1;
      view.byteOffset = fallbackLength;
      fallbackLength += data.length;
      view.extensions = { ...(view.extensions ?? {}), EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: encoded.length, ...extension } };
    } else {
      compressedLength = align(compressedLength);
      compressed.push({ offset: compressedLength, data });
      view.buffer = 0;
      view.byteOffset = compressedLength;
      compressedLength += data.length;
    }
    remapView.set(viewIndex, newViews.length);
    newViews.push(view);
  });
  json.bufferViews = newViews;
  for (const accessor of json.accessors) if (accessor.bufferView !== undefined) accessor.bufferView = remapView.get(accessor.bufferView);
  for (const image of json.images ?? []) if (image.bufferView !== undefined) image.bufferView = remapView.get(image.bufferView);
  const binOut = Buffer.alloc(align(compressedLength));
  for (const { offset, data } of compressed) data.copy(binOut, offset);
  json.buffers = [{ byteLength: binOut.length }, { byteLength: align(fallbackLength), extensions: { EXT_meshopt_compression: { fallback: true } } }];
  addExtension(json, "EXT_meshopt_compression", true);
  json.asset = { ...json.asset, generator: `${json.asset?.generator ?? "unknown"}; scripts/pack-models.mjs` };
  const after = writeGlb(file, json, binOut);
  console.log(
    `${path.relative(MODELS, file)}: ${(size / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB` +
      ` (${reordered} primitives reordered, ${tangentsDropped} unused tangent sets, keyframes ${keyframes.before} → ${keyframes.after})`,
  );
}

function allModels(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return allModels(full);
    return entry.name.endsWith(".glb") ? [full] : [];
  });
}

await MeshoptEncoder.ready;
const files = process.argv.length > 2 ? process.argv.slice(2).map((file) => path.resolve(file)) : allModels(MODELS);
for (const file of files) await pack(file);
