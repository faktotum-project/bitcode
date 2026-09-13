import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requiresPaymentApproval, handleSlash } from "../src/cli.mjs";
import { compactContext, contextPrompt, loadSkills } from "../src/context.mjs";
import { buildTools } from "../src/tools.mjs";

const run = promisify(execFile);
const entry = fileURLToPath(new URL("../bitcode.mjs", import.meta.url));

test("CLI parsing handles flags, literal arguments and rejects typos", () => {
  assert.equal(parseArgs(["--cwd", "/tmp", "--read-only", "-p", "hello"]).readOnly, true);
  assert.equal(parseArgs(["--", "--literal"]).prompt, "--literal");
  assert.equal(parseArgs(["fix", "models", "please"]).prompt, "fix models please");
  assert.deepEqual(parseArgs(["provider", "health"]).commandArgs, ["health"]);
  for (const args of [["--oops"], ["--model"], ["--print"], ["--max-steps", "1.5"], ["--json"]]) assert.throws(() => parseArgs(args));
});
test("financial approval requirements are independent of --yolo", () => {
  assert.equal(requiresPaymentApproval({ name: "wallet_send" }), true);
  assert.equal(requiresPaymentApproval({ name: "custom_pay", financial: true }), true);
  assert.equal(requiresPaymentApproval({ name: "read_file" }), false);
});

test("CLI help, version and tool catalog work offline and exit cleanly", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bc-cli-"));
  const env = { ...process.env, BITCODE_HOME: dir, NO_COLOR: "1" };
  for (const args of [["--help"], ["--version"], ["tools", "--json"], ["doctor", "--json"]]) {
    const { stdout } = await run(process.execPath, [entry, ...args], { env, timeout: 5000 });
    assert.doesNotMatch(stdout, /undefined/);
    if (args.includes("--json")) assert.doesNotThrow(() => JSON.parse(stdout));
  }
});

async function modelServer(t, respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const output = respond(requests.at(-1), requests.length);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output, usage: { input_tokens: 5, output_tokens: 3 } } })}\n\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests };
}
const answer = text => [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }];

test("CLI one-shot Responses executes a real file tool, saves and resumes the transcript", async t => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "bc-e2e-"));
  const home = path.join(cwd, "state"); mkdirSync(home);
  writeFileSync(path.join(cwd, "note.txt"), "verified file content");
  const { url, requests } = await modelServer(t, (_request, round) => round === 1 ? [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: '{"path":"note.txt"}' }] : answer("done"));
  writeFileSync(path.join(home, "config.json"), JSON.stringify({ model: "mock/model", providers: { mock: { api: "responses", baseURL: url } } }));
  const env = { ...process.env, BITCODE_HOME: home, BITCODE_MODEL: "", NO_COLOR: "1" };
  const result = await run(process.execPath, [entry, "--cwd", cwd, "--json", "--read-only", "-p", "read note.txt"], { env, timeout: 10000 });
  const json = JSON.parse(result.stdout);
  assert.equal(json.answer, "done"); assert.equal(json.events[0].result, "verified file content"); assert.equal(json.usage.input_tokens, 10);
  assert.ok(!requests[0].tools.some(t => t.name === "write_file"));
  const resumed = await run(process.execPath, [entry, "--cwd", cwd, "--json", "--resume", json.session_id, "-p", "continue"], { env, timeout: 10000 });
  assert.equal(JSON.parse(resumed.stdout).session_id, json.session_id);
  assert.ok(requests.at(-1).input.some(x => x.type === "function_call_output" && x.output === "verified file content"));
  const dirs = readdirSync(path.join(home, "sessions"));
  const saved = JSON.parse(readFileSync(path.join(home, "sessions", dirs[0], `${json.session_id}.json`), "utf8"));
  assert.equal(saved.messages.at(-1).content, "done");
});

test("CLI one-shot refuses financial tool execution and returns rejection to the model", async t => {
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-money-"));
  const { url, requests } = await modelServer(t, (_r, round) => round === 1 ? [{ type: "function_call", id: "fc_1", call_id: "c1", name: "wallet_send", arguments: '{"to":"test","amount_sats":100}' }] : answer("approval required"));
  writeFileSync(path.join(home, "config.json"), JSON.stringify({ model: "mock/m", providers: { mock: { api: "responses", baseURL: url } } }));
  const { stdout } = await run(process.execPath, [entry, "--json", "--yolo", "-p", "send"], { env: { ...process.env, BITCODE_HOME: home, BITCODE_MODEL: "" }, timeout: 10000 });
  assert.match(JSON.parse(stdout).events[0].result, /denied/);
  assert.match(requests[1].input.find(x => x.type === "function_call_output").output, /denied/);
});

test("project instructions and skills load without executing skill contents", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "bc-context-"));
  mkdirSync(path.join(cwd, ".bitcode", "skills", "review"), { recursive: true });
  writeFileSync(path.join(cwd, "AGENTS.md"), "Use local conventions.");
  writeFileSync(path.join(cwd, ".bitcode", "skills", "review", "SKILL.md"), "---\ndescription: Review code\n---\nRead before acting.");
  const skills = loadSkills(cwd);
  assert.ok(skills.some(s => s.name === "review"));
  assert.match(contextPrompt(cwd, skills), /Use local conventions/);
  assert.match(contextPrompt(cwd, skills), /review: Review code/);
  assert.doesNotMatch(contextPrompt(cwd, skills), /Read before acting/);
});

test("compaction keeps recent tool pairs intact and requests no tools", async t => {
  const { url, requests } = await modelServer(t, () => answer("task summary"));
  const messages = [
    { role: "user", content: "old" }, { role: "assistant", content: "old answer" },
    { role: "user", content: "recent" }, { role: "assistant", content: "", toolCalls: [{ id: "c", name: "read", args: {} }] }, { role: "tool", toolCallId: "c", content: "ok" },
    { role: "user", content: "latest" },
  ];
  const tail = structuredClone(messages.slice(2));
  assert.equal(await compactContext({ messages, target: { provider: { api: "responses", baseURL: url }, model: "m" } }), true);
  assert.deepEqual(messages.slice(1), tail); assert.match(messages[0].content, /task summary/); assert.deepEqual(requests[0].tools, []);
});

test("subagents inherit approvals and shared tool budgets", async t => {
  const { url } = await modelServer(t, (_r, n) => n === 1 ? [{ type: "function_call", id: "fc", call_id: "c", name: "write_file", arguments: '{"path":"never.txt","content":"bad"}' }] : answer("denied"));
  const target = { provider: { api: "responses", baseURL: url }, model: "m" };
  const tools = buildTools({}, { modelRef: { current: target }, agents: [], system: "s" });
  let approvals = 0;
  const state = { totalToolCalls: 3 };
  const result = await tools.find(t => t.name === "subagent").run({ prompt: "write" }, { state, hooks: { approve: () => { approvals++; return false; } } });
  assert.equal(result, "denied"); assert.equal(approvals, 1); assert.equal(state.totalToolCalls, 4);
});

test("/plan excludes writes and /build restores ordinary approval gates", async t => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "bc-plan-"));
  const prior = process.env.BITCODE_HOME;
  process.env.BITCODE_HOME = path.join(cwd, "state");
  t.after(() => { if (prior === undefined) delete process.env.BITCODE_HOME; else process.env.BITCODE_HOME = prior; });
  const destination = path.join(cwd, "must-not-exist.txt");
  const { url, requests } = await modelServer(t, (_r, round) => round % 2 === 1 ? [{ type: "function_call", id: `fc_${round}`, call_id: `c_${round}`, name: "write_file", arguments: JSON.stringify({ path: destination, content: "bad" }) }] : answer("Investigate then implement and verify."));
  const target = { provider: { api: "responses", baseURL: url }, model: "m" };
  let approvals = 0;
  const ctx = { cwd, config: {}, network: "signet", system: "s", tools: buildTools(), messages: [], getActive: () => target, approve: () => { approvals++; return false; }, ask: async () => "", readOnly: false };
  await handleSlash("/plan inspect the project", ctx);
  assert.equal(approvals, 0); assert.equal(existsSync(destination), false);
  assert.equal(requests[0].tools.some(t => t.name === "write_file"), false);
  await handleSlash("/build", ctx);
  assert.equal(approvals, 1); assert.equal(existsSync(destination), false);
  assert.equal(requests[2].tools.some(t => t.name === "write_file"), true);
});

test("CLI SIGINT cancels a running shell and saves a paired result", async t => {
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-cancel-"));
  let child;
  const { url } = await modelServer(t, () => {
    setTimeout(() => child.kill("SIGINT"), 100);
    return [{ type: "function_call", id: "fc", call_id: "c", name: "bash", arguments: '{"command":"sleep 30"}' }];
  });
  writeFileSync(path.join(home, "config.json"), JSON.stringify({ model: "mock/m", providers: { mock: { api: "responses", baseURL: url } } }));
  const result = await new Promise(resolve => {
    child = execFile(process.execPath, [entry, "--json", "-p", "wait"], { env: { ...process.env, BITCODE_HOME: home, BITCODE_MODEL: "" }, timeout: 5000 }, (error, stdout) => resolve({ error, stdout }));
  });
  assert.equal(result.error.code, 1);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "error"); assert.match(json.events[0].result, /cancelled/);
  const directory = readdirSync(path.join(home, "sessions"))[0];
  const session = JSON.parse(readFileSync(path.join(home, "sessions", directory, `${json.session_id}.json`), "utf8"));
  assert.equal(session.messages.at(-1).role, "tool"); assert.equal(session.messages.at(-1).toolCallId, "c");
});
