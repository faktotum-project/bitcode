// RGB wallet service for desktop sessions in the rgb profile. It runs in the
// Electron main process: the sandboxed worker has no network and reaches the
// node only through the controller's rgb.call, which gates every state change
// behind a human approval. The node's network is proven by the node itself
// before any tool is offered, and only test networks are served (D0 §13).
import { mcpTools } from '../../src/mcp.mjs';
import { rgbTools, rgbServer } from '../../src/rgb/tools.mjs';
import { formatUnits } from '../../src/rgb/format.mjs';
import { fail } from './primitives.mjs';
import { FIX, discoverNodes, fixCommand, kaleidoBinary, probeNode, sameNode } from './rgb-nodes.mjs';
import os from 'node:os';
import path from 'node:path';

// The read-only node panel goes through Tether's WDK: the RGB Lightning Node is
// registered as a WDK wallet (@kaleidorg/wdk-wallet-rln). The node owns its
// keys; the throwaway seed WDK requires is never used for derivation.
async function wdkAccount(nodeUrl) {
  const [{ default: WDK }, { default: RlnWalletManager }] = await Promise.all([import('@tetherto/wdk'), import('@kaleidorg/wdk-wallet-rln')]);
  const wdk = new WDK(WDK.getRandomSeedPhrase()).registerWallet('rgb', RlnWalletManager, { nodeUrl });
  const account = await wdk.getAccount('rgb', 0);
  return { account, dispose: () => wdk.dispose() };
}
// @kaleidorg/wdk-wallet-rln 1.0.0-beta.5 still sends { asset_id } to
// /listtransfers; rgb-lightning-node 0.10 expects an asset filter.
const listTransfers = (account, assetId) => account._rln.listTransfers({ asset_filter: { type: 'Id', value: assetId } });
const num = v => typeof v === 'bigint' ? Number(v) : v;

// rgb-lightning-node /networkinfo names. Mutinynet is reported as SignetCustom.
const NETWORKS = { Bitcoin: 'mainnet', Testnet: 'testnet', Testnet4: 'testnet4', Signet: 'signet', SignetCustom: 'signet', Regtest: 'regtest' };
const TEST = new Set(['testnet', 'testnet4', 'signet', 'regtest']);

// What the user reads when the configured node cannot serve the app yet.
const NOT_READY = {
  locked: url => `The RGB wallet at ${url} is locked: it needs its password after every node restart. Unlock it from Bitcoin → RGB, or run: kaleido --node-url ${url} node unlock`,
  uninitialized: url => `The RGB node at ${url} has no wallet yet. Create one from Bitcoin → RGB, or run: kaleido --node-url ${url} node init`,
  busy: url => `The RGB node at ${url} is unlocking and syncing; try again in a few minutes`,
  stopped: url => `The RGB node at ${url} is not running. Start it from Bitcoin → RGB (Docker)`,
};

export function createRgb({ config, fetchImpl = fetch, mcpToolsImpl = mcpTools, wdkAccountImpl = wdkAccount,
  kaleidoHome = path.join(os.homedir(), '.kaleido'), kaleidoBin = () => kaleidoBinary() } = {}) {
  let connection = null; // { tools, close } shared by all runs, opened on first use

  const spec = () => {
    const cfg = config(), name = rgbServer(cfg), server = cfg.mcp?.[name];
    if (!server) throw fail('RGB_UNAVAILABLE', `No MCP server "${name}" configured; see integrations/kaleido/README.md`);
    return { cfg, name, server };
  };

  async function verify() {
    const { server } = spec();
    const nodeUrl = server.env?.RLN_NODE_URL;
    if (!nodeUrl) throw fail('RGB_UNAVAILABLE', 'RLN_NODE_URL is not set for the RGB MCP server');
    const probe = await probeNode(nodeUrl, fetchImpl);
    if (probe.status !== 'connected') {
      const message = NOT_READY[probe.status]?.(nodeUrl) || `RGB node at ${nodeUrl} answered: ${probe.error}`;
      throw Object.assign(fail(probe.status === 'error' ? 'RGB_UNAVAILABLE' : `RGB_${probe.status.toUpperCase()}`, message), { nodeUrl, status: probe.status, detail: probe.error });
    }
    const info = probe.info;
    const network = NETWORKS[info.network] || 'unknown';
    const environment = TEST.has(network) ? 'test' : network === 'mainnet' ? 'production' : 'unknown';
    return { nodeUrl, reported: info.network, network, environment, height: info.height };
  }

  async function tools() {
    if (connection) return connection.tools;
    const { cfg, name, server } = spec();
    const { tools: raw, servers } = await mcpToolsImpl({ ...cfg, mcp: { [name]: server } });
    const report = servers?.find(s => s.name === name);
    if (report && !report.ok) throw fail('RGB_UNAVAILABLE', `RGB MCP server failed: ${report.error}`);
    connection = { tools: rgbTools(raw, cfg) };
    return connection.tools;
  }

  // Everything a session needs before a run: proof of a test network and the
  // tool schemas the worker may call. Production and unknown nodes get nothing.
  async function prepare() {
    const env = await verify();
    if (env.environment !== 'test') throw fail('POLICY_DENIED', `RGB node reports ${env.reported}; only test networks are allowed in the app`);
    const list = await tools();
    return { env, schemas: list.map(({ name, description, parameters, mutating, financial }) => ({ name, description, parameters, mutating, financial: !!financial })) };
  }

  async function tool(name) {
    const found = (await tools()).find(t => t.name === name);
    if (!found) throw fail('FORBIDDEN', `Unknown RGB tool ${name}`);
    return found;
  }

  // Read-only panel data. Production nodes are shown (read-only, like the other
  // protocols); refreshing first settles transfers the node has already received.
  async function overview() {
    let env;
    try { env = await verify(); }
    catch (e) {
      if (!e.nodeUrl) return { env: { status: 'not_configured', error: e.message } };
      const list = await nodes();
      return { env: { status: e.status, nodeUrl: e.nodeUrl, fix: list.find(n => n.configured)?.fix || null, error: e.message, detail: e.detail }, nodes: list };
    }
    const { account, dispose } = await wdkAccountImpl(env.nodeUrl);
    try {
      await account.refreshTransfers({ skipSync: false }).catch(() => {});
      const [node, btc, listed] = await Promise.all([account.getNodeInfo(), account.getBtcBalance({ skipSync: true }), account.listAssets()]);
      const assets = [...(listed.nia || []), ...(listed.cfa || []), ...(listed.uda || [])].map(a => ({
        assetId: a.asset_id, ticker: a.ticker || null, name: a.name, schema: a.schema, precision: a.precision,
        settled: formatUnits(a.balance?.settled ?? 0, a.precision), spendable: formatUnits(a.balance?.spendable ?? 0, a.precision), future: formatUnits(a.balance?.future ?? 0, a.precision) }));
      const transfers = (await Promise.all(assets.map(async a => ((await listTransfers(account, a.assetId)).transfers || []).map(x => ({
        ticker: a.ticker || a.name, kind: x.kind, status: x.status, txid: x.txid || null, updatedAt: (x.updated_at || x.created_at) * 1000,
        amount: formatUnits((x.requested_assignment?.value ?? x.assignments?.reduce((n, y) => n + (y.value || 0), 0)) || 0, a.precision) })))))
        .flat().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
      return {
        env: { status: 'connected', environment: env.environment, network: env.network, at: Date.now(),
          evidence: [{ source: 'node', value: env.nodeUrl }, { source: '/networkinfo', value: `${env.reported} → ${env.network}` }, { source: 'tip', value: String(env.height) }] },
        via: { core: '@tetherto/wdk', wallet: '@kaleidorg/wdk-wallet-rln', account: account.constructor?.name || 'account' },
        node: { pubkey: node.pubkey, channels: node.num_channels, usableChannels: node.num_usable_channels, peers: node.num_peers },
        btc: { vanillaSats: num(btc.vanilla?.spendable ?? 0), coloredSats: num(btc.colored?.spendable ?? 0), pendingSats: num((btc.vanilla?.future ?? 0) - (btc.vanilla?.settled ?? 0)) },
        assets, transfers, nodes: await nodes() };
    } finally { dispose(); }
  }

  const configuredUrl = () => { try { return spec().server.env?.RLN_NODE_URL || null; } catch { return null; } };
  function known() {
    const url = configuredUrl(), found = discoverNodes(kaleidoHome);
    const list = found.map(n => ({ ...n, configured: !!url && sameNode(n.nodeUrl, url) }));
    return url && !list.some(n => n.configured) ? [{ name: 'config', nodeUrl: url, composeFile: null, configured: true }, ...list] : list;
  }

  // Every node on this computer, so a second one (a demo receiver) is visible too.
  async function nodes() {
    return Promise.all(known().map(async n => {
      const probe = await probeNode(n.nodeUrl, fetchImpl, 3000);
      const fix = FIX[probe.status] && fixCommand(FIX[probe.status], n, kaleidoBin()) ? FIX[probe.status] : null;
      return { name: n.name, nodeUrl: n.nodeUrl, configured: n.configured, status: probe.status, fix,
        network: probe.info ? NETWORKS[probe.info.network] || 'unknown' : null, height: probe.info?.height ?? null, error: probe.error || null };
    }));
  }

  // The shell command for one fix; main.mjs types it into a terminal the user watches.
  function fix({ action, nodeUrl }) {
    const node = known().find(n => n.nodeUrl === nodeUrl);
    if (!node || !Object.values(FIX).includes(action)) throw fail('INVALID_PARAMS', 'Unknown RGB node or action');
    const command = fixCommand(action, node, kaleidoBin());
    if (!command) throw fail('RGB_NO_FIX', action === 'start' ? 'This node has no Docker Compose file under ~/.kaleido' : 'kaleido-cli is not installed; see integrations/kaleido/README.md');
    return { command };
  }

  return { verify, prepare, tool, overview, nodes, fix };
}
