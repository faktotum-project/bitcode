import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hashFile } from './verify.mjs';
import { nodeError, CHALLENGE } from './model.mjs';

// Curated source identities, not Guix release attestations. Changes require review.
export const MUTINYNET = Object.freeze({
  version: '29.0-inq-template-hash',
  core: Object.freeze({ repository: 'https://github.com/benthecarman/bitcoin', commit: '2fda7bfc027e3c2586bb4684401524165c164e65', prefix: 'bitcoin', sha256: '77e1e278e10f2a91c66a46d75a070a1337f6aefc6fb4b35fa6a964a28a1fc5ba' }),
  indexer: Object.freeze({ repository: 'https://github.com/mempool/electrs', commit: '141215c349d5cfbabf8f2b925f3dcea59fed0510', prefix: 'electrs', sha256: '344fdec9aee300ec7d8e27eca598186a15afa339ee975610e9e988f93926b2c9' }),
  peer: '45.79.52.207:38333',
});
export function sourceUrl(recipe) {
  const allowed = [MUTINYNET.core, MUTINYNET.indexer].find(r => r.repository === recipe.repository && r.commit === recipe.commit && r.sha256 === recipe.sha256 && r.prefix === recipe.prefix);
  if (!allowed) throw nodeError('UNREVIEWED_EXPERIMENTAL_SOURCE');
  return `https://codeload.github.com/${new URL(recipe.repository).pathname.slice(1)}/tar.gz/${recipe.commit}`;
}
export async function pinnedSource(recipe, { directory, run, fetchImpl = fetch }) {
  const url = sourceUrl(recipe);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const archive = path.join(directory, `${recipe.prefix}-${recipe.commit}.tar.gz`);
  if (!fs.existsSync(archive)) {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(600_000) });
    if (!response.ok) throw nodeError('SOURCE_DOWNLOAD_FAILED', `HTTP ${response.status}`);
    const temp = archive + '.partial'; const fd = fs.openSync(temp, 'w', 0o600); let bytes = 0;
    try { for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 50_000_000) throw nodeError('SOURCE_TOO_LARGE'); fs.writeSync(fd, chunk); } }
    catch (error) { fs.closeSync(fd); fs.rmSync(temp, { force: true }); throw error; }
    fs.closeSync(fd); fs.renameSync(temp, archive);
  }
  if (await hashFile(archive) !== recipe.sha256) { fs.rmSync(archive); throw nodeError('SOURCE_HASH_MISMATCH'); }
  const prefix = `${recipe.prefix}-${recipe.commit}/`;
  const listing = (await run('tar', ['-tvzf', archive])).stdout;
  for (const row of listing.trim().split('\n')) {
    const name = row.trim().split(/\s+/).slice(5).join(' ');
    if (!/^[d-]/.test(row) || !name.startsWith(prefix) || name.split('/').includes('..') || /[\x00-\x1f]/.test(name)) throw nodeError('UNSAFE_SOURCE_ARCHIVE');
  }
  // Always extract into a fresh tree: a resumed build must not reuse modified source.
  const temp = fs.mkdtempSync(path.join(directory, 'verified-source-'));
  try {
    await run('tar', ['--extract', '--gzip', '--file', archive, '--directory', temp, '--no-same-owner', '--no-same-permissions']);
    return { source: path.join(temp, prefix), cleanup: () => fs.rmSync(temp, { recursive: true, force: true }), evidence: { mode: 'pinned-source', ...recipe, url } };
  } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
}
export async function buildMutinynet(i, { directory, run, fetchImpl }) {
  const tree = await pinnedSource(MUTINYNET.core, { directory, run, fetchImpl });
  const build = path.join(tree.source, 'build');
  try {
    await run('cmake', ['-S', tree.source, '-B', build, '-DENABLE_WALLET=OFF', '-DBUILD_GUI=OFF', '-DBUILD_TESTS=OFF', '-DBUILD_BENCH=OFF', '-DWITH_ZMQ=OFF'], { timeout: 300_000 });
    await run('cmake', ['--build', build, '--target', 'bitcoind', 'bitcoin-cli', '--parallel', '2'], { timeout: 7_200_000 });
    const output = path.join(directory, `mutinynet-${MUTINYNET.core.commit}`);
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    const hashes = {};
    for (const name of ['bitcoind', 'bitcoin-cli']) {
      const built = path.join(build, 'bin', name); hashes[name] = await hashFile(built);
      // Publish each executable atomically only after a successful complete build.
      const pending = path.join(output, name + '.pending'); fs.copyFileSync(built, pending); fs.chmodSync(pending, 0o755); fs.renameSync(pending, path.join(output, name));
    }
    i.binary = path.join(output, 'bitcoind'); i.version = MUTINYNET.version;
    i.verification = { ...tree.evidence, binaryHashes: hashes, guixAttested: false, walletEnabled: false, verifiedAt: new Date().toISOString() };
    return i;
  } finally { tree.cleanup(); }
}
export function mutinynetMagic() {
  const script = Buffer.from(CHALLENGE, 'hex');
  const serialized = Buffer.concat([Buffer.from([script.length]), script]);
  const digest = createHash('sha256').update(createHash('sha256').update(serialized).digest()).digest();
  return digest.readUInt32LE(0).toString(16).padStart(8, '0');
}
export function mutinynetIndexerArgs(i, directory) {
  return ['--network', 'signet', '--magic', mutinynetMagic(), '--daemon-dir', i.datadir,
    '--daemon-rpc-addr', `127.0.0.1:${i.rpcPort}`, '--db-dir', path.join(directory, 'electrs-db'),
    '--electrum-rpc-addr', `127.0.0.1:${i.ports.electrum}`, '--http-addr', `127.0.0.1:${i.ports.esplora}`,
    '--monitoring-addr', `127.0.0.1:${i.ports.monitoring}`, '--jsonrpc-import', '--lightmode', '--timestamp', '-v'];
}
