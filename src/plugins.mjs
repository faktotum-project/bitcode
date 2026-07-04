// Plugin loader: every ~/.bitcode/plugins/*.mjs is imported and its default
// (or `setup`) export is called with a small API surface. A plugin can add
// tools and subscribe to lifecycle events:
//
//   export default function ({ registerTool, on, EVENTS }) {
//     registerTool({ name: "hello", description: "…", parameters: {…}, run: async () => "hi" });
//     on("toolEnd", ({ tc, result }) => { /* observe */ });
//   }
//
// A plugin that throws is reported and skipped — it never blocks startup.

import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerTool, unregisterTool } from "./tools.mjs";
import { on, off, emit, EVENTS } from "./hooks.mjs";

export function pluginsDir() {
  return path.join(homedir(), ".bitcode", "plugins");
}

export async function loadPlugins(dir = pluginsDir()) {
  if (!existsSync(dir)) return [];
  const api = { registerTool, unregisterTool, on, off, emit, EVENTS };
  const loaded = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const mod = await import(pathToFileURL(full).href);
      const setup = mod.default ?? mod.setup;
      if (typeof setup !== "function") {
        loaded.push({ name: f, ok: false, error: "no default/setup export" });
        continue;
      }
      await setup(api);
      loaded.push({ name: f, ok: true });
    } catch (err) {
      loaded.push({ name: f, ok: false, error: err.message });
    }
  }
  return loaded;
}
