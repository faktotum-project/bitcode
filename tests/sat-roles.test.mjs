import test from "node:test";
import assert from "node:assert/strict";
import { satForTool } from "../src/sats/roles.mjs";

test("satForTool maps tools to the Sat whose role they serve", () => {
  assert.equal(satForTool("btc_fees"), "node");
  assert.equal(satForTool("wallet_send"), "node");
  assert.equal(satForTool("cashu_melt"), "node");
  assert.equal(satForTool("edit_file"), "script");
  assert.equal(satForTool("bash"), "script");
  assert.equal(satForTool("read_file"), "hash");
  assert.equal(satForTool("git_diff"), "hash");
  assert.equal(satForTool("subagent"), "merkle");
  assert.equal(satForTool("update_plan"), "merkle");
});

test("satForTool prefers the active Sat and ignores unknown ids", () => {
  assert.equal(satForTool("bash", { activeSatId: "merkle" }), "merkle");
  assert.equal(satForTool("bash", { activeSatId: "bitcode" }), "script");
  assert.equal(satForTool(undefined), "hash");
});
