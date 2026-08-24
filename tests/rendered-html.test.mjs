import assert from "node:assert/strict";
import test from "node:test";

test("renders the modular simulator shell without the legacy iframe", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const NativeAbortController = globalThis.AbortController;
  globalThis.AbortController = class ForbiddenGlobalAbortController {
    constructor() {
      throw new Error("AbortController was constructed while importing the Worker bundle");
    }
  };

  let worker;
  try {
    ({ default: worker } = await import(workerUrl.href));
  } finally {
    globalThis.AbortController = NativeAbortController;
  }

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>Enhanced Sailing Simulator Pro<\/title>/i);
  assert.match(html, /<canvas[^>]+aria-label="Interactive tropical sailing scene"/i);
  assert.doesNotMatch(html, /Sailing_Simulator_Pro_-_Ultimate\.html/);
  assert.doesNotMatch(html, /<iframe\b/i);
});
