import { spawn } from "node:child_process";
import { constants } from "node:os";

function durationMilliseconds(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value ?? "");
  if (!match) throw new Error(`Invalid timeout duration: ${value}`);
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  const milliseconds = Number(match[1]) * units[match[2] ?? "s"];
  if (milliseconds <= 0 || milliseconds > 2_147_483_647) {
    throw new Error(`Timeout duration is out of range: ${value}`);
  }
  return milliseconds;
}

async function main() {
  const [timeout, grace, command, ...args] = process.argv.slice(2);
  const timeoutMs = durationMilliseconds(timeout);
  const graceMs = durationMilliseconds(grace);
  if (!command) throw new Error("usage: run-bounded.mjs timeout grace command [args...]");

  // A process group lets the deadline stop Vite's subprocesses as well as its CLI.
  const grouped = process.platform !== "win32";
  const child = spawn(command, args, { stdio: "inherit", detached: grouped });
  let timedOut = false;
  let interrupted;
  let killTimer;
  const sendSignal = (signal) => {
    if (!child.pid) return;
    try {
      if (grouped) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const stop = (signal) => {
    sendSignal(signal);
    killTimer ??= setTimeout(() => sendSignal("SIGKILL"), graceMs);
  };
  const onInterrupt = () => {
    interrupted = "SIGINT";
    stop("SIGINT");
  };
  const onTerminate = () => {
    interrupted = "SIGTERM";
    stop("SIGTERM");
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  const deadline = setTimeout(() => {
    timedOut = true;
    console.error(`Build command exceeded ${timeout}; stopping ${command}.`);
    stop("SIGTERM");
  }, timeoutMs);

  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        // The CLI can exit on TERM while a worker ignores it. Reap that group too.
        if (timedOut || interrupted) sendSignal("SIGKILL");
        const termination = interrupted ?? signal;
        resolve(timedOut ? 124 : termination ? 128 + constants.signals[termination] : code ?? 1);
      });
    });
  } finally {
    clearTimeout(deadline);
    clearTimeout(killTimer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
