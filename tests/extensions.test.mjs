import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

import { on, off, emit, clear } from "../src/hooks.mjs";
import { loadPlugins } from "../src/plugins.mjs";
import { mcpTools } from "../src/mcp.mjs";
import { buildTools, unregisterTool } from "../src/tools.mjs";

test("hooks: listeners fire in order and a throwing one is isolated", async () => {
  const got = [];
  on("toolEnd", (p) => got.push(p.result));
  on("toolEnd", () => {
    throw new Error("bad");
  });
  await emit("toolEnd", { result: "r1" });
  await emit("toolEnd", { result: "r2" });
  assert.deepEqual(got, ["r1", "r2"]);
  clear();
});

test("hooks: off() unsubscribes", async () => {
  let n = 0;
  const dispose = on("error", () => n++);
  await emit("error", {});
  dispose();
  await emit("error", {});
  assert.equal(n, 1);
  clear();
});

test("plugins: a plugin registers a tool; a broken one is reported not thrown", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bc-plug-"));
  writeFileSync(
    path.join(dir, "ok.mjs"),
    `export default function ({ registerTool }) {
       registerTool({ name: "t_hello", description: "hi", parameters: { type: "object", properties: {} }, run: async () => "hi" });
     }`,
  );
  writeFileSync(path.join(dir, "bad.mjs"), `export default function () { throw new Error("boom"); }`);
  const loaded = await loadPlugins(dir);
  const ok = loaded.find((p) => p.name === "ok.mjs");
  const bad = loaded.find((p) => p.name === "bad.mjs");
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /boom/);
  assert.ok(buildTools({}, {}).find((t) => t.name === "t_hello"));
  unregisterTool("t_hello");
});

test("mcp: connect to a stdio server, wrap its tools, and call one", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bc-mcp-"));
  const server = path.join(dir, "server.mjs");
  writeFileSync(
    server,
    `let buf = "";
     process.stdin.setEncoding("utf8");
     process.stdin.on("data", (d) => {
       buf += d; let nl;
       while ((nl = buf.indexOf("\\n")) !== -1) {
         const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
         if (!line) continue;
         const msg = JSON.parse(line);
         const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
         if (msg.method === "initialize") reply({ protocolVersion: "2024-11-05" });
         else if (msg.method === "tools/list") reply({ tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] });
         else if (msg.method === "tools/call") reply({ content: [{ type: "text", text: "echo: " + (msg.params.arguments.text || "") }] });
       }
     });`,
  );
  const { tools, servers } = await mcpTools({ mcp: { demo: { command: process.execPath, args: [server] } } });
  assert.equal(servers[0].ok, true);
  assert.equal(servers[0].tools, 1);
  assert.equal(tools[0].name, "mcp_demo_echo");
  assert.equal(await tools[0].run({ text: "ciao" }), "echo: ciao");
});
