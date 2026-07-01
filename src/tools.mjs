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

const GENERIC_TOOLS = [bash, readFileTool, writeFileTool, editFileTool, listDirTool];

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
// and (given a modelRef + agents) the subagent delegation tool.
export function buildTools(config = {}, { modelRef, agents = [], system = "", lightning = null } = {}) {
  const realTools = [
    ...GENERIC_TOOLS,
    ...bitcoinTools(config),
    ...liquidTools(config),
    bolt11Tool,
    ...(lightning ? lightningTools(lightning) : []),
  ];
  if (!modelRef) return realTools;
  return [...realTools, subagentTool({ modelRef, agents, system, realTools })];
}
