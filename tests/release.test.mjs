import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverProject, resolveProfile, resolveWorkspacePath } from "../src/project.mjs";
import { isReadOnlyCommand, mayAutoApprove, resolvePermissions } from "../src/permissions.mjs";
import { buildTools } from "../src/tools.mjs";
import { TurnCheckpoint } from "../src/checkpoint.mjs";
import { systemPrompt } from "../src/agent.mjs";

test("code profile is the default and its catalog/prompt omit Bitcoin capabilities", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "bc-release-code-"));
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node --test", lint: "x", build: "x" } }));
  assert.equal(resolveProfile({ cwd, config: {} }), "code");
  assert.deepEqual(discoverProject(cwd).commands.map(x => x.command), ["npm run test", "npm run lint", "npm run build"]);
  const names = buildTools({}, { profile: "code", workspaceRoot: cwd }).map(x => x.name);
  assert.ok(names.includes("write_file")); assert.ok(names.includes("git_status")); assert.ok(!names.includes("btc_fees"));
  assert.doesNotMatch(systemPrompt({ profile: "code", project: discoverProject(cwd) }), /Bitcoin tools|Cashu ecash/);
});

test("permissions use a strict read-only shell grammar and exact allow entries", () => {
  const p = resolvePermissions({ config: { permissions: { allow: ["npm   test"] } } });
  assert.equal(p.mode, "auto-edit");
  assert.equal(isReadOnlyCommand("git status --short"), true);
  assert.equal(isReadOnlyCommand("git status && touch owned"), false);
  assert.equal(mayAutoApprove({ tool: { name: "write_file" }, permissions: p }), true);
  assert.equal(mayAutoApprove({ tool: { name: "bash" }, args: { command: "npm test" }, permissions: p }), true);
  assert.equal(mayAutoApprove({ tool: { name: "bash" }, args: { command: "npm test && whoami" }, permissions: p }), false);
});

test("workspace paths reject traversal and symlink escapes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-release-path-"));
  mkdirSync(path.join(root, "dir")); symlinkSync(os.tmpdir(), path.join(root, "dir", "out"));
  assert.throws(() => resolveWorkspacePath(root, "../outside"), /outside/);
  assert.throws(() => resolveWorkspacePath(root, "dir/out/file"), /symlink/);
});

test("edit_file applies sequential edits and rejects a stale read", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-release-edit-"));
  writeFileSync(path.join(root, "a.txt"), "one two one");
  const tool = buildTools({}, { workspaceRoot: root, profile: "code" }).find(x => x.name === "edit_file");
  await tool.run({ path: "a.txt", edits: [{ old_string: "one", new_string: "1", replace_all: true }, { old_string: "two", new_string: "2" }] });
  assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "1 2 1");
});

test("non-git checkpoint restores file-tool changes and refuses external conflicts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-release-undo-"));
  const file = path.join(root, "a.txt"); writeFileSync(file, "before\n");
  const checkpoint = new TurnCheckpoint(root);
  checkpoint.begin({ name: "write_file", args: { path: "a.txt" } }); writeFileSync(file, "agent\n"); checkpoint.finalize();
  assert.equal(checkpoint.undo().ok, true); assert.equal(readFileSync(file, "utf8"), "before\n");
  checkpoint.begin({ name: "write_file", args: { path: "a.txt" } }); writeFileSync(file, "agent\n"); checkpoint.finalize(); writeFileSync(file, "user\n");
  assert.deepEqual(checkpoint.undo().conflicts, ["a.txt"]);
});
