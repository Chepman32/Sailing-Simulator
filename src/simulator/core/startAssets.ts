import { assetBytes, assetUrl } from "./assetManifest";

/**
 * The models the first frame waits for (`AssetManager`, `stage: "start"`),
 * fetched from the moment the page's script runs: in parallel with the
 * simulator's own code instead of after it has arrived, parsed and built
 * the scene. On a slow line that overlap is several seconds.
 *
 * Kept free of three.js so the page's first script stays small.
 */
export const START_MODEL_URLS = [
  "/models/yacht-sailboat-pbr.glb",
  "/models/dolphin-animated.glb",
  "/models/seagull-animated.glb",
  "/models/trader-man.glb",
] as const;

export type PrefetchedModel = {
  /** Bytes arrived so far (for the loading bar). */
  received: number;
  data: Promise<ArrayBuffer>;
};

const prefetched = new Map<string, PrefetchedModel>();

function start(url: string): PrefetchedModel {
  const entry: PrefetchedModel = { received: 0, data: Promise.resolve(new ArrayBuffer(0)) };
  entry.data = (async () => {
    const response = await fetch(assetUrl(url));
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      entry.received = buffer.byteLength;
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      entry.received += value.byteLength;
    }
    const out = new Uint8Array(entry.received);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  })();
  // A failure is handled by whoever takes it (it loads the model itself).
  entry.data.catch(() => undefined);
  return entry;
}

/** Starts fetching the start's models (once; in the browser only). */
export function prefetchStartModels(): void {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  for (const url of START_MODEL_URLS) if (!prefetched.has(url)) prefetched.set(url, start(url));
}

/** The prefetch of `url`, handed over once (undefined if it was never started). */
export function takePrefetchedModel(url: string): PrefetchedModel | undefined {
  const entry = prefetched.get(url);
  prefetched.delete(url);
  return entry;
}

/** Expected size of `url`, for progress before its own headers arrive. */
export const startModelBytes = (url: string): number => assetBytes(url);
