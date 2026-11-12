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

test('Chat length preserves final delta and usage, drops truncated tools, forwards output controls', async () => {
  let request, hits = 0;
  handler = (req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      request = JSON.parse(body); hits++;
      stream(res, [
        { choices: [{ delta: { content: 'partial ', tool_calls: [{ index: 0, id: 'a', function: { name: 'write_file', arguments: '{"path":' } }] } }] },
        { choices: [{ delta: { content: 'final token' }, finish_reason: 'length' }] },
        { choices: [], usage: { prompt_tokens: 3900, completion_tokens: 196 } },
      ], true);
    });
  };
  let visible = '';
  const result = await callModel({ provider: { ...provider(), discovery: 'ollama', maxOutputTokens: 2048, reasoningEffort: 'none' }, model: 'gemma4:26b', messages: [], onDelta: s => visible += s });
  assert.equal(request.max_tokens, 2048); assert.equal(request.reasoning_effort, 'none');
  assert.equal(result.text, 'partial final token'); assert.equal(visible, result.text);
  assert.equal(result.incomplete, 'length'); assert.deepEqual(result.toolCalls, []);
  assert.equal(result.usage.output_tokens, 196); assert.match(result.completionHint, /num_ctx/); assert.equal(hits, 1);
});

test('Chat rejects invalid output limits before contacting a provider', async () => {
  for (const maxOutputTokens of [0, -1, '4096', 1.5]) await assert.rejects(callModel({ provider: { ...provider(), maxOutputTokens }, model: 'm', messages: [] }), /positive integer/);
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

test("Chat reasoning deltas reach onReasoning and stay out of the answer text", async () => {
  handler = (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const delta of [{ reasoning: "think " }, { reasoning_content: "more" }, { content: "answer" }]) res.write("data: " + JSON.stringify({ choices: [{ delta }] }) + "\n\n");
    res.end("data: [DONE]\n\n");
  };
  let thought = "", visible = "";
  const r = await callModel({ provider: provider(), model: "m", system: "s", messages: [{ role: "user", content: "x" }], tools: [], onDelta: s => visible += s, onReasoning: s => thought += s });
  assert.equal(r.text, "answer"); assert.equal(visible, "answer"); assert.equal(thought, "think more");
});

test("Kimi streams usage, preserves reasoning for tools and never replays it across services", async () => {
  const requests = [];
  handler = (req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      requests.push(JSON.parse(body));
      if (requests.length === 1) return stream(res, [
        { choices: [{ delta: { reasoning_content: "think " } }] },
        { choices: [{ delta: { reasoning_content: "carefully", tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ], true);
      stream(res, [
        { choices: [{ delta: { content: "done" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 20, completion_tokens: 4 } },
      ], true);
    });
  };
  const p = { ...provider(), preserveReasoning: true, useMaxCompletionTokens: true, includeUsage: true, maxOutputTokens: 8192, reasoningEffort: "high" };
  const tools = [{ name: "read_file", description: "Read a file", parameters: { type: "object" } }];
  const first = await callModel({ provider: p, model: "kimi-k3.1-pro", system: "s", messages: [{ role: "user", content: "read" }], tools });
  assert.equal(first.toolCalls[0].args.path, "a.txt");
  assert.equal(first.providerState.reasoningContent, "think carefully");
  assert.equal(first.usage.output_tokens, 5);
  assert.equal(requests[0].max_completion_tokens, 8192);
  assert.equal(requests[0].max_tokens, undefined);
  assert.equal(requests[0].reasoning_effort, "high");
  assert.deepEqual(requests[0].stream_options, { include_usage: true });

  const messages = [
    { role: "user", content: "read" },
    { role: "assistant", content: "", toolCalls: first.toolCalls, providerState: first.providerState },
    { role: "tool", toolCallId: "call_1", name: "read_file", content: "file text" },
  ];
  const second = await callModel({ provider: p, model: "kimi-k3.1-pro", system: "s", messages, tools: [] });
  assert.equal(second.text, "done");
  assert.equal(second.usage.input_tokens, 20);
  const assistant = requests[1].messages.find(m => m.role === "assistant");
  assert.equal(assistant.reasoning_content, "think carefully");
  assert.equal(assistant.tool_calls[0].id, "call_1");

  const crossServiceState = { ...first.providerState, baseURL: "https://api.kimi.ai/coding/v1" };
  await callModel({ provider: p, model: "kimi-k3.1-pro", system: "s", messages: [{ role: "assistant", content: "", providerState: crossServiceState }], tools: [] });
  assert.equal(requests[2].messages.find(m => m.role === "assistant").reasoning_content, undefined);
});

test("Kimi non-streaming responses retain reasoning without streaming options", async () => {
  let request;
  handler = (req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      request = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok", reasoning_content: "thought" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
    });
  };
  const p = { ...provider(), preserveReasoning: true, includeUsage: true, stream: false };
  const result = await callModel({ provider: p, model: "k3.1-pro", messages: [{ role: "user", content: "x" }], tools: [] });
  assert.equal(request.stream, false);
  assert.equal(request.stream_options, undefined);
  assert.equal(result.text, "ok");
  assert.equal(result.providerState.reasoningContent, "thought");
  assert.equal(result.usage.output_tokens, 2);
});
