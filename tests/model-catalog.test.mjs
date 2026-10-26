import test from "node:test";
import assert from "node:assert/strict";
import { providerModels, providerNeedsKey } from "../src/model-catalog.mjs";

const json = (body) => async () => ({ ok: true, json: async () => body });

test("providerModels lists chat models live and keeps the default first", async () => {
  const provider = { api: "openai", baseURL: "https://example.test/v1", keyEnv: "EXAMPLE_KEY", apiKey: "k", defaultModel: "b-chat" };
  const { models, live } = await providerModels("example", provider, { fetchImpl: json({ data: [{ id: "a-chat" }, { id: "text-embedding-3" }, { id: "b-chat" }] }) });
  assert.equal(live, true);
  assert.deepEqual(models.map((m) => m.id), ["a-chat", "b-chat"]);
  assert.equal(models.find((m) => m.id === "b-chat").hint, "default");
});

test("providerModels falls back to known models when the listing fails or a key is missing", async () => {
  const provider = { api: "anthropic", baseURL: "https://example.test", keyEnv: "NO_SUCH_KEY_FOR_TEST", defaultModel: "m1", models: ["m2"] };
  assert.equal(providerNeedsKey(provider), true);
  const { models, live } = await providerModels("x", provider, { fetchImpl: () => { throw new Error("must not fetch without a key"); } });
  assert.equal(live, false);
  assert.deepEqual(models.map((m) => m.id), ["m1", "m2"]);
  const failing = await providerModels("x", { ...provider, apiKey: "k" }, { fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(failing.error, "HTTP 401");
});


test("providerModels uses a key from elsewhere and lists public catalogs without one", async () => {
  const seen = [];
  const fetchImpl = async (url, { headers }) => { seen.push(headers.authorization || "none"); return { ok: true, json: async () => ({ data: [{ id: "vendor/model-a" }] }) }; };
  const keyed = { api: "openai", baseURL: "https://example.test/v1", keyEnv: "NO_SUCH_KEY_FOR_TEST" };
  assert.deepEqual((await providerModels("x", keyed, { fetchImpl, apiKey: "ring" })).models.map((m) => m.id), ["vendor/model-a"]);
  const open = { ...keyed, publicModels: true };
  assert.equal((await providerModels("y", open, { fetchImpl })).live, true);
  assert.deepEqual(seen, ["Bearer ring", "none"]);
});
