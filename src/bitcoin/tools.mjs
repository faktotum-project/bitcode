// Bitcoin agent tools: chain, mempool, fees, full-node RPC, and the wallet.
// Bound to the active network resolved from config.
import { resolveNetwork } from "./network.mjs";
import { esplora } from "./esplora.mjs";
import { bitcoinRpc } from "./rpc.mjs";
import { wallet } from "./wallet.mjs";

const btcOf = (sats) => (Number(sats) / 1e8).toFixed(8) + " BTC";

export function bitcoinTools(config) {
  const ctx = resolveNetwork(config);
  const api = esplora(ctx.esploraUrl);
  const w = wallet(ctx);

  return [
    {
      name: "btc_fees",
      mutating: false,
      description: "Recommended Bitcoin fee rates (sat/vB) for the active network.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const f = await api.feesRecommended();
        return `network ${ctx.name}\nfastest ${f.fastestFee} · 30min ${f.halfHourFee} · 1h ${f.hourFee} · economy ${f.economyFee} · min ${f.minimumFee} (sat/vB)`;
      },
    },
    {
      name: "btc_mempool",
      mutating: false,
      description: "Mempool summary for the active network: tx count, virtual size, total fees, chain tip.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const [m, tip] = await Promise.all([api.mempool(), api.tipHeight()]);
        return `network ${ctx.name} · tip height ${tip}\nmempool ${m.count} txs · ${(m.vsize / 1e6).toFixed(2)} MvB · ${btcOf(m.total_fee)} total fees`;
      },
    },
    {
      name: "btc_tx",
      mutating: false,
      description: "Look up a transaction by txid: confirmation status, fee, size, in/out counts.",
      parameters: {
        type: "object",
        properties: { txid: { type: "string" } },
        required: ["txid"],
      },
      run: async ({ txid }) => {
        const t = await api.tx(txid);
        const outTotal = t.vout.reduce((s, o) => s + o.value, 0);
        const status = t.status?.confirmed
          ? `confirmed in block ${t.status.block_height}`
          : "unconfirmed (in mempool)";
        return `tx ${txid}\n${status}\nfee ${t.fee} sats · ${Math.round(t.weight / 4)} vB · ${t.vin.length} in / ${t.vout.length} out · ${btcOf(outTotal)} out`;
      },
    },
    {
      name: "btc_address",
      mutating: false,
      description: "Address summary: balance, utxo count, and total tx count.",
      parameters: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
      run: async ({ address }) => {
        const [a, utxos] = await Promise.all([api.address(address), api.utxos(address)]);
        const bal =
          a.chain_stats.funded_txo_sum +
          a.mempool_stats.funded_txo_sum -
          a.chain_stats.spent_txo_sum -
          a.mempool_stats.spent_txo_sum;
        return `address ${address} (${ctx.name})\nbalance ${btcOf(bal)} · ${utxos.length} utxos · ${a.chain_stats.tx_count} confirmed txs`;
      },
    },
    {
      name: "btc_block",
      mutating: false,
      description: "Block info. With no args returns the chain tip; otherwise pass height or hash.",
      parameters: {
        type: "object",
        properties: { height: { type: "number" }, hash: { type: "string" } },
      },
      run: async ({ height, hash }) => {
        if (height == null && !hash) hash = await api.tipHash();
        else if (height != null && !hash) hash = await api.blockHashByHeight(height);
        const b = await api.block(hash);
        return `block ${b.height}\nhash ${b.id}\n${b.tx_count} txs · ${(b.size / 1e6).toFixed(2)} MB · ${new Date(b.timestamp * 1000).toISOString()}`;
      },
    },
    {
      name: "btc_broadcast",
      mutating: true,
      description: "Broadcast a raw signed transaction (hex) to the network. Returns the txid.",
      parameters: {
        type: "object",
        properties: { hex: { type: "string" } },
        required: ["hex"],
      },
      run: async ({ hex }) => `broadcast accepted · txid ${await api.broadcast(hex)}`,
    },
    {
      name: "bitcoin_rpc",
      mutating: true,
      description:
        "Call the local Bitcoin Core node via JSON-RPC (full-node developer access), e.g. getblockchaininfo, getmempoolinfo, estimatesmartfee.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          params: { type: "array", items: {} },
        },
        required: ["method"],
      },
      run: async ({ method, params = [] }) => {
        const r = await bitcoinRpc(ctx, method, params);
        return typeof r === "string" ? r : JSON.stringify(r, null, 2).slice(0, 4000);
      },
    },
    {
      name: "wallet_create",
      mutating: true,
      description:
        "Create a new HD wallet (BIP84) for the active network, or restore one by passing a mnemonic.",
      parameters: {
        type: "object",
        properties: { mnemonic: { type: "string" }, force: { type: "boolean" } },
      },
      run: ({ mnemonic, force }) => {
        const r = mnemonic ? w.importMnemonic(mnemonic, { force }) : w.create({ force });
        let s = `wallet ${mnemonic ? "restored" : "created"} for ${ctx.name}\nfile ${r.file}\naddress[0] ${r.address0}\ndescriptor ${r.descriptor}`;
        if (r.mnemonic) s += `\nMNEMONIC (back this up — shown once): ${r.mnemonic}`;
        return s;
      },
    },
    {
      name: "wallet_info",
      mutating: false,
      description: "Show the wallet's network, first receive address, and balance.",
      parameters: {
        type: "object",
        properties: { gap: { type: "number" } },
      },
      run: async ({ gap = 10 }) => {
        const b = await w.balance({ gap });
        return `wallet ${b.network}\nreceive ${b.address0}\nbalance ${b.btc.toFixed(8)} BTC (${b.sats} sats) · ${b.utxos} utxos`;
      },
    },
    {
      name: "wallet_descriptor",
      mutating: false,
      description:
        "Show the wallet's output descriptor (public, safe to share — contains no private key material). Import into Bitcoin Core as watch-only with importdescriptors.",
      parameters: { type: "object", properties: {} },
      run: () => {
        if (!w.exists()) throw new Error(`no ${ctx.name} wallet. Run wallet_create first.`);
        return `network ${ctx.name}\ndescriptor ${w.descriptor()}`;
      },
    },
    {
      name: "wallet_new_address",
      mutating: false,
      description: "Return a receive address for the wallet at the given index (default 0).",
      parameters: {
        type: "object",
        properties: { index: { type: "number" } },
      },
      run: ({ index = 0 }) => `receive[${index}] (${ctx.name}): ${w.receiveAddress(index)}`,
    },
    {
      name: "wallet_send",
      mutating: true,
      description:
        "Build, sign, and optionally broadcast a payment from the wallet. amount_sats in satoshis. fee_rate defaults to the 30-min estimate. Set broadcast=true to send; otherwise returns the signed raw hex.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          amount_sats: { type: "number" },
          fee_rate: { type: "number" },
          broadcast: { type: "boolean" },
        },
        required: ["to", "amount_sats"],
      },
      run: async ({ to, amount_sats, fee_rate, broadcast = false }) => {
        let rate = fee_rate;
        if (rate == null) {
          const f = await api.feesRecommended();
          rate = f.halfHourFee || f.economyFee || 1;
        }
        const r = await w.send({ to, amountSats: amount_sats, feeRate: rate, broadcast });
        let s =
          `${r.broadcast ? "SENT" : "signed (not broadcast)"} on ${r.network}\n` +
          `to ${r.to}\namount ${r.amountSats} sats · fee ${r.feeSats} sats (${r.feeRate} sat/vB) · vsize ${r.vsize}\n` +
          `inputs ${r.inputs} · change ${r.changeSats} sats\ntxid ${r.txid}`;
        s += r.broadcastTxid ? `\nbroadcast txid ${r.broadcastTxid}` : `\nraw hex: ${r.hex}`;
        return s;
      },
    },
  ];
}
