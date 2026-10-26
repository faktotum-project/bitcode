// Bundles the Electron main process, the sandboxed agent worker, the preload
// bridge and the renderer into dist/. The worker bundle is self-contained
// because the sandbox mounts only dist/ (as /app), never the repository.
// dist/cli carries the unbundled terminal CLI for the package's /usr/bin/bitcode.
import { build } from 'esbuild';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, THEME } from '../src/design-tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const version = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

// src/version.mjs reads ../package.json at import time; inline it instead.
const inlineVersion = { name: 'inline-version', setup(b) {
  b.onLoad({ filter: /src[\\/]version\.mjs$/ }, () => ({ contents: `export const VERSION = ${JSON.stringify(version)};`, loader: 'js' }));
} };
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'ui'), { recursive: true });
const node = { bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', plugins: [inlineVersion], banner };
await Promise.all([
  build({ ...node, entryPoints: [path.join(here, 'main.mjs')], outfile: path.join(dist, 'main.mjs'), external: ['electron', 'node-pty', '@tetherto/wdk', '@tetherto/wdk-wallet', '@kaleidorg/wdk-wallet-rln'] }),
  build({ ...node, entryPoints: [path.join(here, 'worker.mjs')], outfile: path.join(dist, 'worker.mjs') }),
  build({ bundle: true, platform: 'node', format: 'cjs', target: 'node22', entryPoints: [path.join(here, 'preload.cjs')], outfile: path.join(dist, 'preload.cjs'), external: ['electron'], logLevel: 'warning' }),
  build({ bundle: true, platform: 'browser', format: 'esm', target: 'chrome140', entryPoints: [path.join(here, 'ui/app.js')], outfile: path.join(dist, 'ui/app.js'), loader: { '.css': 'css' }, logLevel: 'warning' })
]);

cpSync(path.join(here, 'ui/index.html'), path.join(dist, 'ui/index.html'));
cpSync(path.join(here, 'ui/styles.css'), path.join(dist, 'ui/styles.css'));
cpSync(path.join(here, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(dist, 'ui/xterm.css'));
cpSync(path.join(repo, 'ui/sats/fonts'), path.join(dist, 'ui/fonts'), { recursive: true });
writeFileSync(path.join(dist, 'ui/icon.png'), iconPng(256));
// electron-builder installs a directory of NxN.png files as the hicolor icon theme sizes.
mkdirSync(path.join(dist, 'icons'));
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) writeFileSync(path.join(dist, 'icons', `${size}x${size}.png`), iconPng(size));
for (const dir of ['agents', 'commands', 'sats', 'skills']) cpSync(path.join(repo, 'content', dir), path.join(dist, dir), { recursive: true });
cpSync(path.join(repo, 'src/node'), path.join(dist, 'node-resources'), { recursive: true });
copyCli(path.join(dist, 'cli'));
console.log('desktop build → dist/');

// The CLI resolves agents, commands, Sats and its version relative to src/, so
// it ships as a tree rather than a bundle, with only its production dependencies.
function copyCli(out) {
  for (const entry of ['bitcode.mjs', 'package.json', 'LICENSE', 'src', 'content', 'ui/sats'])
    cpSync(path.join(repo, entry), path.join(out, entry), { recursive: true, filter: f => !f.endsWith('.test.mjs') });
  cpSync(path.join(repo, 'assets/sats'), path.join(out, 'assets/sats'), { recursive: true, filter: f => !f.includes(`${path.sep}sources`) });
  const copied = new Set();
  const visit = (name, from) => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) {
        if (copied.has(candidate)) return;
        copied.add(candidate);
        cpSync(candidate, path.join(out, path.relative(repo, candidate)), { recursive: true });
        const pkg = JSON.parse(readFileSync(path.join(candidate, 'package.json'), 'utf8'));
        for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, candidate);
        return;
      }
      if (dir === repo) { if (!isOptional(name)) throw new Error(`CLI dependency not installed: ${name} (run npm ci in the repository)`); return; }
    }
  };
  const root = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const optional = new Set(Object.keys(root.optionalDependencies || {}));
  const isOptional = name => optional.has(name);
  for (const dep of Object.keys({ ...root.dependencies, ...root.optionalDependencies })) visit(dep, repo);
  // Electron's binary runs the CLI as plain Node; the main process never loads it.
  mkdirSync(path.join(dist, 'bin'));
  const launcher = path.join(dist, 'bin', 'bitcode');
  writeFileSync(launcher, '#!/bin/sh\n# bitcode CLI on the Node.js runtime bundled with the desktop app.\nELECTRON_RUN_AS_NODE=1 exec /opt/bitcode/bitcode-desktop /opt/bitcode/resources/app/dist/cli/bitcode.mjs "$@"\n');
  chmodSync(launcher, 0o755);
}

// App/tray icon drawn from the 4×5 pixel "b": orange body, ink base, on a
// cream rounded tile. Encoded as PNG with zlib so no raster asset is shipped.
function iconPng(size) {
  const px = Buffer.alloc(size * size * 4), cell = Math.floor(size / 8), ox = (size - 4 * cell) / 2, oy = (size - 5 * cell) / 2, r = size * 0.22;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const orange = rgb(BRAND.accent), ink = rgb(BRAND.markBase), cream = rgb(THEME.light.canvas);
  const b = [[0, 0, 1, 4], [1, 0, 2, 1], [2, 1, 1, 1], [1, 2, 1, 1], [3, 2, 1, 2]], base = [0, 4, 2, 1];
  const inRect = (x, y, [cx, cy, w, h]) => x >= ox + cx * cell && x < ox + (cx + w) * cell && y >= oy + cy * cell && y < oy + (cy + h) * cell;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(r - x, x - (size - 1 - r), 0), dy = Math.max(r - y, y - (size - 1 - r), 0);
    if (dx * dx + dy * dy > r * r) continue;
    const c = b.some(q => inRect(x, y, q)) ? orange : inRect(x, y, base) ? ink : cream;
    px.set([...c, 255], (y * size + x) * 4);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
