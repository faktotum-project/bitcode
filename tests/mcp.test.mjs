import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mcpConnect, mcpTools, mcpName, mcpResult, closeMcpConnections } from "../src/mcp.mjs";

afterEach(closeMcpConnections);
const empty = { type: "object", properties: {} };

async function endpoint(t, respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    let text = ""; for await (const chunk of req) text += chunk;
    const msg = JSON.parse(text); requests.push({ msg, headers: req.headers });
    if (msg.id == null) { res.writeHead(202); res.end(); return; }
    const result = respond(msg);
    if (result === undefined) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: req.headers["mcp-protocol-version"] === "2026-07-28" && msg.method !== "server/discover" ? { resultType: "complete", ttlMs: 0, cacheScope: "private", ...result } : result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests };
}

test("modern MCP HTTP negotiates 2026, paginates tools, forwards headers and structured errors", async t => {
  const { url, requests } = await endpoint(t, msg => {
    if (msg.method === "server/discover") return { supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "test", version: "1" } } };
    if (msg.method === "tools/list") return msg.params?.cursor ? { tools: [{ name: "second", inputSchema: empty }] } : { tools: [{ name: "echo", inputSchema: empty, annotations: { readOnlyHint: true } }], nextCursor: "next" };
    if (msg.method === "tools/call") return { content: [{ type: "text", text: "denied" }], structuredContent: { ok: false }, isError: true };
  });
  const result = await mcpTools({ mcp: { demo: { url, headers: { "x-test": "fixture" } } } });
  assert.equal(result.servers[0].ok, true, result.servers[0].error);
  assert.equal(result.servers[0].tools, 2);
  const echo = result.tools.find(t => t.name === "mcp_demo_echo");
  assert.equal(echo.mutating, true);
  assert.match(await echo.run({}), /^ERROR: denied/);
  const request = requests.find(r => r.msg.method === "tools/call");
  assert.equal(request.headers["mcp-method"], "tools/call");
  assert.equal(request.headers["mcp-protocol-version"], "2026-07-28");
  assert.equal(request.headers["x-test"], "fixture");
});

test("legacy HTTP initializes and exposes resources and prompts", async t => {
  const { url, requests } = await endpoint(t, msg => {
    if (msg.method === "initialize") return { protocolVersion: "2025-11-25", capabilities: { resources: {}, prompts: {} }, serverInfo: { name: "legacy", version: "1" } };
    if (msg.method === "resources/list") return { resources: [{ uri: "test://readme", name: "readme" }] };
    if (msg.method === "resources/templates/list") return { resourceTemplates: [] };
    if (msg.method === "resources/read") return { contents: [{ uri: msg.params.uri, text: "resource content" }] };
    if (msg.method === "prompts/list") return { prompts: [{ name: "review" }] };
    if (msg.method === "prompts/get") return { messages: [{ role: "user", content: { type: "text", text: "review code" } }] };
  });
  const result = await mcpTools({ mcp: { legacy: { url, negotiation: "legacy" } } });
  assert.equal(result.servers[0].ok, true, result.servers[0].error);
  const get = name => result.tools.find(t => t.name === name);
  assert.equal((await get("mcp_list_resources").run({ server: "legacy" })).resources[0].uri, "test://readme");
  assert.equal(await get("mcp_read_resource").run({ server: "legacy", uri: "test://readme" }), "resource content");
  assert.equal((await get("mcp_list_prompts").run({ server: "legacy" }))[0].name, "review");
  assert.equal((await get("mcp_get_prompt").run({ server: "legacy", name: "review" })).messages.length, 1);
  assert.ok(requests.some(r => r.msg.method === "notifications/initialized"));
});

test("MCP startup errors, hung servers and exits terminate promptly", async () => {
  const missing = await mcpTools({ mcp: { bad: { command: "/nonexistent/bitcode-test-server", timeoutMs: 100, negotiation: "legacy" } } });
  assert.equal(missing.servers[0].ok, false);
  const hang = mcpConnect({ command: process.execPath, args: ["-e", "process.stdin.resume()"], timeoutMs: 50, negotiation: "legacy" });
  await assert.rejects(hang.initialize(), /timeout|timed out/i); await hang.close();
  const exit = mcpConnect({ command: process.execPath, args: ["-e", "process.exit(2)"], timeoutMs: 1000, negotiation: "legacy" });
  await assert.rejects(exit.initialize());
});

test("MCP timeout and AbortSignal cancel a remote call", async t => {
  const { url } = await endpoint(t, msg => msg.method === "server/discover" ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } } : undefined);
  const client = mcpConnect({ url, timeoutMs: 50 });
  await client.initialize();
  await assert.rejects(client.callTool("hang", {}), /timeout|timed out/i);
});

test("MCP names remain valid, unique and bounded; binary content is not dumped", () => {
  assert.equal(mcpName("demo", "echo"), "mcp_demo_echo");
  assert.match(mcpName("a b", "x".repeat(100)), /^[a-zA-Z0-9_-]{1,64}$/);
  assert.notEqual(mcpName("a b", "echo"), mcpName("a.b", "echo"));
  assert.doesNotMatch(mcpResult({ content: [{ type: "image", mimeType: "image/png", data: "BASE64_SECRET" }] }), /BASE64_SECRET/);
});

test("MCP call cancellation propagates AbortSignal", async t => {
  const { url } = await endpoint(t, msg => msg.method === "server/discover" ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } } : undefined);
  const client = mcpConnect({ url, timeoutMs: 5000 });
  await client.initialize();
  const controller = new AbortController();
  const pending = client.callTool("hang", {}, { signal: controller.signal });
  controller.abort(new Error("user stop"));
  await assert.rejects(pending, /user stop|abort|cancel/i);
});
