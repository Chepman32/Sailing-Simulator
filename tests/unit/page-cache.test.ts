import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

/** Exercise the shipped worker with an in-memory CacheStorage and network. */
function pageCache() {
  const pages = new Map<string, Response>();
  let online = true;
  let status = 200;
  const context = {
    URL,
    self: { addEventListener() {} },
    caches: {
      open: async () => ({
        put: async (path: string, response: Response) => { pages.set(path, response); },
        match: async (path: string) => pages.get(path)?.clone(),
      }),
    },
    fetch: async (request: Request) => {
      if (!online) throw new Error("offline");
      return new Response(new URL(request.url).pathname, { status });
    },
  };
  const navigate = runInNewContext(
    `${readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8")}\nnetworkFirstPage;`,
    context,
  ) as (event: { request: Request; waitUntil(promise: Promise<unknown>): void }) => Promise<Response>;
  return {
    pages,
    offline: () => { online = false; },
    fail: () => { status = 500; },
    async visit(path: string) {
      const pending: Promise<unknown>[] = [];
      const response = await navigate({
        request: new Request(`https://sailing.example${path}`),
        waitUntil: (promise) => { pending.push(promise); },
      });
      await Promise.all(pending);
      return response.text();
    },
  };
}

test("story navigation cannot replace the offline free-sailing homepage", async () => {
  const cache = pageCache();
  assert.equal(await cache.visit("/"), "/");
  assert.equal(await cache.visit("/story"), "/story");
  cache.offline();
  assert.equal(await cache.visit("/?debug"), "/");
  assert.equal(await cache.visit("/story/?debug"), "/story");
  assert.equal(cache.pages.size, 2);
});

test("free-sailing navigation cannot replace the offline story page", async () => {
  const cache = pageCache();
  await cache.visit("/story");
  await cache.visit("/");
  cache.offline();
  assert.equal(await cache.visit("/story"), "/story");
  await assert.rejects(cache.visit("/missing"), /offline/);
});

test("failed responses do not replace a working cached route", async () => {
  const cache = pageCache();
  await cache.visit("/story");
  cache.fail();
  await cache.visit("/story/");
  cache.offline();
  assert.equal(await cache.visit("/story"), "/story");
});
