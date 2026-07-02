// Cashu mint daemon — wraps `cdk-mintd` as a managed subprocess.
// This lets the agent start/stop a local mint (useful for regtest/dev).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINTD_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "deps", "cdk", "bin", "cdk-mintd");

function mintdBinPath() {
  if (existsSync(MINTD_SRC)) return MINTD_SRC;
  return "cdk-mintd";
}

export function cashuMint(ctx) {
  let proc = null;

  return {
    start({ config, seedFile } = {}) {
      if (proc) return { status: "already running", pid: proc.pid };

      const args = ["--work-dir", ctx.workDir];
      if (config) args.push("--config", config);
      if (seedFile) args.push("--seed-file", seedFile);

      proc = spawn(mintdBinPath(), args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      proc.on("exit", (code) => {
        proc = null;
      });

      return { status: "started", pid: proc.pid, workDir: ctx.workDir };
    },

    stop() {
      if (!proc) return { status: "not running" };
      proc.kill("SIGTERM");
      proc = null;
      return { status: "stopped" };
    },

    status() {
      if (!proc) return { status: "stopped" };
      return { status: "running", pid: proc.pid, workDir: ctx.workDir };
    },
  };
}
