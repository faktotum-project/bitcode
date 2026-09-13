// Cashu mint daemon — wraps `cdk-mintd` as a managed subprocess.
// This lets the agent start/stop a local mint (useful for regtest/dev).
import { managedDaemon } from "../daemon.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINTD_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "deps", "cdk", "bin", "cdk-mintd");

function mintdBinPath() {
  if (existsSync(MINTD_SRC)) return MINTD_SRC;
  return "cdk-mintd";
}

const daemons = new Set();
export async function closeCashuDaemons() { await Promise.allSettled([...daemons].map(d => d.stop())); daemons.clear(); }
export function cashuMint(ctx) {
  let daemon;
  return {
    async start({ config, seedFile } = {}) {
      if (daemon?.status().status === "running") return { ...daemon.status(), status: "already running" };
      const args = ["--work-dir", ctx.workDir];
      if (config) args.push("--config", config);
      if (seedFile) args.push("--seed-file", seedFile);
      daemon = managedDaemon({ command: mintdBinPath(), args, info: { workDir: ctx.workDir } });
      daemons.add(daemon);
      return daemon.start();
    },
    stop: () => daemon ? daemon.stop() : { status: "not running" },
    status: () => daemon?.status() || { status: "stopped", workDir: ctx.workDir },
  };
}
