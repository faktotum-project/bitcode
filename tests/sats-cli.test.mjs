import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { startCliFixture, until } from "../scripts/sats/fixture.mjs";

test("Sats CLI: opt-in observer, manual gate, policies, session isolation and shutdown", async t => {
  const f = await startCliFixture(); t.after(() => f.close());
  await f.ready();
  const url = new URL(await f.panelUrl());
  const attached = await fetch(url.origin + "/api/attach", { method: "POST", headers: { Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ token: url.hash.slice(7) }) });
  const headers = { Cookie: attached.headers.get("set-cookie").split(";")[0] };
  const snapshot = async () => (await (await fetch(url.origin + "/api/bootstrap", { headers })).json()).snapshot;
  f.send("/subagent"); await until(() => f.stdout().includes("merkle"));
  assert.equal(f.requests.length, 0);
  f.send("/subagent missing task"); await until(() => f.stdout().includes("unknown agent"));
  assert.equal(f.requests.length, 0);
  f.send("/subagent script change"); await until(() => f.stdout().includes("approve write_file"));
  let state = await snapshot();
  const script = Object.values(state.runs).find(r => r.agentId === "script");
  assert.equal(script.state, "awaiting_approval");
  assert.equal(state.activity.some(e => e.type === "tool.started"), false);
  assert.deepEqual(f.requests[0].tools.map(t => t.function.name).sort(), ["bash", "edit_file", "list_dir", "read_file", "write_file"].sort());
  f.send("n"); await until(() => f.stdout().includes("— done —"));
  await assert.rejects(access(path.join(f.cwd, "example.txt")));
  state = await snapshot();
  assert.equal(state.activity.find(e => e.type === "tool.finished").data.outcome, "denied");
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_|<img/);
  await assert.rejects(access(path.join(f.home, "sessions")));
  assert.doesNotMatch(f.stdout(), /\x1b\[/);
  f.send("/exit"); assert.equal(await f.exited(), 0);
  await assert.rejects(fetch(url.origin));
});

test("Sats CLI: no flag adds no URL; auto delegation is silent and policies match manual delegation", async t => {
  const f = await startCliFixture({ args: ["--no-session"] }); t.after(() => f.close());
  await f.ready(); f.send("delegate");
  await until(() => f.stdout().includes("approve subagent")); f.send("y");
  await until(() => f.requests.length === 4 && f.stdout().includes("PRIVATE_FINAL_RESULT"));
  assert.doesNotMatch(f.stdout(), /#token=|Sats · apri/);
  assert.deepEqual(f.requests[1].messages.filter(m => m.role === "user"), [{ role: "user", content: "read" }]);
  assert.deepEqual(f.requests[1].tools.map(t => t.function.name).sort(), ["list_dir", "read_file"]);
  // The parent shows the returned tool result and streams its final answer.
  // Child deltas and its read_file trace never stream into the parent output.
  assert.equal(f.stdout().split("PRIVATE_FINAL_RESULT").length - 1, 2);
  assert.doesNotMatch(f.stdout(), /\[READING\]|PRIVATE_FILE_CONTENT/);
  f.send("/exit"); assert.equal(await f.exited(), 0);
});

test("Sats CLI: interrupting an approval clears the pending input and allows a new task", async t => {
  const f = await startCliFixture(); t.after(() => f.close());
  await f.ready(); f.send("/subagent script change");
  await until(() => f.stdout().includes("approve write_file"));
  f.child.kill("SIGINT"); await until(() => f.stdout().includes("cancelled by user"));
  f.send("/subagent node read"); await until(() => f.requests.length === 3);
  await until(() => f.stdout().includes("PRIVATE_FINAL_RESULT"));
  await assert.rejects(access(path.join(f.cwd, "example.txt")));
  f.send("/exit"); assert.equal(await f.exited(), 0);
});

test("Sats CLI: resume/reset preserves parent history and completed companions do not resume", async t => {
  const f = await startCliFixture({ args: [] }); t.after(() => f.close());
  await f.ready(); f.send("hello"); await until(() => f.stdout().includes("PRIVATE_FINAL_RESULT"));
  f.send("/exit"); assert.equal(await f.exited(), 0);
  const dirs = await readdir(path.join(f.home, "sessions"));
  const names = await readdir(path.join(f.home, "sessions", dirs[0]));
  const saved = JSON.parse(await readFile(path.join(f.home, "sessions", dirs[0], names[0]), "utf8"));
  const resumed = await startCliFixture({ cwd: f.cwd, home: f.home, args: ["--sats", "--resume", saved.id] });
  t.after(() => resumed.close()); await resumed.ready();
  assert.match(resumed.stdout(), /resumed/);
  const url = new URL(await resumed.panelUrl());
  const attach = await fetch(url.origin + "/api/attach", { method: "POST", headers: { Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ token: url.hash.slice(7) }) });
  const bootstrap = await (await fetch(url.origin + "/api/bootstrap", { headers: { Cookie: attach.headers.get("set-cookie").split(";")[0] } })).json();
  assert.deepEqual(bootstrap.snapshot.runs, {});
  resumed.send("/reset"); await until(() => resumed.stdout().includes("history cleared"));
  resumed.send("fresh"); await until(() => resumed.requests.length === 1);
  assert.equal(resumed.requests[0].messages.filter(m => m.role === "user").length, 1);
  resumed.send("/exit"); assert.equal(await resumed.exited(), 0);
});
