import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { bitcodeHome } from '../paths.mjs';

export const NETWORKS = Object.freeze({
  mainnet: { chain: 'main', directory: '', rpc: 8332, p2p: 8333, electrum: 50001, api: 8999, web: 8080, monitoring: 4224, reserveGB: 1200 },
  signet: { chain: 'signet', directory: 'signet', rpc: 38332, p2p: 38333, electrum: 60601, api: 9000, web: 8081, monitoring: 34224, reserveGB: 100 },
  testnet4: { chain: 'testnet4', directory: 'testnet4', rpc: 48332, p2p: 48333, electrum: 40001, api: 9001, web: 8082, monitoring: 44224, reserveGB: 200 },
  testnet: { chain: 'test', directory: 'testnet3', rpc: 18332, p2p: 18333, electrum: 60001, api: 9003, web: 8084, monitoring: 14224, reserveGB: 200, connectionOnly: true },
  mutinynet: { chain: 'signet', directory: 'signet', rpc: 39332, p2p: 39333, electrum: 60602, api: 9002, web: 8083, monitoring: 35224, esplora: 3133, reserveGB: 100, experimental: true },
});
export const SIGNET_CHALLENGE = '512103ad5e0edad18cb1f0fc0d28a3d4f1f3e445640337489abb10404f2d1e086be430210359ef5021964fe22d6f8e05b2463c9540ce96883fe3b278760f048f5189f2e6c452ae';
export const CHALLENGE = '512102f7561d208dd9ae99bf497273e16f389bdbd6c4742ddb8e6b216e64fa2928ad8f51ae';
export const RELEASE = Object.freeze({ version: '31.1', compatibleFrom: ['31.0'], electrs: '37501cc4b94aea99e50670a6524fa3ad4ac9aabb', mempool: '9b75f724f8002fdb78d6e6e5ba004cc75b06bf51', minSignatures: 3 });
export const nodeError = (code, message = code) => Object.assign(new Error(message), { code });
export function idOf(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw nodeError('INVALID_INSTANCE'); return id; }
export function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f%]/.test(value)) throw nodeError('INVALID_PATH');
  const normalized = path.resolve(value);
  if (normalized === '/' || normalized === os.homedir()) throw nodeError('INVALID_PATH');
  for (let p = normalized; p !== path.dirname(p); p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw nodeError('SYMLINK_PATH', p);
  }
  return normalized;
}
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}
export function createStore(home = bitcodeHome()) {
  const root = safePath(path.join(home, 'nodes'));
  const directory = id => path.join(root, idOf(id));
  const file = id => path.join(directory(id), 'instance.json');
  return {
    root, directory,
    list() { return fs.existsSync(root) ? fs.readdirSync(root).filter(id => /^[a-z][a-z0-9-]{0,39}$/.test(id) && fs.existsSync(file(id))).map(id => this.read(id)) : []; },
    read(id) { return JSON.parse(fs.readFileSync(safePath(file(id)), 'utf8')); },
    write(instance) { atomic(safePath(file(instance.id)), instance); return instance; },
    recovery(id, action) {
      const dir = safePath(directory(id)); const file = path.join(dir, '.recovering');
      try { fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code === 'EEXIST') throw nodeError('NODE_BUSY', 'A recovery marker exists; inspect doctor before manual repair.'); throw error; }
      try { return action(); } finally { fs.unlinkSync(file); }
    },
    async lock(id, action) {
      const dir = safePath(directory(id)); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const lock = path.join(dir, '.lock'); const recovery = path.join(dir, '.recovering');
      if (fs.existsSync(recovery)) throw nodeError('NODE_BUSY', 'Recovery is in progress; inspect doctor before retrying.');
      try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; throw nodeError('NODE_BUSY', 'An operation owns the instance lock. Use doctor to inspect an interrupted operation.'); }
      if (fs.existsSync(recovery)) { fs.unlinkSync(lock); throw nodeError('NODE_BUSY', 'Recovery acquired the instance.'); }
      try { return await action(); } finally { fs.unlinkSync(lock); }
    },
  };
}
export function options(input = {}, home = bitcodeHome()) {
  const network = input.network ?? 'mainnet'; const net = NETWORKS[network];
  if (!net) throw nodeError('INVALID_NETWORK');
  const id = idOf(input.id ?? network);
  const profile = input.profile ?? 'full';
  if (!['full', 'pruned'].includes(profile)) throw nodeError('INVALID_PROFILE');
  const explorer = input.explorer === true;
  if (profile === 'pruned' && explorer) throw nodeError('EXPLORER_REQUIRES_FULL_ARCHIVE');
  const datadir = safePath(input.datadir ?? path.join(home, 'nodes', id, 'data'));
  const rpcPort = Number(input.rpcPort ?? net.rpc);
  const p2pPort = Number(input.p2pPort ?? net.p2p);
  if ([rpcPort, p2pPort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) throw nodeError('INVALID_PORT');
  const ports = { ...Object.fromEntries(['electrum', 'api', 'web', 'monitoring', 'esplora'].filter(k => net[k] != null).map(k => [k, net[k]])), p2p: p2pPort, rpc: rpcPort };
  const activePorts = Object.entries(ports).filter(([name]) => explorer || ['rpc', 'p2p'].includes(name)).map(([, port]) => port);
  if (new Set(activePorts).size !== activePorts.length) throw nodeError('DUPLICATE_PORT');
  return { id, network, profile, explorer, datadir, rpcPort, p2pPort, ports };
}
export function coreConfig(instance) {
  const n = NETWORKS[instance.network];
  if (n.connectionOnly) throw nodeError('LEGACY_NETWORK_CONNECTION_ONLY');
  const lines = ['# Managed by bitcode; RPC is local and uses cookie authentication.', 'server=1', 'listen=1', `dbcache=${Math.min(4096, Math.max(256, Math.floor(os.totalmem() / 1024 ** 2 / 8)))}`, `prune=${instance.profile === 'pruned' ? 10000 : 0}`, `txindex=${instance.explorer ? 1 : 0}`, `blockfilterindex=${instance.explorer ? 1 : 0}`, `rest=${instance.explorer ? 1 : 0}`];
  if (n.chain !== 'main') lines.push(`${n.chain}=1`);
  lines.push(`[${n.chain}]`, 'rpcbind=127.0.0.1', 'rpcallowip=127.0.0.1', `rpcport=${instance.rpcPort}`, `port=${instance.ports.p2p}`);
  if (instance.network === 'mutinynet') lines.push(`signetchallenge=${CHALLENGE}`, 'signetblocktime=30', 'dnsseed=0', 'addnode=45.79.52.207:38333');
  return lines.join('\n') + '\n';
}
export function cookiePath(i) { return path.join(i.datadir, NETWORKS[i.network].directory, '.cookie'); }

export function packagesProfile(i) { return i.network === 'mutinynet' ? i.explorer ? 'mutinynet-explorer' : 'mutinynet' : i.explorer ? 'explorer' : 'core'; }
