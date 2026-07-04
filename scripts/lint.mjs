// Zero-dependency "lint": syntax-check every .mjs under the project with
// `node --check`. Catches parse errors without pulling in eslint.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["bitcode.mjs", "src", "tests", "scripts"];
const files = [];

function walk(p) {
  if (!existsSync(p)) return;
  const s = statSync(p);
  if (s.isDirectory()) {
    for (const e of readdirSync(p)) walk(path.join(p, e));
  } else if (p.endsWith(".mjs")) {
    files.push(p);
  }
}
for (const r of roots) walk(path.join(root, r));

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    failed++;
    process.stderr.write(`✗ ${path.relative(root, f)}\n${e.stderr?.toString() || e.message}\n`);
  }
}

if (failed) {
  process.stderr.write(`\n${failed} file(s) failed syntax check\n`);
  process.exit(1);
}
process.stdout.write(`✓ ${files.length} files OK\n`);
