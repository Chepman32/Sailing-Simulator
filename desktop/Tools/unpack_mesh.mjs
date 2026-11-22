import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';

const [, , input, output] = process.argv;
if (!input || !output) throw new Error('Usage: unpack_mesh.mjs input.glb output.glb');

const source = readFileSync(input);
if (source.toString('ascii', 0, 4) !== 'glTF' || source.readUInt32LE(4) !== 2) {
    throw new Error('Expected a glTF 2 GLB');
}
const jsonLength = source.readUInt32LE(12);
const scene = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
const data = source.subarray(28 + jsonLength);
const alignment = (size) => (4 - size % 4) % 4;
const chunks = [];
let offset = 0;

// FBX authoring in Blender needs ordinary images. Preserve the author's sRGB
// or linear bytes here. Unreal assigns the colour space according to map usage.
const basisImages = new Map((scene.images || []).filter(i => i.mimeType === 'image/ktx2')
    .map(image => [scene.bufferViews[image.bufferView], image]));
let basis;
if (basisImages.size) {
    const require = createRequire(import.meta.url);
    const runtime = require('three/examples/jsm/libs/basis/basis_transcoder.js');
    const wasmBinary = readFileSync(require.resolve('three/examples/jsm/libs/basis/basis_transcoder.wasm'));
    basis = await runtime({ wasmBinary });
    basis.initializeBasis();
    for (const texture of scene.textures) {
        if (!texture.extensions?.KHR_texture_basisu) continue;
        texture.source = texture.extensions.KHR_texture_basisu.source;
        delete texture.extensions.KHR_texture_basisu;
        if (!Object.keys(texture.extensions).length) delete texture.extensions;
    }
}

function pngChunk(type, bytes) {
    const chunk = Buffer.alloc(12 + bytes.length);
    chunk.writeUInt32BE(bytes.length);
    chunk.write(type, 4);
    bytes.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
}

function unpackImage(bytes) {
    const texture = new basis.KTX2File(bytes);
    try {
        if (!texture.isValid() || !texture.startTranscoding()) throw new Error('Invalid Basis texture');
        const width = texture.getWidth(), height = texture.getHeight(), stride = width * 4;
        const pixels = Buffer.alloc(stride * height);
        if (!texture.transcodeImage(pixels, 0, 0, 0, 13, 0, -1, -1)) throw new Error('RGBA32 transcode failed');
        const lines = Buffer.alloc((stride + 1) * height);
        for (let y = 0; y < height; y++) pixels.copy(lines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
        const header = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0]);
        header.writeUInt32BE(width);
        header.writeUInt32BE(height, 4);
        return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header),
            pngChunk('IDAT', deflateSync(lines)), pngChunk('IEND', Buffer.alloc(0))]);
    } finally {
        texture.close();
        texture.delete();
    }
}

await MeshoptDecoder.ready;
for (const view of scene.bufferViews) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    let chunk = data.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    if (compressed) {
        if (compressed.buffer !== 0) throw new Error('Expected one compressed source buffer');
        chunk = Buffer.alloc(compressed.count * compressed.byteStride);
        MeshoptDecoder.decodeGltfBuffer(chunk, compressed.count, compressed.byteStride,
            data.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
            compressed.mode, compressed.filter);
        delete view.extensions.EXT_meshopt_compression;
        if (!Object.keys(view.extensions).length) delete view.extensions;
    } else if (view.buffer !== 0) {
        throw new Error('Expected one uncompressed source buffer');
    }
    if (basisImages.has(view)) {
        chunk = unpackImage(chunk);
        basisImages.get(view).mimeType = 'image/png';
    }
    view.buffer = 0;
    view.byteOffset = offset;
    view.byteLength = chunk.length;
    const pad = Buffer.alloc(alignment(chunk.length));
    chunks.push(chunk, pad);
    offset += chunk.length + pad.length;
}

scene.buffers = [{ byteLength: offset }];
for (const field of ['extensionsUsed', 'extensionsRequired']) {
    if (scene[field]) scene[field] = scene[field].filter((name) => !['EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name));
}
const json = Buffer.from(JSON.stringify(scene));
const padding = Buffer.alloc(alignment(json.length), 0x20);
const header = Buffer.alloc(20);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + padding.length + offset, 8);
header.writeUInt32LE(json.length + padding.length, 12);
header.write('JSON', 16);
const bin = Buffer.alloc(8);
bin.writeUInt32LE(offset, 0);
bin.write('BIN\0', 4);
writeFileSync(output, Buffer.concat([header, json, padding, bin, ...chunks]));
