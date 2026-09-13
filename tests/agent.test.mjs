import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runAgent, agentLimits } from "../src/agent.mjs";

// A mock OpenAI-compatible SSE endpoint; each test sets `script(res)` to decide
// the per-request response (tool calls first, then a final text).
let server;
let port;
let script;

before(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => script(res));
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
after(() => server.close());

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write("data: " + JSON.stringify(c) + "\n\n");
  res.write("data: [DONE]\n\n");
  res.end();
}
const target = () => ({ provider: { api: "openai", baseURL: `http://127.0.0.1:${port}/v1` }, model: "m", apiKey: null });
const toolCall = (i, id, name) => ({ choices: [{ delta: { tool_calls: [{ index: i, id, function: { name, arguments: "{}" } }] } }] });
const textChunk = (s) => ({ choices: [{ delta: { content: s } }] });

test("independent tool calls in one turn run concurrently", async () => {
  let turn = 0;
  script = (res) =>
    ++turn === 1
      ? sse(res, [toolCall(0, "c1", "slow"), toolCall(1, "c2", "slow")])
      : sse(res, [textChunk("done")]);
  let active = 0;
  let maxActive = 0;
  const slow = {
    name: "slow",
    mutating: false,
    parameters: {},
    run: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 40));
      active--;
      return "ok";
    },
  };
  const out = await runAgent({ target: target(), messages: [{ role: "user", content: "go" }], system: "s", tools: [slow], limits: agentLimits({}) });
  assert.equal(out, "done");
  assert.equal(maxActive, 2); // both ran at the same time
});

test("per-turn tool budget refuses excess calls but still answers each tool_use", async () => {
  let turn = 0;
  script = (res) =>
    ++turn === 1 ? sse(res, [toolCall(0, "c1", "t"), toolCall(1, "c2", "t")]) : sse(res, [textChunk("done")]);
  let ran = 0;
  const tool = { name: "t", mutating: false, parameters: {}, run: async () => (ran++, "ok") };
  const msgs = [{ role: "user", content: "go" }];
  await runAgent({ target: target(), messages: msgs, system: "s", tools: [tool], limits: agentLimits({ agent: { maxToolCallsPerTurn: 1 } }) });
  assert.equal(ran, 1);
  const toolResults = msgs.filter((m) => m.role === "tool");
  assert.equal(toolResults.length, 2); // every tool_use got a result
  assert.ok(toolResults.some((m) => String(m.content).includes("budget")));
});

test("a throwing tool is retried with backoff, then succeeds", async () => {
  let turn = 0;
  script = (res) => (++turn === 1 ? sse(res, [toolCall(0, "c1", "flaky")]) : sse(res, [textChunk("done")]));
  let tries = 0;
  const flaky = {
    name: "flaky",
    mutating: false,
    parameters: {},
    run: async () => {
      if (++tries < 3) throw new Error("transient");
      return "recovered";
    },
  };
  const msgs = [{ role: "user", content: "go" }];
  await runAgent({ target: target(), messages: msgs, system: "s", tools: [flaky], limits: agentLimits({ agent: { toolRetryAttempts: 3, toolRetryDelay: 2 } }) });
  assert.equal(tries, 3);
  assert.equal(msgs.find((m) => m.role === "tool").content, "recovered");
});

test("fallback target answers when the primary call fails", async () => {
  script = (res) => sse(res, [textChunk("from fallback")]);
  const dead = { provider: { api: "openai", baseURL: "http://127.0.0.1:1/v1" }, model: "m", apiKey: null };
  let fellBack = false;
  const out = await runAgent({
    target: dead,
    fallbacks: [target()],
    messages: [{ role: "user", content: "x" }],
    system: "s",
    tools: [],
    hooks: { onFallback: () => (fellBack = true) },
  });
  assert.equal(out, "from fallback");
  assert.equal(fellBack, true);
});

test("mutations form barriers between concurrent reads", async () => {
  let turn = 0, value = 0;
  script = res => ++turn === 1 ? sse(res, [toolCall(0, "a", "read"), toolCall(1, "b", "write"), toolCall(2, "c", "read"), toolCall(3, "d", "write")]) : sse(res, [textChunk("done")]);
  const sequence = [];
  const tools = [
    { name: "read", mutating: false, parameters: {}, run: async () => { await new Promise(r => setTimeout(r, 10)); sequence.push(`read:${value}`); return value; } },
    { name: "write", mutating: true, parameters: {}, run: async () => { sequence.push(`write:${++value}`); return value; } },
  ];
  await runAgent({ target: target(), messages: [], tools, hooks: { approve: () => true } });
  assert.deepEqual(sequence, ["read:0", "write:1", "read:1", "write:2"]);
});

test("side effects are never automatically retried", async () => {
  let turn = 0, calls = 0;
  script = res => ++turn === 1 ? sse(res, [toolCall(0, "a", "pay")]) : sse(res, [textChunk("done")]);
  const messages = [];
  await runAgent({ target: target(), messages, tools: [{ name: "pay", mutating: true, run: () => { calls++; throw new Error("response lost after send"); } }], limits: agentLimits({ agent: { toolRetryAttempts: 3 } }) });
  assert.equal(calls, 1); assert.match(messages[1].content, /response lost/);
});

test("invalid arguments and unknown tools never execute and have paired results", async () => {
  let turn = 0, called = false;
  script = res => ++turn === 1 ? sse(res, [toolCall(0, "a", "write"), toolCall(1, "b", "missing")]) : sse(res, [textChunk("done")]);
  const messages = [];
  await runAgent({ target: target(), messages, tools: [{ name: "write", parameters: { type: "object", required: ["path"] }, run: () => { called = true; } }] });
  assert.equal(called, false); assert.equal(messages.filter(m => m.role === "tool").length, 2);
  assert.match(messages[1].content, /invalid arguments/);
});

test("read-only mode excludes mutations even if a model requests them", async () => {
  let turn = 0, called = false;
  script = res => ++turn === 1 ? sse(res, [toolCall(0, "a", "write")]) : sse(res, [textChunk("done")]);
  const messages = [];
  await runAgent({ target: target(), messages, readOnly: true, tools: [{ name: "write", mutating: true, run: () => { called = true; } }] });
  assert.equal(called, false); assert.match(messages[1].content, /unavailable/);
});

test("budget stops repeated calls, persists final status and does not call model again", async () => {
  let modelCalls = 0, checkpoints = 0;
  script = res => { modelCalls++; sse(res, [toolCall(0, "a", "read")]); };
  const messages = [];
  const out = await runAgent({ target: target(), messages, tools: [{ name: "read", mutating: false, run: () => "ok" }], limits: agentLimits({ agent: { maxTotalToolCalls: 1 } }), hooks: { onCheckpoint: () => checkpoints++ } });
  assert.match(out, /stopped.*budget/); assert.equal(modelCalls, 1); assert.equal(messages.at(-1).content, out); assert.equal(checkpoints, 2);
});

test("cancellation pairs all results and prevents subsequent side effects", async () => {
  const controller = new AbortController(); let second = false;
  script = res => sse(res, [toolCall(0, "a", "first"), toolCall(1, "b", "second")]);
  const messages = [];
  await assert.rejects(runAgent({ target: target(), messages, signal: controller.signal, tools: [
    { name: "first", mutating: true, run: () => { controller.abort(new Error("stop")); return "first complete"; } },
    { name: "second", mutating: true, run: () => { second = true; } },
  ] }), /stop/);
  assert.equal(second, false); assert.equal(messages.filter(m => m.role === "tool").length, 2); assert.match(messages[2].content, /cancelled/);
});

test("auth failures do not send the transcript to fallback providers", async () => {
  let calls = 0;
  script = res => { calls++; res.writeHead(401); res.end("no key"); };
  await assert.rejects(runAgent({ target: target(), fallbacks: [target()], messages: [], tools: [] }), /401/);
  assert.equal(calls, 1);
});
