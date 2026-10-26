import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TurnCheckpoint } from "../src/checkpoint.mjs";

function workspace(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-checkpoint-"));
  for (const [name, size] of files) writeFileSync(path.join(root, name), Buffer.alloc(size, 97));
  return root;
}

test("workspaces beyond the file or byte budget run the turn without a snapshot", () => {
  for (const limits of [{ files: 2, bytes: 1e9 }, { files: 100, bytes: 10 }]) {
    const checkpoint = new TurnCheckpoint(workspace([["a.txt", 4], ["b.txt", 4], ["c.txt", 4]]), { limits });
    checkpoint.begin({ name: "bash" });
    assert.equal(checkpoint.oversized, true);
    assert.deepEqual(checkpoint.finalize(), []);
    assert.match(checkpoint.diff(), /too large for checkpoints/);
    assert.equal(checkpoint.undo().ok, false);
  }
});

test("a workspace within budget is still snapshotted", () => {
  const root = workspace([["a.txt", 4]]);
  const checkpoint = new TurnCheckpoint(root, { limits: { files: 10, bytes: 1000 } });
  checkpoint.begin({ name: "bash" });
  writeFileSync(path.join(root, "a.txt"), "changed\n");
  assert.equal(checkpoint.oversized, false);
  assert.deepEqual(checkpoint.finalize().map((f) => f.path), ["a.txt"]);
});
