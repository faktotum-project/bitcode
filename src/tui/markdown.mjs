// Markdown -> styled, wrapped lines. Covers what models actually write: headings,
// paragraphs, lists, quotes, fenced code, tables, rules and inline bold/italic/code/links.
import { seg, wrapLine } from "./text.mjs";
import { stringWidth, truncate } from "./width.mjs";

function inline(text, theme, base = {}) {
  const out = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(seg(text.slice(last, m.index), base));
    const token = m[0];
    if (m[1]) out.push(seg(token.slice(1, -1), { ...base, fg: theme.accent }));
    else if (m[2]) out.push(seg(token.slice(2, -2), { ...base, bold: true, fg: theme.strong }));
    else if (m[3]) out.push(seg(token.slice(1, -1), { ...base, italic: true }));
    else {
      const [, label, url] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      out.push(seg(label, { ...base, underline: true, fg: theme.info }), seg(` (${url})`, { ...base, fg: theme.faint }));
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(seg(text.slice(last), base));
  return out;
}

function table(rows, width, theme) {
  const cells = rows.map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const body = cells.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  const count = Math.max(...body.map((r) => r.length));
  const widths = Array.from({ length: count }, (_, i) => Math.max(...body.map((r) => stringWidth(r[i] || ""))));
  const budget = Math.max(count * 4, width - (count - 1) * 3);
  while (widths.reduce((a, b) => a + b, 0) > budget) widths[widths.indexOf(Math.max(...widths))]--;
  return body.map((r, rowIndex) => widths.flatMap((w, i) => {
    const text = truncate(r[i] || "", w);
    const cell = seg(text + " ".repeat(Math.max(0, w - stringWidth(text))), rowIndex === 0 ? { bold: true, fg: theme.strong } : { fg: theme.text });
    return i ? [seg(" │ ", { fg: theme.border }), cell] : [cell];
  }));
}

// -> array of lines; a line may carry `fill` (background for the whole row, used by code blocks).
export function renderMarkdown(source, width, theme) {
  const lines = [];
  const text = { fg: theme.text };
  const src = String(source).replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < src.length; i++) {
    const raw = src[i];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(raw);
    if (fence) {
      const code = [];
      for (i++; i < src.length && !src[i].trim().startsWith(fence[1]); i++) code.push(src[i]);
      const label = Object.assign([seg(" " + (fence[2] || "code"), { fg: theme.faint, bg: theme.element })], { rowBg: theme.element });
      lines.push(label);
      for (const c of code) {
        const row = Object.assign([seg(" " + truncate(c.replace(/\t/g, "  "), width - 2), { fg: theme.text, bg: theme.element })], { rowBg: theme.element });
        lines.push(row);
      }
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      const rows = [];
      for (; i < src.length && /^\s*\|.*\|\s*$/.test(src[i]); i++) rows.push(src[i].trim());
      i--;
      lines.push(...table(rows, width, theme));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      const style = heading[1].length === 1 ? { bold: true, fg: theme.accent } : { bold: true, fg: theme.strong };
      lines.push(...wrapLine(inline(heading[2], theme, style), width));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) { lines.push([seg("─".repeat(Math.min(width, 40)), { fg: theme.border })]); continue; }
    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (quote) {
      for (const l of wrapLine(inline(quote[1], theme, { fg: theme.muted, italic: true }), width - 2)) lines.push([seg("▎ ", { fg: theme.border }), ...l]);
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(raw);
    if (item) {
      const depth = Math.floor(item[1].length / 2) * 2;
      const bullet = item[3] !== undefined ? (item[3] === " " ? "☐ " : "☑ ") : /\d/.test(item[2]) ? item[2] + " " : "• ";
      const pad = depth + stringWidth(bullet);
      const wrapped = wrapLine(inline(item[4], theme, text), width - pad);
      wrapped.forEach((l, n) => lines.push([seg(" ".repeat(depth)), seg(n ? " ".repeat(stringWidth(bullet)) : bullet, { fg: theme.accent }), ...l]));
      continue;
    }
    if (!raw.trim()) { if (lines.length && lines.at(-1).length) lines.push([]); continue; }
    lines.push(...wrapLine(inline(raw, theme, text), width));
  }
  while (lines.length && !lines.at(-1).length) lines.pop();
  return lines;
}
