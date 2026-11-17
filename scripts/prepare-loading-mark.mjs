import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// Keep the supplied artwork byte-for-byte. Its first GIF frame is static;
// the browser rotates the centered SVG continuously instead of replaying
// the source GIF's drifting frames and discontinuous last-to-first jump.
const source = readFileSync(new URL("../public/assets/loading-spinner-a90f09314dcb.gif", import.meta.url));
if (!/^GIF8[79]a$/.test(source.toString("ascii", 0, 6))) throw new Error("Expected GIF source");
const globalTableBytes = source[10] & 0x80 ? 3 * (1 << ((source[10] & 7) + 1)) : 0;
let offset = 13 + globalTableBytes;
const chunks = [source.subarray(0, offset)];

function skipBlocks(start) {
  let cursor = start;
  while (cursor < source.length) {
    const size = source[cursor++];
    if (!size) return cursor;
    cursor += size;
  }
  throw new Error("Truncated GIF data");
}

while (offset < source.length) {
  const start = offset;
  const marker = source[offset++];
  if (marker === 0x21) {
    const label = source[offset++];
    offset = skipBlocks(offset);
    // Preserve the transparency control, but omit looping/application blocks.
    if (label === 0xf9) chunks.push(source.subarray(start, offset));
  } else if (marker === 0x2c) {
    const packed = source[offset + 8];
    offset += 9;
    if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
    offset = skipBlocks(offset + 1); // LZW minimum code size, then image data.
    chunks.push(source.subarray(start, offset), Buffer.from([0x3b]));
    break;
  } else {
    throw new Error("No first image frame found");
  }
}
if (chunks.at(-1)?.[0] !== 0x3b) throw new Error("Missing GIF frame");

// The opaque artwork spans x=37..198, y=16..194: center (117.5, 105).
// A square viewport around that center leaves room on all sides while turning.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="190" viewBox="22.5 10 190 190"><image width="214" height="248" href="data:image/gif;base64,${Buffer.concat(chunks).toString("base64")}"/></svg>\n`;
const hash = createHash("sha256").update(svg).digest("hex").slice(0, 12);
const name = `loading-mark-${hash}.svg`;
writeFileSync(new URL(`../public/assets/${name}`, import.meta.url), svg);
console.log(`/assets/${name}`);
