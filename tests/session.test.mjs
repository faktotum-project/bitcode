import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import path from "node:path";

const { saveSession, loadSession, listSessions, exportSession, newSessionId } = await import(
  "../src/session.mjs"
);

const cwd = mkdtempSync(path.join(os.tmpdir(), "bc-sess-"));

const messages = [
  { role: "user", content: "quanto sono le fee?" },
  { role: "assistant", content: "controllo", toolCalls: [{ id: "t1", name: "btc_fees", args: { n: "signet" } }] },
  { role: "tool", toolCallId: "t1", name: "btc_fees", content: "fast: 3 sat/vB" },
  { role: "assistant", content: "~3 sat/vB." },
];

test("save/load round-trips messages and metadata", () => {
  const id = newSessionId();
  saveSession(cwd, { id, model: "ollama/x", network: "signet", messages, name: "fees" });
  const back = loadSession(cwd, id);
  assert.equal(back.messages.length, 4);
  assert.equal(back.name, "fees");
  assert.equal(back.model, "ollama/x");
});

test("listSessions reports message counts, newest first", () => {
  const id2 = newSessionId();
  saveSession(cwd, { id: id2, model: "ollama/y", network: "signet", messages: messages.slice(0, 2) });
  const list = listSessions(cwd);
  assert.ok(list.length >= 2);
  assert.equal(list[0].id, id2); // most recent
  assert.equal(list[0].messageCount, 2);
});

test("exportSession renders markdown and json", () => {
  const id = newSessionId();
  saveSession(cwd, { id, model: "ollama/x", network: "signet", messages, name: "demo" });
  const md = exportSession(cwd, id, "md");
  assert.match(md, /## user/);
  assert.match(md, /btc_fees/);
  const json = JSON.parse(exportSession(cwd, id, "json"));
  assert.equal(json.messages.length, 4);
});
