// Desktop finance service: runs in the Electron main process, never in the
// sandboxed coding worker. Environment classification is proven by the backend
// (genesis block, node info), never by a configured name (D0 contracts §13).
// Production and unknown environments are read-only; Bitcoin test spends reuse
// src/finance (policy, proposal, human confirmation, reconciliation).
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from '../../src/config.mjs';
import { resolveNetwork } from '../../src/bitcoin/network.mjs';
import { esplora } from '../../src/bitcoin/esplora.mjs';
import { wallet as bitcoinWallet } from '../../src/bitcoin/wallet.mjs';
import { resolveLightning } from '../../src/lightning/network.mjs';
import { lnd } from '../../src/lightning/lnd.mjs';
import { tapd } from '../../src/lightning/tapd.mjs';
import { resolveLiquidNetwork } from '../../src/liquid/network.mjs';
import { resolveCashuNetwork } from '../../src/cashu/network.mjs';
import { httpGet } from '../../src/http.mjs';
import { financeStatus, setFinancePolicy, prepareBitcoin, executeBitcoin, reconcileBitcoin } from '../../src/finance/bitcoin.mjs';
import { fail, loadJSON, atomicJSON } from './primitives.mjs';

export const GENESIS = {
  bitcoin: {
    '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f': 'mainnet',
    '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943': 'testnet',
    '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043': 'testnet4',
    '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6': 'signet',
    '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206': 'regtest'
  },
  liquid: {
    '1466275836220db2944ca059a3a10ef6fd2ea684b0688d2c379296888a206003': 'liquidv1',
    'a771da8e52ee6ad581ed1e9a99825e5b3b7992225534eaa2ae23244fe26ab1c1': 'liquidtestnet'
  }
};
const TEST = new Set(['testnet', 'testnet4', 'signet', 'regtest', 'liquidtestnet', 'liquidregtest', 'elementsregtest', 'simnet']);
const PROD = new Set(['mainnet', 'liquidv1', 'bitcoin']);
export const classify = network => TEST.has(network) ? 'test' : PROD.has(network) ? 'production' : 'unknown';
export const PROTOCOLS = ['bitcoin', 'lightning', 'cashu', 'liquid', 'taproot'];
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const isLocalHttp = url => { try { const u = new URL(url); return u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname); } catch { return false; } };

export function createFinance({ home, emit = () => {}, configImpl, saveConfigImpl, fetchImpl } = {}) {
  const config = () => configImpl ? configImpl() : loadConfig();
  const save = cfg => saveConfigImpl ? saveConfigImpl(cfg) : saveConfig(cfg);
  const dir = path.join(home, 'desktop');
  const mintsFile = path.join(dir, 'cashu-test-mints.json');
  const verified = new Map(); // protocol → last verification (re-run before every prepare/execute)
  const financeRoot = () => { mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
  const get = (url, json = true) => fetchImpl ? fetchImpl(url, json) : httpGet(url, { json });

  // ---- environment proofs ----
  async function verifyBitcoin(cfg) {
    const ctx = resolveNetwork(cfg);
    const evidence = [{ source: 'config', value: `bitcoin.network = ${ctx.name}` }, { source: 'endpoint', value: ctx.esploraUrl }];
    const genesis = String(await get(`${ctx.esploraUrl}/block-height/0`, false)).trim();
    const network = GENESIS.bitcoin[genesis] || 'unknown';
    evidence.push({ source: 'genesis', value: `${genesis.slice(0, 16)}… → ${network}` });
    const tip = Number(await get(`${ctx.esploraUrl}/blocks/tip/height`, false));
    evidence.push({ source: 'tip', value: String(tip) });
    // Testnet3 and testnet4 share address params; a configured name that the
    // backend contradicts is "unknown", never trusted.
    const consistent = network === ctx.name;
    if (!consistent) evidence.push({ source: 'mismatch', value: `configured ${ctx.name}, backend ${network}` });
    return { network, environment: consistent ? classify(network) : 'unknown', evidence, tip, localBackend: isLocalHttp(ctx.esploraUrl) && !!cfg.bitcoin?.esploraUrl };
  }
  async function verifyLightning(cfg) {
    const l = resolveLightning(cfg); if (!l) return null;
    const info = await lnd(l.lnd).getInfo();
    const network = info.chains?.[0]?.network || 'unknown';
    return { network, environment: classify(network), tip: info.block_height, evidence: [{ source: 'lnd getinfo', value: `${info.alias || ''} · ${network} · synced ${info.synced_to_chain}` }] };
  }
  async function verifyTaproot(cfg) {
    const l = resolveLightning(cfg); if (!l?.tapd) return null;
    const info = await tapd(l.tapd).getInfo();
    const network = info.network || 'unknown';
    const ln = verified.get('lightning')?.status === 'connected' ? verified.get('lightning') : null;
    const consistent = !ln || ln.network === network;
    return { network, environment: consistent ? classify(network) : 'unknown', tip: info.block_height, evidence: [{ source: 'tapd getinfo', value: `${network} · lnd ${info.lnd_version || ''}` }, ...(consistent ? [] : [{ source: 'mismatch', value: `lnd ${ln.network}, tapd ${network}` }])] };
  }
  async function verifyLiquid(cfg) {
    const ctx = resolveLiquidNetwork(cfg);
    const genesis = String(await get(`${ctx.esploraUrl}/block-height/0`, false)).trim();
    const network = GENESIS.liquid[genesis] || 'unknown';
    const tip = Number(await get(`${ctx.esploraUrl}/blocks/tip/height`, false));
    return { network, environment: classify(network), tip, evidence: [{ source: 'endpoint', value: ctx.esploraUrl }, { source: 'genesis', value: `${genesis.slice(0, 16)}… → ${network}` }] };
  }
  // No cryptographic proof exists for Cashu (D-6): a mint is "test" only when
  // the user allow-listed it and melts go to a Lightning node verified as test.
  async function verifyCashu(cfg) {
    const ctx = resolveCashuNetwork(cfg);
    const info = await get(`${ctx.mintUrl.replace(/\/$/, '')}/v1/info`);
    const allowed = loadJSON(mintsFile, []).includes(ctx.mintUrl);
    const ln = verified.get('lightning')?.status === 'connected' ? verified.get('lightning') : null;
    const environment = allowed && ln?.environment === 'test' ? 'test' : 'unknown';
    return { network: allowed ? 'allow-listed' : 'not allow-listed', environment, mint: { name: info.name, version: info.version, description: info.description, nuts: Object.keys(info.nuts || {}) },
      evidence: [{ source: 'mint', value: `${ctx.mintUrl} · ${info.name || ''} ${info.version || ''}` }, { source: 'allowlist', value: allowed ? 'yes' : 'no' },
        { source: 'lightning', value: ln ? `${ln.network} (${ln.environment})` : 'not connected' }] };
  }
  const VERIFY = { bitcoin: verifyBitcoin, lightning: verifyLightning, taproot: verifyTaproot, liquid: verifyLiquid, cashu: verifyCashu };

  async function verify(protocol) {
    if (!VERIFY[protocol]) throw fail('INVALID_PARAMS', 'Unknown protocol');
    const cfg = config();
    let result;
    try {
      const r = await VERIFY[protocol](cfg);
      result = r ? { protocol, status: 'connected', ...r } : { protocol, status: 'not_configured', environment: null, evidence: [] };
    } catch (e) { result = { protocol, status: 'error', environment: 'unknown', error: e.message, evidence: [] }; }
    result.at = new Date().toISOString();
    const previous = verified.get(protocol);
    verified.set(protocol, result);
    if (previous && previous.environment !== result.environment) emit('finance', { type: 'environment.changed', protocol, from: previous.environment, to: result.environment });
    return result;
  }
  const verifyAll = async () => { await verify('lightning'); return Object.fromEntries(await Promise.all(PROTOCOLS.map(async p => [p, p === 'lightning' ? verified.get(p) : await verify(p)]))); };

  // ---- read-only data ----
  async function bitcoinOverview({ gap = 20 } = {}) {
    const cfg = config(), ctx = resolveNetwork(cfg), api = esplora(ctx.esploraUrl);
    const env = await verify('bitcoin');
    const w = bitcoinWallet(ctx);
    const out = { network: ctx.name, env, wallet: { exists: w.exists(), file: w.file }, fees: null, canSpend: false, spendBlockers: [] };
    try { out.fees = await api.feesRecommended(); } catch { out.fees = null; }
    if (!out.wallet.exists) { out.spendBlockers.push('no_wallet'); return out; }
    const addrs = w.addresses({ gap });
    const stats = await pool(addrs, 6, async a => ({ ...a, info: await api.address(a.address) }));
    const used = stats.filter(a => (a.info.chain_stats?.tx_count || 0) + (a.info.mempool_stats?.tx_count || 0) > 0);
    const sum = (k, s) => stats.reduce((n, a) => n + (a.info[s]?.[k] || 0), 0);
    const confirmed = sum('funded_txo_sum', 'chain_stats') - sum('spent_txo_sum', 'chain_stats');
    const pending = sum('funded_txo_sum', 'mempool_stats') - sum('spent_txo_sum', 'mempool_stats');
    const mine = new Set(addrs.map(a => a.address));
    const txs = new Map();
    for (const a of used) for (const tx of await api.addressTxs(a.address)) txs.set(tx.txid, tx);
    out.balance = { confirmedSats: confirmed, pendingSats: pending };
    out.receive = { address: (stats.find(a => a.change === 0 && !used.includes(a)) || stats[0]).address, index: (stats.find(a => a.change === 0 && !used.includes(a)) || stats[0]).index };
    out.transactions = [...txs.values()].map(tx => {
      const inn = tx.vout.filter(o => mine.has(o.scriptpubkey_address)).reduce((n, o) => n + o.value, 0);
      const outv = tx.vin.filter(i => mine.has(i.prevout?.scriptpubkey_address)).reduce((n, i) => n + i.prevout.value, 0);
      return { txid: tx.txid, deltaSats: inn - outv, feeSats: outv ? tx.fee : null, confirmed: !!tx.status?.confirmed, height: tx.status?.block_height || null, time: tx.status?.block_time ? tx.status.block_time * 1000 : null };
    }).sort((a, b) => (b.time || Infinity) - (a.time || Infinity));
    out.utxoAddresses = used.length;
    out.descriptorAvailable = true;
    if (env.environment !== 'test') out.spendBlockers.push(env.environment === 'production' ? 'production' : 'unverified');
    if (!env.localBackend) out.spendBlockers.push('needs_local_esplora');
    const fin = financeStatus({ root: financeRoot() });
    out.policy = fin.policy; out.proposals = fin.proposals.filter(p => p.network === ctx.name).slice(-20).reverse();
    if (!fin.policy) out.spendBlockers.push('no_policy');
    out.canSpend = !out.spendBlockers.length;
    return out;
  }
  async function lightningOverview() {
    const env = await verify('lightning'); if (env.status !== 'connected') return { env };
    const l = resolveLightning(config()), c = lnd(l.lnd);
    const [info, chain, channels, list] = await Promise.all([c.getInfo(), c.walletBalance().catch(() => null), c.channelBalance().catch(() => null), c.listChannels().catch(() => ({ channels: [] }))]);
    return { env, node: { alias: info.alias, pubkey: info.identity_pubkey, synced: info.synced_to_chain, height: info.block_height, peers: info.num_peers, active: info.num_active_channels },
      balance: { onchainSats: Number(chain?.confirmed_balance ?? 0), unconfirmedSats: Number(chain?.unconfirmed_balance ?? 0), localSats: Number(channels?.local_balance?.sat ?? channels?.balance ?? 0), remoteSats: Number(channels?.remote_balance?.sat ?? 0) },
      channels: (list.channels || []).slice(0, 50).map(ch => ({ peer: ch.remote_pubkey, capacity: Number(ch.capacity), local: Number(ch.local_balance), remote: Number(ch.remote_balance), active: ch.active })) };
  }
  async function taprootOverview() {
    const env = await verify('taproot'); if (env.status !== 'connected') return { env };
    const t = tapd(resolveLightning(config()).tapd);
    const balances = await t.listBalances();
    return { env, assets: Object.values(balances.asset_balances || {}).map(b => ({ id: b.asset_genesis?.asset_id, name: b.asset_genesis?.name, balance: String(b.balance) })) };
  }
  async function liquidOverview() {
    const env = await verify('liquid'); if (env.status !== 'connected') return { env };
    const ctx = resolveLiquidNetwork(config());
    const fees = await get(`${ctx.esploraUrl}/fee-estimates`).catch(() => null);
    const blocks = await get(`${ctx.esploraUrl}/blocks`).catch(() => []);
    return { env, fees, blocks: blocks.slice(0, 6).map(b => ({ height: b.height, txs: b.tx_count, time: b.timestamp * 1000 })), wallet: null };
  }
  async function cashuOverview() {
    const env = await verify('cashu'); if (env.status !== 'connected') return { env };
    const ctx = resolveCashuNetwork(config());
    return { env, mintUrl: ctx.mintUrl, allowList: loadJSON(mintsFile, []), wallet: null };
  }
  const OVERVIEW = { bitcoin: bitcoinOverview, lightning: lightningOverview, taproot: taprootOverview, liquid: liquidOverview, cashu: cashuOverview };

  // ---- connections (human-only writes to the shared CLI config) ----
  const FIELDS = {
    bitcoin: { network: v => ['signet', 'testnet', 'testnet4', 'mainnet'].includes(v), esploraUrl: v => v === '' || /^https?:\/\/[^\s]+$/.test(v) },
    lightning: { lndRestUrl: v => v === '' || /^https:\/\/[^\s]+$/.test(v), lndMacaroonPath: v => v === '' || v.startsWith('/') || v.startsWith('~'), tlsCertPath: v => v === '' || v.startsWith('/') || v.startsWith('~'),
      tapdRestUrl: v => v === '' || /^https:\/\/[^\s]+$/.test(v), tapdMacaroonPath: v => v === '' || v.startsWith('/') || v.startsWith('~') },
    liquid: { network: v => ['mainnet', 'testnet'].includes(v), esploraUrl: v => v === '' || /^https?:\/\/[^\s]+$/.test(v) },
    cashu: { network: v => ['testnet', 'regtest', 'mainnet'].includes(v), mintUrl: v => v === '' || /^https?:\/\/[^\s]+$/.test(v) }
  };
  const SECTION = { bitcoin: 'bitcoin', lightning: 'lightning', taproot: 'lightning', liquid: 'liquid', cashu: 'cashu' };
  function connections() {
    const cfg = config();
    return Object.fromEntries(PROTOCOLS.map(p => {
      const sec = cfg[SECTION[p]] || {};
      const fields = Object.fromEntries(Object.keys(FIELDS[SECTION[p]] || {}).map(k => [k, typeof sec[k] === 'string' ? sec[k] : '']));
      return [p, { fields, verification: verified.get(p) || null }];
    }));
  }
  async function configure({ protocol, fields }) {
    const section = SECTION[protocol], rules = FIELDS[section];
    if (!rules || !fields || typeof fields !== 'object') throw fail('INVALID_PARAMS');
    for (const [k, v] of Object.entries(fields)) if (!rules[k] || typeof v !== 'string' || !rules[k](v.trim())) throw fail('INVALID_PARAMS', `Invalid ${k}`);
    const cfg = config();
    const next = { ...(cfg[section] || {}) };
    for (const [k, v] of Object.entries(fields)) { if (v.trim()) next[k] = v.trim(); else delete next[k]; }
    cfg[section] = next; save(cfg);
    verified.delete(protocol); if (section === 'lightning') { verified.delete('lightning'); verified.delete('taproot'); }
    return verify(protocol);
  }
  async function setMintAllowed({ mintUrl, allowed }) {
    if (typeof mintUrl !== 'string' || !/^https?:\/\//.test(mintUrl)) throw fail('INVALID_PARAMS');
    const list = new Set(loadJSON(mintsFile, []));
    allowed ? list.add(mintUrl) : list.delete(mintUrl);
    mkdirSync(dir, { recursive: true, mode: 0o700 }); atomicJSON(mintsFile, [...list]);
    verified.delete('cashu'); return [...list];
  }

  // ---- Bitcoin test operations (backend-enforced) ----
  async function requireTestBitcoin() {
    const env = await verify('bitcoin');
    if (env.environment === 'production') throw fail('ENV_READ_ONLY', 'Production is read-only');
    if (env.environment !== 'test') throw fail('ENV_UNVERIFIED', 'Network not verified as a test network');
    return env;
  }
  async function createWallet() {
    const env = await requireTestBitcoin();
    const w = bitcoinWallet(resolveNetwork(config()));
    if (w.exists()) throw fail('INVALID_PARAMS', 'Wallet already exists');
    const created = w.create();
    return { network: env.network, file: created.file, address0: created.address0 };
  }
  async function setPolicy(policy) {
    await requireTestBitcoin();
    return setFinancePolicy(policy, { root: financeRoot() });
  }
  async function prepare({ to, amountSats, feeRate }) {
    await requireTestBitcoin();
    const p = await prepareBitcoin(config(), { to, amountSats, feeRate: feeRate === '' || feeRate == null ? undefined : feeRate, root: financeRoot() });
    emit('finance', { type: 'proposal', proposal: p });
    return p;
  }
  // `confirmedId` is the proposal id the human saw in the confirmation dialog;
  // the id is a hash of the proposal, so any change in amount, address or fee
  // produces a different id and the confirmation does not carry over.
  async function execute({ proposalId, confirmedId }, origin) {
    if (!/^(ui:\d+)$/.test(origin || '')) throw fail('FORBIDDEN_ORIGIN');
    if (typeof proposalId !== 'string' || proposalId !== confirmedId) throw fail('APPROVAL_DIGEST_MISMATCH');
    await requireTestBitcoin();
    const res = await executeBitcoin(config(), proposalId, { root: financeRoot(), approve: async p => p.id === confirmedId && p.status === 'prepared' });
    emit('finance', { type: 'proposal', proposal: { id: proposalId, ...res } });
    return res;
  }
  async function reconcile({ proposalId }) {
    const res = await reconcileBitcoin(config(), proposalId, { root: financeRoot() });
    emit('finance', { type: 'proposal', proposal: res });
    return res;
  }

  return {
    methods: {
      'finance.connections': () => connections(),
      'finance.verify': ({ protocol }) => verify(protocol),
      'finance.verifyAll': () => verifyAll(),
      'finance.overview': ({ protocol }) => { if (!OVERVIEW[protocol]) throw fail('INVALID_PARAMS'); return OVERVIEW[protocol](); },
      'finance.configure': p => configure(p),
      'finance.cashuAllow': p => setMintAllowed(p),
      'finance.bitcoin.createWallet': () => createWallet(),
      'finance.bitcoin.policy': p => setPolicy(p),
      'finance.bitcoin.prepare': p => prepare(p),
      'finance.bitcoin.execute': (p, origin) => execute(p, origin),
      'finance.bitcoin.reconcile': p => reconcile(p)
    },
    human: ['finance.configure', 'finance.cashuAllow', 'finance.bitcoin.createWallet', 'finance.bitcoin.policy', 'finance.bitcoin.prepare', 'finance.bitcoin.execute', 'finance.bitcoin.reconcile'],
    verified
  };
}
