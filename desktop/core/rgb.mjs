// RGB wallet service for desktop sessions in the rgb profile. It runs in the
// Electron main process: the sandboxed worker has no network and reaches the
// node only through the controller's rgb.call, which gates every state change
// behind a human approval. The node's network is proven by the node itself
// before any tool is offered, and only test networks are served (D0 §13).
import { mcpTools } from '../../src/mcp.mjs';
import { rgbTools, rgbServer } from '../../src/rgb/tools.mjs';
import { formatUnits } from '../../src/rgb/format.mjs';
import { fail } from './primitives.mjs';

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

export function createRgb({ config, fetchImpl = fetch, mcpToolsImpl = mcpTools, wdkAccountImpl = wdkAccount } = {}) {
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
    let info;
    try {
      const res = await fetchImpl(new URL('/networkinfo', nodeUrl), { signal: AbortSignal.timeout(10_000) });
      info = await res.json();
      if (!res.ok) throw new Error(info?.error || `HTTP ${res.status}`);
    } catch (e) { throw fail('RGB_UNAVAILABLE', `RGB node not reachable at ${nodeUrl}: ${e.message}`); }
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
    catch (e) { return { env: { status: e.code === 'RGB_UNAVAILABLE' && /No MCP server|RLN_NODE_URL/.test(e.message) ? 'not_configured' : 'error', error: e.message } }; }
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
        assets, transfers };
    } finally { dispose(); }
  }

  return { verify, prepare, tool, overview };
}
