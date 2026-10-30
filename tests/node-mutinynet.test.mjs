import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { options, coreConfig, CHALLENGE } from '../src/node/model.mjs';
import { MUTINYNET, sourceUrl, pinnedSource, mutinynetMagic, mutinynetIndexerArgs } from '../src/node/mutinynet.mjs';

test('Mutinynet has an isolated custom Signet config and matching network magic', () => {
  const i = options({ network: 'mutinynet', explorer: true }, '/tmp/bitcode-mutinynet-test');
  const conf = coreConfig(i);
  assert.match(conf, new RegExp(`signetchallenge=${CHALLENGE}`));
  assert.match(conf, /signetblocktime=30/); assert.match(conf, /dnsseed=0/);
  assert.equal(mutinynetMagic(), 'cb2ddfa5'); assert.equal(i.rpcPort, 39332);
  const args = mutinynetIndexerArgs(i, '/tmp/bitcode-mutinynet-test');
  assert.equal(args[args.indexOf('--daemon-dir') + 1], i.datadir, 'Indexer itself appends signet directory exactly once');
  assert.equal(args[args.indexOf('--magic') + 1], mutinynetMagic());
  assert.equal(args[args.indexOf('--http-addr') + 1], '127.0.0.1:3133');
});
test('experimental source URLs bind repository, full commit and distributed hash', () => {
  for (const source of [MUTINYNET.core, MUTINYNET.indexer]) {
    assert.equal(source.commit.length, 40); assert.equal(source.sha256.length, 64);
    assert.match(sourceUrl(source), new RegExp(source.commit));
    assert.throws(() => sourceUrl({ ...source, sha256: '0'.repeat(64) }), { code: 'UNREVIEWED_EXPERIMENTAL_SOURCE' });
    assert.throws(() => sourceUrl({ ...source, repository: 'https://github.com/unknown/bitcoin' }), { code: 'UNREVIEWED_EXPERIMENTAL_SOURCE' });
  }
});
test('corrupted experimental source never reaches archive extraction or build', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-mut-source-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, `bitcoin-${MUTINYNET.core.commit}.tar.gz`), 'corrupted');
  let commands = 0;
  await assert.rejects(pinnedSource(MUTINYNET.core, { directory, run: async () => { commands++; }, fetchImpl: () => { throw new Error('cached archive should not download'); } }), { code: 'SOURCE_HASH_MISMATCH' });
  assert.equal(commands, 0);
});
test('pinned source downloads reject redirects and untrusted replacement bytes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-mut-download-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let request;
  await assert.rejects(pinnedSource(MUTINYNET.indexer, { directory, run: () => { throw new Error('must not extract'); }, fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, body: [Buffer.from('wrong source')] }; } }), { code: 'SOURCE_HASH_MISMATCH' });
  assert.equal(new URL(request.url).origin, 'https://codeload.github.com'); assert.equal(request.options.redirect, 'error');
});

test('noninteractive experimental CLI installation announces verification policy before execution', async () => {
  const { nodeCLI } = await import('../src/node/cli.mjs'); const events = [];
  const service = { plan: async () => ({ warnings: ['EXPERIMENTAL_MUTINYNET', 'CURATED_SOURCE_HASH_NOT_GUIX_ATTESTED'] }), install: async () => { events.push({ installed: true }); return { ready: false }; } };
  await nodeCLI(['install', '--network', 'mutinynet', '--yes', '--json'], { service, print: () => {}, progress: event => events.push(event) });
  assert.equal(events[0].warning, 'EXPERIMENTAL_MUTINYNET'); assert.equal(events[1].warning, 'CURATED_SOURCE_HASH_NOT_GUIX_ATTESTED'); assert.equal(events[2].installed, true);
});
