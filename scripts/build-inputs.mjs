import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const inputs = [
  ".openai",
  "app",
  "build",
  "db",
  "drizzle",
  "public",
  "src",
  "worker",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "postcss.config.mjs",
  "tsconfig.json",
  "vite.config.ts",
  "yarn.lock",
];
const hash = createHash("sha256");

function addInput(path) {
  const info = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!info) return;
  if (info.isDirectory()) {
    for (const child of readdirSync(path).sort()) addInput(join(path, child));
    return;
  }
  // Track paths and edits without reading every model and audio asset on startup.
  hash.update(`${path}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\0`);
}

for (const path of inputs) addInput(path);
console.log(hash.digest("hex"));
