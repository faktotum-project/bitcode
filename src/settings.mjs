// Interactive config & provider management for the REPL: the /setting status
// view and the /provider add wizard (masked key entry via tui.readSecret,
// persisted to ~/.bitcode/config.json). Keys live in config only as a fallback
// — an environment variable, when present, always wins in resolveModel().

import { allProviders, saveConfig } from "./config.mjs";
import { readSecret, question } from "./tui.mjs";
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
  const p = Object.hasOwn(providers, name) ? providers[name] : null;
  if (!p) {
    return { ok: false, msg: `unknown provider "${name}". Known: ${Object.keys(providers).join(", ")}` };
  }
  if (p.keyEnv === null) {
    return { ok: false, msg: `${name} runs locally and needs no API key` };
  }

  const key = (await readSecret({ prompt: `  enter API key for ${t.accent(name)}: ` })).trim();
  if (!key) return { ok: false, msg: "cancelled — no key saved" };

  const next = { ...config, providers: { ...config.providers, [name]: { ...config.providers?.[name], apiKey: key } } };
  const file = saveConfig(next);
  config.providers = next.providers;
  const override = p.keyEnv && process.env[p.keyEnv] ? `; ${p.keyEnv} is set and takes precedence` : "";
  return { ok: true, msg: `saved key for ${name} → ${file}${override}` };
}

// CLI/REPL login uses the same masked API-key storage as /provider add.
// No model calls or extensions are needed to configure a provider.
export async function providerLogin(config, name, { ask = question, print = console.log } = {}) {
  const providers = allProviders(config);
  const names = Object.keys(providers);
  if (!name) {
    print(t.label("Log in with an API key"));
    for (const [i, row] of providerRows(config).entries()) print(`  ${i + 1}. ${row.line}`);
    const choice = (await ask("select # or provider name (Enter cancels): ")).trim();
    if (!choice) return { ok: false, msg: "cancelled — no key saved" };
    name = /^\d+$/.test(choice) ? names[Number(choice) - 1] : choice;
    if (!name) return { ok: false, msg: "invalid provider selection" };
  }
  if (Object.hasOwn(providers, name) && providers[name].keyEnv === null) {
    return { ok: true, msg: `${name} needs no API key; no login required` };
  }
  return providerAdd(config, name);
}
