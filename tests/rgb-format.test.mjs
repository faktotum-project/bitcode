import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUnits, createRgbFormatter } from "../src/rgb/format.mjs";

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
