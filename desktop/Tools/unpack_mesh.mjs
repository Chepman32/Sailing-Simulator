import { readFileSync, writeFileSync } from 'node:fs';
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
    view.buffer = 0;
    view.byteOffset = offset;
    view.byteLength = chunk.length;
    const pad = Buffer.alloc(alignment(chunk.length));
    chunks.push(chunk, pad);
    offset += chunk.length + pad.length;
}

scene.buffers = [{ byteLength: offset }];
for (const field of ['extensionsUsed', 'extensionsRequired']) {
    if (scene[field]) scene[field] = scene[field].filter((name) => name !== 'EXT_meshopt_compression');
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
