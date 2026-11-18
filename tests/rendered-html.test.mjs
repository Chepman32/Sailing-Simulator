import assert from "node:assert/strict";
import test from "node:test";

test("renders free sailing at / and the story experience only at /story", async () => {
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

  for (const [path, experience] of [["/", "free"], ["/story", "story"], ["/story/", "story"]]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
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

    if (path === "/story/") {
      assert.equal(response.status, 308);
      assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/story");
      continue;
    }
    assert.equal(response.status, 200, path);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
    );
    const html = await response.text();
    assert.match(html, new RegExp(`data-experience="${experience}"`), path);
    assert.match(html, /<title>Enhanced Sailing Simulator Pro<\/title>/i);
    assert.match(html, /<canvas[^>]+class="simulator-canvas"[^>]+aria-label=/i);
    assert.match(html, /<section[^>]+class="control-panel is-minimized"[^>]+aria-label=/i);
    assert.match(html, /<span class="scene-action-label">Cinematic mode<\/span>/);
    assert.match(html, /<span class="scene-action-label">Map<\/span>/);
    assert.match(html, /id="photo-mode-hint"/);
    assert.doesNotMatch(html, /Sailing_Simulator_Pro_-_Ultimate\.html/);
    assert.doesNotMatch(html, /<iframe\b/i);
  }
});
