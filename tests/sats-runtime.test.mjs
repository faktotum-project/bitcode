import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadAgents } from "../src/agents.mjs";
import { toolsForAgent, SAT_IDS } from "../src/sats/policy.mjs";
import { runAgent } from "../src/agent.mjs";
import { runSubagent } from "../src/subagents.mjs";
import { buildTools } from "../src/tools.mjs";
import { createEventBus, createRunContext } from "../src/runtime/events.mjs";
import { parseArgs } from "../src/cli.mjs";
import { stageForTool } from "../src/theme.mjs";
import { toolSummary } from "../src/runtime/events.mjs";
import { composeHooks } from "../src/runtime/hooks.mjs";
const target = { provider: {}, model: "mock", apiKey: "SECRET_API_KEY" };
const tool = (name, mutating, run = () => "ok") => ({
  name,
  mutating,
  run,
  description: name,
  parameters: { type: "object", properties: {} },
});
const call = (name, args = {}) => ({ id: "call-1", name, args });
const fake = (responses) => async () => {
  if (!responses.length) throw new Error("Unexpected model request");
  return responses.shift();
};
const setup = () => {
  const bus = createEventBus();
  return { bus, context: createRunContext({ bus }) };
};

test("A01/A02: four bundled personas and user override preserve policy", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bitcode-personas-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const initial = loadAgents({ userDir: dir });
  assert.deepEqual(
    initial.map((a) => a.name),
    SAT_IDS,
  );
  await writeFile(
    path.join(dir, "script.md"),
    "---\ndescription: Custom\n---\nCustom persona\n",
  );
  const agents = loadAgents({ userDir: dir });
  assert.equal(agents[1].body, "Custom persona");
  assert.equal(agents[1].source, "user");
  assert.deepEqual(
    toolsForAgent("script", [
      tool("wallet_send", true),
      tool("edit_file", true),
    ]).map((t) => t.name),
    ["edit_file"],
  );
});
test("A03: custom persona supported; explicit unknown persona never falls back", async () => {
  const tools = [tool("read_file", false), tool("subagent", true)];
  const agents = [{ name: "custom", body: "CUSTOM", description: "" }];
  await assert.rejects(
    runSubagent({
      agent: "missing",
      prompt: "hi",
      agents,
      target,
      system: "base",
      tools,
    }),
    /Unknown agent/,
  );
  const result = await runSubagent({
    agent: "custom",
    prompt: "hi",
    agents,
    target,
    system: "base",
    tools,
    callModelImpl: async ({ system, tools }) => {
      assert.match(system, /CUSTOM/);
      assert.equal(
        tools.some((t) => t.name === "subagent"),
        false,
      );
      return { text: "custom result" };
    },
  });
  assert.equal(result, "custom result");
});
test("A04/A05: explicit policy excludes wallet, invoice creation and forged unknown tool calls", async () => {
  const available = [
    tool("read_file", false),
    tool("ln_invoice_create", false),
    tool("wallet_send", true),
    tool("write_file", true),
    tool("subagent", true),
  ];
  for (const id of ["node", "hash", "merkle"])
    assert.deepEqual(
      toolsForAgent(id, available).map((t) => t.name),
      ["read_file"],
    );
  let executed = 0;
  const { bus, context } = setup();
  await runAgent({
    target,
    system: "",
    messages: [],
    context,
    tools: [
      tool("read_file", false, () => {
        executed++;
      }),
    ],
    callModelImpl: fake([
      { toolCalls: [call("wallet_send")] },
      { text: "blocked" },
    ]),
  });
  assert.equal(executed, 0);
  assert.equal(
    bus.snapshot().activity.find((e) => e.type === "tool.finished").data
      .outcome,
    "unknown_tool",
  );
});
test("A06: requested / pending / denied are not execution or success", async () => {
  const { bus, context } = setup();
  let executed = 0;
  const messages = [];
  await runAgent({
    target,
    system: "",
    messages,
    context,
    tools: [
      tool("edit_file", true, () => {
        executed++;
      }),
    ],
    hooks: { approve: async () => false },
    callModelImpl: fake([
      { toolCalls: [call("edit_file", { path: "src/a.mjs" })] },
      { text: "Alternative" },
    ]),
  });
  const events = bus.snapshot().activity;
  assert.equal(executed, 0);
  assert.equal(
    events.some((e) => e.type === "tool.started"),
    false,
  );
  assert.equal(
    events.find((e) => e.type === "tool.finished").data.outcome,
    "denied",
  );
  assert.match(messages.find((m) => m.role === "tool").content, /denied/);
  assert.equal(events.filter((e) => e.type === "run.finished").length, 1);
});
test("approval callback failure denies; one-shot absence still explicitly auto-approves", async () => {
  for (const approve of [
    () => {
      throw new Error("failed");
    },
    undefined,
  ]) {
    let executed = 0;
    await runAgent({
      target,
      system: "",
      messages: [],
      tools: [
        tool("edit_file", true, () => {
          executed++;
          return "ok";
        }),
      ],
      hooks: { approve },
      callModelImpl: fake([
        { toolCalls: [call("edit_file")] },
        { text: "done" },
      ]),
    });
    assert.equal(executed, approve ? 0 : 1);
  }
});
test("A07/A08: autonomous child inherits approval, has fresh history, parent gets final answer only", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bitcode-delegate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, "never-written.txt"),
    agents = loadAgents({ userDir: dir });
  const { bus, context } = setup();
  const tools = buildTools(
    {},
    { modelRef: { current: target }, agents, system: "base" },
  );
  let n = 0,
    approvals = 0,
    usageRounds = 0;
  const model = async ({ messages, tools }) => {
    n++;
    if (n === 1)
      return {
        toolCalls: [
          call("subagent", { agent: "script", prompt: "child task" }),
        ],
      };
    if (n === 2) {
      assert.deepEqual(messages, [{ role: "user", content: "child task" }]);
      assert.equal(
        tools.some((t) => t.name === "subagent"),
        false,
      );
      return {
        toolCalls: [call("write_file", { path: destination, content: "no" })],
      };
    }
    if (n === 3) return { text: "child final" };
    assert.equal(messages.at(-1).content, "child final");
    return { text: "parent final" };
  };
  const result = await runAgent({
    target,
    system: "base",
    messages: [{ role: "user", content: "parent" }],
    tools,
    context,
    hooks: {
      onUsage: () => usageRounds++,
      approve: (tc) => {
        approvals++;
        return tc.name === "subagent";
      },
    },
    callModelImpl: async req => ({ ...await model(req), usage: { input_tokens: 1, output_tokens: 2 } }),
  });
  assert.equal(result, "parent final");
  assert.equal(approvals, 2);
  assert.equal(usageRounds, 4);
  await assert.rejects(access(destination));
  const runs = Object.values(bus.snapshot().runs);
  assert.equal(runs.length, 2);
  assert.equal(
    runs.find((r) => r.agentId === "script").parentRunId,
    context.runId,
  );
});
test("manual child policy / gate matches autonomous child; recursion blocked", async () => {
  let changed = 0,
    approved = 0;
  const agents = loadAgents({ userDir: "/not-present" });
  await runSubagent({
    agent: "script",
    prompt: "change",
    agents,
    target,
    system: "",
    tools: [
      tool("edit_file", true, () => {
        changed++;
        return "ok";
      }),
    ],
    approve: () => {
      approved++;
      return true;
    },
    callModelImpl: fake([{ toolCalls: [call("edit_file")] }, { text: "done" }]),
  });
  assert.equal(changed, 1);
  assert.equal(approved, 1);
  await assert.rejects(
    runSubagent({
      agent: "script",
      prompt: "x",
      agents,
      target,
      tools: [],
      parentContext: { depth: 1 },
    }),
    /Recursive/,
  );
});
test("A09: recoverable tool error does not terminate run", async () => {
  const { bus, context } = setup();
  await runAgent({
    target,
    system: "",
    messages: [],
    context,
    tools: [
      tool("read_file", false, () => {
        throw new Error("fail");
      }),
    ],
    callModelImpl: fake([
      { toolCalls: [call("read_file")] },
      { text: "recovered" },
    ]),
  });
  const s = bus.snapshot();
  assert.equal(s.runs[context.runId].state, "success");
  assert.equal(s.runs[context.runId].warnings, 1);
  assert.equal(s.activity.filter((e) => e.type === "run.finished").length, 1);
});
test("A10: max steps and provider error produce exactly one non-success outcome", async () => {
  for (const failure of [false, true]) {
    const { bus, context } = setup();
    const args = {
      target,
      system: "",
      messages: [],
      context,
      tools: [tool("read_file", false)],
      callModelImpl: async () => {
        if (failure) throw new Error("SECRET_ENDPOINT");
        return { toolCalls: [call("read_file")] };
      },
    };
    if (failure) await assert.rejects(runAgent(args));
    else assert.match(await runAgent(args), /50 steps/);
    assert.equal(bus.snapshot().runs[context.runId].state, "error");
    assert.equal(
      bus.snapshot().activity.filter((e) => e.type === "run.finished").length,
      1,
    );
    assert.equal(
      JSON.stringify(bus.snapshot()).includes("SECRET_ENDPOINT"),
      false,
    );
  }
});
test("A11/A14: observer exception and sensitive args/results cannot affect execution or leak", async () => {
  const { bus, context } = setup();
  bus.subscribe(() => {
    throw new Error("observer");
  });
  bus.subscribe(async () => {
    throw new Error("async observer");
  });
  let count = 0;
  await runAgent({
    target,
    system: "SECRET_SYSTEM",
    messages: [],
    context,
    tools: [
      tool("bash", true, () => {
        count++;
        return "SECRET_RESULT <script>alert(1)</script>";
      }),
    ],
    hooks: { approve: () => true },
    callModelImpl: fake([
      {
        text: "SECRET_ASSISTANT",
        toolCalls: [call("bash", { command: "SECRET_COMMAND" })],
      },
      { text: "SECRET_FINAL" },
    ]),
  });
  assert.equal(count, 1);
  const serialized = JSON.stringify(bus.snapshot());
  assert.equal(serialized.includes("SECRET_"), false);
  assert.equal(serialized.includes("<script>"), false);
});
test("A12/A15: bounded replay and snapshots; slow subscribers are isolated", () => {
  const bus = createEventBus({ bufferSize: 5 }),
    context = createRunContext({ bus });
  for (let i = 0; i < 10; i++) bus.emit(context, "model.started");
  assert.equal(bus.replay(1), null);
  assert.equal(bus.replay(8).length, 2);
  assert.equal(bus.replay(99), null);
  const snapshot = bus.snapshot();
  snapshot.seq = 0;
  assert.equal(bus.snapshot().seq, 10);
  for (let i = 0; i < 60; i++) {
    const c = createRunContext({ bus, agentId: "custom-" + i });
    bus.emit(c, "run.started");
    bus.emit(c, "run.finished", { outcome: "ok" });
  }
  assert.ok(Object.keys(bus.snapshot().runs).length <= 40);
  assert.equal(bus.snapshot().activity.length, 100);
});
test("concurrent root rejected; cancellation preserves valid tool history and releases lock", async () => {
  const { bus, context } = setup(),
    abort = new AbortController();
  context.signal = abort.signal;
  let resolveApproval;
  const messages = [];
  const pending = runAgent({
    target,
    system: "",
    messages,
    tools: [tool("edit_file", true)],
    context,
    hooks: { approve: () => new Promise((r) => (resolveApproval = r)) },
    callModelImpl: fake([
      {
        toolCalls: [call("edit_file"), { ...call("edit_file"), id: "second" }],
      },
    ]),
  });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(
    runAgent({
      target,
      system: "",
      messages: [],
      tools: [],
      context: createRunContext({ bus }),
      callModelImpl: fake([{ text: "never" }]),
    }),
    /already active/,
  );
  abort.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(pending);
  assert.equal(messages.filter((m) => m.role === "tool").length, 2);
  assert.equal(bus.busy, false);
  assert.equal(bus.snapshot().runs[context.runId].state, "cancelled");
  resolveApproval(false);
});
test("CLI flags preserve default and reject ambiguous modes", () => {
  assert.equal(parseArgs([]).sats, false);
  assert.equal(parseArgs(["--sats"]).sats, true);
  assert.throws(() => parseArgs(["--sats", "-p", "x"]), /interactive/);
  assert.throws(() => parseArgs(["--sats-control"]), /unknown option/);
  assert.throws(() => parseArgs(["--no-session", "--resume"]), /cannot be combined/);
});

test("parallel read completion preserves the remaining active tool state", async () => {
  const { bus, context } = setup();
  let finishA, finishB;
  const running = runAgent({ target, messages: [], context,
    tools: [tool("read_file", false, () => new Promise(resolve => { if (!finishA) finishA = resolve; else finishB = resolve; }))],
    callModelImpl: fake([{ toolCalls: [call("read_file"), { ...call("read_file"), id: "second" }] }, { text: "done" }]),
  });
  await new Promise(resolve => setImmediate(resolve));
  finishA("one"); await new Promise(resolve => setImmediate(resolve));
  const active = bus.snapshot().runs[context.runId];
  assert.equal(active.state, "reading");
  assert.equal(Object.keys(active.tools).length, 1);
  finishB("two"); assert.equal(await running, "done");
});

test("a bus allows one authorized child and rejects forged/concurrent parent contexts", () => {
  const bus = createEventBus(), root = createRunContext({ bus }); bus.enter(root);
  const child = createRunContext({ bus, depth: 1, parentRunId: root.runId }); bus.enter(child);
  assert.throws(() => bus.enter(createRunContext({ bus, depth: 1, parentRunId: root.runId })), /already active/);
  assert.throws(() => bus.enter(createRunContext({ bus, depth: 1, parentRunId: "forged" })), /active parent/);
  bus.leave(child); bus.leave(root); assert.equal(bus.busy, false);
});

test("shared stages, safe external-file summaries and isolated async observers", async () => {
  for (const name of ["read_file", "edit_file", "bash", "exec_command", "ln_balance", "btc_tx", "subagent"]) {
    const stage = stageForTool(name).name;
    assert.equal(toolSummary({ name }).stage, stage === "querying" ? "running" : stage);
  }
  assert.equal(toolSummary({ name: "read_file", args: { path: "/outside/SECRET" } }, "/tmp/project").summary, "read_file · file esterno al progetto");
  const order = [];
  const hooks = composeHooks({ approve: () => false, onCheckpoint: async () => { await new Promise(r => setImmediate(r)); order.push("primary"); } },
    { approve: () => true, onCheckpoint: () => { order.push("observer"); throw new Error("observer"); } });
  await hooks.onCheckpoint(); assert.deepEqual(order, ["primary", "observer"]); assert.equal(hooks.approve(), false);
});

test("read-only schema excludes invoice creation and delegation regardless of adapter labels", async () => {
  let calls = 0;
  await runAgent({ target, messages: [], tools: [tool("ln_invoice_create", false, () => calls++), tool("subagent", false, () => calls++)], readOnly: true,
    callModelImpl: fake([{ toolCalls: [call("ln_invoice_create")] }, { text: "denied" }]),
  });
  assert.equal(calls, 0);
});
