// Chooses between the full-screen UI and the classic line REPL, and wires the
// full-screen app to the CLI's commands, sessions, models and status.
import { execFileSync } from "node:child_process";
import os from "node:os";
import { createApp } from "./app.mjs";
import { createTheme } from "./theme.mjs";
import { projectFiles } from "./files.mjs";
import { PROFILES } from "../project.mjs";
import { SAT_IDS } from "../sats/policy.mjs";

// Full screen needs a real terminal both ways and colour; BITCODE_UI=line keeps the line REPL.
export function fullscreenSupported(caps, env = process.env, stdin = process.stdin) {
  const forced = String(env.BITCODE_UI || "").toLowerCase();
  if (forced === "line" || forced === "text") return false;
  return Boolean(stdin.isTTY && caps.tty && caps.level !== "text");
}

function gitBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const tilde = (dir) => (dir.startsWith(os.homedir()) ? "~" + dir.slice(os.homedir().length) : dir);

export function createPresenter({ caps, lang, cwd, commands, history, listSessions, modelChoices = () => [], status, env = process.env }) {
  const branch = gitBranch(cwd);
  const args = {
    profile: () => [...PROFILES].map((value) => ({ value })),
    sat: () => [...SAT_IDS, "info", "workspace"].map((value) => ({ value })),
    session: () => ["list", "save", "load", "export"].map((value) => ({ value })),
    config: () => ["get", "set"].map((value) => ({ value })),
    provider: () => ["list", "health", "add"].map((value) => ({ value })),
    model: modelChoices,
  };
  return createApp({
    theme: createTheme(),
    lang,
    caps,
    commands,
    history,
    mouse: env.BITCODE_MOUSE !== "0",
    argChoices: (name) => args[name]?.() || [],
    files: () => projectFiles(cwd),
    sessions: () => listSessions().map((s) => ({ id: s.id, label: s.name || s.id, hint: `${s.messageCount} msg${s.model ? " · " + s.model : ""}` })),
    status: () => ({ cwd: tilde(cwd), branch, ...status() }),
  });
}
