import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTools, registerTool, unregisterTool } from "../src/tools.mjs";
import { systemPrompt } from "../src/agent.mjs";
import { resolveProfile } from "../src/project.mjs";

const empty = { type: "object", properties: {} };

test("rgb profile exposes only the configured RGB node's MCP tools", t => {
  const tools = [
    { name: "mcp_kaleido_rln_get_balances", mcpServer: "kaleido", mutating: false },
    { name: "mcp_kaleido_rln_issue_asset", mcpServer: "kaleido", mutating: true },
    { name: "mcp_other_search", mcpServer: "other", mutating: false },
    { name: "plugin_tool", mutating: false },
  ];
  for (const tool of tools) registerTool({ ...tool, parameters: empty, run: async () => "" });
  t.after(() => { for (const tool of tools) unregisterTool(tool.name); });

  const rgb = buildTools({}, { profile: "rgb" });
  assert.deepEqual(rgb.map(x => x.name), ["mcp_kaleido_rln_get_balances", "mcp_kaleido_rln_issue_asset"]);
  // Any state change on the node takes the payment gate, never one-shot auto-approval.
  assert.equal(rgb[0].financial, undefined);
  assert.equal(rgb[1].financial, true);
  assert.deepEqual(buildTools({ rgb: { mcpServer: "other" } }, { profile: "rgb", modelRef: { current: null } }).map(x => x.name), ["mcp_other_search"]);
  const code = buildTools({}, { profile: "code" }).map(x => x.name);
  assert.ok(code.includes("mcp_kaleido_rln_get_balances") && code.includes("read_file"));
});

test("rgb profile is selectable and has its own short system prompt", () => {
  assert.equal(resolveProfile({ cliProfile: "rgb" }), "rgb");
  assert.throws(() => resolveProfile({ cliProfile: "rgbx" }), /use code, bitcoin or rgb/);
  const prompt = systemPrompt({ profile: "rgb" });
  assert.match(prompt, /signet/);
  assert.match(prompt, /full asset ID/);
  assert.doesNotMatch(prompt, /coding agent/);
});
