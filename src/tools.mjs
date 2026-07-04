// Built-in tools the agent can call. Each tool exposes a JSON-schema `parameters`
// (sent to the model) and an async `run(args)` returning a string result.
//
// All paths resolve against process.cwd(). `mutating: true` marks tools that
// change state, so the CLI can gate them behind an approval prompt.

import { exec } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { bitcoinTools } from "./bitcoin/tools.mjs";
import { liquidTools } from "./liquid/tools.mjs";
import { lightningTools, bolt11Tool } from "./lightning/tools.mjs";
import { cashuTools } from "./cashu/tools.mjs";
import { coinjoinTools } from "./coinjoin/tools.mjs";
import { runAgent } from "./agent.mjs";
import { findAgent } from "./agents.mjs";

const MAX_RESULT_CHARS = 100_000;
const DEFAULT_BASH_TIMEOUT = 120_000;

function clip(s) {
  s = String(s);
  return s.length > MAX_RESULT_CHARS
    ? s.slice(0, MAX_RESULT_CHARS) + `\n…[truncated ${s.length - MAX_RESULT_CHARS} chars]`
    : s;
}

function resolvePath(p) {
  return path.resolve(process.cwd(), p);
}

const bash = {
  name: "bash",
  mutating: true,
  description:
    "Run a shell command in the current working directory and return combined stdout/stderr. Use for builds, tests, git, grep, etc.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
      timeout_ms: {
        type: "number",
        description: `Optional timeout in milliseconds (default ${DEFAULT_BASH_TIMEOUT}).`,
      },
    },
    required: ["command"],
  },
  run: ({ command, timeout_ms }) =>
    new Promise((resolve) => {
      exec(
        command,
        {
          cwd: process.cwd(),
          timeout: timeout_ms || DEFAULT_BASH_TIMEOUT,
          maxBuffer: 10 * 1024 * 1024,
          shell: "/bin/bash",
        },
        (err, stdout, stderr) => {
          let out = "";
          if (stdout) out += stdout;
          if (stderr) out += (out ? "\n" : "") + stderr;
          if (err && err.killed) out += `\n[command timed out]`;
          if (err && typeof err.code === "number") out += `\n[exit code ${err.code}]`;
          resolve(clip(out.trim() || "[no output]"));
        },
      );
    }),
};

const readFileTool = {
  name: "read_file",
  mutating: false,
  description: "Read a UTF-8 text file and return its contents.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Path to the file." } },
    required: ["path"],
  },
  run: async ({ path: p }) => {
    const content = await readFile(resolvePath(p), "utf8");
    return clip(content);
  },
};

const writeFileTool = {
  name: "write_file",
  mutating: true,
  description: "Create or overwrite a file with the given contents. Creates parent dirs.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  run: async ({ path: p, content }) => {
    const abs = resolvePath(p);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content ?? "", "utf8");
    return `wrote ${abs} (${(content ?? "").length} chars)`;
  },
};

const editFileTool = {
  name: "edit_file",
  mutating: true,
  description:
    "Replace the first exact occurrence of old_string with new_string in a file. old_string must be unique enough to match once.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
    },
    required: ["path", "old_string", "new_string"],
  },
  run: async ({ path: p, old_string, new_string }) => {
    const abs = resolvePath(p);
    const content = await readFile(abs, "utf8");
    const idx = content.indexOf(old_string);
    if (idx === -1) return `ERROR: old_string not found in ${abs}`;
    if (content.indexOf(old_string, idx + 1) !== -1) {
      return `ERROR: old_string is not unique in ${abs}; add more context`;
    }
    const updated = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
    await writeFile(abs, updated, "utf8");
    return `edited ${abs}`;
  },
};

const listDirTool = {
  name: "list_dir",
  mutating: false,
  description: "List entries in a directory (defaults to the current directory).",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Directory path (default '.')." } },
  },
  run: async ({ path: p }) => {
    const abs = resolvePath(p || ".");
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
};

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
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
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

const grepTool = {
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
    const root = resolvePath(p);
    const results = [];
    for await (const file of walkFiles(root)) {
      if (nameRe && !nameRe.test(path.basename(file))) continue;
      let content;
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue; // binary
      const rel = path.relative(process.cwd(), file) || file;
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
};

const globTool = {
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
    const root = resolvePath(p);
    const re = globToRegExp(pattern);
    const found = [];
    for await (const file of walkFiles(root)) {
      const rel = path.relative(root, file);
      if (re.test(rel)) {
        found.push(path.relative(process.cwd(), file) || rel);
        if (found.length >= max_results) break;
      }
    }
    found.sort();
    return found.length ? clip(found.join("\n")) : "[no files matched]";
  },
};

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

    const target = oldStart - 1;
    if (target < srcIdx) throw new Error(`hunk at line ${oldStart} overlaps a previous hunk`);
    while (srcIdx < target) out.push(src[srcIdx++]);

    while (i < dl.length && (oldRem > 0 || newRem > 0)) {
      const line = dl[i];
      const tag = line === "" ? " " : line[0];
      const text = line === "" ? "" : line.slice(1);
      if (tag === "+") {
        out.push(text);
        newRem--;
      } else if (tag === "-") {
        if (src[srcIdx] !== text) {
          throw new Error(`removal mismatch at line ${srcIdx + 1}: expected "${text}", found "${src[srcIdx] ?? "<eof>"}"`);
        }
        srcIdx++;
        oldRem--;
      } else if (tag === " ") {
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
  }
  while (srcIdx < src.length) out.push(src[srcIdx++]);
  return out.join("\n");
}

const patchTool = {
  name: "patch",
  mutating: true,
  description:
    "Apply a unified diff to a single file (multi-hunk). ---/+++ headers are ignored; @@ hunks are required. Verifies context strictly and writes nothing if the diff does not apply.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to patch." },
      diff: { type: "string", description: "Unified diff text with @@ hunks." },
    },
    required: ["path", "diff"],
  },
  run: async ({ path: p, diff }) => {
    const abs = resolvePath(p);
    let content;
    try {
      content = await readFile(abs, "utf8");
    } catch (e) {
      return `ERROR: cannot read ${abs}: ${e.message}`;
    }
    let updated;
    try {
      updated = applyUnifiedDiff(content, diff || "");
    } catch (e) {
      return `ERROR: patch does not apply: ${e.message}`;
    }
    await writeFile(abs, updated, "utf8");
    return `patched ${abs}`;
  },
};

const GENERIC_TOOLS = [
  bash,
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  grepTool,
  globTool,
  patchTool,
];

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
      "Delegate a focused sub-task to a fresh nested agent with its own context window; returns only its final answer, not the full transcript. Optionally pick a persona with `agent` (a name from ~/.bitcode/agents/*.md). Approving this tool authorizes everything the subagent does internally — it runs without further per-tool confirmation prompts.",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Name of a persona loaded from ~/.bitcode/agents/*.md (optional)." },
        prompt: { type: "string", description: "The sub-task to delegate." },
      },
      required: ["prompt"],
    },
    run: async ({ agent, prompt }) => {
      const persona = agent ? findAgent(agents, agent) : null;
      if (agent && !persona) {
        return `ERROR: unknown agent "${agent}". Known: ${agents.map((a) => a.name).join(", ") || "(none)"}`;
      }
      const nestedSystem = persona ? `${system}\n\n${persona.body}` : system;
      const messages = [{ role: "user", content: prompt }];
      const text = await runAgent({ target: modelRef.current, messages, system: nestedSystem, tools: realTools, hooks: {} });
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
export function buildTools(config = {}, { modelRef, agents = [], system = "", lightning = null } = {}) {
  const base = [
    ...GENERIC_TOOLS,
    ...bitcoinTools(config),
    ...liquidTools(config),
    bolt11Tool,
    ...(lightning ? lightningTools(lightning) : []),
    ...cashuTools(config),
    ...coinjoinTools(config),
    ...registeredTools(),
  ];
  // Dedup by name, last wins — a registered tool may override a built-in.
  const realTools = [...new Map(base.map((t) => [t.name, t])).values()];
  if (!modelRef) return realTools;
  return [...realTools, subagentTool({ modelRef, agents, system, realTools })];
}
