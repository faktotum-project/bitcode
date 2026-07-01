// Provider registry and model resolution.
//
// A "model spec" is written as "<provider>/<model>", e.g. "ollama/gpt-oss:20b"
// or "anthropic/claude-sonnet-4-6". A bare provider name ("anthropic") uses that
// provider's defaultModel. Resolution order for the active model:
//   1. CLI flag --model / -m
//   2. env BITCODE_MODEL
//   3. config file "model" field (~/.bitcode/config.json)
//   4. built-in fallback

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Built-in providers. `api` selects the wire format: "anthropic" (Messages API)
// or "openai" (Chat Completions, used by most OpenAI-compatible servers).
// For "openai", baseURL already includes the version segment (e.g. /v1).
export const BUILTIN_PROVIDERS = {
  anthropic: {
    api: "anthropic",
    baseURL: "https://api.anthropic.com",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
  },
  openai: {
    api: "openai",
    baseURL: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-5.5",
  },
  openrouter: {
    api: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-sonnet-4.6",
  },
  groq: {
    api: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  ollama: {
    api: "openai",
    baseURL: "http://127.0.0.1:11434/v1",
    keyEnv: null,
    defaultModel: "gpt-oss:20b",
  },
};

const FALLBACK_MODEL = "anthropic/claude-sonnet-4-6";

export function configPath() {
  return path.join(homedir(), ".bitcode", "config.json");
}

export function loadConfig() {
  const file = configPath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`invalid config at ${file}: ${err.message}`);
  }
}

// Merge built-in providers with any user-defined ones. User entries override
// or extend built-ins by key.
export function allProviders(config) {
  return { ...BUILTIN_PROVIDERS, ...(config.providers || {}) };
}

// Resolve a model spec into a concrete target the providers module can call.
export function resolveModel({ cliModel, config }) {
  const spec =
    cliModel || process.env.BITCODE_MODEL || config.model || FALLBACK_MODEL;

  const slash = spec.indexOf("/");
  const providerName = slash === -1 ? spec : spec.slice(0, slash);
  const providers = allProviders(config);
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(
      `unknown provider "${providerName}". Known: ${Object.keys(providers).join(", ")}`,
    );
  }

  const model =
    slash === -1 ? provider.defaultModel : spec.slice(slash + 1) || provider.defaultModel;
  if (!model) {
    throw new Error(`no model given and provider "${providerName}" has no defaultModel`);
  }

  const apiKey = provider.keyEnv ? process.env[provider.keyEnv] : undefined;

  return {
    spec: `${providerName}/${model}`,
    providerName,
    provider,
    model,
    apiKey,
  };
}
