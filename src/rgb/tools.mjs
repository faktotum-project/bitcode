// The RGB wallet tool set shared by the CLI's rgb profile and the desktop app:
// only the configured RGB node's MCP tools, every state change on the node
// behind the payment gate, exact display balances, and sends whose recipient
// and asset are checked by code rather than trusted from the model.
import { isMutating } from "../runtime.mjs";
import { createRgbFormatter, describeRgbSend, prepareRgbSend } from "./format.mjs";

export const rgbServer = config => config?.rgb?.mcpServer || "kaleido";

// Reads that report holdings. An RGB transfer only settles after both nodes
// refresh, so without it a finished send still shows the sender's whole
// allocation as unspendable and the receiver's as missing.
const HOLDINGS = /(list_assets|get_asset_balance|get_balances|list_transfers)$/;

export function rgbTools(tools, config = {}) {
  const server = rgbServer(config);
  const format = createRgbFormatter();
  const isSend = tool => /send_asset$/.test(tool.name);
  const own = tools.filter(tool => tool.mcpServer === server);
  const refresh = own.find(tool => /refresh_transfers$/.test(tool.name));
  return own.map(tool => ({
    ...tool,
    ...(isMutating(tool) ? { financial: true } : {}),
    // prepare() throws for a send that the node must not receive, so callers
    // can refuse it before asking a human to approve it.
    ...(isSend(tool) ? {
      prepare: args => prepareRgbSend(args, format.knownAssetIds()),
      // Structured form of the same facts, for UIs that localise the line.
      preview: args => {
        const prepared = prepareRgbSend(args, format.knownAssetIds()), asset = format.asset(prepared.asset_id);
        return { amount: prepared.amount, unit: asset?.ticker || null, assetId: prepared.asset_id, recipientId: prepared.recipient_id, endpoints: prepared.transport_endpoints || [] };
      },
      readback: args => {
        try { const prepared = prepareRgbSend(args, format.knownAssetIds()); return describeRgbSend(prepared, format.asset(prepared.asset_id)); }
        catch (err) { return `Will be refused: ${err.message}`; }
      },
    } : {}),
    run: async (args, options) => {
      if (isSend(tool)) args = prepareRgbSend(args, format.knownAssetIds());
      if (refresh && HOLDINGS.test(tool.name)) await refresh.run({}, options).catch(() => {});
      return format(await tool.run(args, options), args);
    },
  }));
}
