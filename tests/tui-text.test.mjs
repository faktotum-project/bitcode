import test from "node:test";
import assert from "node:assert/strict";
import { stringWidth, truncate, truncateStart } from "../src/tui/width.mjs";
import { fromAnsi, wrapLine, plainText, seg } from "../src/tui/text.mjs";
import { parseKeys } from "../src/tui/keys.mjs";
import { createScreen } from "../src/tui/screen.mjs";

test("stringWidth counts wide and zero-width graphemes", () => {
  assert.equal(stringWidth("abc"), 3);
  assert.equal(stringWidth("日本"), 4);
  assert.equal(stringWidth("🎉"), 2);
  assert.equal(stringWidth("é"), 1);
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncateStart("/a/b/c/d", 5), "…/c/d");
});

test("fromAnsi turns theme colours into styled segments", () => {
  const [line, next] = fromAnsi("\x1b[1mbold\x1b[0m \x1b[38;2;247;147;26mo\x1b[0m\nx");
  assert.deepEqual(line.map((s) => s.text), ["bold", " ", "o"]);
  assert.equal(line[0].style.bold, true);
  assert.equal(line[2].style.fg, "#f7931a");
  assert.equal(plainText(next), "x");
});

test("wrapLine breaks on words and splits words longer than the width", () => {
  const rows = wrapLine([seg("the quick brown fox")], 9).map(plainText);
  assert.deepEqual(rows, ["the quick", "brown fox"]);
  assert.deepEqual(wrapLine([seg("abcdefghij")], 4).map(plainText), ["abcd", "efgh", "ij"]);
});

test("parseKeys reads control keys, modifiers, paste and mouse", () => {
  const keys = [...parseKeys("a\x10\x1b[Z\x1b[200~x\ny\x1b[201~\x1b[<64;3;4M\x1b\r\x1b")];
  assert.deepEqual(keys.map((k) => k.name), ["text", "ctrl-p", "backtab", "paste", "mouse", "enter", "escape"]);
  assert.equal(keys[3].text, "x\ny");
  assert.equal(keys[4].button, 64);
  assert.equal(keys[5].alt, true);
});

test("screen flush writes only changed cells after the first frame", () => {
  let written = "";
  const screen = createScreen({ output: { write: (s) => { written = s; } } });
  screen.resize(10, 2);
  screen.begin();
  screen.text(0, 0, "hello");
  screen.flush();
  assert.match(written, /hello/);
  screen.begin();
  screen.text(0, 0, "hellO");
  screen.flush();
  assert.doesNotMatch(written, /hell/);
  assert.match(written, /\x1b\[1;5H\x1b\[0mO/);
  assert.equal(screen.snapshot(), "hellO\n");
});
