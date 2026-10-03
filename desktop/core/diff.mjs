// Minimal line diff for approval previews. Inputs above the cap are summarised
// rather than diffed: the approval still binds the exact new version by hash.
const CAP = 4000;

export function unifiedDiff(file, before = '', after = '', context = 3) {
  const a = before === null ? [] : before.split('\n'), b = after.split('\n');
  const header = [`--- ${before === null ? '/dev/null' : `a/${file}`}`, `+++ b/${file}`];
  if (a.length > CAP || b.length > CAP) return [...header, `@@ ${a.length} → ${b.length} lines (preview omitted) @@`].join('\n');
  let start = 0; while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length; while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const ops = lcs(a.slice(start, endA), b.slice(start, endB));
  const lines = [];
  for (let i = Math.max(0, start - context); i < start; i++) lines.push(` ${a[i]}`);
  lines.push(...ops);
  for (let i = endA; i < Math.min(a.length, endA + context); i++) lines.push(` ${a[i]}`);
  const from = Math.max(0, start - context);
  const countA = lines.filter(l => l[0] !== '+').length, countB = lines.filter(l => l[0] !== '-').length;
  return [...header, `@@ -${from + 1},${countA} +${from + 1},${countB} @@`, ...lines].join('\n');
}

function lcs(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [...a.map(l => `-${l}`), ...b.map(l => `+${l}`)];
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out;
}
