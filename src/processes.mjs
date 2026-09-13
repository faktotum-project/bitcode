import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { wait, throwIfAborted } from "./runtime.mjs";

const sessions = new Map();
const MAX_OUTPUT = 100_000;

function stop(entry, signal = "SIGTERM") {
  if (entry.done) return;
  try {
    if (process.platform !== "win32") process.kill(-entry.child.pid, signal);
    else entry.child.kill(signal);
  } catch { /* already exited */ }
}

export function startProcess({ command, cwd = process.cwd(), timeout_ms = 120_000 }, signal) {
  if (typeof command !== "string" || !command.trim()) throw new Error("command must be non-empty");
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 86_400_000) throw new Error("timeout_ms must be 1..86400000");
  throwIfAborted(signal);
  if ([...sessions.values()].filter(s => !s.done).length >= 16) throw new Error("too many running processes (max 16)");
  for (const [id, entry] of sessions) if (entry.done && sessions.size >= 100) sessions.delete(id);
  const child = spawn(command, { cwd: path.resolve(cwd), shell: process.platform === "win32" ? true : "/bin/bash", detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  const entry = { id: randomUUID(), child, command, cwd: path.resolve(cwd), output: "", dropped: 0, done: false, exitCode: null, signal: null };
  sessions.set(entry.id, entry);
  const append = chunk => {
    entry.output += chunk;
    if (entry.output.length > MAX_OUTPUT) { const count = entry.output.length - MAX_OUTPUT; entry.output = entry.output.slice(count); entry.dropped += count; }
  };
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", append); child.stderr.on("data", append);
  child.stdin.on("error", () => {});
  let forceTimer;
  const terminate = reason => { entry.reason = reason; stop(entry); forceTimer ??= setTimeout(() => stop(entry, "SIGKILL"), 1000); forceTimer.unref(); };
  const abort = () => terminate("cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => terminate("timed out"), timeout_ms);
  timer.unref();
  entry.terminate = terminate;
  entry.completed = new Promise(resolve => {
    let settled = false;
    const finish = (code, exitSignal) => {
      if (settled) return; settled = true;
      entry.done = true; entry.exitCode = code; entry.signal = exitSignal;
      clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener("abort", abort);
      resolve(entry);
    };
    child.once("error", err => { append(`ERROR: ${err.message}\n`); finish(null, null); });
    child.once("close", finish);
  });
  return entry;
}

function snapshot(entry, offset = 0) {
  const start = Math.max(0, offset - entry.dropped);
  return { session_id: entry.id, running: !entry.done, exit_code: entry.exitCode, signal: entry.signal, reason: entry.reason,
    output: entry.output.slice(start), next_offset: entry.dropped + entry.output.length, truncated: offset < entry.dropped };
}
function get(id) { const entry = sessions.get(id); if (!entry) throw new Error(`unknown process session: ${id}`); return entry; }
export function listProcesses() { return [...sessions.values()].map(e => ({ ...snapshot(e, e.dropped + e.output.length), command: e.command, cwd: e.cwd })); }
export async function closeProcesses() {
  const entries = [...sessions.values()].filter(e => !e.done);
  for (const entry of entries) entry.terminate("session closed");
  await Promise.all(entries.map(e => e.completed));
  sessions.clear();
}
export async function runShell(args, { signal } = {}) {
  const entry = startProcess(args, signal);
  await entry.completed;
  const result = snapshot(entry);
  sessions.delete(entry.id);
  return `${result.output.trimEnd() || "[no output]"}\n[exit code ${result.exit_code ?? "unknown"}${result.reason ? `; ${result.reason}` : ""}${result.signal ? `; ${result.signal}` : ""}]`;
}

const id = { type: "string", description: "session_id returned by exec_command" };
const pause = { type: "integer", minimum: 0, maximum: 1000 };
export const processTools = [
  { name: "exec_command", mutating: true, description: "Start a managed shell process with piped stdin/stdout (no PTY). Returns session_id and output after up to one second. Use write_stdin to continue. Processes close when the CLI exits.", parameters: { type: "object", properties: { command: { type: "string", minLength: 1 }, cwd: { type: "string" }, timeout_ms: { type: "integer", minimum: 1, maximum: 86400000 }, yield_time_ms: pause }, required: ["command"], additionalProperties: false },
    run: async ({ yield_time_ms = 1000, ...args }, { signal } = {}) => { const entry = startProcess(args, signal); await Promise.race([entry.completed, wait(yield_time_ms, signal)]); return snapshot(entry); } },
  { name: "write_stdin", mutating: true, description: "Send text to a managed process, optionally close stdin, and retrieve output from an offset. Omit chars to poll; keep next_offset to avoid repeated output.", parameters: { type: "object", properties: { session_id: id, chars: { type: "string" }, eof: { type: "boolean" }, offset: { type: "integer", minimum: 0 }, yield_time_ms: pause }, required: ["session_id"], additionalProperties: false },
    run: async ({ session_id, chars, eof, offset = 0, yield_time_ms = 1000 }, { signal } = {}) => { const entry = get(session_id); if (chars && entry.done) throw new Error("process already exited"); if (chars) entry.child.stdin.write(chars); if (eof) entry.child.stdin.end(); if (!entry.done) await Promise.race([entry.completed, wait(yield_time_ms, signal)]); return snapshot(entry, offset); } },
  { name: "list_processes", mutating: false, description: "List managed process sessions and exit status.", parameters: { type: "object", properties: {} }, run: listProcesses },
  { name: "terminate_process", mutating: true, description: "Stop a managed process and its process group, escalating to SIGKILL after one second.", parameters: { type: "object", properties: { session_id: id }, required: ["session_id"] },
    run: async ({ session_id }) => { const entry = get(session_id); entry.terminate("terminated by user"); await entry.completed; return snapshot(entry); } },
];
