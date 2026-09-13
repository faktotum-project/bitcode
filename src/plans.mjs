import { bitcodeHome } from "./paths.mjs";
// Persistence for /plan output: a read-only investigation turn whose final
// answer becomes a plan file that /build can later execute against.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { slug } from "./session.mjs";

export function plansDir(cwd) {
  return path.join(bitcodeHome(), "plans", slug(cwd));
}

export function savePlan(cwd, { task, text }) {
  const dir = plansDir(cwd);
  mkdirSync(dir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${id}.md`);
  writeFileSync(file, `# ${task}\n\n${text}\n`);
  return file;
}

export function latestPlan(cwd) {
  const dir = plansDir(cwd);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) return null;
  const file = path.join(dir, files[files.length - 1]);
  return { file, text: readFileSync(file, "utf8") };
}
