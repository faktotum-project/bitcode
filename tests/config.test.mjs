import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtempSync, statSync } from "node:fs";
import path from "node:path";

// Isolate HOME so config writes never touch the real ~/.bitcode.
process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "bc-home-"));
process.env.USERPROFILE = process.env.HOME;
delete process.env.BITCODE_MODEL;
delete process.env.ANTHROPIC_API_KEY;

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
