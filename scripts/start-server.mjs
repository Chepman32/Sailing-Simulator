import { spawn } from "node:child_process";
import { constants } from "node:os";

function openBrowser(host, port) {
  const hostname = host.replace(/^\[|\]$/g, "");
  const localHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  const url = `http://${localHost.includes(":") ? `[${localHost}]` : localHost}:${port}/`;
  const command = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "rundll32" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(command, args, { stdio: "ignore", detached: true });
  browser.once("error", () => console.warn(`Could not open the browser. Open ${url} manually.`));
  browser.once("exit", (code) => {
    if (code) console.warn(`Could not open the browser. Open ${url} manually.`);
  });
  browser.unref();
}

const server = spawn("vinext", ["start", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "inherit"],
});
server.stdout.pipe(process.stdout);

// Use Vinext's listening confirmation, including its resolved host and port.
// Complete lines avoid opening a truncated URL when stdout arrives in chunks.
if (process.env.BROWSER !== "none" && !process.env.CI) {
  let pending = "";
  const onOutput = (chunk) => {
    const lines = (pending + chunk.toString()).split("\n");
    pending = lines.pop().slice(-4096);
    for (const line of lines) {
      const ready = /Production server running at http:\/\/([^\s]+):(\d+)\s*$/.exec(line);
      if (!ready) continue;
      server.stdout.off("data", onOutput);
      openBrowser(ready[1], ready[2]);
      break;
    }
  };
  server.stdout.on("data", onOutput);
}

const onInterrupt = () => server.kill("SIGINT");
const onTerminate = () => server.kill("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
server.once("error", (error) => console.error(`Could not start Vinext: ${error.message}`));

try {
  process.exitCode = await new Promise((resolve) => {
    server.once("close", (code, signal) => {
      resolve(signal ? 128 + constants.signals[signal] : code ?? 1);
    });
  });
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}
