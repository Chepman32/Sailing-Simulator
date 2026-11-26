import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mac = fileURLToPath(new URL('./macos.sh', import.meta.url));
const args = process.argv.slice(2);

function run(script, argv) {
  const child = spawn('bash', [script, ...argv], { cwd: root, stdio: 'inherit' });
  const done = new Promise((resolve) => {
    child.once('error', (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)));
  });
  return { child, done };
}

async function stop(job) {
  const pid = job?.child.pid;
  if (!pid || job.child.exitCode !== null || job.child.signalCode !== null) return;

  job.child.kill('SIGTERM');
  const timeout = setTimeout(() => job.child.kill('SIGKILL'), 6000);
  try {
    await job.done;
  } finally {
    clearTimeout(timeout);
  }
}

async function watchDesktop() {
  const reloadAssets = 1;
  const rebuildCode = 2;
  const sourceExtensions = new Set(['.c', '.cpp', '.h', '.hpp', '.inl', '.mm', '.cs']);
  const assetExtensions = new Set(['.uasset', '.umap']);
  const watchers = [];
  let preview;
  let compiler;
  let pending = 0;
  let timer;
  let busy = false;
  let closing = false;

  async function finish(code) {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    await Promise.all([stop(preview), stop(compiler)]);
    process.exitCode = code;
  }

  function enqueue(change) {
    if (closing) return;
    pending = Math.max(pending, change);
    clearTimeout(timer);
    timer = setTimeout(reload, 450);
  }

  async function reload() {
    if (closing || busy || !pending) return;
    const needsCompile = pending === rebuildCode || !preview;
    pending = 0;
    busy = true;
    try {
      if (needsCompile) {
        console.log('Compiling the Unreal editor target…');
        compiler = run(mac, ['compile']);
        const code = await compiler.done;
        compiler = undefined;
        if (closing) return;
        if (code !== 0) {
          console.error('Build failed. The watcher will retry after the next file change.');
          return;
        }
      }

      const previous = preview;
      preview = undefined;
      await stop(previous);
      if (closing) return;
      console.log(previous ? 'Reloading the sailing preview…' : 'Opening the sailing preview…');
      const game = run(mac, ['preview', '-SailingInteractivePreview', ...args]);
      preview = game;
      void game.done.then((code) => {
        if (preview === game) void finish(code);
      });
    } finally {
      busy = false;
      if (pending) enqueue(pending);
    }
  }

  function addWatcher(directory, recursive, change, matches) {
    const watcher = watch(root + directory, { recursive }, (_event, file) => {
      if (!file || matches(file)) enqueue(change);
    });
    watcher.on('error', (error) => {
      console.error(error.message);
      void finish(1);
    });
    watchers.push(watcher);
  }

  process.once('SIGINT', () => void finish(130));
  process.once('SIGTERM', () => void finish(143));
  try {
    addWatcher('desktop/Source', true, rebuildCode, (file) => sourceExtensions.has(extname(file)));
    addWatcher('desktop/Config', true, reloadAssets, (file) => extname(file) === '.ini');
    addWatcher('desktop/Content', true, reloadAssets, (file) => assetExtensions.has(extname(file)));
    addWatcher('desktop', false, rebuildCode, (file) => file === 'SailingSimulatorDesktop.uproject');
  } catch (error) {
    console.error(error.message);
    await finish(1);
    return;
  }

  pending = rebuildCode;
  await reload();
}

if (process.platform !== 'darwin') {
  process.exitCode = await run(`${root}scripts/start.sh`, args).done;
} else if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
  console.log('npm start [-- <Unreal options>] opens a preview and watches Source, Config, and Content.');
} else {
  await watchDesktop();
}
