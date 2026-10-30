// Optional host smoke: generated configuration against a real local Core binary.
// Only an isolated temporary Signet directory is used; no peers or P2P listener.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { coreConfig, options, SIGNET_CHALLENGE } from '../../src/node/model.mjs';
import { createNodeService } from '../../src/node/service.mjs';
const binary = process.env.BITCODE_CORE_BINARY;
if (!binary || !path.isAbsolute(binary)) throw Error('Set BITCODE_CORE_BINARY to an absolute local bitcoind path');
fs.accessSync(binary, fs.constants.X_OK);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-core-smoke-'));
const server = net.createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port; await new Promise(resolve => server.close(resolve));
const instance = options({ id: 'isolated-signet', network: 'signet', rpcPort: port, explorer: true }, home);
fs.mkdirSync(instance.datadir, { recursive: true });
fs.writeFileSync(path.join(instance.datadir, 'bitcoin.conf'), coreConfig(instance), { mode: 0o600 });
const child = spawn(binary, [`-datadir=${instance.datadir}`, '-listen=0', '-connect=0', '-dnsseed=0', '-discover=0', '-dbcache=64', '-maxmempool=5'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit'); let diagnostic = '';
child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-4000); });
const service = createNodeService({ home });
try {
  let connected, last;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`Core exited: ${diagnostic}`);
    try { connected = await service.connect(instance, { confirmed: true }); break; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!connected) throw last;
  const status = await service.status(instance.id);
  assert.equal(status.core.chain, 'signet');
  assert.equal(status.core.initialblockdownload, true);
  assert.equal(status.ready, false, 'An isolated unsynchronized node must not be ready');
  assert.ok(status.indexes.txindex);
  assert.ok(status.indexes['basic block filter index']);
  const rpc = await import('../../src/node/service.mjs');
  const chain = await rpc.rpc(instance, 'getblockchaininfo');
  assert.equal(chain.signet_challenge, SIGNET_CHALLENGE);
  console.log(JSON.stringify({ passed: true, network: chain.chain, blocks: chain.blocks, initialblockdownload: chain.initialblockdownload, indexes: Object.keys(status.indexes), ready: status.ready, checks: ['generated config', 'cookie authentication', 'live Signet challenge', 'indexes', 'unsynced readiness'] }, null, 2));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  await exited; clearTimeout(timer);
  fs.rmSync(home, { recursive: true, force: true });
}
