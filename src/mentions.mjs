// "@path" file references: expanded when the message is submitted (not a
// live autocomplete-as-you-type editor — bitcode's REPL is a plain
// node:readline interface, and building a custom character-by-character
// input component just for this would be a lot of code for little payoff).
// A token like "@src/foo.js" in a typed message gets the file's content
// appended after the message, so the model sees both the mention and the
// content. Unmatched "@something" tokens (not a real path) are silently
// left alone, same as how a plain "@" in prose shouldn't break anything.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_MENTION_CHARS = 20_000;
const MENTION_RE = /@(\S+)/g;

export function expandMentions(text, cwd = process.cwd()) {
  const seen = new Set();
  let blocks = "";
  for (const m of text.matchAll(MENTION_RE)) {
    const rel = m[1].replace(/[.,;:!?)]+$/, "");
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);

    const abs = path.resolve(cwd, rel);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    let content;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (content.length > MAX_MENTION_CHARS) {
      content = content.slice(0, MAX_MENTION_CHARS) + `\n…[truncated ${content.length - MAX_MENTION_CHARS} chars]`;
    }
    blocks += `\n\n--- @${rel} ---\n${content}`;
  }
  return blocks ? text + blocks : text;
}
