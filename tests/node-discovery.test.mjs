import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverNodes, nodeCandidate } from '../src/node/discovery.mjs';
import { CHALLENGE, coreConfig, options } from '../src/node/model.mjs';
const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-node-discovery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
test('discovery distinguishes configured networks and never returns passwords', t => {
  const root = temporary(t); const data = path.join(root, 'data'); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'bitcoin.conf'), `signet=1\nrpcpassword=do-not-expose\n[signet]\nrpcport=39332\nsignetchallenge=${CHALLENGE}\n`);
  const result = nodeCandidate(['/usr/bin/bitcoind', `-datadir=${data}`], root);
  assert.equal(result.network, 'mutinynet'); assert.equal(result.rpcPort, 39332);
  assert.equal(result.evidence, 'configuration-candidate'); assert.doesNotMatch(JSON.stringify(result), /do-not-expose|rpcpassword/);
  fs.writeFileSync(path.join(data, 'bitcoin.conf'), `signet=1\n[signet]\nsignetchallenge=${CHALLENGE}\n`);
  assert.equal(nodeCandidate(['bitcoind', `-datadir=${data}`], root).rpcPort, 38332, 'Existing custom Signet keeps its protocol default RPC port');
  assert.equal(nodeCandidate(['unrelated-process', `-datadir=${data}`], root), null);
});
test('discovery enumerates only the same user and tolerates disappearing processes', t => {
  const root = temporary(t); const proc = path.join(root, 'proc'); fs.mkdirSync(proc);
  for (const [pid, uid, command] of [[10, 1000, ['bitcoind', '-datadir=/tmp/one', '-testnet4']], [11, 1001, ['bitcoind', '-datadir=/tmp/private']], [12, 1000, ['unrelated', '--password=private']]]) {
    const dir = path.join(proc, String(pid)); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'status'), `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`); fs.writeFileSync(path.join(dir, 'cmdline'), command.join('\0'));
  }
  fs.mkdirSync(path.join(proc, '13'));
  const result = discoverNodes({ procRoot: proc, home: root, uid: 1000 });
  assert.equal(result.length, 1); assert.equal(result[0].network, 'testnet4'); assert.equal(result[0].pid, 10);
});
test('legacy Testnet3 is discoverable for connection but cannot generate a new managed config', t => {
  const root = temporary(t); const result = nodeCandidate(['bitcoind', '-testnet', '-datadir=/tmp/legacy-testnet'], root);
  assert.equal(result.network, 'testnet'); assert.equal(result.connectionOnly, true);
  assert.throws(() => coreConfig(options({ network: 'testnet' }, root)), { code: 'LEGACY_NETWORK_CONNECTION_ONLY' });
});
