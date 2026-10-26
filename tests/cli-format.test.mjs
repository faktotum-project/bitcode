import test from "node:test";
import assert from "node:assert/strict";
import { statusText, listText, mcpText, satInfoText } from "../src/cli-format.mjs";

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("status reads as labelled sections instead of JSON", () => {
  const text = plain(statusText({ model: "mock/demo", profile: "code", root: "/w", permissions: { mode: "suggest", allow: [] }, readOnly: false,
    messages: 4, estimated_tokens: 1200, usage: { input_tokens: 2000, output_tokens: 300 }, commands: ["npm test"], plan: { steps: [{ step: "read", status: "completed" }] } }));
  assert.match(text, /model\s+mock\/demo/);
  assert.match(text, /used\s+↑2,000 ↓300 tokens/);
  assert.match(text, /npm test/);
  assert.match(text, /☑ read/);
  assert.doesNotMatch(text, /[{}]/);
});

test("lists, MCP servers and Sat info have readable empty and filled forms", () => {
  assert.match(plain(listText("Skills", [])), /none/);
  assert.match(plain(listText("Commands", [{ name: "btc:fees", description: "fees" }], { name: (c) => "/" + c.name })), /\/btc:fees\s+fees/);
  assert.match(plain(mcpText([{ name: "docs", ok: true, tools: 3 }])), /● docs\s+3 tools/);
  assert.match(plain(satInfoText({ name: "Node", role: "Bitcoin infrastructure", permissions: { wallet: "deny" }, tools: ["btc_fees"] })), /permissions\s+wallet deny/);
});
