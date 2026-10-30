import { bitcodeHome } from "./paths.mjs";
// Persistence for /plan output: a read-only investigation turn whose final
// answer becomes a plan file that /build can later execute against.
// Plans live in the project (<root>/.bitcode/plans); older ones saved under
// ~/.bitcode/plans/<slug> are still listed and read.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { slug } from "./session.mjs";

export function plansDir(cwd) {
  return path.join(cwd, ".bitcode", "plans");
}

const legacyPlansDir = (cwd) => path.join(bitcodeHome(), "plans", slug(cwd));

export function savePlan(cwd, { task, text }) {
  const dir = plansDir(cwd);
  mkdirSync(dir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${id}.md`);
  writeFileSync(file, `# ${task}\n\n${text}\n`);
  return file;
}

// Newest first; file names are timestamps, so the name orders them.
export function listPlans(cwd) {
  const byName = new Map();
  for (const dir of [legacyPlansDir(cwd), plansDir(cwd)]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (name.endsWith(".md")) byName.set(name, path.join(dir, name));
  }
  return [...byName].sort(([a], [b]) => b.localeCompare(a)).map(([name, file]) => ({ name, file }));
}

export function latestPlan(cwd) {
  const [latest] = listPlans(cwd);
  return latest ? { file: latest.file, text: readFileSync(latest.file, "utf8") } : null;
}
