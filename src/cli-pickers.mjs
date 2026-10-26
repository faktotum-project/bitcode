// Arrow-key pickers for the full-screen UI, in the style of Codex: choose a provider,
// then one of its models; or move through settings and change one value at a time.
// Esc or ← goes back one level; nothing is saved until a value is chosen.
import { allProviders, resolveModel, saveConfig } from "./config.mjs";
import { isLocalProvider } from "./local-models.mjs";
import { providerModels, providerNeedsKey } from "./model-catalog.mjs";
import { providerAdd } from "./settings.mjs";
import { bubblewrapAvailable, PERMISSION_MODES } from "./permissions.mjs";
import { PROFILES } from "./project.mjs";
import { loadSats } from "./sats.mjs";

const words = (lang) => (lang === "it"
  ? { provider: "Modello · provider", model: "modello", custom: "Altro modello…", customHint: "scrivi un id", customAsk: "id del modello per", keyNeeded: "manca la chiave · ⏎ per inserirla", keyOk: "chiave ✓", local: "locale", saved: "modello predefinito", settings: "Impostazioni", none: "nessuno (bitcode)" }
  : { provider: "Model · provider", model: "model", custom: "Other model…", customHint: "type an id", customAsk: "model id for", keyNeeded: "no key · ⏎ to add one", keyOk: "key ✓", local: "local", saved: "default model", settings: "Settings", none: "none (bitcode)" });

function providerItems(config, activeSpec, w) {
  const activeProvider = String(activeSpec || "").split("/")[0];
  return Object.entries(allProviders(config)).map(([name, p]) => {
    const local = isLocalProvider(p), needsKey = providerNeedsKey(p);
    return {
      label: name, value: name, current: name === activeProvider, muted: needsKey,
      hint: `${local ? w.local : needsKey ? w.keyNeeded : w.keyOk}${p.defaultModel ? ` · ${p.defaultModel}` : ""}`,
      hintColor: needsKey ? "warning" : undefined,
    };
  });
}

// -> the chosen spec ("provider/model") or null; the caller applies it.
export async function pickModel({ ui, config, activeSpec, lang }) {
  const w = words(lang);
  for (;;) {
    const provider = await ui.select({ title: w.provider, subtitle: activeSpec, items: providerItems(config, activeSpec, w) });
    if (!provider) return null;
    const p = allProviders(config)[provider.value];
    if (providerNeedsKey(p)) {
      const result = await providerAdd(config, provider.value);
      ui.toast(result.msg, result.ok ? "success" : "error", 5000);
      if (!result.ok) continue;
    }
    const activeModel = activeSpec?.startsWith(provider.value + "/") ? activeSpec.slice(provider.value.length + 1) : null;
    const items = providerModels(provider.value, allProviders(config)[provider.value]).then(({ models, error }) => [
      ...models.map((m) => ({ label: m.id, value: m.id, hint: m.hint, current: m.id === activeModel })),
      { label: w.custom, value: null, hint: error ? `${w.customHint} · ${error}` : w.customHint, muted: true },
    ]);
    const model = await ui.select({ title: `${provider.value} · ${w.model}`, subtitle: activeSpec, items });
    if (!model) continue;
    const id = model.value ?? (await ui.ask(`${w.customAsk} ${provider.value}`)).trim();
    if (!id) continue;
    return `${provider.value}/${id}`;
  }
}

// Applies and persists a chosen model, as /models always did.
export function applyModel({ spec, config, setActive }) {
  const next = resolveModel({ cliModel: spec, config });
  saveConfig({ ...config, model: next.spec });
  config.model = next.spec;
  setActive(next);
  return next;
}

export async function pickProfile({ ui, current, lang }) {
  const hints = lang === "it"
    ? { code: "programmazione", bitcoin: "strumenti Bitcoin, Lightning, Cashu", rgb: "portafoglio RGB" }
    : { code: "coding", bitcoin: "Bitcoin, Lightning and Cashu tools", rgb: "RGB wallet" };
  const choice = await ui.select({ title: lang === "it" ? "Profilo" : "Profile", items: [...PROFILES].map((p) => ({ label: p, value: p, hint: hints[p] || "", current: p === current })) });
  return choice?.value ?? null;
}

export async function pickPermission({ ui, current, lang }) {
  const it = lang === "it";
  const hints = {
    suggest: it ? "chiede prima di ogni modifica o comando" : "asks before every edit or command",
    "auto-edit": it ? "modifica i file da solo, chiede per i comandi" : "edits files on its own, asks for commands",
    "full-auto": bubblewrapAvailable() ? (it ? "tutto in sandbox, i pagamenti chiedono sempre" : "all in a sandbox; payments still ask") : (it ? "richiede bubblewrap (non trovato)" : "needs bubblewrap (not found)"),
  };
  const choice = await ui.select({ title: it ? "Permessi" : "Permissions", items: [...PERMISSION_MODES].map((m) => ({ label: m, value: m, hint: hints[m], current: m === current, muted: m === "full-auto" && !bubblewrapAvailable() })) });
  return choice?.value ?? null;
}

export async function pickSat({ ui, current, lang }) {
  const items = [{ label: words(lang).none, value: "", current: !current }, ...loadSats().map((s) => ({ label: s.name, value: s.id, sat: s.id, hint: s.role, current: s.id === current }))];
  const choice = await ui.select({ title: "Sat", items });
  return choice ? choice.value : null;
}

export async function pickProvider({ ui, config, lang }) {
  const w = words(lang);
  const items = Object.entries(allProviders(config)).filter(([, p]) => p.keyEnv && !isLocalProvider(p))
    .map(([name, p]) => ({ label: name, value: name, hint: providerNeedsKey(p) ? w.keyNeeded : w.keyOk, hintColor: providerNeedsKey(p) ? "warning" : "success" }));
  const choice = await ui.select({ title: lang === "it" ? "Chiavi API" : "API keys", items });
  return choice?.value ?? null;
}

// The settings menu: one row per setting with its current value; ⏎ opens that setting's picker.
export async function settingsMenu({ ui, lang, read, actions }) {
  const it = lang === "it";
  for (;;) {
    const v = read();
    const row = await ui.select({ title: words(lang).settings, items: [
      { label: it ? "Modello" : "Model", value: "model", hint: v.model },
      { label: it ? "Profilo" : "Profile", value: "profile", hint: v.profile },
      { label: it ? "Permessi" : "Permissions", value: "permission", hint: v.permission },
      { label: "Sat", value: "sat", hint: v.sat || words(lang).none },
      { label: it ? "Chiavi API" : "API keys", value: "keys", hint: it ? "aggiungi o cambia una chiave" : "add or change a key" },
    ] });
    if (!row) return;
    await actions[row.value]();
  }
}
