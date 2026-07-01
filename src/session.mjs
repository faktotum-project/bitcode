// Interactive-session persistence: save/resume REPL conversations to disk so
// closing the terminal (or the power going out) doesn't lose the history.
// One-shot mode (-p) never touches this module — it stays ephemeral.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

function slug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

export function sessionsDir(cwd) {
  return path.join(homedir(), ".bitcode", "sessions", slug(cwd));
}

export function newSessionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function sessionFile(cwd, id) {
  return path.join(sessionsDir(cwd), `${id}.json`);
}

// Lightweight listing: parses each file just for its header fields, not the
// full (potentially large) messages array.
export function listSessions(cwd) {
  const dir = sessionsDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const file = path.join(dir, f);
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        return {
          id: data.id || f.slice(0, -5),
          file,
          updatedAt: data.updatedAt || statSync(file).mtime.toISOString(),
          model: data.model || null,
          name: data.name || null,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function latestSession(cwd) {
  return listSessions(cwd)[0] || null;
}

export function loadSession(cwd, id) {
  const file = sessionFile(cwd, id);
  const data = JSON.parse(readFileSync(file, "utf8"));
  return {
    id: data.id || id,
    model: data.model || null,
    network: data.network || null,
    name: data.name || null,
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

export function saveSession(cwd, { id, model, network, messages, name }) {
  const dir = sessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const payload = {
    id,
    updatedAt: new Date().toISOString(),
    model,
    network,
    name: name || null,
    messages,
  };
  writeFileSync(sessionFile(cwd, id), JSON.stringify(payload, null, 2));
}
