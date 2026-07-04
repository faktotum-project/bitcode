// Interactive config & provider management for the REPL: the /setting status
// view and the /provider add wizard (masked key entry via tui.readSecret,
// persisted to ~/.bitcode/config.json). Keys live in config only as a fallback
// — an environment variable, when present, always wins in resolveModel().

import { allProviders, saveConfig } from "./config.mjs";
import { readSecret } from "./tui.mjs";
import * as t from "./theme.mjs";

// One status row per known provider: where its key comes from (env / saved /
// local / unset). Returns [{ name, line }] so the caller controls printing.
export function providerRows(config) {
  const providers = allProviders(config);
  return Object.entries(providers).map(([name, p]) => {
    let status;
    if (p.keyEnv && process.env[p.keyEnv]) status = t.ok(`${p.keyEnv} ✓`);
    else if (p.apiKey) status = t.ok("saved key ✓");
    else if (!p.keyEnv) status = t.faint("local");
    else status = t.faint(`${p.keyEnv} (unset)`);
    return { name, line: `${t.accent(name.padEnd(12))} ${status}` };
  });
}

// /provider add <name>: prompt (masked) for an API key and persist it under
// config.providers.<name>.apiKey. Mutates `config` in place and saves. Returns
// { ok, msg } for the caller to render.
export async function providerAdd(config, name) {
  const providers = allProviders(config);
  const p = providers[name];
  if (!p) {
    return { ok: false, msg: `unknown provider "${name}". Known: ${Object.keys(providers).join(", ")}` };
  }
  if (p.keyEnv === null) {
    return { ok: false, msg: `${name} runs locally and needs no API key` };
  }

  const key = await readSecret({ prompt: `  enter API key for ${t.accent(name)}: ` });
  if (!key) return { ok: false, msg: "cancelled — no key saved" };

  config.providers = config.providers || {};
  config.providers[name] = { ...(config.providers[name] || {}), apiKey: key };
  const file = saveConfig(config);
  return { ok: true, msg: `saved key for ${name} → ${file}` };
}
