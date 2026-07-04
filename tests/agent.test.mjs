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
