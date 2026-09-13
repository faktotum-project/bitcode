import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { callModel, providerHealth } from "../src/providers.mjs";

let server;
let port;
let handler;

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
after(() => server.close());

const provider = () => ({ api: "openai", baseURL: `http://127.0.0.1:${port}/v1` });
const call = () =>
  callModel({ provider: provider(), model: "m", apiKey: null, system: "s", messages: [{ role: "user", content: "x" }], tools: [] });

test("callModel retries on 429 (Retry-After) and recovers", async () => {
  let hits = 0;
  handler = (req, res) => {
    hits++;
    if (hits <= 2) {
      res.writeHead(429, { "retry-after": "0" });
      return res.end("rate limited");
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  };
  const r = await call();
  assert.equal(r.text, "ok");
  assert.equal(hits, 3);
});

test("callModel does not retry a non-retryable 400", async () => {
  let hits = 0;
  handler = (req, res) => {
    hits++;
    res.writeHead(400);
    res.end("bad request");
  };
  await assert.rejects(call(), /HTTP 400/);
  assert.equal(hits, 1);
});

test("providerHealth reports reachable vs dead endpoints", async () => {
  handler = (req, res) => {
    res.writeHead(200);
    res.end("{}");
  };
  const ok = await providerHealth(provider(), null);
  assert.equal(ok.ok, true);
  const dead = await providerHealth({ api: "openai", baseURL: "http://127.0.0.1:1/v1" }, null);
  assert.equal(dead.ok, false);
});

function stream(res, events, done = false) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\r\n\r\n`);
  if (done) res.write("data: [DONE]\n\n");
  res.end();
}

test("Responses replays reasoning and function calls, emits text and usage", async () => {
  const requests = [];
  const reasoning = { id: "rs_1", type: "reasoning", summary: [], encrypted_content: "opaque" };
  const fn = { id: "fc_1", type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}', status: "completed" };
  handler = (req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      requests.push(JSON.parse(body));
      assert.equal(req.url, "/v1/responses");
      stream(res, requests.length === 1 ? [{ type: "response.completed", response: { status: "completed", output: [reasoning, fn], usage: { input_tokens: 10, output_tokens: 5 } } }] : [
        { type: "response.output_text.delta", delta: "done" },
        { type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }], usage: { input_tokens: 20, output_tokens: 4 } } },
      ]);
    });
  };
  const p = { ...provider(), api: "responses", reasoningEffort: "medium", maxOutputTokens: 5000 };
  const first = await callModel({ provider: p, model: "gpt-6-astra", system: "system", messages: [{ role: "user", content: "read" }], tools: [{ name: "read_file", parameters: { type: "object" } }] });
  assert.equal(first.toolCalls[0].args.path, "a.txt"); assert.equal(first.usage.output_tokens, 5);
  let text = "";
  const second = await callModel({ provider: p, model: "gpt-6-astra", system: "system", messages: [{ role: "user", content: "read" }, { role: "assistant", content: "", toolCalls: first.toolCalls, providerState: first.providerState }, { role: "tool", toolCallId: "call_1", content: "file text" }], tools: [], onDelta: s => text += s });
  assert.equal(text, "done"); assert.equal(second.text, "done");
  assert.deepEqual(requests[1].input.slice(1, 3), [reasoning, fn]);
  assert.equal(requests[1].input[3].type, "function_call_output");
  assert.equal(requests[0].store, false); assert.equal(requests[0].reasoning.effort, "medium");
});

test("malformed tool JSON, truncated streams and provider error events fail closed", async () => {
  const scenarios = [
    [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "write", arguments: '{"broken"' } }] } }] }],
    [{ error: { message: "stream error" } }],
  ];
  for (const events of scenarios) { handler = (_req, res) => stream(res, events, true); await assert.rejects(call()); }
  handler = (_req, res) => stream(res, [{ choices: [{ delta: { content: "partial" } }] }]);
  await assert.rejects(call(), /before completion/);
});

test("Responses incomplete response is not treated as success", async () => {
  handler = (_req, res) => stream(res, [{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }]);
  await assert.rejects(callModel({ provider: { ...provider(), api: "responses" }, model: "m", system: "s", messages: [], tools: [] }), /max_output_tokens/);
});

test("Anthropic streaming preserves initial tool input and detects error events", async () => {
  handler = (_req, res) => stream(res, [
    { type: "message_start", message: { usage: { input_tokens: 12 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "a", name: "read", input: { path: "a" } } },
    { type: "message_delta", usage: { output_tokens: 4 } }, { type: "message_stop" },
  ]);
  const args = { provider: { api: "anthropic", baseURL: `http://127.0.0.1:${port}` }, model: "m", apiKey: "test", system: "s", messages: [], tools: [] };
  const result = await callModel(args);
  assert.equal(result.toolCalls[0].args.path, "a"); assert.equal(result.usage.input_tokens, 12);
  handler = (_req, res) => stream(res, [{ type: "error", error: { message: "overloaded" } }]);
  await assert.rejects(callModel(args), /overloaded/);
});

test("provider request cancellation closes the HTTP stream promptly", async () => {
  handler = (req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": keepalive\n\n"); req.on("close", () => res.end()); };
  const controller = new AbortController();
  const promise = callModel({ provider: provider(), model: "m", messages: [], tools: [], signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(promise);
});

test("401 is unhealthy, even when the endpoint is reachable", async () => {
  handler = (_req, res) => { res.writeHead(401); res.end(); };
  assert.equal((await providerHealth(provider(), "bad")).ok, false);
});
