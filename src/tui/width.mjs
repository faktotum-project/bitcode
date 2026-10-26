// Terminal column width of text, by grapheme: wide East Asian and emoji take two
// cells, combining marks and zero-width joiners take none.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const WIDE = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

function isWide(cp) {
  let lo = 0, hi = WIDE.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, [start, end] = WIDE[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

export function graphemeWidth(grapheme) {
  const cp = grapheme.codePointAt(0);
  if (cp === undefined || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (/^\p{Mn}|^‍/u.test(grapheme)) return 0;
  if (grapheme.includes("️") && !/^[\d#*]/.test(grapheme)) return 2;
  return isWide(cp) ? 2 : 1;
}

export function graphemes(text) {
  return Array.from(segmenter.segment(String(text)), (s) => s.segment);
}

export function stringWidth(text) {
  const plain = String(text);
  if (/^[\x20-\x7e]*$/.test(plain)) return plain.length;
  let width = 0;
  for (const g of graphemes(plain)) width += graphemeWidth(g);
  return width;
}

// Longest prefix that fits in `max` columns; appends "…" when it cuts.
export function truncate(text, max) {
  if (max <= 0) return "";
  if (stringWidth(text) <= max) return text;
  let out = "", width = 0;
  for (const g of graphemes(text)) {
    const w = graphemeWidth(g);
    if (width + w > max - 1) break;
    out += g;
    width += w;
  }
  return out + "…";
}

// Keeps the end of the text (paths read best from the right): "…/bitcode/src".
export function truncateStart(text, max) {
  if (stringWidth(text) <= max) return text;
  const parts = graphemes(text);
  let out = "", width = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const w = graphemeWidth(parts[i]);
    if (width + w > max - 1) break;
    out = parts[i] + out;
    width += w;
  }
  return "…" + out;
}
