import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/tui/markdown.mjs";
import { renderBlock, groupBlocks, toolLabel } from "../src/tui/blocks.mjs";
import { createTheme } from "../src/tui/theme.mjs";
import { strings } from "../src/tui/strings.mjs";
import { plainText } from "../src/tui/text.mjs";

const theme = createTheme("dark");
const ctx = { theme, width: 60, words: strings("en"), frame: 0, expanded: false, modeColor: theme.modeBuild };

test("markdown renders headings, lists, inline code and fenced code on a panel", () => {
  const lines = renderMarkdown("# Title\n\n- one `x`\n- **two**\n\n```js\nlet a = 1;\n```", 40, theme);
  assert.deepEqual(lines.map(plainText), ["Title", "", "• one x", "• two", "", " js", " let a = 1;"]);
  assert.equal(lines[0][0].style.fg, theme.accent);
  assert.equal(lines.at(-1).rowBg, theme.element);
});

test("tool lines carry the dot and colour of the Sat that owns the role", () => {
  const [line] = renderBlock({ kind: "tool", name: "btc_fees", sat: "node", status: "ok", preview: "" }, ctx);
  const dot = line.find((s) => s.text === "●");
  assert.equal(dot.style.fg, theme.sat.node);
  assert.match(plainText(line), /Node\s+btc fees/);
  assert.equal(toolLabel("edit_file"), "edit");
});

test("edits show a coloured diff and denied calls are struck through", () => {
  const edit = renderBlock({ kind: "tool", name: "edit_file", sat: "script", status: "ok", preview: "a.js", diff: "-old\n+new" }, ctx);
  assert.deepEqual(edit.slice(1).map((l) => plainText(l).trim()), ["-old", "+new"]);
  assert.equal(edit[2].rowBg, theme.diffAddBg);
  const denied = renderBlock({ kind: "tool", name: "bash", sat: "script", status: "denied", preview: "rm -rf x" }, ctx);
  assert.equal(denied[0].find((s) => s.text.includes("rm -rf")).style.strike, true);
});

test("three or more successful reads collapse into one Hash line", () => {
  const read = (n) => ({ kind: "tool", name: "read_file", sat: "hash", status: "ok", preview: n });
  const grouped = groupBlocks([read("a"), read("b"), { ...read("c"), name: "grep" }, { kind: "assistant", text: "ok" }]);
  assert.equal(grouped[0].kind, "group");
  assert.match(plainText(renderBlock(grouped[0], ctx)[0]), /explored 3\s+read ×2 · grep/);
  assert.equal(groupBlocks([read("a"), read("b")]).length, 2);
});
