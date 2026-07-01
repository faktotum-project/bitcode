// Lightning agent tools. `ln_decode_invoice` needs no node and is always
// available (see src/tools.mjs). Everything else — LND (payments, channels,
// balance) and Taproot Assets (stablecoins over Lightning) — is only
// registered when config.lightning.lndRestUrl is set: no public fallback
// exists for Lightning the way mempool.space covers Bitcoin, so this is
// opt-in and requires a node you control ("not your key, not your BTC"
// applies just as much to a Lightning node as to an on-chain wallet).
import { lnd } from "./lnd.mjs";
import { tapd } from "./tapd.mjs";
import { decodeBolt11 } from "./bolt11.mjs";

export const bolt11Tool = {
  name: "ln_decode_invoice",
  mutating: false,
  description: "Decode a BOLT11 Lightning invoice (amount, description, expiry, payment hash, route hints). Works without any Lightning node configured.",
  parameters: {
    type: "object",
    properties: { invoice: { type: "string" } },
    required: ["invoice"],
  },
  run: ({ invoice }) => {
    const d = decodeBolt11(invoice);
    const amount = d.amountSats != null ? `${d.amountSats} sats` : "any amount";
    return (
      `bolt11 invoice (${d.network})\namount ${amount}\ndescription ${d.description ?? d.descriptionHash ?? "(none)"}\n` +
      `created ${d.timestampIso} · expires in ${d.expirySeconds}s · min_final_cltv ${d.minFinalCltvExpiry}\n` +
      `payment_hash ${d.paymentHash}${d.payeeNodeKey ? `\npayee ${d.payeeNodeKey}` : ""}${d.routeHints.length ? `\n${d.routeHints.length} route hint(s)` : ""}`
    );
  },
};

export function lightningTools(lnCfg) {
  const node = lnd(lnCfg.lnd);
  const tap = lnCfg.tapd ? tapd(lnCfg.tapd) : null;

  const tools = [
    {
      name: "ln_info",
      mutating: false,
      description: "Lightning node info: alias, pubkey, block height, sync status.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const i = await node.getInfo();
        return `node ${i.alias || "(no alias)"}\npubkey ${i.identity_pubkey}\nblock height ${i.block_height} · synced ${i.synced_to_chain}\n${i.num_active_channels} active channels`;
      },
    },
    {
      name: "ln_balance",
      mutating: false,
      description: "On-chain and Lightning channel balance for the connected node.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const [chain, chan] = await Promise.all([node.walletBalance(), node.channelBalance()]);
        return `on-chain ${chain.confirmed_balance} sats (unconfirmed ${chain.unconfirmed_balance})\nchannels: local ${chan.local_balance?.sat ?? 0} sats · remote ${chan.remote_balance?.sat ?? 0} sats`;
      },
    },
    {
      name: "ln_channels",
      mutating: false,
      description: "List open Lightning channels: peer, capacity, local/remote balance.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = await node.listChannels();
        if (!r.channels?.length) return "no open channels";
        return r.channels
          .map((c) => `${c.remote_pubkey.slice(0, 16)}… cap ${c.capacity} sats · local ${c.local_balance} · remote ${c.remote_balance} · active ${c.active}`)
          .join("\n");
      },
    },
    {
      name: "ln_invoice_create",
      mutating: false,
      description: "Create a Lightning invoice to receive a payment. amount_sats in satoshis.",
      parameters: {
        type: "object",
        properties: {
          amount_sats: { type: "number" },
          memo: { type: "string" },
          expiry_seconds: { type: "number" },
        },
        required: ["amount_sats"],
      },
      run: async ({ amount_sats, memo, expiry_seconds }) => {
        const r = await node.createInvoice({ valueMsat: Math.round(amount_sats * 1000), memo, expiry: expiry_seconds });
        return `invoice created for ${amount_sats} sats\n${r.payment_request}`;
      },
    },
    {
      name: "ln_invoice_pay",
      mutating: true,
      description: "Pay a BOLT11 Lightning invoice from the connected node's channels. Irreversible once sent — confirm amount and destination with the user first.",
      parameters: {
        type: "object",
        properties: {
          invoice: { type: "string" },
          fee_limit_sat: { type: "number" },
          timeout_seconds: { type: "number" },
        },
        required: ["invoice"],
      },
      run: async ({ invoice, fee_limit_sat, timeout_seconds }) => {
        const r = await node.payInvoice({ paymentRequest: invoice, feeLimitSat: fee_limit_sat, timeoutSeconds: timeout_seconds });
        const status = r.status || r.result?.status;
        if (status && status !== "SUCCEEDED") {
          return `payment ${status.toLowerCase()}${r.failure_reason ? `: ${r.failure_reason}` : ""}`;
        }
        const p = r.result || r;
        return `payment sent\npreimage ${p.payment_preimage}\nfee ${p.fee_sat ?? p.fee_msat / 1000} sats`;
      },
    },
  ];

  if (tap) {
    tools.push(
      {
        name: "taproot_asset_balance",
        mutating: false,
        description: "List Taproot Assets balances held by the connected node (e.g. USDt or other assets issued over Lightning).",
        parameters: { type: "object", properties: {} },
        run: async () => {
          const r = await tap.listBalances();
          const entries = Object.values(r.asset_balances || {});
          if (!entries.length) return "no Taproot Assets held";
          return entries.map((e) => `${e.asset_genesis?.name || e.asset_genesis?.asset_id} — ${e.balance} units`).join("\n");
        },
      },
      {
        name: "taproot_asset_send",
        mutating: true,
        description: "Send Taproot Assets to one or more encoded Taproot Asset addresses. Irreversible once sent — confirm asset, amount, and destination with the user first.",
        parameters: {
          type: "object",
          properties: { tap_addrs: { type: "array", items: { type: "string" } } },
          required: ["tap_addrs"],
        },
        run: async ({ tap_addrs }) => {
          const r = await tap.send({ tapAddrs: tap_addrs });
          return `sent · transfer txid ${r.transfer?.anchor_tx_hash || "(pending)"}`;
        },
      },
    );
  }

  return tools;
}
