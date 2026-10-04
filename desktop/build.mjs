// Bundles the Electron main process, the sandboxed agent worker, the preload
// bridge and the renderer into dist/. The worker bundle is self-contained
// because the sandbox mounts only dist/ (as /app), never the repository.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  build({ ...node, entryPoints: [path.join(here, 'main.mjs')], outfile: path.join(dist, 'main.mjs'), external: ['electron', 'node-pty'] }),
  build({ ...node, entryPoints: [path.join(here, 'worker.mjs')], outfile: path.join(dist, 'worker.mjs') }),
  build({ bundle: true, platform: 'node', format: 'cjs', target: 'node22', entryPoints: [path.join(here, 'preload.cjs')], outfile: path.join(dist, 'preload.cjs'), external: ['electron'], logLevel: 'warning' }),
  build({ bundle: true, platform: 'browser', format: 'esm', target: 'chrome140', entryPoints: [path.join(here, 'ui/app.js')], outfile: path.join(dist, 'ui/app.js'), loader: { '.css': 'css' }, logLevel: 'warning' })
]);

cpSync(path.join(here, 'ui/index.html'), path.join(dist, 'ui/index.html'));
cpSync(path.join(here, 'ui/styles.css'), path.join(dist, 'ui/styles.css'));
cpSync(path.join(here, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(dist, 'ui/xterm.css'));
cpSync(path.join(repo, 'ui/sats/fonts'), path.join(dist, 'ui/fonts'), { recursive: true });
writeFileSync(path.join(dist, 'ui/icon.png'), iconPng(256));
cpSync(path.join(repo, 'agents'), path.join(dist, 'agents'), { recursive: true });
cpSync(path.join(repo, 'commands'), path.join(dist, 'commands'), { recursive: true });
cpSync(path.join(repo, 'sats'), path.join(dist, 'sats'), { recursive: true });
console.log('desktop build → dist/');

// App/tray icon drawn from the 4×5 pixel "b": orange body, ink base, on a
// cream rounded tile. Encoded as PNG with zlib so no raster asset is shipped.
function iconPng(size) {
  const px = Buffer.alloc(size * size * 4), cell = Math.floor(size / 8), ox = (size - 4 * cell) / 2, oy = (size - 5 * cell) / 2, r = size * 0.22;
  const orange = [247, 147, 26], ink = [15, 15, 15], cream = [247, 247, 244];
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
