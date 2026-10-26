import test from "node:test";
import assert from "node:assert/strict";
import { createEditor, edit, layoutEditor, remember } from "../src/tui/editor.mjs";
import { fuzzyFiles } from "../src/tui/files.mjs";

test("editor inserts, deletes graphemes and moves across lines", () => {
  const e = createEditor();
  edit(e, { name: "text", text: "ab🎉" });
  edit(e, { name: "backspace" });
  assert.equal(e.text, "ab");
  edit(e, { name: "newline" });
  edit(e, { name: "text", text: "cd" });
  edit(e, { name: "up" });
  assert.equal(e.cursor, 2);
  edit(e, { name: "ctrl-w" });
  assert.equal(e.text, "\ncd");
});

test("up and down browse history from the first and last line", () => {
  const e = createEditor(["first", "second"]);
  edit(e, { name: "text", text: "draft" });
  edit(e, { name: "up" });
  assert.equal(e.text, "second");
  edit(e, { name: "up" });
  assert.equal(e.text, "first");
  edit(e, { name: "down" });
  edit(e, { name: "down" });
  assert.equal(e.text, "draft");
  remember(e, "third");
  assert.deepEqual(e.history, ["first", "second", "third"]);
});

test("layoutEditor wraps by column and places the cursor on the wrapped row", () => {
  assert.deepEqual(layoutEditor("abcdef", 6, 4), { rows: ["abcd", "ef"], cursorRow: 1, cursorCol: 2 });
  assert.deepEqual(layoutEditor("abcd", 4, 4), { rows: ["abcd", ""], cursorRow: 1, cursorCol: 0 });
  assert.equal(layoutEditor("ab\ncd", 1, 10).cursorRow, 0);
});

test("fuzzyFiles prefers matches in the file name", () => {
  const files = ["src/cli.mjs", "src/tui/app.mjs", "docs/clients.md"];
  assert.equal(fuzzyFiles(files, "app")[0], "src/tui/app.mjs");
  assert.equal(fuzzyFiles(files, "cli")[0], "src/cli.mjs");
  assert.deepEqual(fuzzyFiles(files, "zzz"), []);
});
