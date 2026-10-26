// A double-buffered cell grid on the terminal's alternate screen. Each frame is drawn
// into `next`; flush() writes only the cells that changed since the previous frame.
import { graphemes, graphemeWidth } from "./width.mjs";

const ESC = "\x1b[";
const BLANK = Object.freeze({ ch: " ", sgr: "" });

const rgb = (hexColor) => [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16));

// Nearest xterm-256 color, for terminals without 24-bit support.
function to256(hexColor) {
  const [r, g, b] = rgb(hexColor);
  const level = (c) => (c < 48 ? 0 : c < 115 ? 1 : Math.floor((c - 35) / 40));
  const cube = 16 + 36 * level(r) + 6 * level(g) + level(b);
  const grayLevel = Math.round(((r + g + b) / 3 - 8) / 10);
  const gray = 232 + Math.max(0, Math.min(23, grayLevel));
  const value = (c) => (c ? 55 + c * 40 : 0);
  const cubeDistance = (value(level(r)) - r) ** 2 + (value(level(g)) - g) ** 2 + (value(level(b)) - b) ** 2;
  const grayValue = 8 + (gray - 232) * 10;
  const grayDistance = (grayValue - r) ** 2 + (grayValue - g) ** 2 + (grayValue - b) ** 2;
  return grayDistance < cubeDistance ? gray : cube;
}

export function sgrFor(style = {}, { truecolor = true, color = true } = {}) {
  const codes = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.strike) codes.push(9);
  if (color && style.fg) codes.push(truecolor ? `38;2;${rgb(style.fg).join(";")}` : `38;5;${to256(style.fg)}`);
  if (color && style.bg) codes.push(truecolor ? `48;2;${rgb(style.bg).join(";")}` : `48;5;${to256(style.bg)}`);
  return codes.join(";");
}

export function createScreen({ output = process.stdout, truecolor = true, color = true } = {}) {
  let cols = 0, rows = 0, prev = [], next = [], cursor = null, forceFull = true;
  const sgrCache = new Map();
  const sgr = (style) => {
    const key = JSON.stringify(style || {});
    if (!sgrCache.has(key)) sgrCache.set(key, sgrFor(style, { truecolor, color }));
    return sgrCache.get(key);
  };
  const grid = () => Array.from({ length: rows }, () => Array.from({ length: cols }, () => BLANK));

  const screen = {
    get cols() { return cols; },
    get rows() { return rows; },
    resize(width, height) {
      cols = Math.max(1, width);
      rows = Math.max(1, height);
      prev = grid();
      next = grid();
      forceFull = true;
    },
    begin() {
      next = grid();
      cursor = null;
    },
    fill(x, y, width, height, style) {
      const cell = { ch: " ", sgr: sgr(style), bg: style?.bg, style };
      for (let row = Math.max(0, y); row < Math.min(rows, y + height); row++)
        for (let col = Math.max(0, x); col < Math.min(cols, x + width); col++) next[row][col] = cell;
    },
    // Writes text at (x, y), clipped at `maxX`; a cell's background is kept when the style has none.
    text(x, y, text, style = {}, maxX = cols) {
      if (y < 0 || y >= rows) return x;
      for (const g of graphemes(text)) {
        const w = graphemeWidth(g);
        if (w === 0) continue;
        if (x + w > Math.min(maxX, cols)) break;
        if (x >= 0) {
          const under = next[y][x];
          const merged = style.bg || !under.bg ? style : { ...style, bg: under.bg };
          const cell = { ch: g, sgr: sgr(merged), bg: merged.bg, style: merged };
          next[y][x] = cell;
          if (w === 2 && x + 1 < cols) next[y][x + 1] = { ch: "", sgr: cell.sgr, bg: merged.bg, style: merged };
        }
        x += w;
      }
      return x;
    },
    line(x, y, segments, maxX = cols, baseStyle = {}) {
      for (const s of segments) x = screen.text(x, y, s.text, { ...baseStyle, ...s.style }, maxX);
      return x;
    },
    setCursor(x, y) { cursor = { x, y }; },
    // Recolours the cells of a selection (row-major from start to end, within columns [minX, maxX)).
    highlight(start, end, { minX = 0, maxX = cols, style }) {
      for (let y = Math.max(0, start.y); y <= Math.min(rows - 1, end.y); y++) {
        const from = y === start.y ? start.x : minX, to = y === end.y ? end.x : maxX - 1;
        for (let x = Math.max(minX, from); x <= Math.min(maxX - 1, to); x++) {
          const cell = next[y][x], merged = { ...cell.style, ...style };
          next[y][x] = { ...cell, sgr: sgr(merged), bg: merged.bg, style: merged };
        }
      }
    },
    // The characters of a selection, one line per row, trailing spaces trimmed.
    textRange(start, end, { minX = 0, maxX = cols } = {}) {
      const lines = [];
      for (let y = Math.max(0, start.y); y <= Math.min(rows - 1, end.y); y++) {
        const from = y === start.y ? start.x : minX, to = y === end.y ? end.x : maxX - 1;
        lines.push(next[y].slice(Math.max(minX, from), Math.min(maxX - 1, to) + 1).map((c) => c.ch).join("").trimEnd());
      }
      return lines.join("\n");
    },
    flush() {
      let outText = "\x1b[?2026h";
      let current = null;
      for (let y = 0; y < rows; y++) {
        let x = 0;
        while (x < cols) {
          const cell = next[y][x], old = prev[y]?.[x];
          if (!forceFull && old && old.ch === cell.ch && old.sgr === cell.sgr) { x++; continue; }
          outText += `${ESC}${y + 1};${x + 1}H`;
          while (x < cols) {
            const c = next[y][x], o = prev[y]?.[x];
            if (!forceFull && o && o.ch === c.ch && o.sgr === c.sgr) break;
            if (c.sgr !== current) { outText += `${ESC}0${c.sgr ? ";" + c.sgr : ""}m`; current = c.sgr; }
            outText += c.ch;
            x++;
          }
        }
      }
      outText += `${ESC}0m`;
      outText += cursor ? `${ESC}${cursor.y + 1};${cursor.x + 1}H${ESC}?25h` : `${ESC}?25l`;
      outText += "\x1b[?2026l";
      prev = next;
      forceFull = false;
      output.write(outText);
      return outText;
    },
    // Plain-text dump of the current frame, for tests.
    snapshot() {
      return next.map((row) => row.map((c) => c.ch).join("").trimEnd()).join("\n");
    },
  };
  return screen;
}
