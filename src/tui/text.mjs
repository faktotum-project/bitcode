// Styled text for the full-screen UI. A line is an array of segments
// { text, style }; style = { fg, bg, bold, dim, italic, underline, strike } with
// colors as "#rrggbb". ANSI strings produced by theme.mjs convert into the same model.
import { graphemes, graphemeWidth, stringWidth } from "./width.mjs";

export const seg = (text, style = {}) => ({ text: String(text), style });
export const lineWidth = (line) => line.reduce((sum, s) => sum + stringWidth(s.text), 0);

const BASIC = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"];
const BRIGHT = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
const hex = (r, g, b) => "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("");

function xterm256(n) {
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return hex(v, v, v); }
  const i = n - 16, step = (c) => (c ? 55 + c * 40 : 0);
  return hex(step(Math.floor(i / 36)), step(Math.floor(i / 6) % 6), step(i % 6));
}

function applySgr(style, params) {
  const p = params.length ? params : [0];
  for (let i = 0; i < p.length; i++) {
    const code = p[i];
    if (code === 0) style = {};
    else if (code === 1) style = { ...style, bold: true };
    else if (code === 2) style = { ...style, dim: true };
    else if (code === 3) style = { ...style, italic: true };
    else if (code === 4) style = { ...style, underline: true };
    else if (code === 9) style = { ...style, strike: true };
    else if (code === 22) style = { ...style, bold: false, dim: false };
    else if (code === 23) style = { ...style, italic: false };
    else if (code === 24) style = { ...style, underline: false };
    else if (code === 29) style = { ...style, strike: false };
    else if (code === 39) style = { ...style, fg: undefined };
    else if (code === 49) style = { ...style, bg: undefined };
    else if (code >= 30 && code <= 37) style = { ...style, fg: BASIC[code - 30] };
    else if (code >= 90 && code <= 97) style = { ...style, fg: BRIGHT[code - 90] };
    else if (code >= 40 && code <= 47) style = { ...style, bg: BASIC[code - 40] };
    else if (code >= 100 && code <= 107) style = { ...style, bg: BRIGHT[code - 100] };
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg";
      if (p[i + 1] === 2) { style = { ...style, [key]: hex(p[i + 2] || 0, p[i + 3] || 0, p[i + 4] || 0) }; i += 4; }
      else if (p[i + 1] === 5) { style = { ...style, [key]: xterm256(p[i + 2] || 0) }; i += 2; }
    }
  }
  return style;
}

// "\x1b[1mhi\x1b[0m\nthere" -> [[seg("hi", {bold})], [seg("there")]]; other escapes are dropped.
export function fromAnsi(text, base = {}) {
  const lines = [[]];
  let style = { ...base };
  const pattern = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07]*\x07|\r|\t|\n|[^\x1b\r\t\n]+/g;
  for (const match of String(text).matchAll(pattern)) {
    const [token, params, final] = match;
    if (final) {
      if (final === "m") style = { ...base, ...applySgr(style, params.split(";").filter(Boolean).map(Number)) };
    } else if (token === "\n") lines.push([]);
    else if (token === "\t") lines.at(-1).push(seg("  ", style));
    else if (token !== "\r" && !token.startsWith("\x1b")) lines.at(-1).push(seg(token, style));
  }
  return lines;
}

export const plainText = (line) => line.map((s) => s.text).join("");

// Word-wrap a styled line to `width` columns; continuation lines get `indent` spaces.
export function wrapLine(line, width, { indent = 0 } = {}) {
  if (width <= 0) return [line];
  const out = [];
  let current = [], used = 0;
  const flush = () => { out.push(current); current = indent ? [seg(" ".repeat(indent))] : []; used = indent; };
  const push = (text, style) => {
    const last = current.at(-1);
    if (last && last.style === style) last.text += text; else current.push(seg(text, style));
  };
  for (const { text, style } of line) {
    for (const word of text.split(/(\s+)/)) {
      if (!word) continue;
      const w = stringWidth(word);
      if (/^\s+$/.test(word)) {
        if (used + w <= width) { push(word, style); used += w; }
        else flush();
        continue;
      }
      if (used + w > width && used > indent) flush();
      if (w <= width - used) { push(word, style); used += w; continue; }
      for (const g of graphemes(word)) {
        const gw = graphemeWidth(g);
        if (used + gw > width) flush();
        push(g, style);
        used += gw;
      }
    }
  }
  out.push(current);
  return out.map((l) => trimEnd(l));
}

function trimEnd(line) {
  const copy = line.map((s) => ({ ...s }));
  while (copy.length && !copy.at(-1).text.trimEnd()) copy.pop();
  if (copy.length) copy[copy.length - 1].text = copy.at(-1).text.trimEnd();
  return copy;
}

export function wrapLines(lines, width, options) {
  return lines.flatMap((line) => wrapLine(line, width, options));
}
