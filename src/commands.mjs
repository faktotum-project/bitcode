// Custom slash commands: markdown files, each becoming its own /<name>
// command in the interactive REPL. The body is a prompt template —
// "$ARGUMENTS" is replaced with whatever the user typed after the command
// name; with no placeholder, typed text is just appended.
//
// Two sources are merged, user entries winning on name collisions:
//   - bundled:  <repo>/commands/       (shipped with bitcode)
//   - user:     ~/.bitcode/commands/   (personal additions/overrides)
// In either source, a file directly inside becomes /<name> (e.g. fees.md ->
// /fees); a file one directory down becomes /<dir>:<name> (e.g.
// btc/fees.md -> /btc:fees), mirroring pi's "/skill:name" namespacing.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadMarkdownDir } from "./markdown-config.mjs";

export function commandsDir() {
  return path.join(homedir(), ".bitcode", "commands");
}

function bundledCommandsDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "commands");
}

function loadCommandsFrom(dir) {
  const top = loadMarkdownDir(dir);
  const namespaced = [];
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const cmd of loadMarkdownDir(path.join(dir, entry.name))) {
        namespaced.push({ ...cmd, name: `${entry.name}:${cmd.name}` });
      }
    }
  }
  return [...top, ...namespaced];
}

export function loadCommands() {
  const bundled = loadCommandsFrom(bundledCommandsDir());
  const user = loadCommandsFrom(commandsDir());
  const byName = new Map(bundled.map((c) => [c.name, c]));
  for (const c of user) byName.set(c.name, c);
  return [...byName.values()];
}

export function expandCommand(command, args) {
  if (command.body.includes("$ARGUMENTS")) {
    return command.body.split("$ARGUMENTS").join(args);
  }
  return args ? `${command.body}\n\n${args}` : command.body;
}
