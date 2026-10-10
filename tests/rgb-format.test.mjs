import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUnits, createRgbFormatter, describeRgbSend, parseRgbInvoice, prepareRgbSend } from "../src/rgb/format.mjs";
import { rgbTools } from "../src/rgb/tools.mjs";

const USDT = "rgb:lX~ToKsO-Iup7dJ5-UM794sA-9WD21ge-VHYzBGb-E9PA_h0";

test("formatUnits divides exactly by 10^precision", () => {
  assert.equal(formatUnits(100000000, 6), "100");
  assert.equal(formatUnits(65500000, 6), "65.5");
  assert.equal(formatUnits(1, 6), "0.000001");
  assert.equal(formatUnits(10000, 0), "10000");
  assert.equal(formatUnits("18446744073709551615", 9), "18446744073.709551615");
  assert.equal(formatUnits(5, -1), null);
  assert.equal(formatUnits("x", 2), null);
});

test("asset lists gain balance_display; later lookups by ID or ticker reuse the precision", () => {
  const format = createRgbFormatter();
  const list = JSON.parse(format(JSON.stringify([
    { asset_id: USDT, ticker: "USDT", precision: 6, balance: { settled: 100000000, future: 100000000, spendable: 100000000 } },
  ])));
  assert.deepEqual(list[0].balance_display, { settled: "100 USDT", future: "100 USDT", spendable: "100 USDT" });
  assert.equal(list[0].balance.settled, 100000000);

  const bare = JSON.stringify({ settled: 2500000, future: 2500000, spendable: 2500000 });
  assert.equal(JSON.parse(format(bare, { asset_id: USDT })).balance_display.spendable, "2.5 USDT");
  assert.equal(JSON.parse(format(bare, { asset_id: "USDT" })).balance_display.spendable, "2.5 USDT");
  // Unknown assets are left unconverted rather than guessed.
  assert.equal(JSON.parse(format(bare, { asset_id: "rgb:unknown" })).balance_display, undefined);
});

test("errors and non-JSON results pass through unchanged", () => {
  const format = createRgbFormatter();
  assert.equal(format("ERROR: Invalid asset ID"), "ERROR: Invalid asset ID");
  assert.equal(format("plain text"), "plain text");
});

const BLINDED = "rgb:~/~/~/sbc:utxob:_pnvbOef-ljmgfSr-i0bQvnR-qyC1g6i-IU1Lr9O-DKfmoTF-Cm5ty?expiry=1791664659&endpoints=rpcs://proxy.iriswallet.com/0.2/json-rpc";

test("parseRgbInvoice extracts recipient and endpoints from an invoice", () => {
  assert.deepEqual(parseRgbInvoice(BLINDED), {
    recipient_id: "sbc:utxob:_pnvbOef-ljmgfSr-i0bQvnR-qyC1g6i-IU1Lr9O-DKfmoTF-Cm5ty",
    transport_endpoints: ["rpcs://proxy.iriswallet.com/0.2/json-rpc"],
  });
  assert.equal(parseRgbInvoice("rpcs://proxy.iriswallet.com/0.2/json-rpc"), null);
});

test("prepareRgbSend takes the recipient from the invoice, not from the model's field choice", () => {
  const known = new Set([USDT]);
  // Observed failure: the model put the invoice endpoint in recipient_id.
  const fixed = prepareRgbSend({ asset_id: USDT, amount: 5, recipient_id: "rpcs://proxy.iriswallet.com/0.2/json-rpc", invoice: BLINDED }, known);
  assert.deepEqual(fixed, { asset_id: USDT, amount: 5, recipient_id: "sbc:utxob:_pnvbOef-ljmgfSr-i0bQvnR-qyC1g6i-IU1Lr9O-DKfmoTF-Cm5ty",
    transport_endpoints: ["rpcs://proxy.iriswallet.com/0.2/json-rpc"] });
  assert.equal(prepareRgbSend({ asset_id: USDT, amount: 5, recipient_id: BLINDED }, known).recipient_id, fixed.recipient_id);
  assert.throws(() => prepareRgbSend({ asset_id: USDT, amount: 5, recipient_id: "rpcs://proxy" }, known), /full RGB invoice/);
  assert.throws(() => prepareRgbSend({ asset_id: "rgb:invented", amount: 5, recipient_id: BLINDED }, known), /not held by this node/);
  assert.throws(() => prepareRgbSend({ asset_id: USDT, amount: 5, recipient_id: "rgb:~/~/~/sbc:wvout:abc" }, known), /witness/);
});

test("describeRgbSend gives one deterministic approval line", () => {
  const line = describeRgbSend(prepareRgbSend({ asset_id: USDT, amount: 2, recipient_id: BLINDED }, new Set([USDT])), { ticker: "USDT", precision: 6 });
  assert.equal(line, "Send 2 USDT (rgb:lX~ToKsO-Iup…9PA_h0) to sbc:utxob:_pnvbO…-Cm5ty on signet via rpcs://proxy.iriswallet.com/0.2/json-rpc");
});

test("rgb tools refresh transfers before reporting holdings, not before other calls", async () => {
  const calls = [];
  const tool = (name, mutating = false) => ({ name: `mcp_kaleido_${name}`, mcpServer: "kaleido", mutating, run: async () => { calls.push(name); return "[]"; } });
  const tools = rgbTools([tool("rln_refresh_transfers"), tool("rln_list_assets"), tool("rln_get_address"), tool("rln_create_rgb_invoice", true)]);
  const run = name => tools.find(t => t.name === `mcp_kaleido_${name}`).run({});
  await run("rln_list_assets"); await run("rln_get_address"); await run("rln_create_rgb_invoice");
  assert.deepEqual(calls, ["rln_refresh_transfers", "rln_list_assets", "rln_get_address", "rln_create_rgb_invoice"]);
});
