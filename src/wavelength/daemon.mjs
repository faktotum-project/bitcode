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
import { managedDaemon } from "../daemon.mjs";
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

export function wavelengthDaemon(ctx) {
  return managedDaemon({ command: wavedBinPath(), args: wavedArgs(ctx),
    info: { dataDir: ctx.dataDir, rpcListenAddr: ctx.rpcListenAddr },
    prepare: () => mkdirSync(ctx.dataDir, { recursive: true }),
  });
}
