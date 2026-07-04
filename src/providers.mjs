// Model adapters. Two wire formats behind one canonical interface.
//
// Canonical message shapes used everywhere else in the app:
//   { role: "user",      content: string }
//   { role: "assistant", content: string, toolCalls?: [{ id, name, args }] }
//   { role: "tool",      toolCallId, name, content: string }
//
// callModel(...) returns: { text: string, toolCalls: [{ id, name, args }] }
//
// Requests stream (SSE) so the first byte arrives immediately. This avoids
// undici's headers timeout when a slow local model (e.g. a cold-loaded Ollama
// model) buffers its whole non-streamed response, and lets us surface tokens
// live via the optional onDelta(piece) callback.

import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_TOKENS = 4096;

export async function callModel({ provider, model, apiKey, system, messages, tools, onDelta }) {
  if (provider.api === "anthropic") {
    return callAnthropic({ provider, model, apiKey, system, messages, tools, onDelta });
  }
  if (provider.api === "openai") {
    return callOpenAI({ provider, model, apiKey, system, messages, tools, onDelta });
  }
  throw new Error(`unsupported provider api: ${provider.api}`);
}

// POST a streaming request using node:http(s) rather than fetch. fetch (undici)
// enforces a headers timeout we cannot disable without a dependency, which a
// slow cold-loading local model trips before its first byte. Raw http lets us
// wait. Resolves with the response stream (utf8) once status is 2xx.
function openStream(urlString, headers, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch {
      return reject(new Error(`bad URL: ${urlString}`));
    }
    const lib = u.protocol === "https:" ? https : http;
    const payload = JSON.stringify({ ...body, stream: true });
    const req = lib.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      async (res) => {
        res.setEncoding("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errBody = "";
          for await (const c of res) errBody += c;
          const err = new Error(`${urlString} -> HTTP ${res.statusCode}: ${errBody.slice(0, 800)}`);
          err.statusCode = res.statusCode;
          const ra = res.headers["retry-after"];
          if (ra) {
            const ms = /^\d+$/.test(ra) ? Number(ra) * 1000 : Date.parse(ra) - Date.now();
            if (ms > 0) err.retryAfter = ms;
          }
          reject(err);
          return;
        }
        resolve(res);
      },
    );
    req.on("error", (err) => {
      const e = new Error(`network error calling ${urlString}: ${err.code || err.message}`);
      e.code = err.code;
      reject(e);
    });
    // Allow slow local model loads; guard only against a fully dead socket.
    req.setTimeout(REQUEST_TIMEOUT_MS, () =>
      req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`)),
    );
    req.write(payload);
    req.end();
  });
}

// Retry openStream on transient failures (rate limits, gateway/5xx, dropped
// sockets) with exponential backoff, honouring a Retry-After header when the
// server sends one. Non-retryable errors (4xx other than 429, bad key) throw
// immediately.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE"]);
const MAX_HTTP_RETRIES = 3;

async function openStreamRetry(urlString, headers, body) {
  let lastErr;
  for (let a = 0; a <= MAX_HTTP_RETRIES; a++) {
    try {
      return await openStream(urlString, headers, body);
    } catch (err) {
      lastErr = err;
      const retryable = RETRYABLE_STATUS.has(err.statusCode) || RETRYABLE_CODES.has(err.code);
      if (!retryable || a === MAX_HTTP_RETRIES) throw err;
      const wait = err.retryAfter && err.retryAfter > 0 ? err.retryAfter : Math.min(500 * 2 ** a, 8000);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Lightweight, token-free reachability probe for /provider health.
export function providerHealth(provider, apiKey, timeoutMs = 5000) {
  const target =
    provider.api === "openai" ? `${provider.baseURL}/models` : provider.baseURL;
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(target);
    } catch {
      return resolve({ ok: false, detail: "bad baseURL" });
    }
    const lib = u.protocol === "https:" ? https : http;
    const headers = {};
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    if (provider.api === "anthropic" && apiKey) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = ANTHROPIC_VERSION;
    }
    const req = lib.request(
      { method: "GET", hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, headers },
      (res) => {
        res.resume();
        const ok = res.statusCode < 500;
        resolve({ ok, detail: `HTTP ${res.statusCode}${apiKey ? "" : " (no key)"}` });
      },
    );
    req.on("error", (err) => resolve({ ok: false, detail: err.code || err.message }));
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.end();
  });
}

// Yield SSE data payloads (the part after "data:"), skipping comments and blank
// lines. Stops at the "[DONE]" sentinel.
async function* sseEvents(res) {
  let buf = "";
  for await (const chunk of res) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      yield data;
    }
  }
}

// ---- OpenAI Chat Completions (and compatible servers: Ollama, Groq, ...) ----

function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.content || "" };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        }));
      }
      out.push(msg);
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

async function callOpenAI({ provider, model, apiKey, system, messages, tools, onDelta }) {
  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const body = { model, messages: toOpenAIMessages(system, messages) };
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }

  const res = await openStreamRetry(`${provider.baseURL}/chat/completions`, headers, body);

  let text = "";
  const calls = []; // accumulated by streamed tool_call index
  for await (const data of sseEvents(res)) {
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      onDelta?.(delta.content);
    }
    for (const tcd of delta.tool_calls || []) {
      const i = tcd.index ?? 0;
      calls[i] ??= { id: tcd.id, name: "", args: "" };
      if (tcd.id) calls[i].id = tcd.id;
      if (tcd.function?.name) calls[i].name = tcd.function.name;
      if (tcd.function?.arguments) calls[i].args += tcd.function.arguments;
    }
  }

  const toolCalls = calls
    .filter((c) => c && c.name)
    .map((c) => ({ id: c.id || randomUUID(), name: c.name, args: parseArgs(c.args) }));
  return { text, toolCalls };
}

function parseArgs(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ---- Anthropic Messages API ----

function toAnthropicMessages(messages) {
  const raw = [];
  for (const m of messages) {
    if (m.role === "user") {
      raw.push({ role: "user", content: [{ type: "text", text: m.content }] });
    } else if (m.role === "assistant") {
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls || []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} });
      }
      raw.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      raw.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      });
    }
  }
  // Anthropic requires alternating roles; collapse consecutive same-role
  // messages (e.g. parallel tool results) into one.
  const merged = [];
  for (const msg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) last.content.push(...msg.content);
    else merged.push({ role: msg.role, content: [...msg.content] });
  }
  return merged;
}

async function callAnthropic({ provider, model, apiKey, system, messages, tools, onDelta }) {
  if (!apiKey) {
    throw new Error(`missing API key: set ${provider.keyEnv} for the anthropic provider`);
  }
  const headers = { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };

  const body = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(messages),
  };
  if (system) body.system = system;
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await openStreamRetry(`${provider.baseURL}/v1/messages`, headers, body);

  let text = "";
  const blocks = []; // by content-block index
  for await (const data of sseEvents(res)) {
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    if (ev.type === "content_block_start") {
      blocks[ev.index] = { ...ev.content_block, json: "" };
    } else if (ev.type === "content_block_delta") {
      const d = ev.delta;
      if (d.type === "text_delta") {
        text += d.text;
        onDelta?.(d.text);
      } else if (d.type === "input_json_delta") {
        blocks[ev.index].json += d.partial_json;
      }
    }
  }

  const toolCalls = blocks
    .filter((b) => b && b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, args: parseArgs(b.json) }));
  return { text, toolCalls };
}
