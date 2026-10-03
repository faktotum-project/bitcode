// Bundles the Electron main process, the sandboxed agent worker, the preload
// bridge and the renderer into dist/. The worker bundle is self-contained
// because the sandbox mounts only dist/ (as /app), never the repository.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
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
for (const sat of ['node', 'script', 'hash', 'merkle']) {
  mkdirSync(path.join(dist, 'ui/sats', sat), { recursive: true });
  cpSync(path.join(repo, 'assets/sats', sat, 'avatar-96.png'), path.join(dist, 'ui/sats', sat, 'avatar-96.png'));
}
cpSync(path.join(repo, 'assets/sats/node/brand-ink.png'), path.join(dist, 'ui/icon.png'));
cpSync(path.join(repo, 'agents'), path.join(dist, 'agents'), { recursive: true });
console.log('desktop build → dist/');
