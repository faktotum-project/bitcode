import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, options, coreConfig, NETWORKS, RELEASE, nodeError } from '../src/node/model.mjs';
import { installExplorer, checkout } from '../src/node/explorer.mjs';
import { failure, execute } from '../src/node/process.mjs';
import { MUTINYNET } from '../src/node/mutinynet.mjs';
import { signatures, archiveEntries, hashFile } from '../src/node/verify.mjs';
import { parseNodeArgs, nodeCLI } from '../src/node/cli.mjs';
import { createNodeService, rpc, serviceRuntime } from '../src/node/service.mjs';
import { createNodes } from '../desktop/core/nodes.mjs';
import { nodeToolCall } from '../src/node/tools.mjs';
const temp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-node-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const signature = (f, primary = f) => `[GNUPG:] VALIDSIG ${f} 2026-07-07 1783382400 0 4 0 1 10 00 ${primary}`;
test('profiles and isolated networks; explorer cannot use pruned data', t => {
  const home = temp(t);
  assert.throws(() => options({ profile: 'pruned', explorer: true }, home), /EXPLORER_REQUIRES/);
  assert.equal(new Set(Object.values(NETWORKS).map(n => n.rpc)).size, 5);
  for (const network of ['mainnet', 'signet', 'testnet4']) {
    const i = options({ network, explorer: true }, home); const config = coreConfig(i);
    assert.match(config, /rpcbind=127\.0\.0\.1/); assert.match(config, /prune=0/); assert.match(config, /txindex=1/);
    assert.ok(!config.includes('password'));
  }
  assert.match(coreConfig(options({ profile: 'pruned' }, home)), /prune=10000/);
});
test('a second mainnet node can use separate RPC and P2P ports without colliding with the existing node', async t => {
  const home = temp(t);
  const { input } = parseNodeArgs(['plan', '--network', 'mainnet', '--profile', 'pruned', '--rpc-port', '58332', '--p2p-port', '58333']);
  const i = options(input, home);
  assert.match(coreConfig(i), /rpcport=58332\nport=58333/);
  assert.equal(i.ports.p2p, 58333);
  for (const p2pPort of [0, 1023, 65536, 'invalid']) assert.throws(() => options({ p2pPort }, home), /INVALID_PORT/);
  assert.throws(() => options({ rpcPort: 58333, p2pPort: 58333 }, home), /DUPLICATE_PORT/);
  assert.throws(() => options({ explorer: true, rpcPort: NETWORKS.mainnet.web }, home), /DUPLICATE_PORT/);
  const store = createStore(home);
  store.write({ ...i, mode: 'installing', steps: {} });
  await assert.rejects(createNodeService({ home }).install({ ...input, p2pPort: 58334 }, { confirmed: true }), /RESUME_OPTIONS_CHANGED/);
});
test('signature threshold counts primary identities and rejects tampering', () => {
  const fingerprints = ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)];
  assert.equal(signatures(fingerprints.map(f => signature(f)).join('\n'), fingerprints).length, 3);
  assert.throws(() => signatures(signature('D'.repeat(40), fingerprints[0]) + '\n' + signature('E'.repeat(40), fingerprints[0]), fingerprints), /required/);
  assert.throws(() => signatures(fingerprints.map(f => signature(f)).join('\n') + '\n[GNUPG:] BADSIG A bad', fingerprints), /INVALID_RELEASE_SIGNATURE/);
  assert.throws(() => signatures('', fingerprints, 1), /INVALID_SIGNATURE_THRESHOLD/);
});
test('archive validation refuses traversal and symlinks', () => {
  archiveEntries('-rwxr-xr-x user/group 12 2026-01-01 12:00 bitcoin-31.1/bin/bitcoind', '31.1');
  assert.throws(() => archiveEntries('-rwxr-xr-x user/group 12 2026-01-01 12:00 bitcoin-31.1/../../escape', '31.1'), /UNSAFE_ARCHIVE/);
  assert.throws(() => archiveEntries('lrwxrwxrwx user/group 0 2026-01-01 12:00 bitcoin-31.1/bin/bitcoind -> /bin/sh', '31.1'), /UNSAFE_ARCHIVE/);
});
test('persistent instance locks serialize concurrent operations', async t => {
  const store = createStore(temp(t)); let release;
  const first = store.lock('signet', () => new Promise(r => { release = r; }));
  await assert.rejects(store.lock('signet', () => {}), /operation owns/); release(); await first;
  await store.lock('signet', () => store.write({ id: 'signet', network: 'signet' }));
  assert.equal(store.list()[0].id, 'signet');
});
test('all node mutations require confirmation', async t => {
  const service = createNodeService({ home: temp(t) });
  await assert.rejects(service.install({}), /CONFIRMATION_REQUIRED/);
  await assert.rejects(service.connect({}), /CONFIRMATION_REQUIRED/);
  await assert.rejects(service.control('mainnet', 'uninstall'), /CONFIRMATION_REQUIRED/);
  await assert.rejects(nodeToolCall(service, 'node_action', { action: 'stop', id: 'mainnet' }), /NODE_APPROVAL_REQUIRED/);
});
test('RPC accepts only local read methods, sends cookie without returning it', async t => {
  const home = temp(t); const i = options({ network: 'mainnet', datadir: home + '/data' }, home);
  fs.mkdirSync(i.datadir); fs.writeFileSync(path.join(i.datadir, '.cookie'), 'user:secret');
  let called;
  const result = await rpc(i, 'getblockchaininfo', [], async (url, init) => { called = { url, init }; return { ok: true, json: async () => ({ result: { chain: 'main' } }) }; });
  assert.equal(result.chain, 'main'); assert.equal(called.url, 'http://127.0.0.1:8332/'); assert.equal(called.init.redirect, 'error');
  await assert.rejects(rpc(i, 'sendtoaddress'), /RPC_METHOD_DENIED/);
});
test('connecting detects wrong chain before registering', async t => {
  const home = temp(t); fs.mkdirSync(home + '/data'); fs.writeFileSync(home + '/data/.cookie', 'user:secret');
  const service = createNodeService({ home, fetchImpl: async () => ({ ok: true, json: async () => ({ result: { chain: 'signet' } }) }) });
  await assert.rejects(service.connect({ datadir: home + '/data' }, { confirmed: true }), /NODE_PROFILE_MISMATCH/);
  assert.equal(service.list().length, 0);
});
test('CLI supports explicit options and works without an AI provider', async () => {
  const args = parseNodeArgs(['plan', '--network', 'signet', '--explorer', '--json']);
  assert.equal(args.input.explorer, true); assert.equal(args.json, true);
  let called = false;
  await nodeCLI(['status', '--id', 'signet', '--json'], { service: { status: async id => { assert.equal(id, 'signet'); called = true; return { ready: true }; } }, print: () => {} });
  assert.equal(called, true);
});
test('desktop node jobs report failure and require explicit confirmation', async () => {
  const nodes = createNodes({ service: { install: async () => { throw Object.assign(new Error('verification failed'), { code: 'BAD_SIGNATURE' }); } } });
  assert.throws(() => nodes.methods['node.execute']({ action: 'install', input: {} }), /confirmation/);
  const job = nodes.methods['node.execute']({ action: 'install', input: {}, confirmed: true });
  await new Promise(r => setImmediate(r));
  const [result] = nodes.methods['node.jobs'](); assert.equal(result.jobId, job.jobId); assert.equal(result.error.code, 'BAD_SIGNATURE');
});
test('custom Signet challenge must match the live node, not its configured label', async t => {
  const home = temp(t); fs.mkdirSync(home + '/data/signet', { recursive: true }); fs.writeFileSync(home + '/data/signet/.cookie', 'user:secret');
  const service = createNodeService({ home, fetchImpl: async () => ({ ok: true, json: async () => ({ result: { chain: 'signet', signet_challenge: 'deadbeef' } }) }) });
  await assert.rejects(service.connect({ network: 'mutinynet', datadir: home + '/data' }, { confirmed: true }), /SIGNET_CHALLENGE_MISMATCH/);
  await assert.rejects(service.connect({ network: 'signet', datadir: home + '/data' }, { confirmed: true }), /SIGNET_CHALLENGE_MISMATCH/);
  assert.deepEqual(service.list(), []);
});
test('Script node tools cannot mutate without an approval hook', async t => {
  const { nodeTools } = await import('../src/node/tools.mjs');
  const action = nodeTools(createNodeService({ home: temp(t) })).find(t => t.name === 'node_action');
  assert.throws(() => action.run({ action: 'stop', id: 'mainnet' }), /NODE_APPROVAL_REQUIRED/);
});
test('desktop node mutations reject worker and remote origins', async t => {
  const { createController } = await import('../desktop/core/controller.mjs');
  const controller = createController({ home: temp(t), config: {} }); t.after(() => controller.shutdown());
  await assert.rejects(controller.invoke('node.execute', { action: 'stop', input: { id: 'mainnet' }, confirmed: true }, 'worker'), /FORBIDDEN_ORIGIN/);
  await assert.rejects(controller.invoke('node.execute', { action: 'stop', input: { id: 'mainnet' }, confirmed: true }, 'remote'), /FORBIDDEN_ORIGIN/);
});
test('stale operation recovery refuses a live owner and preserves data', async t => {
  const home = temp(t); const store = createStore(home); const i = { ...options({}, home), mode: 'installing', phase: 'services', steps: { services: { status: 'running' } } }; store.write(i);
  const lock = path.join(store.directory(i.id), '.lock'); fs.writeFileSync(lock, String(process.pid));
  const service = createNodeService({ home });
  await assert.rejects(service.recover(i.id, { confirmed: true }), /NODE_BUSY/);
  fs.writeFileSync(lock, '2147483647');
  const result = await service.recover(i.id, { confirmed: true });
  assert.equal(result.steps.services.status, 'interrupted'); assert.equal(fs.existsSync(lock), false); assert.equal(store.read(i.id).datadir, i.datadir);
});
test('update without a reviewed compatibility path does not stop the node', async t => {
  const home = temp(t); const store = createStore(home); store.write({ ...options({}, home), version: '29.0', mode: 'managed', steps: {} }); let calls = 0;
  const service = createNodeService({ home, admin: async () => { calls++; } });
  await assert.rejects(service.update('mainnet', { confirmed: true }), { code: 'UPDATE_COMPATIBILITY_REVIEW_REQUIRED' });
  assert.equal(calls, 0); assert.equal(store.read('mainnet').version, '29.0');
});
test('expired primary signer is excluded even if other signatures verify', () => {
  const ids = ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)];
  assert.throws(() => signatures(ids.map(f => signature(f)).join('\n') + `\n[GNUPG:] EXPKEYSIG ${ids[2].slice(-16)} expired`, ids), { code: 'INSUFFICIENT_SIGNATURES' });
});
test('real signed release fixture rejects modified metadata and a corrupted archive', async t => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('gpg', ['--version']).status !== 0) { t.skip('GnuPG unavailable'); return; }
  const { verifyRelease } = await import('../src/node/verify.mjs');
  const home = temp(t); const archive = path.join(home, 'bitcoin-31.1-x86_64-linux-gnu.tar.gz'); fs.writeFileSync(archive, 'corrupted archive');
  const sums = path.join(home, 'SHA256SUMS'); fs.copyFileSync(new URL('./fixtures/node/SHA256SUMS', import.meta.url), sums);
  const request = { archive, sums, signature: new URL('./fixtures/node/SHA256SUMS.asc', import.meta.url).pathname, keys: new URL('../src/node/builder-keys', import.meta.url).pathname, keyHome: path.join(home, 'gnupg') };
  await assert.rejects(verifyRelease(request), { code: 'ARCHIVE_HASH_MISMATCH' });
  fs.appendFileSync(sums, '\ntampered');
  await assert.rejects(verifyRelease(request), { code: 'INVALID_RELEASE_SIGNATURE' });
});
test('bundled skill references stay inside the skill directory', async () => {
  const { loadSkills, readSkillResource } = await import('../src/context.mjs');
  const skill = loadSkills().find(s => s.name === 'bitcoin-fullnode');
  assert.ok(skill); assert.match(readSkillResource(skill, 'references/workflow.md'), /Operating workflow/);
  assert.throws(() => readSkillResource(skill, '../../../../README.md'));
});

test('connection records actual pruning mode without changing an existing node', async t => {
  const home = temp(t); fs.mkdirSync(home + '/data'); fs.writeFileSync(home + '/data/.cookie', 'user:secret');
  const service = createNodeService({ home, fetchImpl: async () => ({ ok: true, json: async () => ({ result: { chain: 'main', pruned: true } }) }) });
  const result = await service.connect({ datadir: home + '/data' }, { confirmed: true });
  assert.equal(result.profile, 'pruned'); assert.equal(result.mode, 'connected');
});

test('recovery excludes normal operations and does not trust a stale diagnostic', async t => {
  const home = temp(t); const store = createStore(home); const i = { ...options({}, home), mode: 'installing', steps: {} }; store.write(i);
  const marker = path.join(store.directory(i.id), '.recovering'); fs.writeFileSync(marker, String(process.pid));
  await assert.rejects(store.lock(i.id, () => { throw new Error('must not execute'); }), { code: 'NODE_BUSY' });
  const service = createNodeService({ home });
  await assert.rejects(service.recover(i.id, { confirmed: true }), { code: 'NODE_BUSY' });
  fs.unlinkSync(marker);
  const lock = path.join(store.directory(i.id), '.lock'); fs.writeFileSync(lock, String(process.pid));
  await assert.rejects(service.recover(i.id, { confirmed: true }), { code: 'NODE_BUSY' });
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid)); assert.equal(fs.existsSync(marker), false);
});
test('plan shows the dependency command for the planned components', async t => {
  const service = createNodeService({ home: temp(t) });
  const { environment } = await service.plan({ network: 'signet', explorer: true });
  assert.match(environment.commands.dependencies, /"profile":"explorer"/);
});
test('explorer build stops with an actionable error when native tooling is missing', async t => {
  const run = async file => { if (file === 'rustc') return { stdout: 'rustc 1.90.0' }; throw nodeError('COMMAND_UNAVAILABLE', `${file}: ENOENT`); };
  const i = options({ network: 'signet', explorer: true }, temp(t));
  await assert.rejects(installExplorer(i, { dir: temp(t), run }), /EXPLORER_DEPENDENCIES_REQUIRED|node dependencies/);
});
test('failed commands surface their last diagnostic line', () => {
  assert.equal(failure('cargo', 101, 'Compiling x\nerror: Unable to find libclang\n'), 'cargo exited 101: error: Unable to find libclang');
  assert.equal(failure('tar', 2, ''), 'tar exited 2');
});
test('electrs builds include <cstdint> for the bundled RocksDB', async t => {
  const calls = [];
  const run = async (file, args, opts = {}) => { calls.push({ file, args, opts }); if (file === 'rustc') return { stdout: 'rustc 1.90.0' }; if (file === 'cargo') throw nodeError('STOP'); return { stdout: args.includes('rev-parse') ? RELEASE.electrs : 'https://github.com/romanz/electrs.git' }; };
  await assert.rejects(installExplorer(options({ network: 'signet', explorer: true }, temp(t)), { dir: temp(t), run }), /STOP/);
  assert.match(calls.find(c => c.file === 'cargo').opts.env.CXXFLAGS, /-include cstdint/);
});
test('explorer services use a runtime that survives Node version managers', t => {
  const dir = temp(t); const source = path.join(dir, 'nvm-node'); fs.writeFileSync(source, 'runtime');
  const runtime = serviceRuntime(dir, source);
  assert.equal(runtime, path.join(dir, 'runtime', 'node')); assert.equal(fs.readFileSync(runtime, 'utf8'), 'runtime');
  if (fs.statSync('/bin/sh').uid === 0) assert.equal(serviceRuntime(dir, '/bin/sh'), '/bin/sh');
});
test('a stopped node reports NODE_NOT_RUNNING instead of a file error', async t => {
  const home = temp(t); const i = options({ network: 'signet', datadir: home + '/data' }, home);
  await assert.rejects(rpc(i, 'getblockchaininfo'), e => e.code === 'NODE_NOT_RUNNING' && !e.message.includes(home));
});
test('a command killed by its timeout says so', async () => {
  await assert.rejects(execute('sleep', ['5'], { timeout: 50 }), e => e.code === 'COMMAND_TIMEOUT');
});
test('checkout fetches a pinned commit from a sibling clone before the network', async t => {
  const root = temp(t); const calls = [];
  const sibling = path.join(root, 'signet', 'mempool-source'); fs.mkdirSync(path.join(sibling, '.git'), { recursive: true });
  const target = path.join(root, 'mutinynet', 'mempool-source');
  const run = async (file, args) => { calls.push(args.join(' ')); return { stdout: args.includes('get-url') ? 'https://example.org/repo.git' : 'c0ffee' }; };
  await checkout('https://example.org/repo.git', 'c0ffee', target, run, [sibling, target]);
  assert.ok(calls.some(c => c.endsWith(`fetch --depth=1 ${sibling} c0ffee`)));
  assert.ok(!calls.some(c => c.includes('fetch --depth=1 origin')));
});
test('a resumed Mutinynet install reuses the verified indexer binary', async t => {
  const root = temp(t); const dir = path.join(root, 'mutinynet'); const output = path.join(dir, `mempool-electrs-${MUTINYNET.indexer.commit}`);
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'electrs'), 'built');
  const i = { ...options({ network: 'mutinynet', explorer: true }, root), indexerVerification: { commit: MUTINYNET.indexer.commit, binaryHash: await hashFile(path.join(output, 'electrs')) } };
  const files = [];
  const run = async (file, args) => { files.push(file); if (file === 'rustc') return { stdout: 'rustc 1.90.0' }; if (file === 'git') throw nodeError('STOP'); return { stdout: '' }; };
  await assert.rejects(installExplorer(i, { dir, run }), /STOP/);
  assert.ok(!files.includes('cargo') && !files.includes('tar'));
});
test('the explorer frontend build skips unpinned asset downloads', async t => {
  const root = temp(t); const dir = path.join(root, 'signet'); const calls = [];
  const browser = path.join(dir, 'mempool-source/frontend/dist/mempool/browser/it'); fs.mkdirSync(browser, { recursive: true }); fs.writeFileSync(path.join(browser, 'index.html'), '<head></head><body>');
  fs.mkdirSync(path.join(dir, 'mempool-source/backend/src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'mempool-source/backend/src/index.ts'), "this.server.listen(config.MEMPOOL.HTTP_PORT, () => {");
  const run = async (file, args, opts = {}) => { calls.push({ file, args, opts }); if (file === 'rustc') return { stdout: 'rustc 1.90.0' }; return { stdout: args.includes('get-url') ? 'https://github.com/' + (args.includes(path.join(dir, 'electrs-source')) ? 'romanz/electrs.git' : 'mempool/mempool.git') : args.includes('rev-parse') ? (args.includes(path.join(dir, 'electrs-source')) ? RELEASE.electrs : RELEASE.mempool) : '' }; };
  await installExplorer(options({ network: 'signet', explorer: true }, root), { dir, run });
  const frontendBuild = calls.find(c => c.file === 'npm' && c.args[1] === 'build' && c.opts.cwd.endsWith('frontend'));
  assert.equal(frontendBuild.opts.env.SKIP_SYNC, '1');
});
test('Rust is checked in the source tree, where a pinned toolchain applies', async t => {
  const root = temp(t); const dir = path.join(root, 'signet'); const source = path.join(dir, 'electrs-source');
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(path.join(source, 'rust-toolchain'), '1.80\n');
  const progress = []; let rustCwd;
  const run = async (file, args, opts = {}) => {
    if (file === 'rustc') { rustCwd = opts.cwd; return { stdout: 'rustc 1.80.0' }; }
    return { stdout: args.includes('get-url') ? 'https://github.com/romanz/electrs.git' : args.includes('rev-parse') ? RELEASE.electrs : '' };
  };
  await assert.rejects(installExplorer(options({ network: 'signet', explorer: true }, root), { dir, run, progress: d => progress.push(d) }), /RUST_1_85_REQUIRED/);
  assert.equal(rustCwd, source); assert.deepEqual(progress, ['rust-toolchain']);
});
