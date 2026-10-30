// Models each provider offers, for the model picker: asked live from the provider
// (its /models endpoint, or the local server), falling back to what config knows.
import { isLocalProvider, listLocalModels, describeLocalModel } from "./local-models.mjs";

// OpenAI-style listings include embeddings, speech and image models that cannot chat.
const NOT_CHAT = /embed|tts|whisper|dall-e|davinci|babbage|moderation|transcribe|audio|realtime|image|search|similarity|guard/i;
// Catalogs that declare output modalities (OpenRouter) say it directly; otherwise only the model's own
// name is judged, so a vendor prefix such as "nousresearch/" never hides a whole family.
const isChatModel = (m) => Array.isArray(m.architecture?.output_modalities)
  ? m.architecture.output_modalities.includes("text")
  : !NOT_CHAT.test(m.id.split("/").pop());

export const providerApiKey = (provider) => (provider.keyEnv ? process.env[provider.keyEnv] : undefined) || provider.apiKey;
export const providerNeedsKey = (provider) => Boolean(provider.keyEnv) && !isLocalProvider(provider) && !providerApiKey(provider);

async function getJSON(url, headers, { timeoutMs, signal, fetchImpl }) {
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  const res = await fetchImpl(url, { headers, signal: AbortSignal.any(signals) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function liveModels(provider, options) {
  const base = String(provider.baseURL || "").replace(/\/+$/, "");
  const key = options.apiKey || providerApiKey(provider);
  if (provider.api === "anthropic") {
    const { data = [] } = await getJSON(`${base}/v1/models?limit=100`, { "x-api-key": key, "anthropic-version": "2023-06-01" }, options);
    return data.map((m) => ({ id: m.id, hint: m.display_name || "" }));
  }
  const { data = [] } = await getJSON(`${base}/models`, key ? { authorization: `Bearer ${key}` } : {}, options);
  return data.filter((m) => m.id && isChatModel(m)).map((m) => ({ id: m.id, hint: m.name && m.name !== m.id ? m.name : "" }));
}

// -> { models: [{ id, hint }], live: boolean, error? }; the default and configured models always appear.
// apiKey: a key held elsewhere (the desktop keyring). Providers with publicModels list without a key.
export async function providerModels(name, provider, { timeoutMs = 4000, signal, fetchImpl = fetch, apiKey } = {}) {
  const known = [provider.defaultModel, ...(Array.isArray(provider.models) ? provider.models : [])].filter(Boolean).map((id) => ({ id, hint: id === provider.defaultModel ? "default" : "" }));
  let models = [], error, live = false;
  try {
    if (isLocalProvider(provider)) {
      const local = await listLocalModels(name, provider, { timeoutMs, signal });
      if (!local.running) throw new Error(local.error || "not running");
      models = local.models.map((m) => ({ id: m.id, hint: describeLocalModel(m) }));
    } else if (apiKey || provider.publicModels || !providerNeedsKey(provider)) {
      models = await liveModels(provider, { timeoutMs, signal, fetchImpl, apiKey });
    }
    live = models.length > 0;
  } catch (err) {
    error = err.name === "TimeoutError" ? "timeout" : err.message;
  }
  const seen = new Set(models.map((m) => m.id));
  const merged = [...known.filter((m) => !seen.has(m.id)), ...models.sort((a, b) => a.id.localeCompare(b.id))];
  for (const m of merged) if (m.id === provider.defaultModel && !m.hint) m.hint = "default";
  return { models: merged, live, ...(error ? { error } : {}) };
}
