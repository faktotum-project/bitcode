import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectLintFiles } from "../scripts/lint.mjs";

test("lint discovery skips dependencies, scratch copies and build output", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-lint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const included = path.join(root, "src", "feature.mjs");
  mkdirSync(path.dirname(included), { recursive: true });
  writeFileSync(included, "export const valid = true;\n");
  for (const directory of [".git/objects", "node_modules/package", ".work/clone", ".sats-build/output", "dist", "build", "release", "coverage"]) {
    const target = path.join(root, "src", directory);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "invalid.mjs"), "export const broken =\n");
  }
  assert.deepEqual(collectLintFiles(root), [included]);
});
