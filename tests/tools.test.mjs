import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const { buildTools, registerTool, unregisterTool } = await import("../src/tools.mjs");

let get;

before(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bc-tools-"));
  process.chdir(dir);
  mkdirSync("src/sub", { recursive: true });
  writeFileSync("src/a.mjs", "export const x = 1;\nfunction foo() { return 42; }\n");
  writeFileSync("src/sub/b.mjs", "// TODO: fix me\nconst y = foo();\n");
  writeFileSync("README.md", "# title\nTODO later\n");
  const tools = buildTools({}, {});
  get = (n) => tools.find((t) => t.name === n);
});

test("grep finds matches across the tree as path:line:text", async () => {
  const r = await get("grep").run({ pattern: "TODO" });
  assert.match(r, /README\.md:2:TODO later/);
  assert.match(r, /src\/sub\/b\.mjs:1:\/\/ TODO/);
});

test("grep honours a filename glob", async () => {
  const r = await get("grep").run({ pattern: "foo\\(", glob: "*.mjs" });
  assert.match(r, /src\/a\.mjs:2/);
  assert.doesNotMatch(r, /README/);
});

test("glob ** crosses directories, * does not", async () => {
  const deep = await get("glob").run({ pattern: "src/**/*.mjs" });
  assert.equal(deep.split("\n").sort().join(","), "src/a.mjs,src/sub/b.mjs");
  const top = await get("glob").run({ pattern: "*.md" });
  assert.equal(top, "README.md");
});

test("patch applies a unified diff", async () => {
  const diff = [
    "@@ -1,2 +1,2 @@",
    " export const x = 1;",
    "-function foo() { return 42; }",
    "+function foo() { return 99; }",
  ].join("\n");
  const r = await get("patch").run({ path: "src/a.mjs", diff });
  assert.match(r, /^patched /);
  assert.match(readFileSync("src/a.mjs", "utf8"), /return 99/);
});

test("patch refuses a mismatching context and writes nothing", async () => {
  const before = readFileSync("src/a.mjs", "utf8");
  const bad = ["@@ -1,1 +1,1 @@", " WRONG", "+x"].join("\n");
  const r = await get("patch").run({ path: "src/a.mjs", diff: bad });
  assert.match(r, /does not apply/);
  assert.equal(readFileSync("src/a.mjs", "utf8"), before);
});

test("registry adds, overrides (dedup), and removes tools", async () => {
  registerTool({ name: "ping", run: async () => "pong" });
  registerTool({ name: "grep", run: async () => "OVERRIDDEN" });
  let tools = buildTools({}, {});
  assert.ok(tools.find((t) => t.name === "ping"));
  assert.equal(tools.filter((t) => t.name === "grep").length, 1);
  assert.equal(await tools.find((t) => t.name === "grep").run({}), "OVERRIDDEN");
  unregisterTool("ping");
  unregisterTool("grep");
  tools = buildTools({}, {});
  assert.equal(tools.filter((t) => t.name === "ping").length, 0);
});

test("registerTool validates its argument", () => {
  assert.throws(() => registerTool({}), /non-empty name/);
  assert.throws(() => registerTool({ name: "x" }), /run\(\)/);
});
