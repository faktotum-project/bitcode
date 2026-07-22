import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveWavelength } = await import("../src/wavelength/network.mjs");
const { wavelengthEngine, FACADE_METHODS } = await import("../src/wavelength/engine.mjs");
const { wavelengthTools } = await import("../src/wavelength/tools.mjs");
const { buildTools } = await import("../src/tools.mjs");

test("wavelength is opt-in: no config, no context, no tools", () => {
  assert.equal(resolveWavelength({}), null);
  assert.deepEqual(wavelengthTools({}), []);
});

test("signet is the default network, with the SDK's public endpoint preset", () => {
  const ctx = resolveWavelength({ wavelength: {} });
  assert.equal(ctx.network, "signet");
  assert.equal(ctx.arkServerAddress, "https://signet.wavelength-rest.lightning.finance");
  assert.equal(ctx.swapServerAddress, "https://signet.swapd-rest.lightning.finance");
  assert.match(ctx.walletEsploraUrl, /mempool-signet/);
  assert.equal(ctx.maxPaySats, 50_000);
  assert.equal(ctx.maxOperatorFeeSat, 1_000);
  assert.match(ctx.dataDir, /\.bitcode[/\\]wavelength[/\\]signet$/);
});

test("explicit endpoints and caps override the preset", () => {
  const ctx = resolveWavelength({
    wavelength: { network: "testnet4", arkServerAddress: "https://ark.example", maxPaySats: 21 },
  });
  assert.equal(ctx.arkServerAddress, "https://ark.example");
  assert.equal(ctx.swapServerAddress, "https://test4.swapd-rest.lightning.finance");
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

test("the engine surface stays inside the SDK facade verbs", () => {
  const engine = wavelengthEngine({}, { call: async (m) => m });
  for (const method of Object.keys(engine)) {
    assert.ok(FACADE_METHODS.includes(method), `${method} is not a wavewalletdk facade method`);
  }
});

test("without a transport every engine call fails with an actionable error", async () => {
  const tools = wavelengthTools({ wavelength: {} });
  const info = tools.find((t) => t.name === "wl_info");
  await assert.rejects(async () => info.run({}), /transport not available yet/);
});

test("wl_info renders engine info through an injected transport", async () => {
  const calls = [];
  const transport = {
    call: async (method) => {
      calls.push(method);
      return {
        version: "0.1.0",
        network: "signet",
        blockHeight: 212_000,
        serverConnected: true,
        walletState: "ready",
        identityPubKey: "02abcdef0123456789ff",
      };
    },
  };
  const tools = wavelengthTools({ wavelength: {} }, { transport });
  const out = await tools.find((t) => t.name === "wl_info").run({});
  assert.deepEqual(calls, ["getInfo"]);
  assert.match(out, /wavelength signet · daemon 0\.1\.0 · block 212000/);
  assert.match(out, /operator https:\/\/signet\.wavelength-rest\.lightning\.finance · connected true/);
  assert.match(out, /wallet ready · identity 02abcdef01234567…/);
});

test("wl_balance renders the SDK Balance shape", async () => {
  const transport = {
    call: async () => ({
      confirmedSat: 12_345,
      pendingInSat: 100,
      pendingOutSat: 0,
      creditAvailableSat: 0,
      creditReservedSat: 0,
    }),
  };
  const tools = wavelengthTools({ wavelength: {} }, { transport });
  const out = await tools.find((t) => t.name === "wl_balance").run({});
  assert.match(out, /confirmed 12345 sats/);
  assert.match(out, /pending in 100 · pending out 0/);
});

test("buildTools registers wl_* only when config.wavelength is set", () => {
  const withOut = buildTools({}, {}).map((t) => t.name);
  assert.ok(!withOut.includes("wl_info"));
  const withIn = buildTools({ wavelength: {} }, {}).map((t) => t.name);
  assert.ok(withIn.includes("wl_info"));
  assert.ok(withIn.includes("wl_balance"));
  const mutating = buildTools({ wavelength: {} }, {}).filter((t) => t.name.startsWith("wl_") && t.mutating);
  assert.equal(mutating.length, 0, "phase 1 ships read-only tools only");
});
