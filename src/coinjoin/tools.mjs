// CoinJoin agent tools — Fase 1 (update_cj.md): risk consent, temp wallet
// lifecycle. JoinMarket round execution itself is Fase 2 and not wired up
// yet; these tools only manage the isolated temp wallet described in G1/G9.
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveNetwork } from "../bitcoin/network.mjs";
import { esplora } from "../bitcoin/esplora.mjs";
import { coinjoinWallet } from "./wallet.mjs";

const MIN_AMOUNT_SATS = 1_000_000; // 0.01 BTC (G2)

function consentLogPath() {
  return path.join(homedir(), ".bitcode", "cj-consent.log");
}

function logConsent(line) {
  const dir = path.join(homedir(), ".bitcode");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(consentLogPath(), line + "\n");
}

export function coinjoinTools(config) {
  const ctx = resolveNetwork(config);
  const api = esplora(ctx.esploraUrl);
  const w = coinjoinWallet(ctx);

  return [
    {
      name: "cj_risk_consent",
      mutating: true,
      description:
        'Record the user\'s explicit consent to the CoinJoin temporary-custody risk disclosure (G11). Call only after the user has typed exactly "I ACCEPT" in response to the risk warning — never on their behalf.',
      parameters: {
        type: "object",
        properties: {
          accepted_text: { type: "string", description: 'Must be exactly "I ACCEPT".' },
          amount_sats: { type: "number" },
          to_address: { type: "string" },
        },
        required: ["accepted_text", "amount_sats", "to_address"],
      },
      run: ({ accepted_text, amount_sats, to_address }) => {
        if (accepted_text.trim() !== "I ACCEPT") {
          throw new Error('consent not recorded: user must type exactly "I ACCEPT"');
        }
        const hash = createHash("sha256").update(accepted_text).digest("hex");
        logConsent(`${new Date().toISOString()} | ${hash} | ${amount_sats} | ${to_address}`);
        return "consent recorded in ~/.bitcode/cj-consent.log";
      },
    },
    {
      name: "cj_wallet_create",
      mutating: true,
      description:
        `Create the temporary CoinJoin wallet (isolated from the main bitcode wallet — G1/G9). Refuses amount_sats below ${MIN_AMOUNT_SATS} (0.01 BTC, G2). Call cj_risk_consent first.`,
      parameters: {
        type: "object",
        properties: { amount_sats: { type: "number" } },
        required: ["amount_sats"],
      },
      run: ({ amount_sats }) => {
        if (amount_sats < MIN_AMOUNT_SATS) {
          throw new Error(`amount too small for CoinJoin: ${amount_sats} sats (minimum ${MIN_AMOUNT_SATS} = 0.01 BTC, G2)`);
        }
        if (w.exists()) {
          throw new Error("a CoinJoin wallet already exists — finish, drain (cj_wallet_drain), or destroy it (cj_wallet_destroy) first");
        }
        const r = w.create({});
        return `CoinJoin temp wallet created on ${ctx.name}\ndeposit address: ${r.address0}\n\nSend exactly ${amount_sats} sats to this address, then check cj_wallet_status.`;
      },
    },
    {
      name: "cj_wallet_status",
      mutating: false,
      description: "Check the temporary CoinJoin wallet's balance and deposit address.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        if (!w.exists()) return "no CoinJoin wallet exists — call cj_wallet_create first.";
        const b = await w.balance({});
        return `CoinJoin wallet (${b.network})\ndeposit ${b.address0}\nbalance ${b.btc.toFixed(8)} BTC (${b.sats} sats) · ${b.utxos} utxos`;
      },
    },
    {
      name: "cj_wallet_drain",
      mutating: true,
      description:
        "Sweep ALL funds from the temporary CoinJoin wallet to the given address, leaving zero change (G4). Used to return funds if CoinJoin can't proceed, or as final payout. Set broadcast=true to actually send.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          fee_rate: { type: "number" },
          broadcast: { type: "boolean" },
        },
        required: ["to"],
      },
      run: async ({ to, fee_rate, broadcast = false }) => {
        if (!w.exists()) throw new Error("no CoinJoin wallet exists.");
        let rate = fee_rate;
        if (rate == null) {
          const f = await api.feesRecommended();
          rate = f.halfHourFee || f.economyFee || 1;
        }
        const r = await w.drainAll(to, { feeRate: rate, broadcast });
        let s =
          `${r.broadcast ? "SWEPT" : "signed (not broadcast)"} on ${r.network}\n` +
          `to ${r.to}\namount ${r.amountSats} sats · fee ${r.feeSats} sats (${r.feeRate} sat/vB)\ntxid ${r.txid}`;
        s += r.broadcastTxid ? `\nbroadcast txid ${r.broadcastTxid}` : `\nraw hex: ${r.hex}`;
        return s;
      },
    },
    {
      name: "cj_wallet_destroy",
      mutating: true,
      description:
        "Permanently destroy the temporary CoinJoin wallet file (zero-overwrite + delete). Refuses unless the wallet balance is verified at zero, unless force=true.",
      parameters: {
        type: "object",
        properties: { force: { type: "boolean" } },
      },
      run: async ({ force = false }) => {
        if (!w.exists()) return "no CoinJoin wallet to destroy.";
        if (!force) {
          const check = await w.verifyEmpty({});
          if (!check.empty) {
            throw new Error(
              `refusing to destroy: wallet still holds ${check.sats} sats. Drain it first (cj_wallet_drain), or pass force=true.`,
            );
          }
        }
        const r = w.destroy();
        return `CoinJoin wallet destroyed: ${r.file}`;
      },
    },
  ];
}
