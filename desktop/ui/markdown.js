// Small, safe Markdown for chat answers. parseMarkdown() is pure (tested in Node) and returns
// a tree; renderMarkdown() builds DOM nodes from it. Nothing is ever assigned through innerHTML,
// and only http(s) links are kept.

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isBlockStart = l => FENCE.test(l) || HEADING.test(l) || HR.test(l) || /^\s{0,3}>/.test(l) || ITEM.test(l);

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m = line.match(FENCE);
    if (m) {
      const mark = m[1], lang = m[2], body = []; i++;
      let closed = false;
      while (i < lines.length) {
        if (new RegExp(`^\\s{0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[i])) { closed = true; i++; break; }
        body.push(lines[i]); i++;
      }
      out.push({ type: 'code', lang, text: body.join('\n'), open: !closed }); // open = still streaming
      continue;
    }
    if ((m = line.match(HEADING))) { out.push({ type: 'heading', level: m[1].length, inline: inline(m[2]) }); i++; continue; }
    if (HR.test(line)) { out.push({ type: 'hr' }); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { body.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
      out.push({ type: 'quote', children: parseMarkdown(body.join('\n')) }); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line), align = cells(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
      i += 2; const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i]).map(c => inline(c))); i++; }
      out.push({ type: 'table', head: head.map(c => inline(c)), align, rows }); continue;
    }
    if ((m = line.match(ITEM))) {
      const ordered = /\d/.test(m[2]), base = m[1].length, items = [];
      while (i < lines.length) {
        const mm = lines[i].match(ITEM);
        if (!mm || mm[1].length > base + 1 && false) break;
        if (!mm || mm[1].length !== base || /\d/.test(mm[2]) !== ordered) break;
        const nested = []; i++;
        while (i < lines.length && (lines[i].trim() === '' ? /^\s+\S/.test(lines[i + 1] || '') : (lines[i].match(/^(\s*)/)[1].length > base))) {
          nested.push(lines[i].slice(Math.min(lines[i].match(/^(\s*)/)[1].length, base + 2))); i++;
        }
        items.push({ inline: inline(mm[3]), children: nested.length ? parseMarkdown(nested.join('\n')) : [] });
      }
      out.push({ type: 'list', ordered, start: ordered ? parseInt(m[2], 10) : 1, items }); continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) { para.push(lines[i]); i++; }
    out.push({ type: 'para', lines: para.map(inline) });
  }
  return out;
}

// ---- inline ----
const URL_RE = /https?:\/\/[^\s<>()\[\]"']+[^\s<>()\[\]"'.,;:!?]/;
const RULES = [
  { re: /`([^`\n]+)`/, make: m => ({ t: 'code', v: m[1] }) },
  { re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/, make: m => ({ t: 'b', c: inline(m[1]) }) },
  { re: /__(?=\S)([\s\S]+?)(?<=\S)__/, make: m => ({ t: 'b', c: inline(m[1]) }) },
  { re: /~~(?=\S)([\s\S]+?)(?<=\S)~~/, make: m => ({ t: 'del', c: inline(m[1]) }) },
  { re: /(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/, make: m => ({ t: 'i', c: inline(m[1]) }) },
  { re: /(?<![\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w])/, make: m => ({ t: 'i', c: inline(m[1]) }) },
  { re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, make: m => ({ t: 'a', href: m[2], c: inline(m[1]) }) },
  { re: URL_RE, make: m => ({ t: 'a', href: m[0], c: [{ t: 'text', v: m[0] }] }) }
];
export function inline(text) {
  const nodes = []; let rest = String(text ?? '');
  while (rest) {
    let best = null;
    for (const rule of RULES) { const m = rest.match(rule.re); if (m && (!best || m.index < best.m.index)) best = { m, rule }; }
    if (!best) { nodes.push({ t: 'text', v: rest }); break; }
    if (best.m.index > 0) nodes.push({ t: 'text', v: rest.slice(0, best.m.index) });
    nodes.push(best.rule.make(best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return nodes;
}

// Finished messages are re-rendered on every update of the thread; their parse result is reused.
const cache = new Map();
function cachedParse(src) {
  const key = String(src ?? ''); let tree = cache.get(key);
  if (!tree) { tree = parseMarkdown(key); cache.set(key, tree); if (cache.size > 300) cache.delete(cache.keys().next().value); }
  return tree;
}

// ---- DOM ----
export function renderMarkdown(src, { h, onCopy, onLink, labels = {} }) {
  const il = nodes => nodes.map(n => n.t === 'text' ? n.v : n.t === 'code' ? h('code', { class: 'ic' }, n.v)
    : n.t === 'b' ? h('strong', {}, il(n.c)) : n.t === 'i' ? h('em', {}, il(n.c)) : n.t === 'del' ? h('del', {}, il(n.c))
    : h('a', { class: 'mdlink', href: n.href, title: n.href, onClick: e => { e.preventDefault(); onLink?.(n.href); } }, il(n.c)));
  const block = b => {
    switch (b.type) {
      case 'heading': return h(`h${Math.min(6, b.level + 1)}`, { class: 'mdh' }, il(b.inline));
      case 'para': return h('p', {}, b.lines.flatMap((l, i) => (i ? [h('br'), ...il(l)] : il(l))));
      case 'hr': return h('hr');
      case 'quote': return h('blockquote', {}, b.children.map(block));
      case 'list': return h(b.ordered ? 'ol' : 'ul', b.ordered && b.start !== 1 ? { start: b.start } : {}, b.items.map(it => h('li', {}, il(it.inline), it.children.map(block))));
      case 'table': return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, b.head.map((c, i) => h('th', { style: b.align[i] ? `text-align:${b.align[i]}` : null }, il(c))))),
        h('tbody', {}, b.rows.map(r => h('tr', {}, r.map((c, i) => h('td', { style: b.align[i] ? `text-align:${b.align[i]}` : null }, il(c))))))));
      case 'code': return h('div', { class: `codeblock${b.open ? ' open' : ''}` }, h('div', { class: 'codehead' }, h('span', { class: 'lang' }, b.lang || labels.code || 'code'),
        h('button', { class: 'copy', type: 'button', title: labels.copy || 'Copy', onClick: e => onCopy?.(b.text, e.currentTarget) }, labels.copy || 'Copy')), h('pre', {}, h('code', {}, b.text)));
      default: return null;
    }
  };
  return h('div', { class: 'md' }, cachedParse(src).map(block));
}
