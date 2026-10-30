import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHALLENGE, NETWORKS } from './model.mjs';
const flag = (args, name) => { const at = args.findIndex(s => s === `-${name}` || s.startsWith(`-${name}=`)); return at < 0 ? undefined : args[at].includes('=') ? args[at].slice(name.length + 2) : args[at + 1]?.startsWith('-') ? '1' : args[at + 1] ?? '1'; };
const enabled = value => value != null && !['0', 'false', 'no'].includes(value.toLowerCase());
function configuration(file) {
  const sections = { global: {} }; let section = 'global';
  try {
    if (fs.statSync(file).size > 100_000) return sections;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim(); const heading = /^\[([a-z0-9]+)\]$/.exec(line);
      if (heading) { section = heading[1]; sections[section] ||= {}; continue; }
      const entry = /^(chain|signet|testnet|testnet4|rpcport|signetchallenge|includeconf)\s*=\s*([^#\s]+)/.exec(line);
      if (entry) sections[section][entry[1]] = entry[2];
    }
  } catch { /* Candidate discovery must tolerate inaccessible or partial setups. */ }
  return sections;
}
export function nodeCandidate(args, home = os.homedir()) {
  if (!Array.isArray(args) || !['bitcoind', 'bitcoin-node'].includes(path.basename(args[0] || ''))) return null;
  const data = flag(args, 'datadir') || path.join(home, '.bitcoin');
  if (!path.isAbsolute(data) || /[\x00-\x1f]/.test(data)) return null;
  const datadir = path.resolve(data); const conf = configuration(flag(args, 'conf') || path.join(datadir, 'bitcoin.conf'));
  const global = conf.global;
  const selected = flag(args, 'chain') || global.chain;
  let network = selected === 'main' ? 'mainnet' : selected === 'test' || selected === 'testnet3' ? 'testnet' : selected;
  if (!network) network = enabled(flag(args, 'signet') ?? global.signet) ? 'signet' : enabled(flag(args, 'testnet4') ?? global.testnet4) ? 'testnet4' : enabled(flag(args, 'testnet') ?? global.testnet) ? 'testnet' : 'mainnet';
  const section = network === 'mainnet' ? 'main' : network === 'testnet' ? 'test' : network;
  const active = conf[section] || {};
  const challenge = (flag(args, 'signetchallenge') || active.signetchallenge || global.signetchallenge)?.toLowerCase();
  if (network === 'signet' && challenge === CHALLENGE) network = 'mutinynet';
  const known = NETWORKS[network];
  const rpcPort = Number(flag(args, 'rpcport') || active.rpcport || global.rpcport || (network === 'mutinynet' ? NETWORKS.signet.rpc : known?.rpc));
  if (!known || !Number.isInteger(rpcPort) || rpcPort < 1024 || rpcPort > 65535) return null;
  return { datadir, network, rpcPort, evidence: 'configuration-candidate', includes: !!(global.includeconf || active.includeconf), experimental: !!known.experimental, connectionOnly: !!known.connectionOnly };
}
export function discoverNodes({ procRoot = '/proc', home = os.homedir(), uid = process.getuid(), extraDatadirs = [] } = {}) {
  const candidates = [];
  try {
    for (const pid of fs.readdirSync(procRoot).filter(name => /^\d+$/.test(name))) {
      try {
        const status = fs.readFileSync(path.join(procRoot, pid, 'status'), 'utf8');
        if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== uid) continue;
        const args = fs.readFileSync(path.join(procRoot, pid, 'cmdline'), 'utf8').split('\0').filter(Boolean);
        const candidate = nodeCandidate(args, home);
        if (candidate) candidates.push({ ...candidate, pid: Number(pid) });
      } catch { /* Processes can exit during enumeration. */ }
    }
  } catch { /* Some sandboxes do not expose process information. */ }
  for (const datadir of [path.join(home, '.bitcoin'), ...extraDatadirs]) {
    if (fs.existsSync(path.join(datadir, 'bitcoin.conf')) && !candidates.some(c => c.datadir === datadir)) {
      const candidate = nodeCandidate(['bitcoind', `-datadir=${datadir}`], home);
      if (candidate) candidates.push({ ...candidate, pid: null });
    }
  }
  return [...new Map(candidates.map(c => [`${c.datadir}\0${c.network}\0${c.rpcPort}`, c])).values()];
}
