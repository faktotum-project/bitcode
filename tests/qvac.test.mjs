import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { resolveModel } from "../src/config.mjs";
import { callModel } from "../src/providers.mjs";
import { listLocalModels, isOllama } from "../src/local-models.mjs";

test("QVAC discovery and streaming round-trip preserve tool calls and tool results", async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ data: [{ id: "bitcode-local" }] }));
    }
    assert.equal(req.url, "/v1/chat/completions");
    let raw = "";
    for await (const part of req) raw += part;
    requests.push(JSON.parse(raw));
    res.setHeader("content-type", "text/event-stream");
    const delta = requests.length === 1
      ? { tool_calls: [{ index: 0, id: "qvac-call-1", type: "function", function: { name: "read_file", arguments: '{"path":"README.md"}' } }] }
      : { content: "Letto." };
    res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const target = resolveModel({ cliModel: "qvac", config: {
    providers: { qvac: { baseURL: `http://127.0.0.1:${server.address().port}/v1` } },
  } });
  assert.equal(isOllama("qvac", target.provider), false);
  assert.deepEqual((await listLocalModels("qvac", target.provider)).models.map(m => m.id), [target.model]);
  const tools = [{ name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }];
  const messages = [{ role: "user", content: "Leggi README.md" }];
  const first = await callModel({ ...target, system: "Assistente locale", messages, tools });
  assert.deepEqual(first.toolCalls, [{ id: "qvac-call-1", name: "read_file", args: { path: "README.md" } }]);
  messages.push({ role: "assistant", content: first.text, toolCalls: first.toolCalls },
    { role: "tool", toolCallId: "qvac-call-1", name: "read_file", content: "# bitcode" });
  const deltas = [];
  const second = await callModel({ ...target, messages, tools, onDelta: d => deltas.push(d) });
  assert.equal(second.text, "Letto.");
  assert.deepEqual(deltas, ["Letto."]);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].tools[0].function.name, "read_file");
  assert.deepEqual(requests[1].messages.at(-1), { role: "tool", tool_call_id: "qvac-call-1", content: "# bitcode" });
});

test("idleTimeoutMs retries a stream that never sends data, and gives up after bounded attempts", async t => {
  let calls = 0, stallAll = false;
  const server = http.createServer(async (req, res) => {
    for await (const _ of req);
    calls++;
    res.setHeader("content-type", "text/event-stream");
    res.flushHeaders();
    if (stallAll || calls === 1) return; // accept the request, then stay silent
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const target = resolveModel({ cliModel: "qvac", config: {
    providers: { qvac: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, idleTimeoutMs: 100 } },
  } });
  const messages = [{ role: "user", content: "ciao" }];
  const first = await callModel({ ...target, messages });
  assert.equal(first.text, "ok");
  assert.equal(calls, 2);

  stallAll = true; calls = 0;
  await assert.rejects(callModel({ ...target, messages }), /stalled: no data for 100ms in 3 attempts/);
  assert.equal(calls, 3);
});
