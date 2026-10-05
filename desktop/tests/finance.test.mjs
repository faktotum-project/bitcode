import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFinance, GENESIS, classify } from '../core/finance.mjs';
import { createController } from '../core/controller.mjs';

const genesisOf = (map, name) => Object.entries(map).find(([, n]) => n === name)[0];
// Fake Esplora/mint: the backend's answers decide the environment, not config.
function setup({ bitcoin = {}, chain = 'signet', cashu = {}, liquidChain = 'liquidtestnet' } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'bitcode-fin-'));
  let cfg = { bitcoin, cashu, liquid: { network: 'testnet' } };
  const fetchImpl = async url => {
    if (url.includes('liquid')) return url.endsWith('/block-height/0') ? genesisOf(GENESIS.liquid, liquidChain) : url.endsWith('/tip/height') ? '100' : [];
    if (url.endsWith('/v1/info')) return { name: 'Test mint', version: 'cdk', nuts: { 4: {}, 5: {} } };
    if (url.endsWith('/block-height/0')) return genesisOf(GENESIS.bitcoin, chain);
    if (url.endsWith('/blocks/tip/height')) return '325000';
    throw new Error(`unexpected ${url}`);
  };
  const f = createFinance({ home, configImpl: () => cfg, saveConfigImpl: next => { cfg = next; }, fetchImpl });
  return { f, home, cfg: () => cfg };
}

test('environment is proven by the genesis block, never by the configured name', async () => {
  assert.equal(classify('signet'), 'test'); assert.equal(classify('mainnet'), 'production'); assert.equal(classify('weird'), 'unknown');
  const ok = await setup({ bitcoin: { network: 'signet' } }).f.methods['finance.verify']({ protocol: 'bitcoin' });
  assert.equal(ok.environment, 'test'); assert.equal(ok.network, 'signet');
  // "signet" in config but the backend serves mainnet → unknown, and no spend path.
  const lie = setup({ bitcoin: { network: 'signet' }, chain: 'mainnet' });
  const v = await lie.f.methods['finance.verify']({ protocol: 'bitcoin' });
  assert.equal(v.environment, 'unknown'); assert.ok(v.evidence.some(e => e.source === 'mismatch'));
  await assert.rejects(lie.f.methods['finance.bitcoin.prepare']({ to: 'tb1q', amountSats: 1000 }), { code: 'ENV_UNVERIFIED' });
  await assert.rejects(lie.f.methods['finance.bitcoin.createWallet'](), { code: 'ENV_UNVERIFIED' });
});

test('production is read-only in the backend, whatever the UI shows', async () => {
  const { f } = setup({ bitcoin: { network: 'mainnet' }, chain: 'mainnet' });
  assert.equal((await f.methods['finance.verify']({ protocol: 'bitcoin' })).environment, 'production');
  for (const call of [() => f.methods['finance.bitcoin.prepare']({ to: 'bc1q', amountSats: 1000 }), () => f.methods['finance.bitcoin.createWallet'](),
    () => f.methods['finance.bitcoin.policy']({ maxPaymentSats: 1, dailyLimitSats: 1, maxFeeSats: 1, minReserveSats: 0 })])
    await assert.rejects(call(), { code: 'ENV_READ_ONLY' });
  const liquid = await f.methods['finance.verify']({ protocol: 'liquid' });
  assert.equal(liquid.environment, 'test');
});

test('execution needs a human origin and the exact proposal id the human confirmed', async () => {
  const { f } = setup({ bitcoin: { network: 'signet' } });
  await assert.rejects(f.methods['finance.bitcoin.execute']({ proposalId: 'a', confirmedId: 'a' }, 'worker'), { code: 'FORBIDDEN_ORIGIN' });
  await assert.rejects(f.methods['finance.bitcoin.execute']({ proposalId: 'a', confirmedId: 'b' }, 'ui:1'), { code: 'APPROVAL_DIGEST_MISMATCH' });
  const c = createController({ home: mkdtempSync(path.join(tmpdir(), 'bitcode-fin-c-')), config: {}, sandbox: { available: true } });
  for (const m of ['finance.bitcoin.execute', 'finance.bitcoin.prepare', 'finance.configure', 'finance.cashuAllow', 'finance.bitcoin.createWallet'])
    await assert.rejects(c.invoke(m, {}), { code: 'FORBIDDEN_ORIGIN' }, m);
  c.shutdown();
});

test('a Cashu mint is test only when allow-listed and Lightning is a verified test node', async () => {
  const { f } = setup({ cashu: { network: 'testnet', mintUrl: 'https://mint.example' } });
  assert.equal((await f.methods['finance.verify']({ protocol: 'cashu' })).environment, 'unknown');
  await f.methods['finance.cashuAllow']({ mintUrl: 'https://mint.example', allowed: true });
  const v = await f.methods['finance.verify']({ protocol: 'cashu' });
  assert.equal(v.environment, 'unknown', 'allow-list alone is not enough without a test Lightning node');
  assert.ok(v.evidence.some(e => e.source === 'lightning' && e.value === 'not connected'));
});

test('connection settings are validated before they reach the shared config', async () => {
  const s = setup({ bitcoin: { network: 'signet' } });
  await assert.rejects(s.f.methods['finance.configure']({ protocol: 'bitcoin', fields: { esploraUrl: 'javascript:alert(1)' } }), { code: 'INVALID_PARAMS' });
  await assert.rejects(s.f.methods['finance.configure']({ protocol: 'bitcoin', fields: { rpcPassword: 'x' } }), { code: 'INVALID_PARAMS' });
  await assert.rejects(s.f.methods['finance.configure']({ protocol: 'lightning', fields: { lndRestUrl: 'http://plain.example' } }), { code: 'INVALID_PARAMS' });
  const r = await s.f.methods['finance.configure']({ protocol: 'bitcoin', fields: { network: 'signet', esploraUrl: 'http://127.0.0.1:3002/api' } });
  assert.equal(s.cfg().bitcoin.esploraUrl, 'http://127.0.0.1:3002/api');
  assert.equal(r.localBackend, true);
});
