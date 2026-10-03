export const TERMINAL = new Set(["success", "error", "cancelled"]);
export function initialState() {
  return { seq: 0, runs: {}, activity: [] };
}

export function reduceEvent(state, event) {
  state.seq = event.seq;
  const { runId, type, data } = event;
  if (type === "run.started") {
    state.runs[runId] = {
      runId,
      parentRunId: event.parentRunId || null,
      agentId: event.agentId,
      displayName: event.displayName || event.agentId,
      state: "thinking",
      startedAt: event.at,
      updatedAt: event.at,
      warnings: 0,
      tools: {},
      model: data.model,
    };
    const parent = state.runs[event.parentRunId];
    if (parent) {
      parent.state = "delegating";
      parent.childAgentId = event.agentId;
    }
  }
  const run = state.runs[runId];
  if (run && type !== "run.started") {
    run.updatedAt = event.at;
    if (type === "model.started") run.state = "thinking";
    const toolId = event.toolCallId;
    if (type === "tool.requested") {
      run.tools[toolId] = { name: data.tool, stage: data.stage, summary: data.summary, status: "requested" };
    }
    if (type === "approval.requested" && run.tools[toolId]) run.tools[toolId].status = "awaiting_approval";
    if (type === "approval.resolved" && run.tools[toolId]) run.tools[toolId].status = "requested";
    if (type === "tool.started" && run.tools[toolId]) {
      run.tools[toolId].status = "running";
      run.tools[toolId].startedAt = event.at;
    }
    if (type === "tool.finished") {
      if (data.outcome !== "ok") run.warnings++;
      delete run.tools[toolId];
      run.lastTool = { name: data.tool, summary: data.summary, outcome: data.outcome, durationMs: data.durationMs };
    }
    if (type !== "run.finished") {
      const tools = Object.values(run.tools);
      const pending = tools.find(t => t.status === "awaiting_approval");
      const running = tools.findLast(t => t.status === "running");
      run.state = pending ? "awaiting_approval" : run.childAgentId ? "delegating" : running?.stage || "thinking";
      run.tool = (pending || running)?.name;
    }
    if (type === "run.finished") {
      run.state =
        data.outcome === "ok"
          ? "success"
          : data.outcome === "cancelled"
            ? "cancelled"
            : "error";
      run.outcome = data.outcome;
      run.finishedAt = event.at;
      run.durationMs = data.durationMs;
      run.tools = {};
      delete run.tool;
      const parent = state.runs[event.parentRunId];
      if (parent && !TERMINAL.has(parent.state)) {
        delete parent.childAgentId;
        const active = Object.values(parent.tools).findLast(t => t.status === "running");
        parent.state = active?.stage || "thinking";
      }
    }
  }
  // Bounded history, retaining active runs and the last run for every built-in Sat.
  const runs = Object.values(state.runs);
  if (runs.length > 40) {
    const latest = new Map();
    for (const r of runs) latest.set(r.agentId, r.runId);
    for (const r of runs) {
      if (Object.keys(state.runs).length <= 40) break;
      if (
        TERMINAL.has(r.state) &&
        (!["node", "script", "hash", "merkle", "bitcode"].includes(r.agentId) ||
          latest.get(r.agentId) !== r.runId)
      )
        delete state.runs[r.runId];
    }
  }
  state.activity.push(event);
  if (state.activity.length > 100) state.activity.shift();
  return state;
}
