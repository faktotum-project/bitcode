// Subagent personas: markdown files in ~/.bitcode/agents/*.md. Each becomes
// a named persona usable both from the REPL (/subagent <name> <prompt>) and
// by the model itself (the "subagent" tool, see tools.mjs), to delegate a
// focused sub-task under an extended system prompt.
import { homedir } from "node:os";
import path from "node:path";
import { loadMarkdownDir } from "./markdown-config.mjs";

export function agentsDir() {
  return path.join(homedir(), ".bitcode", "agents");
}

export function loadAgents() {
  return loadMarkdownDir(agentsDir());
}

export function findAgent(agents, name) {
  return agents.find((a) => a.name === name);
}
