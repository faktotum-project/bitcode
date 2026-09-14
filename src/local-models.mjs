// Discovery of the models installed on the user's own machine.
//
// Nothing here is hard-coded per user: every call asks the local inference
// servers (Ollama, LM Studio, or any provider marked `"local": true`) what they
// actually have, so each installation lists its own models.

import { allProviders } from "./config.mjs";

export { ollamaBaseURL } from "./config.mjs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

export function isLocalProvider(p) {
  if (!p || p.api !== "openai") return false;
  if (p.local === true) return true;
  if (p.local === false || p.keyEnv || p.apiKey) return false;
  try {
    return LOOPBACK.has(new URL(p.baseURL).hostname);
  } catch {
    return false;
  }
}

export const isOllama = (name, p) => name === "ollama" || p.discovery === "ollama" || /:11434(\/|$)/.test(p.baseURL || "");

async function getJSON(url, timeoutMs, signal, apiKey) {
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  const headers = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.any(signals), headers });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { statusCode: res.status });
  return res.json();
}

// Returns { running, models: [{ id, parameterSize?, quantization?, size? }], error? }.
export async function listLocalModels(name, provider, { timeoutMs = 1500, signal } = {}) {
  const base = String(provider.baseURL || "").replace(/\/+$/, "");
  const apiKey = (provider.keyEnv ? process.env[provider.keyEnv] : undefined) || provider.apiKey;
  if (isOllama(name, provider)) {
    try {
      const { models = [] } = await getJSON(`${base.replace(/\/v1$/, "")}/api/tags`, timeoutMs, signal, apiKey);
      return {
        running: true,
        models: models.map(m => ({
          id: m.name || m.model,
          parameterSize: m.details?.parameter_size,
          quantization: m.details?.quantization_level,
          size: m.size,
        })).filter(m => m.id),
      };
    } catch {
      // fall through to the OpenAI-compatible listing (proxies, older servers)
    }
  }
  try {
    const { data = [] } = await getJSON(`${base}/models`, timeoutMs, signal, apiKey);
    return { running: true, models: data.map(m => ({ id: m.id })).filter(m => m.id) };
  } catch (err) {
    return { running: false, models: [], error: err.name === "TimeoutError" ? "timeout" : err.cause?.code || err.message };
  }
}

// Probe every local provider in parallel.
export async function discoverLocalModels(config, options) {
  const entries = Object.entries(allProviders(config)).filter(([, p]) => isLocalProvider(p));
  return Promise.all(entries.map(async ([name, provider]) => ({
    name,
    provider,
    ...(await listLocalModels(name, provider, options)),
  })));
}

// First installed model, preferring the provider's declared default when present.
export function pickLocalModel(discovered) {
  for (const { name, provider, models } of discovered) {
    if (!models.length) continue;
    const preferred = models.find(m => m.id === provider.defaultModel) || models[0];
    return `${name}/${preferred.id}`;
  }
  return null;
}

export function describeLocalModel(m) {
  const size = m.size ? `${(m.size / 1e9).toFixed(1)} GB` : "";
  return [m.parameterSize, m.quantization, size].filter(Boolean).join(" · ");
}

export function localSetupHint(name, running) {
  if (name === "ollama") return running ? "no models installed — try `ollama pull qwen3:8b`" : "not running — start it with `ollama serve` (https://ollama.com)";
  if (name === "lmstudio") return running ? "no models loaded — load one in LM Studio" : "not running — enable the server in LM Studio (Developer → Start Server)";
  return running ? "no models reported" : "not reachable";
}
