// Explicit host acceptance: installs a separate pruned Mainnet node, exercises
// its lifecycle, and removes only its services. Downloads and chain data remain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createNodeService, HELPER } from '../../src/node/service.mjs';
import { execute } from '../../src/node/process.mjs';
import { resolveNetwork } from '../../src/bitcoin/network.mjs';
import { bitcoinRpc } from '../../src/bitcoin/rpc.mjs';

const { values } = parseArgs({ options: {
  home: { type: 'string' }, yes: { type: 'boolean' },
  'seed-downloads': { type: 'string' }, sudo: { type: 'boolean' },
  peer: { type: 'string' },
} });
if (!values.yes || !values.home || !path.isAbsolute(values.home)) throw Error('Review this host check, then provide --yes --home /absolute/test/home. It installs and removes systemd services.');
if (values.peer && (!/^127\.0\.0\.1:\d{4,5}$/.test(values.peer) || Number(values.peer.split(':')[1]) > 65535 || Number(values.peer.split(':')[1]) < 1024)) throw Error('--peer must be a reviewed local Mainnet peer at 127.0.0.1:PORT');
const id = `release-mainnet-${Date.now()}`;
const input = { id, network: 'mainnet', profile: 'pruned', rpcPort: 58332, p2pPort: 58333 };
// sudo is an explicit alternative for terminal hosts with an authenticated sudo
// session. The application normally uses pkexec for the same fixed helper API.
const admin = async payload => JSON.parse((await execute(values.sudo ? 'sudo' : 'pkexec',
  [...(values.sudo ? ['-n'] : []), '/usr/bin/python3', '-I', HELPER],
  { input: JSON.stringify(payload), timeout: 120_000 })).stdout);
const service = createNodeService({ home: values.home, admin });
const report = { id, startedAt: new Date().toISOString(), network: 'mainnet', profile: 'pruned', checks: [] };
const progress = message => process.stderr.write(`${new Date().toISOString()} ${message}\n`);
const wait = async predicate => {
  const deadline = Date.now() + 600_000;
  let status;
  while (Date.now() < deadline) {
    status = await service.status(id);
    if (predicate(status)) return status;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error(`Timed out waiting for Mainnet: ${JSON.stringify({ core: status?.core, error: status?.error })}`);
};
let configured = false;
try {
  const plan = await service.plan(input);
  assert.deepEqual(plan.errors, [], 'Host preflight must pass');
  if (values['seed-downloads']) {
    const target = path.join(values.home, 'nodes', id, 'downloads'); fs.mkdirSync(target, { recursive: true });
    for (const name of ['SHA256SUMS', 'SHA256SUMS.asc', 'bitcoin-31.1-x86_64-linux-gnu.tar.gz', 'bitcoin-31.1-aarch64-linux-gnu.tar.gz']) {
      const source = path.join(values['seed-downloads'], name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
    }
  }
  progress(`Installing ${id}`);
  const instance = await service.install(input, { confirmed: true }); configured = true;
  report.verification = instance.verification;
  report.checks.push('managed install, signed release and dedicated RPC/P2P ports');
  if (values.peer) {
    await wait(s => s.core.chain === 'main');
    const context = resolveNetwork({ bitcoin: await service.connection(id) });
    const previousPeers = await bitcoinRpc(context, 'getpeerinfo');
    await bitcoinRpc(context, 'addnode', [values.peer, 'add']);
    const deadline = Date.now() + 60_000;
    let connected = false;
    while (Date.now() < deadline) {
      connected = (await bitcoinRpc(context, 'getpeerinfo')).some(peer => peer.addr === values.peer);
      if (connected) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(connected, 'Explicit local bootstrap peer must be connected');
    // Select the local peer for initial header sync instead of waiting for an
    // already-selected slow Internet peer. Only the disposable node is changed.
    for (const peer of previousPeers) {
      try { await bitcoinRpc(context, 'disconnectnode', ['', peer.id]); }
      catch (error) { if (!/not found|not connected/i.test(error.message)) throw error; }
    }
    report.bootstrapPeer = values.peer;
    report.checks.push('explicit local Mainnet peer connected for initial synchronization');
  }
  progress('Waiting for Mainnet peers and the first downloaded blocks');
  const live = await wait(s => s.core.chain === 'main' && s.core.blocks > 0 && s.peers?.connections > 0);
  report.firstSync = { core: live.core, connections: live.peers.connections };
  report.checks.push('Mainnet peers and real blocks downloading');
  const connection = await service.connection(id);
  const toolChain = await bitcoinRpc(resolveNetwork({ bitcoin: connection }), 'getblockchaininfo');
  assert.equal(toolChain.chain, 'main');
  assert.equal(resolveNetwork({ bitcoin: connection }).allowMainnetSpend, false);
  report.checks.push('bitcode Bitcoin RPC adapter uses the new node; spending remains opt-in');
  progress('Checking stop/start/restart');
  await service.control(id, 'stop', { confirmed: true });
  assert.equal((await service.status(id)).error.code, 'NODE_NOT_RUNNING');
  assert.ok(fs.existsSync(path.join(instance.datadir, 'blocks')));
  await service.control(id, 'start', { confirmed: true });
  await wait(s => s.core.chain === 'main' && s.core.blocks >= live.core.blocks);
  await service.control(id, 'restart', { confirmed: true });
  await wait(s => s.core.chain === 'main' && s.core.blocks >= live.core.blocks);
  report.checks.push('stop/start/restart with retained blocks');
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = { code: error.code, message: error.message };
  process.exitCode = 1;
} finally {
  if (configured) {
    try {
      progress('Removing test services; retaining downloaded data');
      await service.control(id, 'uninstall', { confirmed: true });
      const instance = service.list().find(i => i.id === id);
      assert.ok(fs.existsSync(path.join(instance.datadir, 'blocks')));
      report.checks.push('managed uninstall removes services and retains chain data');
    } catch (error) { report.passed = false; report.cleanupError = error.message; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
}
