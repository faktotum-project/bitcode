// Wavelength agent tools — self-custodial Bitcoin/Lightning/Ark wallet via
// Lightning Labs' `waved` daemon. Registered only when config.wavelength is
// set (same opt-in contract as the LND tools), but unlike LND this needs no
// node of your own: the engine holds its own keys locally and talks to
// Lightning Labs' public signet/testnet operators.
//
// Transport: bitcode vendors and runs `waved` itself (./daemon.mjs), then
// talks to it through Lightning Labs' own `wavecli mcp serve` — a native MCP
// server built into the CLI (confirmed against a live v0.1.1 binary: `wavecli
// schema --all --json` runs fully offline and tags each method
// mcp_tool/side_effect) — reusing bitcode's existing MCP client (../mcp.mjs)
// instead of hand-rolling a gRPC/REST client and a bespoke tool surface.
//
// Phase 1 of update_wavelength.md: read-only only. `wavecli schema` classifies
// each MCP-exposed method as side_effect true/false; only false ones are
// registered here. Mutating ones (send, recv, exit, vtxo management) arrive
// in a later phase behind bitcode's own guardrails (G3 per-payment sats cap,
// G4 seed disclosure) — those aren't Lightning Labs' to enforce, so passing
// their tools through unguarded here would skip them.
import { execFileSync } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveWavelength } from "./network.mjs";
import { wavelengthDaemon, wavecliBinPath } from "./daemon.mjs";
import { mcpConnect, mcpResult } from "../mcp.mjs";

// The TLS cert file appears slightly before the gRPC listener actually
// accepts connections (confirmed against a live daemon: a file-existence
// check alone still raced wavecli into "connection refused"), so this polls
// the real thing wavecli is about to dial instead of a proxy signal.
function canConnect(addr) {
  return new Promise((resolve) => {
    const [host, port] = addr.split(":");
    const socket = net.connect({ host, port: Number(port), timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForRpcReady(ctx, { timeoutMs = 10_000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!(await canConnect(ctx.rpcListenAddr))) {
    if (Date.now() > deadline) throw new Error(`waved did not become ready within ${timeoutMs}ms`);
    await sleep(intervalMs);
  }
}

// Pure filter over a `wavecli schema --all --json` dump: only methods that
// are both MCP-exposed and read-only are safe to register before phase 2/3
// guardrails exist.
export function filterReadOnlyMcpMethods(schema) {
  return new Set(schema.filter((m) => m.mcp_tool && !m.side_effect).map((m) => m.method));
}

// Runs `wavecli schema --all --json` — no daemon connection needed, it's a
// static dump of the compiled-in command tree.
export function readOnlyMcpMethods(wavecliPath = wavecliBinPath()) {
  const raw = execFileSync(wavecliPath, ["schema", "--all", "--json"], { encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  return filterReadOnlyMcpMethods(JSON.parse(raw));
}

export function mcpServeArgs(ctx) {
  return [
    "mcp",
    "serve",
    "--network",
    ctx.network,
    "--rpcserver",
    ctx.rpcListenAddr,
    "--macaroonpath",
    ctx.rpcMacaroonPath,
    "--tlscertpath",
    ctx.rpcTlsCertPath,
  ];
}

const activeDaemons = new Set();
export async function closeWavelength() { await Promise.allSettled([...activeDaemons].map(daemon => daemon.stop())); activeDaemons.clear(); }

export async function wavelengthTools(config = {}) {
  const ctx = resolveWavelength(config);
  if (!ctx) return [];

  let daemon;
  let client;
  try {
    const allowed = readOnlyMcpMethods();

    daemon = wavelengthDaemon(ctx);
    await daemon.start();
    activeDaemons.add(daemon);
    process.on("exit", () => daemon.stop());
    await waitForRpcReady(ctx);

    client = mcpConnect({ command: wavecliBinPath(), args: mcpServeArgs(ctx) });
    await client.initialize();
    const list = await client.listTools();

    return list
      .filter((def) => allowed.has(def.name))
      .map((def) => ({
        name: `wl_${def.name.replace(/\./g, "_")}`,
        mutating: false,
        description: `${def.description} (Wavelength, ${ctx.network}).`,
        parameters: def.inputSchema || { type: "object", properties: {} },
        retryable: false,
        run: async (args, { signal } = {}) => mcpResult(await client.callTool(def.name, args, { signal })),
      }));
  } catch (err) {
    // Best-effort, same contract as config.mcp servers (mcp.mjs): a
    // Wavelength setup that fails to start or handshake (binaries not
    // vendored yet, daemon crash, ...) yields no wl_* tools rather than
    // breaking the whole session — but not silently: config.wavelength was
    // set on purpose, so a one-line reason goes to stderr.
    const tail = daemon?.logTail();
    process.stderr.write(`wavelength: disabled — ${err.message}${tail ? `\n${tail}` : ""}\n`);
    await client?.close();
    await daemon?.stop();
    return [];
  }
}
