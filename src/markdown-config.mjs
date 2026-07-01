// Shared loader for markdown-defined config (custom /commands, /subagent
// personas): a directory of *.md files, each optionally starting with a
// "---\nkey: value\n---\n" frontmatter block, followed by a free-form body.
// The filename (without .md) is the item's name.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: raw };
  const header = raw.slice(4, end);
  let body = raw.slice(end + 4);
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);

  const meta = {};
  for (const line of header.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body };
}

// Reads every *.md file directly inside `dir` (no recursion). Returns
// [] if the directory doesn't exist — these features are all optional.
export function loadMarkdownDir(dir) {
  if (!existsSync(dir)) return [];
  const items = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(path.join(dir, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    items.push({
      name: file.slice(0, -3),
      description: meta.description || "",
      body: body.trim(),
    });
  }
  return items;
}
