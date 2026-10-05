// Demo backend for the Bitcode Desktop marketing video.
// The real renderer bundle runs unchanged; only window.bitcode (normally the
// Electron preload bridge) is replaced with deterministic fixtures. Everything
// shown on screen is produced by the real UI code from these data.
(() => {
  const BASE = new Date('2026-10-05T10:42:00').getTime();
  const RealDate = Date;
  let OFFSET = 0; // advanced by the video engine so clocks in the UI (elapsed seconds) follow the film, not the wall
  class FixedDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(BASE + OFFSET); } static now() { return BASE + OFFSET; } }
  window.Date = FixedDate;
  window.__setNow = ms => { OFFSET = ms; };
  window.confirm = () => true; // native confirm() would block the recording

  const GiB = 1024 ** 3, MIN = 60_000, HOUR = 3_600_000;
  const listeners = new Set();
  const emit = (channel, payload) => listeners.forEach(fn => { try { fn({ channel, payload }); } catch {} });
  window.__emit = emit;

  const sats = window.__SATS;
  const settings = { v: 1, lang: 'it', theme: 'dark', maxActive: 3, maxLocal: 1, model: null, satModels: {}, localOnly: false };
  const DEFAULT_MODEL = 'ollama/qwen3-coder:30b';

  const PROJECT = { projectId: 'p_btcinvoice', root: '/home/dev/btc-invoice-api', name: 'btc-invoice-api', openedAt: BASE };
  const PROJECT2 = { projectId: 'p_kiosk', root: '/home/dev/lightning-kiosk', name: 'lightning-kiosk', openedAt: BASE - 26 * HOUR };
  const S = { opened: false, sessions: [], staged: new Set(['src/signature.js']), committed: false, mode: 'assisted', proposals: [], proposalSent: false, txs: null, allow: [], ptyId: null };

  const seedSessions = () => [
    { sessionId: 's_a', projectId: PROJECT.projectId, name: 'Rifattorizza il parser delle invoice', mode: 'assisted', model: null, satModels: {}, satId: '', keep: true, updatedAt: BASE - 2 * HOUR },
    { sessionId: 's_b', projectId: PROJECT.projectId, name: 'Fix timeout Esplora in lettura', mode: 'assisted', model: null, satModels: {}, satId: 'node', keep: false, updatedAt: BASE - 5 * HOUR },
    { sessionId: 's_c', projectId: PROJECT.projectId, name: 'Stima commissioni con RBF', mode: 'manual', model: null, satModels: {}, satId: '', keep: false, updatedAt: BASE - 27 * HOUR },
    { sessionId: 's_d', projectId: PROJECT2.projectId, name: 'Pagina di checkout Lightning', mode: 'assisted', model: null, satModels: {}, satId: 'script', keep: false, updatedAt: BASE - 30 * HOUR }
  ].map(s => ({ ...s, expiresAt: s.keep ? null : s.updatedAt + 7 * 24 * HOUR, active: false }));
  const messages = {};
  const meta = s => ({ ...s, expiresAt: s.keep ? null : s.updatedAt + 7 * 24 * HOUR, active: !!s.active });

  // ---- project files ----
  const WEBHOOKS_BEFORE = `import { createServer } from 'node:http';
import { markPaid } from './invoice.js';

// Riceve le notifiche di pagamento dal gateway.
export function webhookHandler(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    const event = JSON.parse(body);
    if (event.type === 'payment.confirmed') {
      await markPaid(event.invoiceId, event.txid);
    }
    res.writeHead(204).end();
  });
}

export function startWebhookServer(port = 8787) {
  return createServer(webhookHandler).listen(port);
}
`;
  const WEBHOOKS_AFTER = `import { createServer } from 'node:http';
import { markPaid } from './invoice.js';
import { verifySignature } from './signature.js';

const MAX_SKEW_MS = 5 * 60 * 1000;

// Riceve le notifiche di pagamento dal gateway.
export function webhookHandler(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    const stamp = Number(req.headers['x-bitcode-timestamp']);
    const valid = verifySignature(body, req.headers['x-bitcode-signature'], process.env.WEBHOOK_SECRET);
    if (!valid || Math.abs(Date.now() - stamp) > MAX_SKEW_MS) {
      return res.writeHead(401).end();
    }
    const event = JSON.parse(body);
    if (event.type === 'payment.confirmed') {
      await markPaid(event.invoiceId, event.txid);
    }
    res.writeHead(204).end();
  });
}

export function startWebhookServer(port = 8787) {
  return createServer(webhookHandler).listen(port);
}
`;
  const SIGNATURE = `import { createHmac, timingSafeEqual } from 'node:crypto';

// HMAC-SHA256 del corpo grezzo, confrontato a tempo costante.
export function verifySignature(body, header, secret) {
  if (!header || !secret) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(String(header).replace(/^sha256=/, ''), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
`;
  const FILES = {
    'src/webhooks.js': WEBHOOKS_AFTER,
    'src/signature.js': SIGNATURE,
    'src/invoice.js': `export async function markPaid(invoiceId, txid) {\n  // aggiorna lo stato della fattura nel database\n}\n`,
    'src/fees.js': `export const feeTiers = ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee'];\n`,
    'src/index.js': `export { startWebhookServer } from './webhooks.js';\n`,
    'tests/webhooks.test.js': `import test from 'node:test';\nimport assert from 'node:assert/strict';\n`,
    'tests/signature.test.js': `import test from 'node:test';\nimport assert from 'node:assert/strict';\n`,
    'package.json': `{\n  "name": "btc-invoice-api",\n  "version": "0.4.2",\n  "type": "module",\n  "scripts": { "test": "node --test tests/" }\n}\n`,
    'README.md': `# btc-invoice-api\n\nAPI per fatture pagabili in Bitcoin.\n`,
    '.gitignore': `node_modules/\n.env\n`
  };
  const TREE = {
    '.': [['.github', 1], ['src', 1], ['tests', 1], ['.gitignore'], ['package.json'], ['README.md']],
    'src': [['fees.js'], ['index.js'], ['invoice.js'], ['signature.js'], ['webhooks.js']],
    'tests': [['signature.test.js'], ['webhooks.test.js']],
    '.github': [['workflows', 1]]
  };
  const treeOf = (rel) => (TREE[rel] || []).map(([name, dir]) => ({ name, path: rel === '.' ? name : `${rel}/${name}`, dir: !!dir }));
  const version = text => String(text.length * 7919 % 100003);

  const DIFF_WEBHOOKS = `diff --git a/src/webhooks.js b/src/webhooks.js
index 3f1c2a9..b7d04e1 100644
--- a/src/webhooks.js
+++ b/src/webhooks.js
@@ -1,5 +1,8 @@
 import { createServer } from 'node:http';
 import { markPaid } from './invoice.js';
+import { verifySignature } from './signature.js';
+
+const MAX_SKEW_MS = 5 * 60 * 1000;

 // Riceve le notifiche di pagamento dal gateway.
 export function webhookHandler(req, res) {
@@ -7,6 +10,11 @@ export function webhookHandler(req, res) {
   req.on('data', chunk => { body += chunk; });
   req.on('end', async () => {
+    const stamp = Number(req.headers['x-bitcode-timestamp']);
+    const valid = verifySignature(body, req.headers['x-bitcode-signature'], process.env.WEBHOOK_SECRET);
+    if (!valid || Math.abs(Date.now() - stamp) > MAX_SKEW_MS) {
+      return res.writeHead(401).end();
+    }
     const event = JSON.parse(body);
     if (event.type === 'payment.confirmed') {
       await markPaid(event.invoiceId, event.txid);
`;
  const DIFF_TEST = `diff --git a/tests/webhooks.test.js b/tests/webhooks.test.js
index 91ac0de..4be2f70 100644
--- a/tests/webhooks.test.js
+++ b/tests/webhooks.test.js
@@ -1,2 +1,9 @@
 import test from 'node:test';
 import assert from 'node:assert/strict';
+import { webhookHandler } from '../src/webhooks.js';
+
+test('rifiuta un webhook senza firma', async () => {
+  const res = await call(webhookHandler, { body: '{}', headers: {} });
+  assert.equal(res.status, 401);
+});
`;
  const gitFiles = () => [
    { path: 'src/signature.js', index: S.staged.has('src/signature.js') ? 'A' : '?', worktree: S.staged.has('src/signature.js') ? ' ' : '?' },
    { path: 'src/webhooks.js', index: S.staged.has('src/webhooks.js') ? 'M' : ' ', worktree: S.staged.has('src/webhooks.js') ? ' ' : 'M' },
    { path: 'tests/signature.test.js', index: S.staged.has('tests/signature.test.js') ? 'A' : '?', worktree: S.staged.has('tests/signature.test.js') ? ' ' : '?' },
    { path: 'tests/webhooks.test.js', index: S.staged.has('tests/webhooks.test.js') ? 'M' : ' ', worktree: S.staged.has('tests/webhooks.test.js') ? ' ' : 'M' }
  ];

  // ---- models ----
  const machine = { ram: { total: 64 * GiB, available: 41.3 * GiB }, gpus: [{ name: 'NVIDIA GeForce RTX 4090', vram: 24 * GiB, unified: false }], cpus: 16 };
  const m = (provider, id, quant, params, gb, fit) => ({ spec: `${provider}/${id}`, model: id, detail: `${params} · ${quant} · ${gb} GB`, size: gb * GiB, fit });
  const available = () => ({
    local: [
      { provider: 'ollama', label: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', configured: true, running: true, hint: null, models: [
        m('ollama', 'qwen3-coder:30b', 'Q4_K_M', '30B', 17.3, 'gpu'), m('ollama', 'gpt-oss:20b', 'MXFP4', '20B', 12.8, 'gpu'),
        m('ollama', 'devstral:24b', 'Q4_K_M', '24B', 13.4, 'gpu'), m('ollama', 'llama3.3:70b', 'Q4_K_M', '70B', 39.6, 'ram')] },
      { provider: 'lmstudio', label: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1', configured: true, running: true, hint: null, models: [
        m('lmstudio', 'qwen2.5-coder-7b-instruct', 'Q8_0', '7B', 7.6, 'gpu')] }
    ],
    idle: [{ name: 'deepseek-r1:70b', runtime: 'llama.cpp', size: 42.5 * GiB, fit: 'tight', hint: 'llama-server -m ~/models/deepseek-r1-70b-q4.gguf' }],
    machine,
    cloud: [{ provider: 'anthropic', spec: 'anthropic/claude-sonnet-5-5', model: 'claude-sonnet-5-5', hasKey: true },
      { provider: 'openai', spec: 'openai/gpt-5', model: 'gpt-5', hasKey: false }, { provider: 'openrouter', spec: 'openrouter/auto', model: 'auto', hasKey: false }],
    current: DEFAULT_MODEL, auto: true, localOnly: false
  });

  // ---- finance ----
  const iso = '2026-10-05T08:41:12.000Z';
  const ev = (protocol, network, extra = {}) => ({ protocol, status: 'connected', environment: 'test', network, at: iso, evidence: [{ source: 'genesis', value: network }], ...extra });
  const ADDR = 'tb1qx4m9n7d0c5rk2v8wl3ahe6u0yzjf94qsw7t2dn';
  const baseTxs = () => [
    { txid: '9c1e47b0a3d85f62e4d7c01b8a9f3e5276d4b1c0a8e93f57d2b6c4018af3e7d1', deltaSats: 250000, feeSats: null, confirmed: true, height: 281930, time: BASE - 38 * MIN },
    { txid: '5be2f8a1c7d4039e6b1a2c8d7f0e4953a6b8d1c27e0f94a3b5c6d7e8f9012a3b', deltaSats: -48200, feeSats: 1412, confirmed: true, height: 281877, time: BASE - 3 * HOUR },
    { txid: 'a07d3c91e5b2f486d0c1a9e7b3f58264c1d0e9a8b7f6054321cdeba987654fe0', deltaSats: 640510, feeSats: null, confirmed: true, height: 281702, time: BASE - 9 * HOUR }
  ];
  const bitcoinOverview = () => ({
    network: 'signet', env: ev('bitcoin', 'signet', { tip: 281943, localBackend: true, environment: 'test' }),
    wallet: { exists: true, file: '~/.bitcode/wallets/signet.json' }, fees: { fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 2, minimumFee: 1 },
    canSpend: true, spendBlockers: [],
    balance: S.proposalSent ? { confirmedSats: 842310, pendingSats: -21128 } : { confirmedSats: 842310, pendingSats: 0 },
    receive: { address: ADDR, index: 7 },
    transactions: S.proposalSent ? [{ txid: 'e41b7a09c3d5f8264b0a19d7c6e3f5a2b8d10c9e7f6a4b3c2d1e0f9a8b7c6d5e', deltaSats: -21128, feeSats: 1128, confirmed: false, height: null, time: null }, ...baseTxs()] : baseTxs(),
    policy: { maxPaymentSats: 50000, dailyLimitSats: 200000, maxFeeSats: 2000, minReserveSats: 100000 },
    proposals: S.proposals
  });
  const OVERVIEW = {
    bitcoin: bitcoinOverview,
    lightning: () => ({ env: ev('lightning', 'signet'), node: { alias: 'bitcode-signet-ln', pubkey: '03a1f4c8d92e5b60173f8a4d2c9e0b7516f3d84a2c1e9b0753d6a8f2c4e1b09d57', synced: true, height: 281943, peers: 4, active: 3 },
      balance: { onchainSats: 312400, unconfirmedSats: 0, localSats: 1480000, remoteSats: 920000 },
      channels: [
        { peer: '02b7d4e19c83a5f0627d1e8b4a9c3f50d2e7b6a18c4f9d03e5a2b7c1d8f6049e3a', capacity: 1000000, local: 640000, remote: 360000, active: true },
        { peer: '03e91c5a7d2f48b60a3c9e1d7f5b8240c6a3e9d1b7f0852a4c6e8d03b1f97a5c2e', capacity: 800000, local: 520000, remote: 280000, active: true },
        { peer: '021f6b8d3a90c7e45d12f8a6b3c9e07d5a14f2c8b6e30d9a7f51c4e2b8d6a03f19', capacity: 600000, local: 320000, remote: 280000, active: true }] }),
    taproot: () => ({ env: ev('taproot', 'signet'), assets: [
      { id: '7f3a91c2d4e85b60a1c9d3e7f2b48a05c6d1e9f3b7a2c4d80e5f6a1b3c9d7e24', name: 'usdt-test', balance: '1250' },
      { id: 'c2e8f1a3d5b79046e1a8c3f5d2b7e09a4c6f1d83b5e7a2c90d4f6b8e1a3c5d79', name: 'bitcode-badge', balance: '3' }] }),
    liquid: () => ({ env: ev('liquid', 'testnet'), fees: null, wallet: null, blocks: [
      { height: 2113847, txs: 14, time: BASE - 1 * MIN }, { height: 2113846, txs: 9, time: BASE - 2 * MIN }, { height: 2113845, txs: 22, time: BASE - 3 * MIN },
      { height: 2113844, txs: 6, time: BASE - 4 * MIN }, { height: 2113843, txs: 17, time: BASE - 5 * MIN }, { height: 2113842, txs: 11, time: BASE - 6 * MIN }] }),
    cashu: () => ({ env: ev('cashu', 'testnet', { mint: { name: 'Cashu test mint', description: 'Mint di prova: i token non hanno valore reale.', nuts: [4, 5, 7, 9, 10, 11, 12] } }), mintUrl: 'https://testnut.cashu.space', allowList: S.allow, wallet: null })
  };
  const connections = () => ({
    bitcoin: { fields: { network: 'signet', esploraUrl: 'http://127.0.0.1:3002/api' } },
    lightning: { fields: { lndRestUrl: 'https://127.0.0.1:8080', lndMacaroonPath: '~/.lnd/data/chain/bitcoin/signet/readonly.macaroon', tlsCertPath: '~/.lnd/tls.cert', tapdRestUrl: 'https://127.0.0.1:8089', tapdMacaroonPath: '~/.tapd/data/signet/readonly.macaroon' } },
    taproot: { fields: { lndRestUrl: 'https://127.0.0.1:8080', lndMacaroonPath: '~/.lnd/data/chain/bitcoin/signet/readonly.macaroon', tlsCertPath: '~/.lnd/tls.cert', tapdRestUrl: 'https://127.0.0.1:8089', tapdMacaroonPath: '~/.tapd/data/signet/readonly.macaroon' } },
    liquid: { fields: { network: 'testnet', esploraUrl: 'https://blockstream.info/liquidtestnet/api' } },
    cashu: { fields: { network: 'testnet', mintUrl: 'https://testnut.cashu.space' } }
  });

  // ---- sessions & runs ----
  const sessionOpen = id => {
    const s = S.sessions.find(x => x.sessionId === id);
    return { ...meta(s), mode: S.mode && id === 's_new' ? S.mode : s.mode, messages: messages[id] || [], pending: [] };
  };
  const REQUEST = 'Aggiungi la verifica HMAC ai webhook dei pagamenti e scrivi i test';
  window.__demo = {
    request: REQUEST,
    approval: () => ({ id: 'apr_5d1c8e7f20a4b963', digest: 'dg_81f2', sessionId: 's_new', kind: 'command', status: 'pending', expiresAt: BASE + 9 * MIN,
      subject: { agentId: 'script', model: DEFAULT_MODEL, mode: 'assisted', shell: 'npm test -- --test-name-pattern="firma|webhook"', argv: ['npm', 'test'], reason: 'Verifica i test dei webhook dopo l\'aggiunta della firma HMAC.', projectId: PROJECT.projectId, project: PROJECT.name } }),
    run: (state, extra = {}) => ({ runId: 'run_01', sessionId: 's_new', projectId: PROJECT.projectId, state, mode: 'assisted', model: DEFAULT_MODEL, prompt: REQUEST,
      startedAt: BASE + 10_000, endedAt: null, usage: { inputTokens: 4120, outputTokens: 786 }, worktree: null, error: null, ...extra }),
    setAnswer: text => { window.__demo.customAnswer = text; },
    finish: () => {
      messages.s_new = [{ role: 'user', content: REQUEST }, { role: 'assistant', content: window.__demo.customAnswer || 'Ho aggiunto la verifica HMAC-SHA256 con confronto a tempo costante e il controllo del timestamp. I test dei webhook passano (4/4).', tools: ['read_file src/webhooks.js', 'write_file src/signature.js', 'edit_file src/webhooks.js', 'bash npm test'] }];
      S.sessions[0].updatedAt = BASE; emit('session', { sessionId: 's_new', type: 'messages', data: { messages: messages.s_new } });
    },
    setStaged: () => {}, ptyWrite: data => emit('pty', { ptyId: S.ptyId, data })
  };

  const H = {
    'app.info': () => ({ version: '0.1.0', home: '/home/dev/.bitcode', secretStore: { secure: true, backend: 'gnome_libsecret' }, secrets: ['anthropic'], platform: 'linux' }),
    'app.status': () => ({ sandbox: { available: true, detail: 'bwrap 0.9.0' }, settings, defaultModel: { spec: DEFAULT_MODEL, locality: 'local' }, runs: [], pending: [], projects: S.opened ? [PROJECT, PROJECT2] : [] }),
    'models.list': () => [{ name: 'ollama', defaultModel: 'qwen3-coder:30b', locality: 'local', hasKey: true }, { name: 'anthropic', defaultModel: 'claude-sonnet-5-5', locality: 'cloud', hasKey: true }],
    'models.available': () => available(),
    'worktree.list': () => [],
    'project.list': () => (S.opened ? [PROJECT, PROJECT2] : []),
    'project.open': () => { S.opened = true; S.sessions = seedSessions(); return PROJECT; },
    'dialog.openFolder': () => PROJECT.root,
    'session.list': ({ projectId } = {}) => S.sessions.filter(s => !projectId || s.projectId === projectId).map(meta).sort((a, b) => b.updatedAt - a.updatedAt),
    'session.create': ({ name, mode = 'assisted', satId = '' }) => {
      S.mode = mode;
      const s = { sessionId: 's_new', projectId: PROJECT.projectId, name, mode, model: null, satModels: {}, satId, keep: false, updatedAt: BASE, active: false };
      S.sessions.unshift(s); messages.s_new = []; return meta(s);
    },
    'session.open': ({ sessionId }) => sessionOpen(sessionId),
    'session.update': ({ sessionId, keep, satId, name }) => { const s = S.sessions.find(x => x.sessionId === sessionId); if (keep !== undefined) s.keep = keep; if (satId !== undefined) s.satId = satId; if (name) s.name = name; return meta(s); },
    'commands.list': () => [{ name: 'models', hint: 'scegli un modello' }, { name: 'sat', args: true, hint: 'seleziona' }, { name: 'plan', hint: '' }, { name: 'build', hint: '' }, { name: 'diff', hint: '' }, { name: 'status', hint: '' }],
    'mode.set': ({ mode }) => { S.mode = mode; const s = S.sessions.find(x => x.sessionId === 's_new'); if (s) s.mode = mode; return { mode }; },
    'chat.submit': ({ sessionId, text }) => {
      const info = /^\/sat info (\w+)/.exec(text);
      if (info) {
        const k = info[1];
        return { command: true, result: { ...sats[k], history: [{ at: BASE - 26 * HOUR, state: 'success' }, { at: BASE - 5 * HOUR, state: 'success' }, { at: BASE - 2 * HOUR, state: 'success' }] } };
      }
      messages[sessionId] = [{ role: 'user', content: text }];
      S.sessions.find(x => x.sessionId === sessionId).active = true;
      return { run: { runId: 'run_01' } };
    },
    'approval.resolve': ({ requestId, decision }) => { emit('approval', { ...window.__demo.approval(), id: requestId, status: decision === 'approve' ? 'approved' : 'denied' }); return true; },
    'fs.tree': ({ path: rel = '.' }) => treeOf(rel),
    'buffer.open': ({ path: rel }) => { const text = FILES[rel] ?? ''; return { text, version: version(text) }; },
    'git.status': () => ({ repo: true, branch: 'feat/webhook-hmac', files: S.committed ? [] : gitFiles() }),
    'git.diff': ({ path: p }) => (p === 'src/webhooks.js' ? DIFF_WEBHOOKS : p === 'tests/webhooks.test.js' ? DIFF_TEST : `diff --git a/${p} b/${p}\nnew file mode 100644\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,3 @@\n${(FILES[p] || '').split('\n').slice(0, 3).map(l => '+' + l).join('\n')}\n`),
    'git.stage': ({ paths }) => { paths.forEach(p => S.staged.add(p)); return ''; },
    'git.unstage': ({ paths }) => { paths.forEach(p => S.staged.delete(p)); return ''; },
    'git.commit': () => { S.committed = true; return ''; },
    'pty.open': () => { S.ptyId = 'pty_1'; return { ptyId: S.ptyId, shell: '/bin/bash' }; },
    'pty.write': () => true, 'pty.resize': () => true, 'pty.close': () => true,
    'clipboard.write': () => true, 'app.openExternal': () => true,
    'settings.set': ({ key, value }) => { settings[key] = value; return settings; },
    'finance.overview': ({ protocol }) => OVERVIEW[protocol](),
    'finance.connections': () => connections(),
    'finance.bitcoin.prepare': ({ to, amountSats, feeRate }) => ({ id: 'prop_8f3a91c2d4e6', network: 'signet', to, amountSats, feeRate: feeRate || 8, feeSats: (feeRate || 8) * 141, expiresAt: BASE + 10 * MIN }),
    'finance.bitcoin.execute': ({ proposalId }) => {
      S.proposalSent = true;
      S.proposals = [{ id: proposalId, to: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', amountSats: 20000, feeSats: 1128, status: 'submitted', txid: 'e41b7a09c3d5f8264b0a19d7c6e3f5a2b8d10c9e7f6a4b3c2d1e0f9a8b7c6d5e' }];
      return { status: 'submitted', txid: 'e41b7a09c3d5f8264b0a19d7c6e3f5a2b8d10c9e7f6a4b3c2d1e0f9a8b7c6d5e' };
    },
    'finance.cashuAllow': ({ mintUrl, allowed }) => { S.allow = allowed ? [mintUrl] : []; return true; }
  };
  window.bitcoin_mock_methods = Object.keys(H);

  window.bitcode = {
    invoke: async (method, params = {}) => {
      try {
        const fn = H[method]; if (!fn) throw Object.assign(new Error(`mock: ${method}`), { code: 'NOT_FOUND' });
        return { ok: true, result: await fn(params) ?? null };
      } catch (e) { return { ok: false, error: { code: e.code || 'INTERNAL', message: e.message } }; }
    },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };
  // Cloud models are never contacted and no clipboard access is needed.
  try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } }); } catch {}
})();
