import { randomUUID } from "node:crypto";
import path from "node:path";
import { initialState, reduceEvent } from "./state.mjs";
import { stageForTool } from "../design-tokens.mjs";

const TYPES = new Set([
  "run.started",
  "model.started",
  "model.finished",
  "tool.requested",
  "approval.requested",
  "approval.resolved",
  "tool.started",
  "tool.finished",
  "run.finished",
]);
const OUTCOMES = new Set([
  "ok",
  "error",
  "denied",
  "unknown_tool",
  "max_steps",
  "cancelled",
  "approved",
]);
const STAGES = new Set(["thinking", "reading", "running", "drafting"]);
export function safeText(value, max = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, max);
}
export function toolSummary(tc, cwd = process.cwd()) {
  const tool = /^[a-z][a-z0-9_]{0,63}$/.test(tc.name)
    ? tc.name
    : "unknown_tool";
  const name = stageForTool(tool).name;
  const stage = name === "querying" ? "running" : name;
  let summary = ["bash", "exec_command"].includes(tool) ? "Esecuzione comando" : tool;
  if (
    ["read_file", "list_dir", "write_file", "edit_file"].includes(tool) &&
    typeof tc.args?.path === "string"
  ) {
    const rel = path.relative(cwd, path.resolve(cwd, tc.args.path));
    summary +=
      " · " +
      (rel.startsWith("..") || path.isAbsolute(rel)
        ? "file esterno al progetto"
        : safeText(rel || "."));
  }
  return { tool, stage, summary: safeText(summary) };
}

export function createRunContext(options = {}) {
  return {
    ...options,
    runId: options.runId || randomUUID(),
    sessionId: options.sessionId || randomUUID(),
    agentId: options.agentId || "bitcode",
    depth: options.depth || 0,
    cwd: options.cwd || process.cwd(),
  };
}
export function observe(context, type, data = {}) {
  try {
    context?.bus?.emit(context, type, data);
  } catch {
    /* Observers never alter execution. */
  }
}
export function createEventBus({ bufferSize = 500 } = {}) {
  let state = initialState(),
    seq = 0,
    root = null,
    child = null;
  const ring = [],
    listeners = new Set();
  return {
    enter(context) {
      if (!context.parentRunId) {
        if (root)
          throw Object.assign(
            new Error("A run is already active in this session."),
            { code: "BUSY" },
          );
        root = context.runId;
      } else if (context.parentRunId !== root || context.depth !== 1) {
        throw new Error("Delegation must belong to the active parent run.");
      } else if (child) {
        throw Object.assign(new Error("A delegation is already active in this session."), { code: "BUSY" });
      } else {
        child = context.runId;
      }
    },
    leave(context) {
      if (child === context.runId) child = null;
      if (root === context.runId) { root = null; child = null; }
    },
    get busy() {
      return !!root;
    },
    emit(context, type, input = {}) {
      if (!TYPES.has(type)) return;
      // Only explicit public fields; never serialize tool args, result, target or config.
      const data = {};
      if (typeof input.tool === "string")
        data.tool = /^[a-z][a-z0-9_]{0,63}$/.test(input.tool)
          ? input.tool
          : "unknown_tool";
      if (STAGES.has(input.stage)) data.stage = input.stage;
      if (typeof input.summary === "string")
        data.summary = safeText(input.summary);
      if (typeof input.model === "string" && type === "run.started")
        data.model = safeText(input.model, 100);
      if (OUTCOMES.has(input.outcome)) data.outcome = input.outcome;
      if (Number.isFinite(input.durationMs))
        data.durationMs = Math.max(0, Math.round(input.durationMs));
      const event = {
        v: 1,
        seq: ++seq,
        at: new Date().toISOString(),
        type,
        sessionId: context.sessionId,
        runId: context.runId,
        agentId: safeText(context.agentId, 80),
        data,
      };
      if (context.agentId === "custom") event.displayName = safeText(context.displayName || "custom", 80);
      if (context.parentRunId) event.parentRunId = context.parentRunId;
      if (input.toolCallId) event.toolCallId = safeText(input.toolCallId, 100);
      reduceEvent(state, event);
      ring.push(event);
      if (ring.length > bufferSize) ring.shift();
      for (const listener of listeners) {
        try {
          listener(structuredClone(event))?.catch?.(() => {});
        } catch {}
      }
    },
    snapshot() {
      return structuredClone(state);
    },
    replay(after) {
      if (
        !Number.isSafeInteger(after) ||
        after < 0 ||
        after > seq ||
        (ring.length && after < ring[0].seq - 1)
      )
        return null;
      return structuredClone(ring.filter((e) => e.seq > after));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
