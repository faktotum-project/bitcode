import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAttachments, safeSegment, safeRelative, uniqueTop, kindOf, LIMITS } from '../core/attachments.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'bc-att-'));

test('names and paths are sanitized; traversal is refused', () => {
  assert.equal(safeSegment('a/b\\c:d.txt'), 'a_b_c_d.txt'); assert.equal(safeSegment('..'), 'file'); assert.equal(safeSegment('x'.repeat(300) + '.pdf').length, 120);
  assert.deepEqual(safeRelative('src\\a/b.txt'), ['src', 'a', 'b.txt']);
  for (const bad of ['../x', 'a/../../x', '', '/']) assert.throws(() => safeRelative(bad), /Invalid path/);
  assert.equal(kindOf('x.PDF'), 'pdf'); assert.equal(kindOf('a.png'), 'image'); assert.equal(kindOf('dir', true), 'folder'); assert.equal(kindOf('blob.bin'), 'file');
});

test('dropped files and folders land in allegati/ without overwriting', () => {
  const root = tmp(), a = createAttachments(root);
  const one = a.put({ group: 'g1', top: 'nota.txt', rel: 'nota.txt', bytes: Buffer.from('ciao') });
  assert.equal(one.rel, 'allegati/nota.txt'); assert.equal(readFileSync(path.join(root, one.rel), 'utf8'), 'ciao');
  const two = a.put({ group: 'g2', top: 'nota.txt', rel: 'nota.txt', bytes: Buffer.from('altro') });
  assert.equal(two.rel, 'allegati/nota (2).txt'); assert.equal(readFileSync(path.join(root, 'allegati/nota.txt'), 'utf8'), 'ciao');
  const f1 = a.put({ group: 'g3', rel: 'progetto/src/a.js', bytes: Buffer.from('1') }), f2 = a.put({ group: 'g3', rel: 'progetto/README.md', bytes: Buffer.from('2') });
  assert.equal(f1.rel, 'allegati/progetto/src/a.js'); assert.equal(f2.rel, 'allegati/progetto/README.md'); assert.equal(f1.top, f2.top);
  assert.throws(() => a.put({ group: 'g4', rel: '../evil', bytes: Buffer.from('x') }), /Invalid path/);
  assert.ok(!existsSync(path.join(root, 'evil')));
});

test('picked folders are copied recursively, skipping .git, node_modules and symlinks', () => {
  const root = tmp(), src = tmp(), a = createAttachments(root);
  mkdirSync(path.join(src, 'lib/deep'), { recursive: true }); mkdirSync(path.join(src, 'node_modules/x'), { recursive: true }); mkdirSync(path.join(src, '.git'));
  writeFileSync(path.join(src, 'lib/deep/a.txt'), 'A'); writeFileSync(path.join(src, 'top.md'), 'T'); writeFileSync(path.join(src, 'node_modules/x/i.js'), 'no'); writeFileSync(path.join(src, '.git/HEAD'), 'no');
  symlinkSync('/etc/hostname', path.join(src, 'link'));
  const name = path.basename(src), res = a.importPaths([src]);
  assert.equal(res.items.length, 1); assert.equal(res.items[0].isDir, true); assert.equal(res.items[0].files, 2);
  assert.deepEqual(readdirSync(path.join(root, 'allegati', name)).sort(), ['lib', 'top.md']);
  assert.equal(readFileSync(path.join(root, 'allegati', name, 'lib/deep/a.txt'), 'utf8'), 'A');
  assert.equal(a.importPaths([path.join(src, 'link')]).skipped[0].reason, 'symlink');
});

test('size limits are enforced per file, in total and by count', () => {
  const root = tmp(), a = createAttachments(root, { limits: { file: 10, total: 15, files: 3 } });
  assert.throws(() => a.put({ group: 'a', rel: 'big.bin', bytes: Buffer.alloc(11) }), /too large/i);
  a.put({ group: 'b', rel: 'one.bin', bytes: Buffer.alloc(8) });
  assert.throws(() => a.put({ group: 'c', rel: 'two.bin', bytes: Buffer.alloc(8) }), /too large/i);
  assert.ok(LIMITS.file === 50 * 1024 * 1024);
});

test('only attachments created by this app can be removed, and only inside allegati/', () => {
  const root = tmp(), a = createAttachments(root);
  mkdirSync(path.join(root, 'allegati')); writeFileSync(path.join(root, 'allegati/vecchio.txt'), 'mio');
  const r = a.put({ group: 'g', top: 'nuovo.txt', rel: 'nuovo.txt', bytes: Buffer.from('x') });
  assert.throws(() => a.remove('vecchio.txt'), /Not an attachment/); assert.ok(existsSync(path.join(root, 'allegati/vecchio.txt')));
  assert.throws(() => a.remove('../package.json'), /Not an attachment/);
  assert.equal(a.remove(r.top), true); assert.ok(!existsSync(path.join(root, r.rel)));
  assert.equal(uniqueTop(path.join(root, 'allegati'), 'nuovo.txt'), 'nuovo.txt');
});
