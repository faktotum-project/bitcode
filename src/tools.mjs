// Built-in tools the agent can call. Each tool exposes a JSON-schema `parameters`
// (sent to the model) and an async `run(args)` returning a string result.
//
// All paths resolve against process.cwd(). `mutating: true` marks tools that
// change state, so the CLI can gate them behind an approval prompt.

import { runShell, processToolsFor } from "./processes.mjs";
import { workspaceTools } from "./workspace-tools.mjs";
import { resolveLightning } from "./lightning/network.mjs";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { bitcoinTools } from "./bitcoin/tools.mjs";
import { liquidTools } from "./liquid/tools.mjs";
import { lightningTools, bolt11Tool } from "./lightning/tools.mjs";
import { cashuTools } from "./cashu/tools.mjs";
import { coinjoinTools } from "./coinjoin/tools.mjs";
import { runSubagent } from "./subagents.mjs";
import { projectRoot, resolveWorkspacePath, relativeProjectPath } from "./project.mjs";

const MAX_RESULT_CHARS = 100_000;
const DEFAULT_BASH_TIMEOUT = 120_000;
const readHashes = new Map();

function clip(s) {
  s = String(s);
  return s.length > MAX_RESULT_CHARS
    ? s.slice(0, MAX_RESULT_CHARS) + `\n…[truncated ${s.length - MAX_RESULT_CHARS} chars]`
    : s;
}

function resolvePath(root, p) { return resolveWorkspacePath(root, p); }

function bashTool(processOptions) { return {
  name: "bash",
  mutating: true,
  description:
    "Run a shell command in the current working directory and return combined stdout/stderr. Use for builds, tests, git, grep, etc.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1, description: "The shell command to execute." },
      cwd: { type: "string", description: "Working directory (default current directory)." },
      timeout_ms: {
        type: "integer", minimum: 1, maximum: 86400000,
        description: `Optional timeout in milliseconds (default ${DEFAULT_BASH_TIMEOUT}).`,
      },
    },
    required: ["command"],
  },
  run: (args, context) => runShell(args, context, processOptions),
}; }

function readFileTool(root) { return {
  name: "read_file",
  mutating: false,
  description: "Read a UTF-8 text file and return its contents.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Path to the file." }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 10000 }, line_numbers: { type: "boolean" } },
    required: ["path"],
  },
  run: async ({ path: p, offset = 1, limit, line_numbers = false }) => {
    const abs = resolvePath(root, p);
    if ((await stat(abs)).size > 10 * 1024 * 1024) throw new Error("file exceeds 10 MiB; use a shell command to read a range");
    const content = await readFile(abs, "utf8");
    if (content.includes("\u0000")) throw new Error("binary file: use a suitable binary tool");
    const lines = content.split("\n");
    const selected = lines.slice(offset - 1, limit ? offset - 1 + limit : undefined);
    readHashes.set(abs, fileHash(content));
    return clip(line_numbers ? selected.map((l, i) => `${offset + i}: ${l}`).join("\n") : selected.join("\n"));
  },
}; }

function writeFileTool(root) { return {
  name: "write_file",
  mutating: true,
  description: "Create or overwrite a file with the given contents. Creates parent dirs.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" }, expected_hash: { type: "string" },
    },
    required: ["path", "content"],
  },
  run: async ({ path: p, content, expected_hash }) => {
    const abs = resolvePath(root, p);
    await assertFresh(abs, expected_hash);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content ?? "", "utf8");
    readHashes.set(abs, fileHash(content ?? ""));
    return `wrote ${abs} (${(content ?? "").length} chars)`;
  },
}; }

function editFileTool(root) { return {
  name: "edit_file",
  mutating: true,
  description:
    "Apply sequential exact replacements in edits[]. Each replacement must be unique unless replace_all is true. A prior read_file hash protects against stale writes.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, edits: { type: "array", minItems: 1, items: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["old_string", "new_string"], additionalProperties: false } }, old_string: { type: "string" }, new_string: { type: "string" }, expected_hash: { type: "string" } },
    required: ["path"],
  },
  run: async ({ path: p, edits, old_string, new_string, expected_hash }) => {
    const abs = resolvePath(root, p);
    const content = await readFile(abs, "utf8");
    assertFreshContent(abs, content, expected_hash, p);
    let updated = content;
    for (const edit of edits || [{ old_string, new_string }]) {
      const { old_string, new_string, replace_all = false } = edit;
      if (!old_string) throw new Error("old_string must be non-empty");
      const idx = updated.indexOf(old_string);
      if (idx === -1) throw new Error(`old_string not found in ${abs}`);
      if (!replace_all && updated.indexOf(old_string, idx + 1) !== -1) throw new Error(`old_string is not unique in ${abs}; add more context or set replace_all`);
      updated = replace_all ? updated.split(old_string).join(new_string) : updated.slice(0, idx) + new_string + updated.slice(idx + old_string.length);
    }
    await writeFile(abs, updated, "utf8");
    readHashes.set(abs, fileHash(updated));
    return `edited ${abs}`;
  },
}; }

function listDirTool(root) { return {
  name: "list_dir",
  mutating: false,
  description: "List entries in a directory (defaults to the current directory).",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Directory path (default '.')." } },
  },
  run: async ({ path: p }) => {
    const abs = resolvePath(root, p || ".");
    const entries = await readdir(abs);
    const lines = await Promise.all(
      entries.sort().map(async (name) => {
        try {
          const s = await stat(path.join(abs, name));
          return s.isDirectory() ? `${name}/` : name;
        } catch {
          return name;
        }
      }),
    );
    return clip(lines.join("\n") || "[empty]");
  },
}; }

// ---- search & patch tools ----

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", ".cache", ".next",
]);
const MAX_WALK_FILE_BYTES = 2 * 1024 * 1024;

// Recursively yield readable file paths under `root`, skipping vendor/VCS dirs
// and files larger than MAX_WALK_FILE_BYTES. If `root` is itself a file, yields
// just that file.
async function* walkFiles(root) {
  let st;
  try {
    st = await stat(root);
  } catch {
    return;
  }
  if (st.isFile()) {
    yield root;
    return;
  }
  if (!st.isDirectory()) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) yield* walkFiles(full);
    } else if (e.isFile()) {
      try {
        const s = await stat(full);
        if (s.size <= MAX_WALK_FILE_BYTES) yield full;
      } catch {
        // unreadable; skip
      }
    }
  }
}

// Translate a glob (**, *, ?) into an anchored RegExp matched against a path.
// `*` stops at "/"; `**` (optionally followed by "/") crosses directories.
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { re += "(?:.*/)?"; i++; }
        else re += ".*";
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+.^$()[]{}|\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function grepTool(root) { return {
  name: "grep",
  mutating: false,
  description:
    "Search file contents by JavaScript regular expression across the working tree. Returns matches as path:line:text. Skips node_modules, .git, and binary/large files.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "JavaScript regular expression matched per line." },
      path: { type: "string", description: "Directory or file to search (default '.')." },
      glob: { type: "string", description: "Optional filename glob to restrict files, e.g. '*.mjs'." },
      ignore_case: { type: "boolean", description: "Case-insensitive match (default false)." },
      max_results: { type: "number", description: "Max matching lines (default 200)." },
    },
    required: ["pattern"],
  },
  run: async ({ pattern, path: p = ".", glob, ignore_case, max_results = 200 }) => {
    let re;
    try {
      re = new RegExp(pattern, ignore_case ? "i" : "");
    } catch (e) {
      return `ERROR: invalid regex: ${e.message}`;
    }
    const nameRe = glob ? globToRegExp(glob) : null;
    const searchRoot = resolvePath(root, p);
    const results = [];
    for await (const file of walkFiles(searchRoot)) {
      if (nameRe && !nameRe.test(glob.includes("/") ? path.relative(searchRoot, file).split(path.sep).join("/") : path.basename(file))) continue;
      let content;
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue; // binary
      const rel = relativeProjectPath(root, file);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${rel}:${i + 1}:${lines[i].slice(0, 300)}`);
          if (results.length >= max_results) {
            return clip(results.join("\n") + `\n…[capped at ${max_results} matches]`);
          }
        }
      }
    }
    return results.length ? clip(results.join("\n")) : "[no matches]";
  },
}; }

function globTool(root) { return {
  name: "glob",
  mutating: false,
  description:
    "List files matching a glob pattern (supports **, *, ?) under a base directory. Skips node_modules and .git. Paths are returned relative to the cwd, sorted.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob such as 'src/**/*.mjs' or '*.json'." },
      path: { type: "string", description: "Base directory to search from (default '.')." },
      max_results: { type: "number", description: "Max paths to return (default 500)." },
    },
    required: ["pattern"],
  },
  run: async ({ pattern, path: p = ".", max_results = 500 }) => {
    const searchRoot = resolvePath(root, p);
    const re = globToRegExp(pattern);
    const found = [];
    for await (const file of walkFiles(searchRoot)) {
      const rel = path.relative(searchRoot, file);
      if (re.test(rel)) {
        found.push(relativeProjectPath(root, file) || rel);
        if (found.length >= max_results) break;
      }
    }
    found.sort();
    return found.length ? clip(found.join("\n")) : "[no files matched]";
  },
}; }

// Apply a unified diff to one file's content. Strictly verifies context and
// removed lines against the source (no fuzzy matching), so a bad diff fails
// loudly instead of corrupting the file. Hunk line counts bound each hunk.
function applyUnifiedDiff(content, diff) {
  const src = content.split("\n");
  const out = [];
  let srcIdx = 0;
  const dl = diff.split("\n");
  let i = 0;
  while (i < dl.length && !dl[i].startsWith("@@")) i++;
  if (i >= dl.length) throw new Error("no @@ hunk found in diff");

  while (i < dl.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(dl[i]);
    if (!m) {
      i++;
      continue;
    }
    const oldStart = parseInt(m[1], 10);
    let oldRem = m[2] === undefined ? 1 : parseInt(m[2], 10);
    let newRem = m[4] === undefined ? 1 : parseInt(m[4], 10);
    i++;

    const target = oldRem === 0 ? oldStart : oldStart - 1;
    if (target < 0 || target > src.length) throw new Error("hunk starts outside the source file");
    if (target < srcIdx) throw new Error(`hunk at line ${oldStart} overlaps a previous hunk`);
    while (srcIdx < target) out.push(src[srcIdx++]);

    while (i < dl.length && (oldRem > 0 || newRem > 0)) {
      const line = dl[i];
      const tag = line === "" ? " " : line[0];
      const text = line === "" ? "" : line.slice(1);
      if (tag === "+") {
        if (newRem <= 0) throw new Error("hunk has too many added lines");
        out.push(text);
        newRem--;
      } else if (tag === "-") {
        if (oldRem <= 0) throw new Error("hunk has too many removed lines");
        if (src[srcIdx] !== text) {
          throw new Error(`removal mismatch at line ${srcIdx + 1}: expected "${text}", found "${src[srcIdx] ?? "<eof>"}"`);
        }
        srcIdx++;
        oldRem--;
      } else if (tag === " ") {
        if (oldRem <= 0 || newRem <= 0) throw new Error("hunk has excess context");
        if (src[srcIdx] !== text) {
          throw new Error(`context mismatch at line ${srcIdx + 1}: expected "${text}", found "${src[srcIdx] ?? "<eof>"}"`);
        }
        out.push(src[srcIdx++]);
        oldRem--;
        newRem--;
      } else if (tag === "\\") {
        // "\ No newline at end of file" — nothing to apply
      } else {
        break; // header of a following file section, etc.
      }
      i++;
    }
    if (oldRem !== 0 || newRem !== 0) throw new Error("incomplete hunk");
    if (i < dl.length && /^[ +\-]/.test(dl[i]) && dl[i] !== "") throw new Error("unexpected lines after hunk");
  }
  while (srcIdx < src.length) out.push(src[srcIdx++]);
  return out.join("\n");
}

function patchTool(root) { return {
  name: "patch",
  mutating: true,
  description:
    "Apply a unified diff to a single file (multi-hunk). ---/+++ headers are ignored; @@ hunks are required. Verifies context strictly and writes nothing if the diff does not apply.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to patch." },
      diff: { type: "string", description: "Unified diff text with @@ hunks." }, expected_hash: { type: "string" },
    },
    required: ["path", "diff"],
  },
  run: async ({ path: p, diff, expected_hash }) => {
    const abs = resolvePath(root, p);
    let content;
    try {
      content = await readFile(abs, "utf8");
    } catch (e) {
      return `ERROR: cannot read ${abs}: ${e.message}`;
    }
    assertFreshContent(abs, content, expected_hash, p);
    let updated;
    try {
      updated = applyUnifiedDiff(content, diff || "");
    } catch (e) {
      return `ERROR: patch does not apply: ${e.message}`;
    }
    await writeFile(abs, updated, "utf8");
    readHashes.set(abs, fileHash(updated));
    return `patched ${abs}`;
  },
}; }

function fileHash(content) { return createHash("sha256").update(content).digest("hex"); }
async function assertFresh(abs, expectedHash) {
  let content = null;
  try { content = await readFile(abs, "utf8"); } catch (err) { if (err.code !== "ENOENT") throw err; }
  if (content != null) assertFreshContent(abs, content, expectedHash, abs);
  else if (expectedHash || readHashes.has(abs)) throw new Error(`stale file hash for ${abs}; read the file again before editing`);
}
function assertFreshContent(abs, content, expectedHash, label) {
  const actualHash = fileHash(content);
  if ((expectedHash && expectedHash !== actualHash) || (readHashes.has(abs) && readHashes.get(abs) !== actualHash)) throw new Error(`stale file hash for ${label}; read the file again before editing`);
}
function genericTools(root, processOptions) { return [bashTool(processOptions), readFileTool(root), writeFileTool(root), editFileTool(root), listDirTool(root), grepTool(root), globTool(root), patchTool(root)]; }

// ---- external tool registry (for plugins / future MCP) ----
// A mutable box of extra tools folded into every session. Kept separate from
// GENERIC_TOOLS so a plugin can add or remove tools without editing core.
const registry = new Map();

export function registerTool(tool) {
  if (!tool || typeof tool.name !== "string" || !tool.name) {
    throw new Error("registerTool: tool must have a non-empty name");
  }
  if (typeof tool.run !== "function") {
    throw new Error(`registerTool: tool "${tool.name}" needs a run() function`);
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error("registerTool: name must match [a-zA-Z0-9_-] and be at most 64 characters");
  registry.set(tool.name, tool);
  return tool.name;
}

export function unregisterTool(name) {
  return registry.delete(name);
}

export function registeredTools() {
  return [...registry.values()];
}

// The "subagent" tool: delegates a focused sub-task to a fresh nested agent
// loop (its own message history, same real tools minus itself) and returns
// only the final answer — keeps the parent's context small. `modelRef` is a
// mutable box so the subagent always uses whichever model is currently
// active (it can change at runtime via /model or /models), not whatever was
// active when the tool set was built.
function subagentTool({ modelRef, agents, system, realTools }) {
  return {
    name: "subagent",
    mutating: true,
    description:
      "Delegate one focused task; returns only the final answer. Personas: " + agents.map(a => `${a.name}: ${a.description}`).join("; ") + ". Named Sats have fixed tool allowlists. Every internal mutation uses the parent approval gate. Cancellation and budgets are shared; recursive delegation is unavailable.",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Bundled or user persona name (optional). Available: " + agents.map(a => a.name).join(", ") },
        prompt: { type: "string", description: "The sub-task to delegate." },
      },
      required: ["prompt"],
    },
    serial: true,
    run: async ({ agent, prompt }, execution = {}) => {
      const { context: parentContext, limits, fallbacks, signal, state, readOnly, callModelImpl } = execution;
      const approve = execution.approve ?? execution.hooks?.approve;
      const text = await runSubagent({ agent, prompt, agents, target: modelRef.current, system, tools: realTools, parentContext, approve, limits, fallbacks, signal, state, readOnly, callModelImpl,
        // Autonomous child output stays in the child context. Mutation tracking
        // and user questions still belong to the parent interaction.
        hooks: { onMutation: execution.hooks?.onMutation, askUser: execution.hooks?.askUser, onFallback: execution.hooks?.onFallback, onUsage: execution.hooks?.onUsage } });
      return clip(text || "[subagent returned no text]");
    },
  };
}

// The full tool set for a session: generic coding tools, Bitcoin tools bound
// to the network resolved from config, Liquid tools (always available,
// read-only, public infra), Lightning tools (only if config.lightning is
// set — no sensible public default exists for a node you don't control),
// Cashu ecash tools (when mint URL is available), CoinJoin temp-wallet tools
// (isolated wallet lifecycle for /btc:coinjoin, always available), and
// (given a modelRef + agents) the subagent delegation tool.
//
// Wavelength self-custodial wallet tools are NOT built here: unlike the
// other verticals, standing them up means spawning and MCP-handshaking with
// a local `waved` daemon, which is inherently async. They're wired in by
// loadExtensions() in cli.mjs (same async stage as plugins/config.mcp) and
// land in `registeredTools()` before this function runs.
export function buildTools(config = {}, { modelRef, agents = [], system = "", lightning = resolveLightning(config), skills, plan, profile = "bitcoin", workspaceRoot = process.cwd(), sandbox = false } = {}) {
  const root = projectRoot(workspaceRoot);
  const base = [
    ...genericTools(root, { workspaceRoot: root, sandbox }),
    ...processToolsFor({ workspaceRoot: root, sandbox }),
    ...workspaceTools({ skills, plan, workspaceRoot: root }),
    ...registeredTools().filter(tool => !tool.profile || tool.profile === profile),
  ];
  if (profile === "bitcoin") base.push(
    ...bitcoinTools(config), ...liquidTools(config), bolt11Tool,
    ...(lightning ? lightningTools(lightning) : []), ...cashuTools(config), ...coinjoinTools(config),
  );
  // Dedup by name, last wins — a registered tool may override a built-in.
  const realTools = [...new Map(base.map((t) => [t.name, t])).values()];
  if (!modelRef) return realTools;
  return [...realTools.filter(t => t.name !== "subagent"), subagentTool({ modelRef, agents, system, realTools })];
}
