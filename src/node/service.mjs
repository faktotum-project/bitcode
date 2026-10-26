import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createStore, options, NETWORKS, RELEASE, CHALLENGE, SIGNET_CHALLENGE, cookiePath, coreConfig, safePath, nodeError, packagesProfile } from './model.mjs';
import { execute } from './process.mjs';
import { verifyRelease, archiveEntries, hashFile } from './verify.mjs';
import { buildMutinynet, MUTINYNET } from './mutinynet.mjs';
import { discoverNodes } from './discovery.mjs';
import { installExplorer } from './explorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const resources = fs.existsSync(path.join(here, 'node-resources')) ? path.join(here, 'node-resources') : here;
export const HELPER = '/usr/local/lib/bitcode/node-helper.py';
const q = s => `'${String(s).replaceAll("'", "'\\''")}'`;
export async function rpc(instance, method, params = [], fetchImpl = fetch) {
  if (!['getblockchaininfo', 'getindexinfo', 'getnetworkinfo', 'getblockhash'].includes(method)) throw nodeError('RPC_METHOD_DENIED');
  let cookie;
  // Core deletes its cookie on shutdown, so a missing file means a stopped node.
  try { cookie = fs.readFileSync(cookiePath(instance), 'utf8').trim(); }
  catch (e) { if (e.code === 'ENOENT') throw nodeError('NODE_NOT_RUNNING', 'Core is not running: its RPC cookie is absent.'); throw e; }
  const response = await fetchImpl(`http://127.0.0.1:${instance.rpcPort}/`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Authorization: `Basic ${Buffer.from(cookie).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'bitcode-node', method, params }) });
  if (!response.ok) throw nodeError('NODE_RPC_UNAVAILABLE', `RPC HTTP ${response.status}`);
  const result = await response.json(); if (result.error) throw nodeError('NODE_RPC_ERROR', `RPC ${method}: ${result.error.code}`);
  return result.result;
}
export async function portFree(port) {
  return new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); });
}
export async function download(url, target, fetchImpl = fetch) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://bitcoincore.org') throw nodeError('DOWNLOAD_ORIGIN_DENIED');
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw nodeError('DOWNLOAD_FAILED', `HTTP ${response.status}`);
  const temp = `${target}.partial`; const file = fs.openSync(temp, 'w', 0o600); let bytes = 0;
  try { for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 200_000_000) throw nodeError('DOWNLOAD_TOO_LARGE'); fs.writeSync(file, chunk); } }
  catch (e) { fs.closeSync(file); fs.rmSync(temp, { force: true }); throw e; }
  fs.closeSync(file); fs.renameSync(temp, target);
}
// Services outlive the launching runtime: a version-managed Node (nvm, fnm…) can be
// upgraded or removed, so only a root-owned runtime is referenced in place.
export function serviceRuntime(directory, execPath = process.execPath) {
  if (fs.statSync(execPath).uid === 0) return execPath;
  const target = path.join(directory, 'runtime', 'node');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const pending = `${target}.pending`; fs.copyFileSync(execPath, pending); fs.chmodSync(pending, 0o755); fs.renameSync(pending, target);
  return target;
}
export function createNodeService({ home, run = execute, fetchImpl = fetch, admin, emit = () => {} } = {}) {
  const store = createStore(home);
  const save = instance => store.write({ ...instance, updatedAt: new Date().toISOString() });
  const publicInstance = i => ({ ...i });
  const elevated = admin || (async payload => {
    if (!fs.existsSync(HELPER)) throw nodeError('HELPER_REQUIRED', 'Install the administrative helper using the displayed terminal command.');
    const st = fs.statSync(HELPER);
    if (st.uid !== 0 || (st.mode & 0o022)) throw nodeError('UNTRUSTED_HELPER');
    return JSON.parse((await run('pkexec', ['/usr/bin/python3', '-I', HELPER], { input: JSON.stringify(payload), timeout: 1_800_000 })).stdout);
  });
  function commands(input = {}) {
    const profile = packagesProfile(options(input, home));
    const src = path.join(resources, 'node-helper.py');
    return { bootstrap: `sudo install -d -o root -g root -m 755 /usr/local/lib/bitcode && sudo install -o root -g root -m 755 ${q(src)} ${HELPER}`, dependencies: `pkexec /usr/bin/python3 -I ${HELPER} <<'BITCODE_NODE_REQUEST'\n{"action":"dependencies","profile":"${profile}"}\nBITCODE_NODE_REQUEST` };
  }
  async function environment(datadir, input = {}) {
    let parent = datadir || os.homedir(); while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const stat = fs.statfsSync(parent);
    const osRelease = fs.existsSync('/etc/os-release') ? fs.readFileSync('/etc/os-release', 'utf8') : '';
    const supported = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch) && /^(?:ID|ID_LIKE)=.*(?:ubuntu|debian)/m.test(osRelease);
    return { supported, platform: process.platform, arch: process.arch, ramBytes: os.totalmem(), freeBytes: Number(stat.bavail) * Number(stat.bsize), commands: commands(input), systemd: fs.existsSync('/run/systemd/system'), networks: NETWORKS, release: RELEASE };
  }
  async function plan(input) {
    const i = options(input, home); const env = await environment(i.datadir, input);
    const reserveGB = i.profile === 'pruned' ? 40 : NETWORKS[i.network].reserveGB + (i.explorer ? 250 : 0);
    const occupied = [];
    const usedPorts = Object.entries(i.ports).filter(([name]) => i.explorer || ['rpc', 'p2p'].includes(name));
    for (const [name, port] of usedPorts) if (!(await portFree(port))) occupied.push({ name, port });
    const errors = [];
    if (NETWORKS[i.network].connectionOnly) errors.push('LEGACY_NETWORK_CONNECTION_ONLY');
    if (!env.supported || !env.systemd) errors.push('UNSUPPORTED_SYSTEM');
    const warnings = i.network === 'mutinynet' ? ['EXPERIMENTAL_MUTINYNET', 'CURATED_SOURCE_HASH_NOT_GUIX_ATTESTED', 'BUILD_HAS_NO_WALLET'] : [];
    if (env.freeBytes < reserveGB * 1e9 * 1.1) errors.push('INSUFFICIENT_SPACE');
    if (occupied.length) errors.push('PORT_IN_USE');
    if (env.ramBytes < (i.explorer ? 8 : 2) * 1024 ** 3) errors.push('INSUFFICIENT_RAM');
    if (fs.existsSync(i.datadir) && fs.readdirSync(i.datadir).length) errors.push('EXISTING_DATA_USE_CONNECT_OR_ADOPT');
    return { instance: i, environment: env, reserveGB, occupied, errors, warnings, verification: i.network === 'mutinynet' ? MUTINYNET : { release: RELEASE.version, minimumSignatures: RELEASE.minSignatures }, steps: ['verified-core', ...(i.explorer ? ['electrs', 'mempool', 'web'] : []), 'services', 'readiness'], changes: ['Create data and instance directories', 'Install verified user-owned binaries', 'Install non-root system services', ...(i.explorer ? ['Create a local mempool database and explorer'] : [])] };
  }
  async function step(i, name, action) {
    i.phase = name; i.steps[name] = { status: 'running', at: new Date().toISOString() }; save(i); emit('node', { id: i.id, phase: name });
    try { const result = await action(); i.steps[name] = { status: 'complete', at: new Date().toISOString() }; save(i); return result; }
    catch (e) { i.steps[name] = { status: 'error', code: e.code || 'INSTALL_FAILED' }; i.phase = 'error'; save(i); throw e; }
  }
  async function installCore(i) {
    if (i.network === 'mutinynet') return buildMutinynet(i, { directory: store.directory(i.id), run, fetchImpl });
    const triplet = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
    const version = RELEASE.version; const filename = `bitcoin-${version}-${triplet}.tar.gz`;
    const dir = path.join(store.directory(i.id), 'downloads'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const name of ['SHA256SUMS', 'SHA256SUMS.asc', filename]) {
      const target = path.join(dir, name); if (!fs.existsSync(target)) await download(`https://bitcoincore.org/bin/bitcoin-core-${version}/${name}`, target, fetchImpl);
    }
    i.verification = await verifyRelease({ archive: path.join(dir, filename), sums: path.join(dir, 'SHA256SUMS'), signature: path.join(dir, 'SHA256SUMS.asc'), keys: path.join(resources, 'builder-keys'), keyHome: path.join(dir, 'gnupg') });
    archiveEntries((await run('tar', ['-tvzf', path.join(dir, filename)], { timeout: 120_000 })).stdout, version);
    const temp = path.join(store.directory(i.id), `extract-${Date.now()}`); fs.mkdirSync(temp, { mode: 0o700 });
    try {
      await run('tar', ['--extract', '--gzip', '--file', path.join(dir, filename), '--directory', temp, '--no-same-owner', '--no-same-permissions']);
      const target = path.join(store.directory(i.id), `bitcoin-${version}`);
      if (fs.existsSync(target)) {
        for (const name of ['bin/bitcoind', 'bin/bitcoin-cli', 'libexec/bitcoin-node']) {
          if (fs.existsSync(path.join(temp, `bitcoin-${version}`, name)) && await hashFile(path.join(temp, `bitcoin-${version}`, name)) !== await hashFile(path.join(target, name))) throw nodeError('INSTALLED_BINARY_CHANGED');
        }
      } else fs.renameSync(path.join(temp, `bitcoin-${version}`), target);
      i.binary = path.join(target, 'bin', 'bitcoind'); i.version = version;
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    return i;
  }
  async function configure(i) {
    fs.mkdirSync(i.datadir, { recursive: true, mode: 0o700 });
    const conf = path.join(i.datadir, 'bitcoin.conf');
    const expected = coreConfig(i);
    if (fs.existsSync(conf) && fs.readFileSync(conf, 'utf8') !== expected) throw nodeError('CONFIG_CHANGED_REVIEW_REQUIRED');
    if (!fs.existsSync(conf)) fs.writeFileSync(conf, expected, { mode: 0o600, flag: 'wx' });
    const webScript = path.join(store.directory(i.id), 'web.mjs');
    if (i.explorer) fs.copyFileSync(path.join(resources, 'web.mjs'), webScript);
    const result = await elevated({ action: 'configure', instance: { ...i, mode: 'managed' }, node: i.explorer ? serviceRuntime(store.directory(i.id)) : process.execPath, webScript });
    i.mode = 'managed'; save(i); return result;
  }
  async function install(input, { confirmed = false } = {}) {
    if (!confirmed) throw nodeError('CONFIRMATION_REQUIRED');
    const spec = options(input, home);
    return store.lock(spec.id, async () => {
      let i;
      try { i = store.read(spec.id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (i && ['network', 'datadir', 'profile', 'explorer', 'rpcPort'].some(k => i[k] !== spec[k])) throw nodeError('RESUME_OPTIONS_CHANGED');
      if (i?.mode === 'connected' || i?.mode === 'adopted') throw nodeError('EXISTING_INSTANCE');
      if (!i) {
        const preview = await plan(spec);
        if (preview.errors.length) throw nodeError(preview.errors[0], preview.errors.join(', '));
        i = { ...spec, mode: 'installing', steps: {}, phase: 'planned', createdAt: new Date().toISOString() }; save(i);
      }
      if (!i.binary) await step(i, 'verified-core', () => installCore(i));
      if (i.explorer && !i.explorerPaths) await step(i, 'explorer-build', () => installExplorer(i, { dir: store.directory(i.id), run, fetchImpl, progress: detail => emit('node', { id: i.id, phase: 'explorer-build', detail }) }));
      await step(i, 'services', () => configure(i));
      i.phase = 'syncing'; save(i); return publicInstance(i);
    });
  }
  async function status(id) {
    const i = store.read(id);
    const output = { ...publicInstance(i), core: { ready: false }, indexes: null, explorerStatus: { enabled: i.explorer, ready: false }, ready: false };
    try {
      const chain = await rpc(i, 'getblockchaininfo', [], fetchImpl);
      const reported = NETWORKS[i.network].chain;
      if (chain.chain !== reported || (i.network === 'mutinynet' && chain.signet_challenge !== CHALLENGE) || (i.network === 'signet' && chain.signet_challenge !== SIGNET_CHALLENGE)) throw nodeError('NETWORK_MISMATCH');
      output.core = { chain: chain.chain, blocks: chain.blocks, headers: chain.headers, progress: chain.verificationprogress, initialblockdownload: chain.initialblockdownload, pruned: chain.pruned, warnings: chain.warnings, ready: !chain.initialblockdownload && chain.blocks === chain.headers };
      output.indexes = await rpc(i, 'getindexinfo', [], fetchImpl);
      output.peers = { name: i.network, ...(await rpc(i, 'getnetworkinfo', [], fetchImpl)) };
      if (i.explorer) {
        const tip = await electrumTip(i);
        const response = await fetchImpl(`http://127.0.0.1:${i.ports.web}/api/v1/blocks/tip/height`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        const value = await response.text(); const apiHeight = /^\d+$/.test(value.trim()) && response.ok ? Number(value) : null;
        output.explorerStatus = { enabled: true, indexedHeight: tip, apiHeight, url: `http://127.0.0.1:${i.ports.web}/`, ready: tip === chain.blocks && apiHeight === chain.blocks && ['txindex', 'basic block filter index'].every(name => output.indexes[name]?.synced) };
      }
      output.ready = output.core.ready && (!i.explorer || output.explorerStatus.ready);
    } catch (e) { output.error = { code: e.code || 'NODE_UNAVAILABLE', message: e.code ? e.message : 'A required local node component is unavailable.' }; }
    return output;
  }
  async function connect(input, { confirmed = false, adopt = false } = {}) {
    if (!confirmed) throw nodeError('CONFIRMATION_REQUIRED');
    const spec = options(input, home); const i = { ...spec, mode: adopt ? 'adopted' : 'connected', steps: {}, phase: 'connected' };
    return store.lock(i.id, async () => {
      if (store.list().some(x => x.id === i.id)) throw nodeError('EXISTING_INSTANCE');
      const chain = await rpc(i, 'getblockchaininfo', [], fetchImpl);
      if (chain.chain !== NETWORKS[i.network].chain || (i.explorer && chain.pruned)) throw nodeError('NODE_PROFILE_MISMATCH');
      i.profile = chain.pruned ? 'pruned' : 'full';
      if ((i.network === 'mutinynet' && chain.signet_challenge !== CHALLENGE) || (i.network === 'signet' && chain.signet_challenge !== SIGNET_CHALLENGE)) throw nodeError('SIGNET_CHALLENGE_MISMATCH');
      if (adopt) {
        const allowed = ['bitcoind', 'electrs', 'mempool-backend'];
        const services = input.services || ['bitcoind'];
        if (!Array.isArray(services) || !services.length || services.some(x => !allowed.includes(x))) throw nodeError('INVALID_ADOPTION_SERVICES');
        i.services = services; await elevated({ action: 'adopt', instance: i });
      }
      save(i); return publicInstance(i);
    });
  }
  async function control(id, action, { confirmed = false } = {}) {
    if (!confirmed) throw nodeError('CONFIRMATION_REQUIRED');
    if (!['start', 'stop', 'restart', 'uninstall'].includes(action)) throw nodeError('INVALID_ACTION');
    return store.lock(id, async () => { const i = store.read(id); if (!['managed', 'adopted'].includes(i.mode)) throw nodeError('INSTANCE_NOT_MANAGED'); const result = await elevated({ action, id }); if (action === 'uninstall') { i.mode = 'connected'; i.phase = 'services-removed-data-preserved'; save(i); } return result; });
  }
  async function update(id, { confirmed = false } = {}) {
    if (!confirmed) throw nodeError('CONFIRMATION_REQUIRED');
    return store.lock(id, async () => {
      const i = store.read(id); if (i.mode !== 'managed') throw nodeError('UPDATE_REQUIRES_MANAGED_INSTANCE');
      if (i.network === 'mutinynet') { if (i.version === MUTINYNET.version) return { changed: false, version: i.version }; throw nodeError('EXPERIMENTAL_UPDATE_REQUIRES_REVIEW'); }
      if (i.version === RELEASE.version) return { changed: false, version: i.version };
      if (!RELEASE.compatibleFrom.includes(i.version)) throw nodeError('UPDATE_COMPATIBILITY_REVIEW_REQUIRED', 'No reviewed upgrade path. The running node was not stopped.');
      const candidate = structuredClone(i);
      await step(i, 'update-verify', () => installCore(candidate));
      if (fs.readFileSync(path.join(i.datadir, 'bitcoin.conf'), 'utf8') !== coreConfig(candidate)) throw nodeError('CONFIG_CHANGED_REVIEW_REQUIRED');
      await step(i, 'update-services', async () => {
        await elevated({ action: 'stop', id });
        await configure(candidate);
      });
      candidate.phase = 'syncing'; save(candidate);
      return { changed: true, version: candidate.version };
    });
  }
  function lockOwner(file) {
    if (!fs.existsSync(file)) return null;
    const pid = Number(fs.readFileSync(file, 'utf8')); let running = true;
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (error) { running = error.code !== 'ESRCH'; } }
    return { pid, running };
  }
  async function doctor(id) {
    return { status: await status(id), lock: lockOwner(path.join(store.directory(id), '.lock')), recovery: lockOwner(path.join(store.directory(id), '.recovering')), environment: await environment(store.read(id).datadir) };
  }
  async function connection(id) {
    const i = store.read(id);
    if (i.network === 'mutinynet') throw nodeError('MUTINYNET_WALLET_ADAPTER_UNAVAILABLE');
    const live = await rpc(i, 'getblockchaininfo', [], fetchImpl);
    if (live.chain !== NETWORKS[i.network].chain || (i.network === 'signet' && live.signet_challenge !== SIGNET_CHALLENGE)) throw nodeError('NETWORK_MISMATCH');
    return { network: i.network, rpc: { url: `http://127.0.0.1:${i.rpcPort}`, cookieFile: cookiePath(i) }, ...(i.explorer ? { esploraUrl: `http://127.0.0.1:${i.ports.web}/api` } : {}) };
  }
  async function recover(id, { confirmed = false } = {}) {
    if (!confirmed) throw nodeError('CONFIRMATION_REQUIRED');
    return store.recovery(id, () => {
      // Recheck synchronously while holding the recovery marker. A prior doctor
      // result could be stale after a different process starts an installation.
      const lock = path.join(store.directory(id), '.lock'); const owner = lockOwner(lock);
      if (owner?.running) throw nodeError('NODE_BUSY');
      const i = store.read(id);
      for (const step of Object.values(i.steps)) if (step.status === 'running') step.status = 'interrupted';
      i.phase = 'interrupted'; save(i);
      if (owner) fs.unlinkSync(lock);
      return i;
    });
  }
  return { discover: () => discoverNodes({ extraDatadirs: store.list().map(i => i.datadir) }), environment, plan, install, connect, status, control, update, doctor, commands, connection, recover, list: () => store.list().map(publicInstance), dependencies: (input = {}) => elevated({ action: 'dependencies', profile: packagesProfile(options(input, home)) }) };
}
export function electrumTip(i) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: i.ports.electrum }); let buffer = '';
    const done = (e, value) => { socket.destroy(); e ? reject(nodeError('ELECTRS_NOT_READY')) : resolve(value); };
    socket.setTimeout(5000, () => done(true)); socket.on('error', () => done(true));
    socket.on('connect', () => socket.write(JSON.stringify({ id: 1, method: 'blockchain.headers.subscribe', params: [] }) + '\n'));
    socket.on('data', b => { buffer += b; if (buffer.length > 100_000) return done(true); if (buffer.includes('\n')) { try { const v = JSON.parse(buffer.split('\n')[0]); if (!Number.isInteger(v.result?.height)) return done(true); done(null, v.result.height); } catch { done(true); } } });
  });
}
