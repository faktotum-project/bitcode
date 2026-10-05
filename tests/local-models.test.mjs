import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ollamaBaseURL, allProviders, resolveModel } from "../src/config.mjs";
import { discoverLocalModels, isLocalProvider, listLocalModels, pickLocalModel } from "../src/local-models.mjs";
import { callModel } from "../src/providers.mjs";
import { handleSlash } from "../src/cli.mjs";

const entry = fileURLToPath(new URL("../bitcode.mjs", import.meta.url));

function cli(args, env, input = "") {
  return new Promise(resolve => {
    const child = execFile(process.execPath, [entry, ...args], { env, timeout: 10000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    child.stdin.end(input);
  });
}

// A fake Ollama: native /api/tags, OpenAI-compatible /v1/models and a streamed
// /v1/chat/completions that 404s for models that were never pulled.
async function fakeOllama(t, installed) {
  const chats = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: installed.map(name => ({ name, model: name, size: 5e9, details: { parameter_size: "8B", quantization_level: "Q4_K_M" } })) }));
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: installed.map(id => ({ id })) }));
    }
    if (req.url === "/v1/chat/completions") {
      const { model } = JSON.parse(body);
      chats.push(model);
      if (!installed.includes(model)) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: `model '${model}' not found` } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `hi from ${model}` } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { host: `127.0.0.1:${server.address().port}`, chats };
}

function withEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  t.after(() => { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); });
}

test("OLLAMA_HOST follows Ollama's host conventions", () => {
  assert.equal(ollamaBaseURL(""), "http://127.0.0.1:11434/v1");
  assert.equal(ollamaBaseURL("0.0.0.0"), "http://127.0.0.1:11434/v1");
  assert.equal(ollamaBaseURL("gpu-box:11500"), "http://gpu-box:11500/v1");
  assert.equal(ollamaBaseURL("https://ollama.example.com/v1/"), "https://ollama.example.com/v1");
});

test("local providers are detected without treating keyed or remote ones as local", () => {
  assert.equal(isLocalProvider({ api: "openai", baseURL: "http://localhost:8080/v1" }), true);
  assert.equal(isLocalProvider({ api: "openai", baseURL: "http://gpu-box:8080/v1", local: true }), true);
  assert.equal(isLocalProvider({ api: "openai", baseURL: "http://localhost:8080/v1", apiKey: "k" }), false);
  assert.equal(isLocalProvider({ api: "openai", baseURL: "https://openrouter.ai/api/v1", keyEnv: "X" }), false);
  assert.equal(isLocalProvider(allProviders({}).anthropic), false);
});

test("discovery lists exactly the models installed on this machine's servers", async t => {
  const { host } = await fakeOllama(t, ["qwen3:8b", "llama3.2:3b"]);
  withEnv(t, { OLLAMA_HOST: host });
  const ollama = await listLocalModels("ollama", allProviders({}).ollama);
  assert.equal(ollama.running, true);
  assert.deepEqual(ollama.models.map(m => m.id), ["qwen3:8b", "llama3.2:3b"]);
  assert.equal(ollama.models[0].parameterSize, "8B");

  // Any OpenAI-compatible local server (llama.cpp, vLLM, LM Studio) via /v1/models.
  const generic = await listLocalModels("llamacpp", { api: "openai", baseURL: `http://${host}/v1` });
  assert.deepEqual(generic.models.map(m => m.id), ["qwen3:8b", "llama3.2:3b"]);

  const offline = await listLocalModels("ollama", { api: "openai", baseURL: "http://127.0.0.1:9/v1" });
  assert.equal(offline.running, false);
  assert.deepEqual(offline.models, []);

  const discovered = await discoverLocalModels({ providers: { lmstudio: { baseURL: "http://127.0.0.1:9/v1" } } });
  assert.equal(pickLocalModel(discovered), "ollama/qwen3:8b");
});

test("/models lists installed local models, switches and saves the choice", async t => {
  const { host } = await fakeOllama(t, ["qwen3:8b", "llama3.2:3b"]);
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-models-"));
  withEnv(t, { OLLAMA_HOST: host, BITCODE_HOME: home, BITCODE_MODEL: undefined, NO_COLOR: "1" });
  const config = {};
  let active = resolveModel({ config });
  const printed = [];
  const write = process.stdout.write;
  process.stdout.write = s => { printed.push(String(s)); return true; };
  try {
    await handleSlash("/models", {
      config,
      getActive: () => active,
      setActive: next => { active = next; },
      ask: async () => {
        const line = printed.join("").split("\n").find(l => l.includes("ollama/llama3.2:3b"));
        return line.trim().split(/\s+/)[0];
      },
    });
  } finally {
    process.stdout.write = write;
  }
  assert.match(printed.join(""), /ollama\/qwen3:8b/);
  // Numbered rows are the selectable entries; models found on disk but not
  // served by any server are listed below without a number.
  const selectable = printed.join("").split("\n").filter(l => /^\s+\d+\s/.test(l)).join("\n");
  assert.doesNotMatch(selectable, /gpt-oss/, "only really installed models are offered");
  assert.equal(active.spec, "ollama/llama3.2:3b");
  assert.equal(JSON.parse(readFileSync(path.join(home, "config.json"), "utf8")).model, "ollama/llama3.2:3b");
});

test("a model that is not installed fails with an actionable message", async t => {
  const { host } = await fakeOllama(t, ["qwen3:8b"]);
  withEnv(t, { OLLAMA_HOST: host });
  const target = resolveModel({ cliModel: "ollama/gpt-oss:20b", config: {} });
  await assert.rejects(callModel({ ...target, system: "", messages: [{ role: "user", content: "hi" }] }), /not installed.*ollama pull gpt-oss:20b/s);
});

test("with no model or API key configured, startup uses an installed local model", async t => {
  const { host, chats } = await fakeOllama(t, ["qwen3:8b"]);
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-auto-"));
  writeFileSync(path.join(home, "config.json"), "{}");
  const env = { ...process.env, BITCODE_HOME: home, OLLAMA_HOST: host, NO_COLOR: "1", BITCODE_MODEL: "", ANTHROPIC_API_KEY: "" };
  const result = await new Promise(resolve => execFile(process.execPath, [entry, "--json", "-p", "hello"], { env, timeout: 10000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null, result.stderr);
  assert.match(result.stderr, /using local ollama\/qwen3:8b/);
  assert.equal(JSON.parse(result.stdout).answer, "hi from qwen3:8b");
  assert.deepEqual(chats, ["qwen3:8b"]);
});

test("explicitly local servers receive saved credentials and environment overrides during discovery", async t => {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push(req.headers.authorization);
    if (!req.headers.authorization) { res.writeHead(401); return res.end(); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/api/tags" ? { models: [{ name: "private-model" }] } : { data: [{ id: "private-model" }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const provider = { api: "openai", local: true, baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "saved-test-key", keyEnv: "BITCODE_TEST_LOCAL_KEY" };
  withEnv(t, { BITCODE_TEST_LOCAL_KEY: undefined });
  assert.equal((await listLocalModels("private", provider)).models[0].id, "private-model");
  process.env.BITCODE_TEST_LOCAL_KEY = "env-test-key";
  assert.equal((await listLocalModels("ollama", provider)).models[0].id, "private-model");
  assert.deepEqual(received, ["Bearer saved-test-key", "Bearer env-test-key"]);
});

test("discovery distinguishes empty servers, supports the compatible fallback and bounds slow probes", async t => {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    if (req.url === "/slow/models") return;
    if (req.url === "/api/tags") { res.writeHead(404); return res.end(); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await listLocalModels("ollama", { baseURL: `${baseURL}/v1` }), { running: true, models: [] });
  assert.deepEqual(paths, ["/api/tags", "/v1/models"]);
  assert.deepEqual(await listLocalModels("custom", { baseURL: `${baseURL}/slow` }, { timeoutMs: 50 }), { running: false, models: [], error: "timeout" });
});

test("models CLI reports online/offline servers and interactive selection survives restart", async t => {
  const { host } = await fakeOllama(t, ["qwen3:8b", "llama3.2:3b"]);
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-catalog-"));
  writeFileSync(path.join(home, "config.json"), JSON.stringify({ providers: { lmstudio: { local: false } } }));
  const env = { ...process.env, BITCODE_HOME: home, OLLAMA_HOST: host, BITCODE_MODEL: "", ANTHROPIC_API_KEY: "", NO_COLOR: "1" };
  const catalog = await cli(["models", "--json"], env);
  assert.equal(catalog.error, null, catalog.stderr);
  const local = JSON.parse(catalog.stdout).local;
  assert.equal(local[0].running, true);
  assert.deepEqual(local[0].models.map(m => m.id), ["qwen3:8b", "llama3.2:3b"]);
  const session = await cli([], env, "/models\nollama/llama3.2:3b\n/exit\n");
  assert.equal(session.error, null, session.stderr);
  assert.match(session.stdout, /switched to ollama\/llama3.2:3b/);
  const restarted = await cli(["--json", "-p", "hello"], env);
  assert.equal(restarted.error, null, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).answer, "hi from llama3.2:3b");
  assert.doesNotMatch(restarted.stderr, /using local/);
  const offline = await cli(["models"], { ...env, OLLAMA_HOST: "127.0.0.1:1" });
  assert.equal(offline.error, null, offline.stderr);
  assert.match(offline.stdout, /not running.*ollama serve/);
  assert.doesNotMatch(offline.stdout, /ollama\/llama3.2:3b/);
});

test("startup preserves explicitly selected models from config, environment and CLI", async t => {
  const { host, chats } = await fakeOllama(t, ["qwen3:8b", "llama3.2:3b", "explicit:latest"]);
  const home = mkdtempSync(path.join(os.tmpdir(), "bc-precedence-"));
  writeFileSync(path.join(home, "config.json"), JSON.stringify({ model: "ollama/llama3.2:3b" }));
  const env = { ...process.env, BITCODE_HOME: home, OLLAMA_HOST: host, BITCODE_MODEL: "", ANTHROPIC_API_KEY: "", NO_COLOR: "1" };
  for (const [args, modelEnv, expected] of [
    [[], "", "llama3.2:3b"],
    [[], "ollama/explicit:latest", "explicit:latest"],
    [["-m", "ollama/qwen3:8b"], "ollama/explicit:latest", "qwen3:8b"],
  ]) {
    const result = await cli([...args, "--json", "-p", "hello"], { ...env, BITCODE_MODEL: modelEnv });
    assert.equal(result.error, null, result.stderr);
    assert.equal(JSON.parse(result.stdout).answer, `hi from ${expected}`);
    assert.doesNotMatch(result.stderr, /using local/);
  }
  assert.deepEqual(chats, ["llama3.2:3b", "explicit:latest", "qwen3:8b"]);
});

test("offline inference errors provide the right startup hint for each local server", async () => {
  for (const discovery of ["ollama", undefined]) {
    const provider = { api: "openai", local: true, discovery, baseURL: "http://127.0.0.1:1/v1" };
    await assert.rejects(callModel({ provider, model: "test", messages: [] }), err => {
      assert.equal(err.code, "ECONNREFUSED");
      assert.match(err.message, /local model server not reachable/);
      if (discovery) assert.match(err.message, /ollama serve/);
      else assert.doesNotMatch(err.message, /ollama/);
      return true;
    });
  }
});
