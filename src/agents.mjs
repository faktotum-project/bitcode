import { bitcodeHome } from "./paths.mjs";
// Subagent personas: markdown files in ~/.bitcode/agents/*.md. Each becomes
// a named persona usable both from the REPL (/subagent <name> <prompt>) and
// by the model itself (the "subagent" tool, see tools.mjs), to delegate a
// focused sub-task under an extended system prompt.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMarkdownDir } from "./markdown-config.mjs";

export function agentsDir() {
  return path.join(bitcodeHome(), "agents");
}

export function loadAgents({
  userDir = agentsDir(),
  bundledDir = fileURLToPath(new URL("../agents/", import.meta.url)),
} = {}) {
  const order = ["node", "script", "hash", "merkle"];
  const byName = new Map(
    loadMarkdownDir(bundledDir).map((a) => [
      a.name,
      { ...a, source: "bundled" },
    ]),
  );
  for (const id of order) {
    if (!byName.get(id)?.body) throw new Error(`Missing bundled Sats persona: ${id}. Reinstall the package.`);
  }
  for (const agent of loadMarkdownDir(userDir))
    byName.set(agent.name, { ...agent, source: "user" });
  return [...byName.values()].sort((a, b) => {
    const ia = order.indexOf(a.name),
      ib = order.indexOf(b.name);
    return (
      (ia < 0 ? 4 : ia) - (ib < 0 ? 4 : ib) || a.name.localeCompare(b.name)
    );
  });
}

export function findAgent(agents, name) {
  return agents.find((a) => a.name === name);
}
