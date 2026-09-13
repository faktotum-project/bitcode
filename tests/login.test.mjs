import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { parseArgs } from "../src/cli.mjs";

const entry = fileURLToPath(new URL("../bitcode.mjs", import.meta.url));
function setup(t, config) {
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-login-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  if (config) writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
  return home;
}
function cli(home, args, input = "", extraEnv = {}) {
  return new Promise(resolve => {
    const child = execFile(process.execPath, [entry, ...args], {
      env: { ...process.env, BITCODE_HOME: home, BITCODE_MODEL: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", NO_COLOR: "1", ...extraEnv },
      timeout: 8000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

test("login is a CLI command and rejects secrets in extra arguments and JSON mode", () => {
  assert.equal(parseArgs(["login"]).command, "login");
  assert.deepEqual(parseArgs(["login", "openai"]).commandArgs, ["openai"]);
  assert.equal(parseArgs(["--", "login"]).prompt, "login");
  for (const args of [["login", "openai", "private-key"], ["login", "--json"], ["login", "-p", "private-key"]]) {
    assert.throws(() => parseArgs(args), /usage: bitcode login/);
  }
});

test("login saves a trimmed key privately, preserves config and skips extensions", async t => {
  const config = { model: "ollama/custom", bitcoin: { network: "signet" }, providers: { openai: { maxOutputTokens: 123 }, anthropic: { apiKey: "existing-key" } } };
  const home = setup(t, config);
  mkdirSync(path.join(home, "plugins"));
  writeFileSync(path.join(home, "plugins", "must-not-load.mjs"), "throw new Error('login loaded a plugin');");
  const result = await cli(home, ["login", "openai"], "  private-test-key  \n");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /saved key for openai/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-key|existing-key|loaded a plugin/);
  const file = path.join(home, "config.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    ...config, providers: { ...config.providers, openai: { maxOutputTokens: 123, apiKey: "private-test-key" } },
  });
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(existsSync(path.join(home, "history")), false);
  assert.equal(existsSync(path.join(home, "sessions")), false);
});

test("bare login accepts a numbered selection and a configured custom provider", async t => {
  const home = setup(t, { providers: { custom: { api: "openai", baseURL: "http://127.0.0.1:1/v1", defaultModel: "test" } } });
  for (const [choice, name] of [["2", "openai"], ["custom", "custom"]]) {
    const result = await cli(home, ["login"], `${choice}\nprivate-picker-key\n`);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`saved key for ${name}`));
    assert.doesNotMatch(result.stdout + result.stderr, /private-picker-key/);
    assert.equal(JSON.parse(readFileSync(path.join(home, "config.json"))).providers[name].apiKey, "private-picker-key");
  }
});

test("cancelled input, EOF, unknown providers and invalid selections never change config", async t => {
  const home = setup(t, { providers: { openai: { apiKey: "keep-this-key" } } });
  const file = path.join(home, "config.json");
  const before = readFileSync(file, "utf8");
  for (const [args, input] of [
    [["login"], "\n"], [["login"], ""], [["login", "openai"], "  \n"], [["login", "openai"], ""],
    [["login", "missing"], ""], [["login", "constructor"], ""], [["login", "__proto__"], ""],
    [["login"], "999\n"], [["login"], "missing\n"],
  ]) {
    const result = await cli(home, args, input);
    assert.equal(result.code, 1, `${args}: ${result.stderr}`);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.doesNotMatch(result.stdout + result.stderr, /keep-this-key/);
  }
});

test("Ollama login succeeds without a key or new config", async t => {
  const home = setup(t);
  const result = await cli(home, ["login", "ollama"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /no login required/);
  assert.equal(existsSync(path.join(home, "config.json")), false);
});

test("login reports environment precedence without exposing either credential", async t => {
  const home = setup(t);
  const result = await cli(home, ["login", "openai"], "private-saved-key\n", { OPENAI_API_KEY: "private-env-key" });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /OPENAI_API_KEY is set and takes precedence/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-saved-key|private-env-key/);
});

test("slash login refreshes the active credential and keeps the key out of history and sessions", async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume request */ }
    requests.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "login works" }] }] } })}\n\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const home = setup(t, { model: "custom/test", providers: { custom: { api: "responses", baseURL: `http://127.0.0.1:${server.address().port}/v1` } } });
  const result = await cli(home, [], "/login custom\nprivate-interactive-key\nhello\n/exit\n");
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests, ["Bearer private-interactive-key"]);
  assert.doesNotMatch(result.stdout + result.stderr, /private-interactive-key/);
  assert.doesNotMatch(readFileSync(path.join(home, "history"), "utf8"), /private-interactive-key/);
  const sessions = path.join(home, "sessions");
  const files = readdirSync(sessions, { recursive: true }).filter(file => file.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) assert.doesNotMatch(readFileSync(path.join(sessions, file), "utf8"), /private-interactive-key/);
});
