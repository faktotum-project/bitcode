import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RELEASE, NETWORKS, cookiePath, nodeError } from './model.mjs';
import { MUTINYNET, pinnedSource, mutinynetIndexerArgs } from './mutinynet.mjs';
import { hashFile } from './verify.mjs';
// Sibling instances pin the same commits; a commit id names its content, so a local
// clone that already holds it is as good as the network and avoids a slow refetch.
export async function checkout(url, commit, dir, run, mirrors = []) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    await run('git', ['init', dir]);
    await run('git', ['-C', dir, 'remote', 'add', 'origin', url]);
  }
  const actualUrl = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'])).stdout.trim();
  if (actualUrl !== url) throw nodeError('SOURCE_ORIGIN_MISMATCH');
  let local = false;
  for (const mirror of mirrors.filter(m => m !== dir && fs.existsSync(path.join(m, '.git')))) {
    try { await run('git', ['-C', dir, 'fetch', '--depth=1', mirror, commit]); local = true; break; } catch {}
  }
  if (!local) await run('git', ['-C', dir, 'fetch', '--depth=1', 'origin', commit], { timeout: 1_800_000 });
  await run('git', ['-C', dir, 'checkout', '--detach', commit]);
  if ((await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim() !== commit) throw nodeError('SOURCE_COMMIT_MISMATCH');
}
// Bundled RocksDB predates GCC 13, which no longer pulls <cstdint> in transitively.
const rocksdbBuild = () => ({ CXXFLAGS: [process.env.CXXFLAGS, '-include cstdint'].filter(Boolean).join(' ') });
// A resumed install reuses the indexer only if it is the exact binary built from the pinned source.
async function mutinynetIndexer(i, { dir, run, fetchImpl, progress }) {
  const output = path.join(dir, `mempool-electrs-${MUTINYNET.indexer.commit}`);
  const binary = path.join(output, 'electrs');
  const evidence = i.indexerVerification;
  if (evidence?.commit === MUTINYNET.indexer.commit && fs.existsSync(binary) && await hashFile(binary) === evidence.binaryHash) return binary;
  const tree = await pinnedSource(MUTINYNET.indexer, { directory: dir, run, fetchImpl });
  try {
    await rustToolchain(tree.source, 87, run, progress);
    await run('cargo', ['build', '--locked', '--release', '--bin', 'electrs', '--jobs', '2'], { cwd: tree.source, timeout: 7_200_000, env: rocksdbBuild() });
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    const pending = binary + '.pending'; fs.copyFileSync(path.join(tree.source, 'target/release/electrs'), pending); fs.chmodSync(pending, 0o755); fs.renameSync(pending, binary);
    i.indexerVerification = { ...tree.evidence, binaryHash: await hashFile(binary), guixAttested: false };
    return binary;
  } finally { tree.cleanup(); }
}
// Checked inside the source tree: a rust-toolchain file there makes rustup select,
// and possibly download, a different compiler than the system default.
async function rustToolchain(source, minimumMinor, run, progress) {
  if (['rust-toolchain', 'rust-toolchain.toml'].some(name => fs.existsSync(path.join(source, name)))) progress('rust-toolchain');
  const rust = (await run('rustc', ['--version'], { cwd: source, timeout: 1_800_000 })).stdout.match(/rustc (\d+)\.(\d+)/);
  if (!rust || Number(rust[1]) < 1 || (Number(rust[1]) === 1 && Number(rust[2]) < minimumMinor)) throw nodeError(`RUST_1_${minimumMinor}_REQUIRED`);
}
export async function installExplorer(i, { dir, run, fetchImpl = fetch, progress = () => {} }) {
  if (i.profile !== 'full') throw nodeError('UNSUPPORTED_EXPLORER_PROFILE');
  try { await run('clang', ['--version']); }
  catch (e) { if (e.code === 'COMMAND_UNAVAILABLE') throw nodeError('EXPLORER_DEPENDENCIES_REQUIRED', 'Install the explorer dependencies first: bitcode node dependencies --explorer'); throw e; }
  const electrs = path.join(dir, 'electrs-source');
  const mempool = path.join(dir, 'mempool-source');
  let electrsBinary;
  if (i.network === 'mutinynet') electrsBinary = await mutinynetIndexer(i, { dir, run, fetchImpl, progress });
  else {
    await checkout('https://github.com/romanz/electrs.git', RELEASE.electrs, electrs, run);
    await rustToolchain(electrs, 85, run, progress);
    await run('cargo', ['build', '--locked', '--release'], { cwd: electrs, timeout: 7_200_000, env: rocksdbBuild() });
    electrsBinary = path.join(electrs, 'target/release/electrs');
  }
  const instances = path.dirname(dir);
  await checkout('https://github.com/mempool/mempool.git', RELEASE.mempool, mempool, run, fs.readdirSync(instances).map(id => path.join(instances, id, 'mempool-source')));
  const backend = path.join(mempool, 'backend');
  const source = path.join(backend, 'src/index.ts'); const before = fs.readFileSync(source, 'utf8');
  const from = 'this.server.listen(config.MEMPOOL.HTTP_PORT, () => {';
  const to = "this.server.listen(config.MEMPOOL.HTTP_PORT, '127.0.0.1', () => {";
  if (before.includes(from)) fs.writeFileSync(source, before.replace(from, to));
  else if (!before.includes(to)) throw nodeError('BACKEND_PATCH_REVIEW_REQUIRED');
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: backend, timeout: 7_200_000 });
  await run('npm', ['run', 'build'], { cwd: backend, timeout: 1_800_000 });
  const frontend = path.join(mempool, 'frontend');
  fs.writeFileSync(path.join(frontend, 'mempool-frontend-config.json'), JSON.stringify({ MEMPOOL_ENABLED: true, ROOT_NETWORK: i.network === 'mainnet' ? '' : i.network === 'mutinynet' ? 'signet' : i.network, TESTNET_ENABLED: false, TESTNET4_ENABLED: i.network === 'testnet4', SIGNET_ENABLED: ['signet', 'mutinynet'].includes(i.network), MAINNET_ENABLED: i.network === 'mainnet', BASE_MODULE: 'mempool' }));
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: frontend, timeout: 1_800_000 });
  // sync-assets would fetch unpinned promo media and pool logos from mempool.space and GitHub at build time.
  await run('npm', ['run', 'build'], { cwd: frontend, timeout: 7_200_000, env: { SKIP_SYNC: '1' } });
  const publicRoot = path.join(frontend, 'dist/mempool/browser');
  if (!['en-US', 'it'].every(locale => fs.existsSync(path.join(publicRoot, locale, 'index.html')))) throw nodeError('FRONTEND_BUILD_MISSING');
  applyBrand(publicRoot, i.network);
  const config = path.join(dir, 'mempool.json');
  const secretFile = path.join(dir, 'database-password');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  const password = fs.readFileSync(secretFile, 'utf8');
  const db = `bc_${process.getuid()}_${i.id.replaceAll('-', '_')}`;
  fs.writeFileSync(config, JSON.stringify({ MEMPOOL: { NETWORK: i.network === 'mutinynet' ? 'signet' : i.network, BACKEND: i.network === 'mutinynet' ? 'esplora' : 'electrum', HTTP_PORT: i.ports.api, SPAWN_CLUSTER_PROCS: 0, CACHE_DIR: path.join(dir, 'cache') }, CORE_RPC: { HOST: '127.0.0.1', PORT: i.rpcPort, COOKIE: true, COOKIE_PATH: cookiePath(i) }, ELECTRUM: { HOST: '127.0.0.1', PORT: i.ports.electrum, TLS_ENABLED: false }, DATABASE: { ENABLED: true, DATABASE: db, USERNAME: db, PASSWORD: password, HOST: '127.0.0.1', SOCKET: '/run/mysqld/mysqld.sock' }, ...(i.network === 'mutinynet' ? { ESPLORA: { REST_API_URL: `http://127.0.0.1:${i.ports.esplora}` } } : {}), LIGHTNING: { ENABLED: false }, REDIS: { ENABLED: false } }, null, 2), { mode: 0o600 });
  fs.chmodSync(config, 0o600); fs.mkdirSync(path.join(dir, 'cache'), { recursive: true, mode: 0o700 });
  const electrsConf = path.join(dir, 'electrs.toml');
  if (i.network === 'mutinynet') fs.writeFileSync(electrsConf, JSON.stringify({ args: mutinynetIndexerArgs(i, dir) }), { mode: 0o600 });
  else fs.writeFileSync(electrsConf, `network = ${JSON.stringify(i.network === 'mainnet' ? 'bitcoin' : i.network)}\ndaemon_dir = ${JSON.stringify(i.datadir)}\ndaemon_rpc_addr = "127.0.0.1:${i.rpcPort}"\nelectrum_rpc_addr = "127.0.0.1:${i.ports.electrum}"\nmonitoring_addr = "127.0.0.1:${i.ports.monitoring}"\ndb_dir = ${JSON.stringify(path.join(dir, 'electrs-db'))}\nlog_filters = "INFO"\n`, { mode: 0o600 });
  i.explorerPaths = { kind: i.network === 'mutinynet' ? 'mempool-electrs' : 'electrs', electrs: electrsBinary, electrsConf, backend: path.join(backend, 'dist/index.js'), config, publicRoot };
  fs.writeFileSync(path.join(dir, 'web.json'), JSON.stringify({ publicRoot, port: i.ports.web, backendPort: i.ports.api, ...(i.network === 'mutinynet' ? { esploraPort: i.ports.esplora } : {}) }), { mode: 0o600 });
  return i;
}
export function applyBrand(root, network = 'mainnet') {
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
  const target = path.join(root, 'bitcode'); fs.mkdirSync(target, { recursive: true });
  fs.cpSync(assets, target, { recursive: true });
  for (const lang of fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const index = path.join(root, lang.name, 'index.html'); if (!fs.existsSync(index)) continue;
    let text = fs.readFileSync(index, 'utf8');
    text = text.replace(/<title>[^<]*<\/title>/, '<title>bitcode · Bitcoin explorer</title>');
    if (!text.includes('/bitcode/theme.css')) text = text.replace('</head>', '<link rel="stylesheet" href="/bitcode/theme.css"></head>');
    if (!text.includes('bitcode-explorer-brand')) text = text.replace('<body>', '<body><header id="bitcode-explorer-brand"><img src="/bitcode/wordmark.svg" alt="bitcode"><span>Bitcoin explorer · powered by mempool</span></header>');
    if (network === 'mutinynet') text = text.replace('Bitcoin explorer · powered by mempool', 'Mutinynet · experimental · powered by mempool');
    fs.writeFileSync(index, text);
  }
}
