import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { savePlan, latestPlan, listPlans, plansDir } from "../src/plans.mjs";
import { slug } from "../src/session.mjs";

test("plans are saved in the project and older ones in the home dir are still found", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "bitcode-plans-"));
  const previous = process.env.BITCODE_HOME;
  process.env.BITCODE_HOME = path.join(scratch, "home");
  try {
    const project = path.join(scratch, "project");
    mkdirSync(project);
    const legacy = path.join(scratch, "home", "plans", slug(project));
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "2026-01-01T00-00-00-000Z.md"), "# old\n");
    assert.equal(latestPlan(project).text, "# old\n");

    const file = savePlan(project, { task: "new task", text: "steps" });
    assert.equal(path.dirname(file), path.join(project, ".bitcode", "plans"));
    assert.equal(plansDir(project), path.dirname(file));
    assert.match(latestPlan(project).text, /^# new task\n\nsteps/);
    assert.deepEqual(listPlans(project).map((p) => p.file), [file, path.join(legacy, "2026-01-01T00-00-00-000Z.md")]);
  } finally {
    if (previous === undefined) delete process.env.BITCODE_HOME; else process.env.BITCODE_HOME = previous;
    rmSync(scratch, { recursive: true, force: true });
  }
});
