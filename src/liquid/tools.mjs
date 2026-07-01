// Liquid agent tools: read-only chain/mempool/asset queries against
// Blockstream's public Liquid Esplora. No wallet — see network.mjs for why.
import { resolveLiquidNetwork } from "./network.mjs";
import { esplora } from "../bitcoin/esplora.mjs";

export function liquidTools(config) {
  const ctx = resolveLiquidNetwork(config);
  const api = esplora(ctx.esploraUrl);

  return [
    {
      name: "liquid_fees",
      mutating: false,
      description: "Recommended fee rates (sat/vB) for the Liquid network.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const f = await api.feeEstimates();
        const at = (n) => (f[n] != null ? f[n].toFixed(2) : "n/a");
        return `liquid ${ctx.name}\n~1 block ${at(1)} · ~3 blocks ${at(3)} · ~6 blocks ${at(6)} · ~1 day ${at(144)} (sat/vB)`;
      },
    },
    {
      name: "liquid_mempool",
      mutating: false,
      description: "Mempool summary for Liquid: tx count, virtual size, chain tip.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const [m, tip] = await Promise.all([api.mempool(), api.tipHeight()]);
        return `liquid ${ctx.name} · tip height ${tip}\nmempool ${m.count} txs · ${(m.vsize / 1e6).toFixed(2)} MvB`;
      },
    },
    {
      name: "liquid_tx",
      mutating: false,
      description: "Look up a Liquid transaction by txid.",
      parameters: {
        type: "object",
        properties: { txid: { type: "string" } },
        required: ["txid"],
      },
      run: async ({ txid }) => {
        const t = await api.tx(txid);
        const status = t.status?.confirmed ? `confirmed in block ${t.status.block_height}` : "unconfirmed (in mempool)";
        return `liquid tx ${txid}\n${status}\n${t.vin.length} in / ${t.vout.length} out`;
      },
    },
    {
      name: "liquid_address",
      mutating: false,
      description: "Liquid address summary: utxo count and confirmed tx count. Amounts on confidential outputs are not visible without the blinding key.",
      parameters: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
      run: async ({ address }) => {
        const [a, utxos] = await Promise.all([api.address(address), api.utxos(address)]);
        return `liquid address ${address} (${ctx.name})\n${utxos.length} utxos · ${a.chain_stats.tx_count} confirmed txs`;
      },
    },
    {
      name: "liquid_block",
      mutating: false,
      description: "Liquid block info. With no args returns the chain tip; otherwise pass height or hash.",
      parameters: {
        type: "object",
        properties: { height: { type: "number" }, hash: { type: "string" } },
      },
      run: async ({ height, hash }) => {
        if (height == null && !hash) hash = await api.tipHash();
        else if (height != null && !hash) hash = await api.blockHashByHeight(height);
        const b = await api.block(hash);
        return `liquid block ${b.height}\nhash ${b.id}\n${b.tx_count} txs · ${new Date(b.timestamp * 1000).toISOString()}`;
      },
    },
    {
      name: "liquid_asset",
      mutating: false,
      description: "Look up a Liquid asset by asset_id: name, ticker, and total supply. Use this to check registered assets like L-BTC or issued stablecoins on Liquid.",
      parameters: {
        type: "object",
        properties: { asset_id: { type: "string" } },
        required: ["asset_id"],
      },
      run: async ({ asset_id }) => {
        const a = await api.asset(asset_id);
        const reg = a.contract || {};
        return (
          `liquid asset ${asset_id}\n` +
          `name ${reg.name || a.name || "unknown"} · ticker ${reg.ticker || a.ticker || "?"}\n` +
          `precision ${reg.precision ?? "?"} · issuance tx ${a.issuance_txin?.txid || "n/a"}`
        );
      },
    },
  ];
}
