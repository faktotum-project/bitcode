// RGB wallet service for desktop sessions in the rgb profile. It runs in the
// Electron main process: the sandboxed worker has no network and reaches the
// node only through the controller's rgb.call, which gates every state change
// behind a human approval. The node's network is proven by the node itself
// before any tool is offered, and only test networks are served (D0 §13).
import { mcpTools } from '../../src/mcp.mjs';
import { rgbTools, rgbServer } from '../../src/rgb/tools.mjs';
import { fail } from './primitives.mjs';

// rgb-lightning-node /networkinfo names. Mutinynet is reported as SignetCustom.
const NETWORKS = { Bitcoin: 'mainnet', Testnet: 'testnet', Testnet4: 'testnet4', Signet: 'signet', SignetCustom: 'signet', Regtest: 'regtest' };
const TEST = new Set(['testnet', 'testnet4', 'signet', 'regtest']);

export function createRgb({ config, fetchImpl = fetch, mcpToolsImpl = mcpTools } = {}) {
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

  return { verify, prepare, tool };
}
