// Project files for "@" completion: git's view when available, otherwise a shallow walk.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const LIMIT = 5000;
const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "target", ".venv", "__pycache__"]);

function walk(root, dir = "", depth = 0, out = []) {
  if (depth > 5 || out.length >= LIMIT) return out;
  let entries = [];
  try { entries = readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".github")) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, rel, depth + 1, out);
    else out.push(rel);
    if (out.length >= LIMIT) break;
  }
  return out;
}

export function projectFiles(root) {
  try {
    const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 });
    return listed.split("\n").filter(Boolean).slice(0, LIMIT);
  } catch {
    return walk(root);
  }
}

// Subsequence match scored by compactness, with a bonus for hits in the file name.
export function fuzzyFiles(files, query, max = 8) {
  const q = query.toLowerCase();
  if (!q) return files.slice(0, max);
  const scored = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    let at = -1, first = -1, gaps = 0, ok = true;
    for (const ch of q) {
      const next = lower.indexOf(ch, at + 1);
      if (next < 0) { ok = false; break; }
      if (first < 0) first = next;
      gaps += at < 0 ? 0 : next - at - 1;
      at = next;
    }
    if (!ok) continue;
    const base = lower.lastIndexOf("/") + 1;
    scored.push({ file, score: gaps + (first >= base ? 0 : 20) + file.length / 100 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, max).map((s) => s.file);
}
