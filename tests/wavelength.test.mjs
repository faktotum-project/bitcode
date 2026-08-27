import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveWavelength } = await import("../src/wavelength/network.mjs");
const { wavedArgs } = await import("../src/wavelength/daemon.mjs");
const { wavelengthTools, filterReadOnlyMcpMethods, mcpServeArgs } = await import("../src/wavelength/tools.mjs");
const { buildTools } = await import("../src/tools.mjs");

test("wavelength is opt-in: no config, no context, no tools", async () => {
  assert.equal(resolveWavelength({}), null);
  assert.deepEqual(await wavelengthTools({}), []);
});

test("signet is the default network, with the SDK's public endpoint preset and local RPC config", () => {
  const ctx = resolveWavelength({ wavelength: {} });
  assert.equal(ctx.network, "signet");
  assert.equal(ctx.arkServerAddress, "https://signet.wavelength-rest.lightning.finance");
  assert.equal(ctx.arkServerTransport, "rest");
  assert.equal(ctx.swapServerAddress, "https://signet.swapd-rest.lightning.finance");
  assert.equal(ctx.swapServerTransport, "rest");
  assert.match(ctx.walletEsploraUrl, /mempool-signet/);
  assert.equal(ctx.maxPaySats, 50_000);
  assert.equal(ctx.maxOperatorFeeSat, 1_000);
  assert.match(ctx.dataDir, /\.bitcode[/\\]wavelength[/\\]signet$/);
  assert.equal(ctx.rpcListenAddr, "127.0.0.1:10029");
  assert.match(ctx.rpcMacaroonPath, /rpc\.macaroon$/);
  assert.match(ctx.rpcTlsCertPath, /tls\.cert$/);
  assert.match(ctx.rpcTlsKeyPath, /tls\.key$/);
});

test("explicit endpoints and caps override the preset, and drop the forced rest transport", () => {
  const ctx = resolveWavelength({
    wavelength: { network: "testnet4", arkServerAddress: "https://ark.example", maxPaySats: 21 },
  });
  assert.equal(ctx.arkServerAddress, "https://ark.example");
  assert.equal(ctx.arkServerTransport, undefined);
  assert.equal(ctx.swapServerAddress, "https://test4.swapd-rest.lightning.finance");
  assert.equal(ctx.swapServerTransport, "rest");
  assert.equal(ctx.maxPaySats, 21);
});

test("mainnet demands explicit opt-in and hand-built endpoints", () => {
  assert.throws(() => resolveWavelength({ wavelength: { network: "mainnet" } }), /allowMainnet/);
  assert.throws(
    () => resolveWavelength({ wavelength: { network: "mainnet", allowMainnet: true } }),
    /arkServerAddress/,
  );
});

test("regtest demands explicit endpoints, unknown networks are rejected", () => {
  assert.throws(() => resolveWavelength({ wavelength: { network: "regtest" } }), /arkServerAddress/);
  assert.throws(() => resolveWavelength({ wavelength: { network: "liquid" } }), /unknown wavelength\.network/);
});

test("waved is launched with TLS + macaroons on, and the hosted rest transport when using presets", () => {
  const ctx = resolveWavelength({ wavelength: {} });
  const args = wavedArgs(ctx);
  assert.ok(!args.includes("--rpc.notls"));
  assert.ok(!args.includes("--rpc.no-macaroons"));
  assert.ok(args.includes("--rpc.gateway.enabled=false"), "the unused HTTP gateway stays off");
  assert.ok(args.includes("--server.transport"));
  assert.equal(args[args.indexOf("--server.transport") + 1], "rest");
  assert.ok(args.includes("--maxoperatorfeesat"));
  assert.equal(args[args.indexOf("--maxoperatorfeesat") + 1], String(ctx.maxOperatorFeeSat));
});

test("mainnet passes --allow-mainnet to waved", () => {
  const ctx = resolveWavelength({
    wavelength: { network: "mainnet", allowMainnet: true, arkServerAddress: "https://ark.example", swapServerAddress: "https://swap.example", walletEsploraUrl: "https://esplora.example" },
  });
  assert.ok(wavedArgs(ctx).includes("--allow-mainnet"));
});

test("wavecli mcp serve is pointed at the locally-managed daemon's RPC, not a hosted endpoint", () => {
  const ctx = resolveWavelength({ wavelength: {} });
  const args = mcpServeArgs(ctx);
  assert.deepEqual(args, [
    "mcp",
    "serve",
    "--network",
    "signet",
    "--rpcserver",
    ctx.rpcListenAddr,
    "--macaroonpath",
    ctx.rpcMacaroonPath,
    "--tlscertpath",
    ctx.rpcTlsCertPath,
  ]);
});

// Fixture shaped like real `wavecli schema --all --json` output (v0.1.1,
// verified against the live binary) — trimmed to the fields the filter reads.
const SCHEMA_FIXTURE = [
  { method: "getinfo", mcp_tool: true, side_effect: false },
  { method: "daemon.balance", mcp_tool: true, mcp_only: true, side_effect: false },
  { method: "send", mcp_tool: true, side_effect: true },
  { method: "send.prepare", mcp_tool: true, mcp_only: true, side_effect: false },
  { method: "recv", mcp_tool: true, side_effect: true },
  { method: "activity", mcp_tool: true, side_effect: false },
  { method: "balance", mcp_tool: true, side_effect: false },
  { method: "exit", mcp_tool: true, side_effect: true },
  { method: "exit.status", mcp_tool: true, side_effect: false },
  { method: "create", side_effect: true }, // not mcp_tool at all
];

test("only mcp-exposed, side-effect-free methods are considered safe to register", () => {
  const allowed = filterReadOnlyMcpMethods(SCHEMA_FIXTURE);
  assert.deepEqual(
    [...allowed].sort(),
    ["activity", "balance", "daemon.balance", "exit.status", "getinfo", "send.prepare"],
  );
  assert.ok(!allowed.has("send"), "mutating methods stay out until phase 2/3 guardrails exist");
  assert.ok(!allowed.has("recv"));
  assert.ok(!allowed.has("exit"));
  assert.ok(!allowed.has("create"), "not an MCP tool at all");
});

test("wavelength is best-effort: an unvendored/unreachable daemon yields no tools, not a crash", async () => {
  // In this checkout deps/wavelength/bin is empty (postinstall skipped, same
  // as CDK in CI) so wavecli resolves to a bare name that ENOENTs.
  const tools = await wavelengthTools({ wavelength: {} });
  assert.deepEqual(tools, []);
});

test("buildTools has no wl_* tools synchronously — they arrive via loadExtensions, not buildTools", () => {
  const tools = buildTools({ wavelength: {} }, {}).map((t) => t.name);
  assert.ok(!tools.some((n) => n.startsWith("wl_")));
});
