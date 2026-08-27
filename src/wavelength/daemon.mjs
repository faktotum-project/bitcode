// Wavelength daemon — wraps `waved` as a managed subprocess, the same
// pattern as src/cashu/mint.mjs for cdk-mintd. bitcode owns the daemon's
// full lifecycle (start/stop/status) because Wavelength's whole point is "no
// node management for the user" — someone still has to run the engine, and
// here that's bitcode, not the person using it.
//
// TLS and macaroon auth are always on (guardrails G6/G8, update_wavelength.md
// §5): no --rpc.notls/--rpc.no-macaroons, those are waved's own dev-only
// bypass flags. The HTTP/JSON gateway is disabled — bitcode's transport goes
// through wavecli (gRPC) exclusively, so the gateway is just an unused open
// listener otherwise.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPS_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "deps", "wavelength", "bin");

export function wavedBinPath() {
  const p = path.join(DEPS_BIN, "waved");
  return existsSync(p) ? p : "waved";
}

export function wavecliBinPath() {
  const p = path.join(DEPS_BIN, "wavecli");
  return existsSync(p) ? p : "wavecli";
}

export function wavedArgs(ctx) {
  const args = [
    "--network",
    ctx.network,
    "--datadir",
    ctx.dataDir,
    "--wallet.type",
    "lwwallet",
    "--wallet.esploraurl",
    ctx.walletEsploraUrl,
    "--server.host",
    ctx.arkServerAddress,
    "--swap.serveraddress",
    ctx.swapServerAddress,
    "--maxoperatorfeesat",
    String(ctx.maxOperatorFeeSat),
    "--rpc.listenaddr",
    ctx.rpcListenAddr,
    "--rpc.macaroonpath",
    ctx.rpcMacaroonPath,
    "--rpc.tlscertpath",
    ctx.rpcTlsCertPath,
    "--rpc.tlskeypath",
    ctx.rpcTlsKeyPath,
    "--rpc.gateway.enabled=false",
  ];
  if (ctx.arkServerTransport) args.push("--server.transport", ctx.arkServerTransport);
  if (ctx.swapServerTransport) args.push("--swap.servertransport", ctx.swapServerTransport);
  if (ctx.network === "mainnet") args.push("--allow-mainnet");
  return args;
}

const LOG_TAIL_LINES = 40;

export function wavelengthDaemon(ctx) {
  let proc = null;
  let tail = [];

  return {
    start() {
      if (proc) return { status: "already running", pid: proc.pid };

      mkdirSync(ctx.dataDir, { recursive: true });
      tail = [];
      proc = spawn(wavedBinPath(), wavedArgs(ctx), {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
      // waved logs enough at startup (info level, dialing the operator over
      // the network) to fill the default 64KB pipe buffer; an unconsumed
      // stdout/stderr would then make the daemon block on its own log
      // writes and hang forever. Draining into a bounded tail avoids that
      // deadlock and doubles as a diagnostic when startup fails.
      const drain = (chunk) => {
        tail.push(...chunk.toString("utf8").split("\n").filter(Boolean));
        if (tail.length > LOG_TAIL_LINES) tail = tail.slice(-LOG_TAIL_LINES);
      };
      proc.stdout.on("data", drain);
      proc.stderr.on("data", drain);
      proc.on("exit", () => {
        proc = null;
      });

      return { status: "started", pid: proc.pid, dataDir: ctx.dataDir, rpcListenAddr: ctx.rpcListenAddr };
    },

    stop() {
      if (!proc) return { status: "not running" };
      proc.kill("SIGTERM");
      proc = null;
      return { status: "stopped" };
    },

    status() {
      if (!proc) return { status: "stopped" };
      return { status: "running", pid: proc.pid, dataDir: ctx.dataDir, rpcListenAddr: ctx.rpcListenAddr };
    },

    // Last LOG_TAIL_LINES lines of combined stdout/stderr, for surfacing why
    // startup failed (e.g. in wavelengthTools()'s best-effort catch path).
    logTail() {
      return tail.join("\n");
    },
  };
}
