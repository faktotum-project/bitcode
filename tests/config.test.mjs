import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtempSync, statSync } from "node:fs";
import path from "node:path";

// Isolate HOME so config writes never touch the real ~/.bitcode.
process.env.BITCODE_HOME = mkdtempSync(path.join(os.tmpdir(), "bc-home-"));
delete process.env.BITCODE_MODEL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MOONSHOT_API_KEY;
delete process.env.KIMI_API_KEY;

const {
  allProviders,
  resolveModel,
  configGet,
  configSet,
  saveConfig,
  loadConfig,
  BUILTIN_PROVIDERS,
} = await import("../src/config.mjs");

test("allProviders deep-merges a saved apiKey without dropping built-in fields", () => {
  const ap = allProviders({ providers: { anthropic: { apiKey: "k" } } }).anthropic;
  assert.equal(ap.baseURL, BUILTIN_PROVIDERS.anthropic.baseURL);
  assert.equal(ap.keyEnv, "ANTHROPIC_API_KEY");
  assert.equal(ap.api, "anthropic");
  assert.equal(ap.apiKey, "k");
});

test("Kimi Platform and Kimi Code keep endpoints, models and credentials separate", () => {
  const providers = allProviders({});
  assert.equal(providers.kimi.baseURL, "https://api.moonshot.ai/v1");
  assert.equal(providers.kimi.keyEnv, "MOONSHOT_API_KEY");
  assert.equal(providers.kimi.defaultModel, "kimi-k3.1-pro");
  assert.ok(providers.kimi.models.includes("kimi-k3.1-pro-highspeed"));
  assert.equal(providers["kimi-code"].baseURL, "https://api.kimi.ai/coding/v1");
  assert.equal(providers["kimi-code"].keyEnv, "KIMI_API_KEY");
  assert.equal(providers["kimi-code"].defaultModel, "k3.1-pro");
  assert.ok(providers["kimi-code"].models.includes("k3.1-pro-highspeed"));

  process.env.MOONSHOT_API_KEY = "platform-env";
  process.env.KIMI_API_KEY = "code-env";
  try {
    const platform = resolveModel({ cliModel: "kimi", config: { providers: { kimi: { apiKey: "platform-config" } } } });
    const code = resolveModel({ cliModel: "kimi-code", config: { providers: { "kimi-code": { apiKey: "code-config" } } } });
    assert.equal(platform.apiKey, "platform-env");
    assert.equal(code.apiKey, "code-env");
    assert.equal(platform.spec, "kimi/kimi-k3.1-pro");
    assert.equal(code.spec, "kimi-code/k3.1-pro");
    assert.notEqual(platform.provider.baseURL, code.provider.baseURL);
  } finally {
    delete process.env.MOONSHOT_API_KEY;
    delete process.env.KIMI_API_KEY;
  }
});

test("resolveModel: env var wins over a config-stored key", () => {
  const cfg = { providers: { anthropic: { apiKey: "cfgkey" } } };
  assert.equal(resolveModel({ cliModel: "anthropic", config: cfg }).apiKey, "cfgkey");
  process.env.ANTHROPIC_API_KEY = "envkey";
  assert.equal(resolveModel({ cliModel: "anthropic", config: cfg }).apiKey, "envkey");
  delete process.env.ANTHROPIC_API_KEY;
});

test("resolveModel: aliases expand to a full spec", () => {
  const cfg = { aliases: { sonnet: "anthropic/claude-sonnet-4-6" } };
  assert.equal(resolveModel({ cliModel: "sonnet", config: cfg }).spec, "anthropic/claude-sonnet-4-6");
});

test("resolveModel: unknown provider throws", () => {
  assert.throws(() => resolveModel({ cliModel: "nope/x", config: {} }), /unknown provider/);
});

test("configGet/configSet round-trip a dot-path", () => {
  const c = {};
  configSet(c, "providers.openai.apiKey", "x");
  assert.equal(configGet(c, "providers.openai.apiKey"), "x");
  assert.equal(configGet(c, "providers.missing.key"), undefined);
});

test("saveConfig persists atomically and 0600", () => {
  const c = { model: "ollama/x", aliases: { a: "b" } };
  const file = saveConfig(c);
  assert.deepEqual(loadConfig(), c);
  if (process.platform !== "win32") {
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
});

test("config paths cannot modify object prototypes", () => {
  for (const key of ["__proto__.polluted", "constructor.prototype.polluted", "a..b"]) assert.throws(() => configSet({}, key, true), /invalid config path/);
  assert.equal({}.polluted, undefined);
});
