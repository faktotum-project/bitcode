import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync, readlinkSync, symlinkSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRoot, resolveWorkspacePath, relativeProjectPath } from "./project.mjs";

const ignored = new Set([".git", "node_modules"]);
function runGit(root, args) {
  try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
}
function isGit(root) { return runGit(root, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true"; }
function walk(root, base = root, out = new Set()) {
  let names = [];
  try { names = readdirSync(root); } catch { return out; }
  for (const name of names) {
    // Nested dependency trees (desktop/node_modules, integrations/*/node_modules)
    // are as irrelevant to a turn as the root one, and slow to snapshot.
    if (ignored.has(name)) continue;
    const file = path.join(root, name); const rel = path.relative(base, file);
    let st; try { st = lstatSync(file); } catch { continue; }
    if (st.isDirectory()) walk(file, base, out); else out.add(rel);
  }
  return out;
}
function fingerprint(file) {
  try {
    const st = lstatSync(file);
    if (st.isSymbolicLink()) return `link:${readlinkSync(file)}`;
    if (!st.isFile()) return `other:${st.mode}`;
    return `file:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  } catch { return null; }
}
function copyOne(from, to) {
  const st = lstatSync(from); mkdirSync(path.dirname(to), { recursive: true });
  if (st.isSymbolicLink()) symlinkSync(readlinkSync(from), to); else copyFileSync(from, to);
}
function removeOne(file) { try { rmSync(file, { recursive: true, force: true }); } catch {} }
function lineCounts(before, after) {
  if (before == null) return { added: after ? after.split("\n").length - 1 : 0, removed: 0 };
  if (after == null) return { added: 0, removed: before.split("\n").length - 1 };
  const a = before.split("\n"), b = after.split("\n");
  // Deterministic, inexpensive approximation that is exact for append/delete.
  let start = 0; while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1, endB = b.length - 1; while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  return { added: Math.max(0, endB - start + 1), removed: Math.max(0, endA - start + 1) };
}

// A checkpoint is deliberately filesystem based. It also snapshots .git/index,
// so a turn that ran `git add` can be restored without using stash/reset.
export class TurnCheckpoint {
  constructor(root = process.cwd()) { this.root = projectRoot(root); this.reset(); }
  reset() { this.active = false; this.dir = null; this.before = new Map(); this.after = new Map(); this.protected = new Set(); this.changed = []; this.git = false; this.index = null; this.afterIndex = null; }
  begin(tc = {}) {
    if (this.active) return;
    this.active = true; this.git = isGit(this.root); this.dir = mkdtempSync(path.join(os.tmpdir(), "bitcode-checkpoint-"));
    const files = walk(this.root);
    for (const rel of files) this.capture(rel);
    if (this.git) {
      const index = runGit(this.root, ["rev-parse", "--git-path", "index"])?.trim();
      if (index) { this.index = path.resolve(this.root, index); if (existsSync(this.index)) { const target = path.join(this.dir, "index-before"); copyFileSync(this.index, target); } }
    }
    this.recordProtected(tc);
  }
  recordProtected(tc) {
    if (!tc || !["write_file", "edit_file", "patch"].includes(tc.name)) return;
    try { this.protected.add(relativeProjectPath(this.root, resolveWorkspacePath(this.root, tc.args?.path))); } catch { /* tool reports the path error itself */ }
  }
  capture(rel) {
    if (this.before.has(rel)) return;
    // Validate the containing directory, but fingerprint the entry itself as
    // finalize() does: resolving it would compare a symlink's target with the link.
    const source = path.join(resolveWorkspacePath(this.root, path.dirname(rel)), path.basename(rel)); const mark = fingerprint(source);
    this.before.set(rel, mark); if (mark != null) copyOne(source, path.join(this.dir, "before", rel));
  }
  finalize() {
    if (!this.active) return [];
    const current = walk(this.root); const all = new Set([...this.before.keys(), ...current]);
    this.after = new Map([...all].map(rel => [rel, fingerprint(path.join(this.root, rel))]));
    this.changed = [...all].filter(rel => this.before.get(rel) !== this.after.get(rel)).sort();
    if (this.index) this.afterIndex = fingerprint(this.index);
    return this.summary();
  }
  summary() {
    return this.changed.map(rel => {
      let before = null, after = null;
      try { if (this.before.get(rel)?.startsWith("file:")) before = readFileSync(path.join(this.dir, "before", rel), "utf8"); } catch {}
      try { if (this.after.get(rel)?.startsWith("file:")) after = readFileSync(path.join(this.root, rel), "utf8"); } catch {}
      return { path: rel, ...lineCounts(before, after) };
    });
  }
  diff() {
    if (!this.active) return "No checkpoint for this turn.";
    const current = path.join(this.dir, "current"); removeOne(current); mkdirSync(current, { recursive: true });
    for (const rel of walk(this.root)) copyOne(path.join(this.root, rel), path.join(current, rel));
    try { return execFileSync("git", ["diff", "--no-index", "--no-ext-diff", "--color=always", path.join(this.dir, "before"), current], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }); }
    catch (err) { return String(err.stdout || "[no changes]").replaceAll(this.dir + "/before", "checkpoint").replaceAll(current, "."); }
  }
  undo() {
    if (!this.active) return { ok: false, error: "no agent checkpoint to undo" };
    const restore = this.git ? this.changed : this.changed.filter(rel => this.protected.has(rel));
    const conflicts = restore.filter(rel => fingerprint(path.join(this.root, rel)) !== this.after.get(rel));
    if (this.git && this.index && fingerprint(this.index) !== this.afterIndex) conflicts.push(".git/index");
    if (conflicts.length) return { ok: false, error: "files changed after the agent turn", conflicts: [...new Set(conflicts)].sort() };
    for (const rel of restore) {
      const target = resolveWorkspacePath(this.root, rel); removeOne(target);
      if (this.before.get(rel) != null) copyOne(path.join(this.dir, "before", rel), target);
    }
    if (this.git && this.index) {
      const saved = path.join(this.dir, "index-before");
      if (existsSync(saved)) copyFileSync(saved, this.index); else removeOne(this.index);
    }
    const undone = restore.slice(); this.reset();
    return { ok: true, files: undone };
  }
}
