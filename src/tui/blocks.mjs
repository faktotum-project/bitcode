// Transcript blocks -> styled lines. Every tool line starts with the dot of the Sat whose
// role it serves (Node = Bitcoin, Script = code and shell, Hash = reading and checks,
// Merkle = plans and delegation), so a glance at the colors tells who did what.
import { seg, fromAnsi, wrapLine, wrapLines } from "./text.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { truncate } from "./width.mjs";
import { SAT_GLYPH } from "./theme.mjs";
import { toolLabel } from "../sats/roles.mjs";

export { toolLabel };

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const READ_GROUP_MIN = 3;
const DIFF_PREVIEW = 12;
const OUTPUT_PREVIEW = 4;

const satName = (id) => id[0].toUpperCase() + id.slice(1);
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
export const formatTokens = compact;
const seconds = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${Math.max(1, Math.round(ms / 1000))}s`);

function satDot(theme, sat, frame) {
  const color = theme.sat[sat] || theme.accent;
  return seg(frame === undefined ? SAT_GLYPH[sat] || "●" : SPINNER[frame % SPINNER.length], { fg: color });
}

function diffLines(diff, theme, width, limit) {
  const rows = String(diff).split("\n").filter((l) => !/^(diff --git|index |\\ No newline|--- |\+\+\+ )/.test(l));
  const shown = limit ? rows.slice(0, limit) : rows;
  const lines = shown.map((l) => {
    const add = l.startsWith("+") && !l.startsWith("+++"), del = l.startsWith("-") && !l.startsWith("---");
    const style = add ? { fg: theme.diffAdd, bg: theme.diffAddBg } : del ? { fg: theme.diffDel, bg: theme.diffDelBg } : { fg: theme.faint };
    return Object.assign([seg(truncate(l, width), style)], add || del ? { rowBg: style.bg } : {});
  });
  return { lines, hidden: rows.length - shown.length };
}

function toolLines(block, ctx) {
  const { theme, width, words, frame, expanded } = ctx;
  const running = block.status === "running";
  const head = [
    seg("  "), satDot(theme, block.sat, running ? frame : undefined), seg(" "),
    seg(satName(block.sat).padEnd(7), { fg: theme.sat[block.sat], bold: true }), seg(" "),
    seg(toolLabel(block.name), { fg: theme.muted }),
  ];
  if (block.preview) head.push(seg("  "), seg(truncate(block.preview, Math.max(10, width - 30)), { fg: theme.faint, strike: block.status === "denied" }));
  if (block.status === "error") head.push(seg("  ✗", { fg: theme.error }));
  if (block.status === "denied") head.push(seg(`  ${words.deny}`, { fg: theme.error }));
  if (block.stat) head.push(seg("  "), ...block.stat.map((s) => seg(s.text, { fg: s.kind === "add" ? theme.diffAdd : theme.diffDel })));
  const lines = [head];
  const indent = (l) => [seg("     "), ...l];
  if (block.status === "error" && block.result) lines.push(indent([seg(truncate(block.result.split("\n")[0], width - 6), { fg: theme.error })]));
  if (block.diff) {
    const { lines: diff, hidden } = diffLines(block.diff, theme, width - 5, expanded ? 0 : DIFF_PREVIEW);
    lines.push(...diff.map((l) => Object.assign(indent(l), { rowBg: l.rowBg, rowBgFrom: 5 })));
    if (hidden > 0) lines.push(indent([seg(`… ${hidden} ${words.more}`, { fg: theme.faint })]));
  } else if (block.output && block.status === "ok") {
    const rows = block.output.split("\n").filter((l) => l.trim());
    const limit = expanded ? 40 : OUTPUT_PREVIEW;
    for (const l of rows.slice(0, limit)) lines.push(indent([seg(truncate(l, width - 6), { fg: theme.faint })]));
    if (rows.length > limit) lines.push(indent([seg(`… ${rows.length - limit} ${words.more}`, { fg: theme.faint })]));
  }
  return lines;
}

function groupLine(group, ctx) {
  const { theme, words } = ctx;
  const counts = new Map();
  for (const b of group) counts.set(toolLabel(b.name), (counts.get(toolLabel(b.name)) || 0) + 1);
  const detail = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ");
  return [[
    seg("  "), satDot(theme, "hash"), seg(" "), seg("Hash".padEnd(7), { fg: theme.sat.hash, bold: true }), seg(" "),
    seg(`${words.explored} ${group.length}`, { fg: theme.muted }), seg("  " + detail, { fg: theme.faint }),
  ]];
}

function userLines(block, { theme, width, modeColor }) {
  const body = wrapLines(block.text.split("\n").map((l) => [seg(l, { fg: theme.strong })]), width - 4);
  return body.map((l) => Object.assign([seg("┃", { fg: block.modeColor || modeColor }), seg("  "), ...l], { rowBg: theme.panel }));
}

function turnLines(block, { theme, words }) {
  const who = block.sat ? satName(block.sat) : "bitcode";
  const facts = [block.model, block.durationMs != null ? seconds(block.durationMs) : null,
    block.outputTokens ? `↑${compact(block.inputTokens || 0)} ↓${compact(block.outputTokens)}` : null,
    block.outcome === "cancelled" ? words.interrupted : null].filter(Boolean);
  const lines = [[satDot(theme, block.sat), seg(" " + who, { fg: block.sat ? theme.sat[block.sat] : theme.accent }), seg("  " + facts.join(" · "), { fg: theme.faint })]];
  for (const f of block.files || []) lines.push([seg("  " + f.path + "  ", { fg: theme.muted }), seg(`+${f.added}`, { fg: theme.diffAdd }), seg(" "), seg(`-${f.removed}`, { fg: theme.diffDel })]);
  return lines;
}

const isReadGroupable = (b) => b.kind === "tool" && b.sat === "hash" && b.status === "ok" && !b.diff && !b.output;

// Groups consecutive successful reads so exploration takes one line, not twenty.
export function groupBlocks(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!isReadGroupable(blocks[i])) { out.push(blocks[i]); continue; }
    let j = i;
    while (j < blocks.length && isReadGroupable(blocks[j])) j++;
    if (j - i >= READ_GROUP_MIN) out.push({ kind: "group", blocks: blocks.slice(i, j) });
    else out.push(...blocks.slice(i, j));
    i = j - 1;
  }
  return out;
}

export function renderBlock(block, ctx) {
  const { theme, width } = ctx;
  switch (block.kind) {
    case "user": return userLines(block, ctx);
    case "command": return [[seg("› ", { fg: theme.accent }), seg(block.text, { fg: theme.faint })]];
    case "assistant": return renderMarkdown(block.text, width, theme);
    case "tool": return toolLines(block, ctx);
    case "group": return ctx.expanded ? block.blocks.flatMap((b) => toolLines(b, ctx)) : groupLine(block.blocks, ctx);
    case "turn": return turnLines(block, ctx);
    case "error": return wrapLine([seg("✗ " + block.text, { fg: theme.error })], width, { indent: 2 });
    case "note": return fromAnsi(block.text, { fg: theme.text }).flatMap((line) => wrapLine(line, width, { indent: Math.min(8, /^ */.exec(line[0]?.text || "")[0].length + 2) }));
    default: return [];
  }
}

// Space between blocks: tool lines of one turn stay together.
export function needsGap(previous, block) {
  if (!previous) return false;
  const tight = (b) => b.kind === "tool" || b.kind === "group";
  return !(tight(previous) && tight(block));
}
