import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const scripts = resolve("scripts");

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sailing startup "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "scripts"));
  for (const name of ["start.sh", "start-server.mjs", "build-verified.sh", "sites-env.sh", "run-bounded.mjs"]) {
    await cp(join(scripts, name), join(root, "scripts", name));
  }
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: { "test:rendered": "node verify.cjs" },
  }));
  await writeFile(join(root, "verify.cjs"), `
    const fs = require('node:fs');
    fs.accessSync('dist/server/index.js');
    fs.appendFileSync('calls.jsonl', JSON.stringify(['verify']) + '\\n');
    process.exit(Number(process.env.VERIFY_EXIT ?? 0));
  `);
  await writeFile(join(root, "bin", "vinext"), `#!/usr/bin/env node
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
    if (args[0] === 'build') {
      if (process.env.BUILD_EXIT) process.exit(Number(process.env.BUILD_EXIT));
      fs.mkdirSync('dist/server', { recursive: true });
      fs.mkdirSync('dist/client', { recursive: true });
      fs.writeFileSync('dist/server/index.js', 'export default {}');
    } else if (args[0] === 'start') {
      if (process.env.START_EXIT) process.exit(Number(process.env.START_EXIT));
      if (process.env.READY_URL) {
        fs.writeFileSync('server-ready', '');
        const line = '[vinext] Production server running at ' + process.env.READY_URL + '\\n';
        process.stdout.write(line.slice(0, -4));
        setTimeout(() => process.stdout.write(line.slice(-4) + line), 20);
        if (process.env.EXPECT_OPEN) {
          const deadline = setTimeout(() => process.exit(99), 5000);
          const poll = setInterval(() => {
            if (!fs.existsSync('browser-opened')) return;
            clearInterval(poll);
            clearTimeout(deadline);
          }, 10);
        }
      }
    }
  `, { mode: 0o755 });
  for (const opener of ["open", "xdg-open"]) {
    await writeFile(join(root, "bin", opener), `#!/usr/bin/env node
      const fs = require('node:fs');
      fs.accessSync('server-ready');
      fs.appendFileSync('calls.jsonl', JSON.stringify(['open', ...process.argv.slice(2)]) + '\\n');
      fs.writeFileSync('browser-opened', '');
    `, { mode: 0o755 });
  }
  const env = { ...process.env, CI: "", BROWSER: "", PATH: `${join(root, "bin")}${delimiter}${process.env.PATH}` };
  return {
    root,
    start: (args: string[] = [], overrides: Partial<NodeJS.ProcessEnv> = {}) => execute(
      "bash", [join(root, "scripts/start.sh"), ...args],
      { cwd: tmpdir(), env: { ...env, ...overrides }, timeout: 15_000 },
    ),
    calls: async () => (await readFile(join(root, "calls.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line)),
  };
}

test("start builds and verifies a clean checkout, then reuses it and forwards server options", async (t) => {
  const app = await fixture(t);
  const first = await app.start(["--port", "3100"]);
  assert.match(first.stdout, /Building the app before starting/);
  assert.deepEqual(await app.calls(), [["build"], ["verify"], ["start", "--port", "3100"]]);
  await app.start(["--hostname", "127.0.0.1"]);
  assert.deepEqual((await app.calls()).slice(3), [["start", "--hostname", "127.0.0.1"]]);
  await rm(join(app.root, "dist/client"), { recursive: true });
  await app.start();
  assert.deepEqual((await app.calls()).slice(4), [["build"], ["verify"], ["start"]]);
});

test("start never launches the server after a failed build or rendered verification", async (t) => {
  const app = await fixture(t);
  await assert.rejects(app.start([], { BUILD_EXIT: "17" }), { code: 17 });
  assert.deepEqual(await app.calls(), [["build"]]);
  await assert.rejects(app.start([], { VERIFY_EXIT: "19" }), { code: 19 });
  assert.deepEqual(await app.calls(), [["build"], ["build"], ["verify"]]);
  await app.start();
  assert.deepEqual((await app.calls()).slice(3), [["build"], ["verify"], ["start"]]);
});

test("start help works before the first build", async (t) => {
  const app = await fixture(t);
  await app.start(["--help"]);
  assert.deepEqual(await app.calls(), [["start", "--help"]]);
});

test("start opens the browser once after readiness, with the resolved port and a usable local URL", async (t) => {
  const app = await fixture(t);
  await app.start(["--port", "3456"], { READY_URL: "http://0.0.0.0:3456", EXPECT_OPEN: "1" });
  assert.deepEqual(await app.calls(), [
    ["build"], ["verify"], ["start", "--port", "3456"], ["open", "http://localhost:3456/"],
  ]);
});

test("start keeps an explicit hostname when opening the browser", async (t) => {
  const app = await fixture(t);
  await app.start(["--hostname", "127.0.0.1"], { READY_URL: "http://127.0.0.1:3000", EXPECT_OPEN: "1" });
  assert.deepEqual((await app.calls()).at(-1), ["open", "http://127.0.0.1:3000/"]);
});

test("headless starts and failed server starts do not open the browser", async (t) => {
  const app = await fixture(t);
  await app.start([], { READY_URL: "http://0.0.0.0:3000", BROWSER: "none" });
  await app.start([], { READY_URL: "http://0.0.0.0:3000", CI: "true" });
  await assert.rejects(app.start([], { START_EXIT: "18" }), { code: 18 });
  assert.ok((await app.calls()).every((args) => args[0] !== "open"));
});

test("the portable deadline preserves failures and kills a command that ignores termination", async () => {
  const runner = join(scripts, "run-bounded.mjs");
  await assert.rejects(execute(process.execPath, [
    runner, "5s", "1s", process.execPath, "-e", "process.exit(23)",
  ]), { code: 23 });
  await assert.rejects(execute(process.execPath, [
    runner, "0.5s", "0.1s", process.execPath, "-e",
    "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
  ], { timeout: 10_000 }), (error: unknown) => {
    const failure = error as { code: number; stdout: string; stderr: string };
    assert.equal(failure.code, 124);
    assert.match(failure.stdout, /ready/);
    assert.match(failure.stderr, /exceeded 0.5s/);
    return true;
  });
});

test("the deadline also stops a surviving worker when its parent exits on termination", async () => {
  await assert.rejects(execute(process.execPath, [
    join(scripts, "run-bounded.mjs"), "0.5s", "0.1s", process.execPath, "-e", `
      require('node:child_process').spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => {});
        console.log('worker ready');
        setTimeout(() => console.log('worker escaped'), 2000);
      \`], { stdio: 'inherit' });
    `,
  ], { timeout: 10_000 }), (error: unknown) => {
    const failure = error as { code: number; stdout: string };
    assert.equal(failure.code, 124);
    assert.match(failure.stdout, /worker ready/);
    assert.doesNotMatch(failure.stdout, /worker escaped/);
    return true;
  });
});
