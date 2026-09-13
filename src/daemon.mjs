import { spawn } from "node:child_process";

// Bounded logs and deterministic teardown for optional wallet daemons.
export function managedDaemon({ command, args, info = {}, prepare = () => {} }) {
  let child, stopped, tail = [], lastError;
  return {
    async start() {
      if (child) return { status: "already running", pid: child.pid, ...info };
      prepare(); tail = []; lastError = null;
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      child = proc;
      const drain = chunk => { tail.push(...chunk.toString("utf8").split("\n").filter(Boolean).map(x => x.slice(-2000))); tail = tail.slice(-40); };
      proc.stdout.on("data", drain); proc.stderr.on("data", drain);
      stopped = new Promise(resolve => {
        proc.once("close", () => { if (child === proc) child = null; resolve(); });
        proc.on("error", err => { lastError = err.message; if (child === proc) child = null; });
      });
      await new Promise((resolve, reject) => { proc.once("spawn", resolve); proc.once("error", reject); });
      return { status: "started", pid: proc.pid, ...info };
    },
    async stop() {
      if (!child) return { status: "not running" };
      const proc = child;
      proc.kill("SIGTERM");
      const timer = setTimeout(() => proc.kill("SIGKILL"), 1000); timer.unref();
      await stopped; clearTimeout(timer);
      return { status: "stopped" };
    },
    status() { return { status: child ? "running" : "stopped", ...(child ? { pid: child.pid } : {}), ...info, ...(lastError ? { error: lastError } : {}) }; },
    logTail() { return tail.join("\n"); },
  };
}
