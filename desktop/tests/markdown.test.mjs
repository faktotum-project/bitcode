import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, inline } from '../ui/markdown.js';

const text = nodes => nodes.map(n => n.v ?? text(n.c)).join('');

test('headings, rules, paragraphs keep line breaks', () => {
  const t = parseMarkdown('## Bitcoin Node\n\nUna riga\nseconda riga\n\n---');
  assert.deepEqual(t.map(b => b.type), ['heading', 'para', 'hr']);
  assert.equal(t[0].level, 2); assert.equal(text(t[0].inline), 'Bitcoin Node');
  assert.equal(t[1].lines.length, 2);
});

test('fenced code, including one still streaming and a lang with extra words', () => {
  let t = parseMarkdown('Prima\n```bash\nsudo apt update\nsudo apt install bitcoind\n```\nDopo');
  assert.deepEqual(t.map(b => b.type), ['para', 'code', 'para']);
  assert.equal(t[1].lang, 'bash'); assert.equal(t[1].text, 'sudo apt update\nsudo apt install bitcoind'); assert.equal(t[1].open, false);
  t = parseMarkdown('```js\nconst a = 1;');
  assert.equal(t[0].open, true); assert.equal(t[0].text, 'const a = 1;');
  assert.equal(parseMarkdown('~~~python title="x"\nprint(1)\n~~~')[0].lang, 'python');
  assert.equal(parseMarkdown('```\n# non è un titolo\n```')[0].text, '# non è un titolo');
});

test('inline: bold, italic, code, links; markup inside code stays literal; non-http links are plain text', () => {
  const n = inline('**Bitcoin Core** (più *comune*) con `bitcoind` e [sito](https://bitcoincore.org) o https://umbrel.com.');
  assert.deepEqual(n.map(x => x.t).filter(t => t !== 'text'), ['b', 'i', 'code', 'a', 'a']);
  assert.equal(n.find(x => x.t === 'a' && x.href.includes('umbrel')).href, 'https://umbrel.com');
  assert.equal(inline('`**no**`')[0].v, '**no**');
  assert.ok(!inline('[x](javascript:alert(1))').some(x => x.t === 'a'));
  assert.equal(text(inline('snake_case_name e 2*3*4')), 'snake_case_name e 2*3*4');
});

test('lists nest, numbered lists keep their start, tables and quotes parse', () => {
  const l = parseMarkdown('- uno\n- due\n  - annidato\n- tre');
  assert.equal(l[0].items.length, 3); assert.equal(l[0].items[1].children[0].type, 'list');
  const o = parseMarkdown('3. a\n4. b'); assert.equal(o[0].ordered, true); assert.equal(o[0].start, 3);
  const tb = parseMarkdown('| A | B |\n|:--|--:|\n| 1 | 2 |');
  assert.equal(tb[0].type, 'table'); assert.deepEqual(tb[0].align, [null, 'right']); assert.equal(tb[0].rows.length, 1);
  assert.equal(parseMarkdown('> citazione\n> due')[0].children[0].lines.length, 2);
});

test('the answer from the screenshot parses without leaving raw markers', () => {
  const src = '## 🟠 Bitcoin Node\n\n### Opzione 1 – **Bitcoin Core** (più comune)\n```bash\n# Su Ubuntu/Debian\nsudo apt update\n```\nOppure scarica da: **https://bitcoincore.org/en/download/**\n\n### Opzione 2 – **Umbrel** (facile, con GUI)\n- Installa su un Raspberry Pi o PC\n- Segui la guida su: **https://umbrel.com**';
  const t = parseMarkdown(src);
  assert.deepEqual(t.map(b => b.type), ['heading', 'heading', 'code', 'para', 'heading', 'list']);
  const flat = JSON.stringify(t);
  assert.ok(!flat.includes('**') && !flat.includes('```'));
});
