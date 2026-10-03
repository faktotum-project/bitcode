import { runAgent } from "./agent.mjs";
import { findAgent } from "./agents.mjs";
import { toolsForAgent } from "./sats/policy.mjs";
import { createRunContext } from "./runtime/events.mjs";

export async function runSubagent({
  agent,
  prompt,
  agents = [],
  target,
  system,
  tools,
  parentContext,
  approve,
  hooks = {},
  callModelImpl,
  limits,
  fallbacks,
  signal,
  state,
  readOnly = false,
}) {
  if ((parentContext?.depth || 0) >= 1)
    throw new Error("Recursive delegation is not available.");
  const persona = agent ? findAgent(agents, agent) : null;
  if (agent && !persona) throw new Error(`Unknown agent "${agent}".`);
  if (typeof prompt !== "string" || !prompt.trim())
    throw new Error("A non-empty prompt is required.");
  const selectedTools = toolsForAgent(agent, tools);
  const nestedSystem = [
    system,
    persona?.body || "",
    "Available tools for this delegated task: " +
      selectedTools.map((t) => t.name).join(", ") +
      ". Do not request tools outside this list.",
  ].join("\n\n");
  const context = createRunContext({
    ...parentContext,
    runId: undefined,
    parentRunId: parentContext?.runId || null,
    agentId: ["node", "script", "hash", "merkle"].includes(persona?.name) ? persona.name : "custom",
    displayName: persona?.name || "custom",
    depth: 1,
  });
  return runAgent({
    target,
    system: nestedSystem,
    messages: [{ role: "user", content: prompt }],
    tools: selectedTools,
    hooks: { ...hooks, approve },
    context,
    callModelImpl,
    limits, fallbacks, signal, state, readOnly,
  });
}
