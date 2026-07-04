// Autonomous HD wallet (BIP84 native segwit, descriptor-based) built on audited
// @scure libraries, following the 2026 best practices in
// aggiornamenti_bitcoin_ai_agents.md:
//   - descriptor wallet (wpkh + xpub/tpub origin),
//   - PSBT flow with construction and signing kept separate,
//   - the seed is NEVER returned through agent tools (only the human CLI
//     `bitcode wallet seed` can reveal it).
// Keys live at ~/.bitcode/wallet.<net>.json (0600) or in BITCODE_MNEMONIC.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as btc from "@scure/btc-signer";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { esplora } from "./esplora.mjs";
import { withChecksum } from "./descriptor.mjs";

const DUST = 330n; // p2wpkh dust floor (sats)
const vbytes = (inputs, outputs) => Math.ceil(10.5 + inputs * 68 + outputs * 31);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

export function wallet(ctx) {
  const dir = path.join(homedir(), ".bitcode");
  const file = path.join(dir, `wallet.${ctx.name}.json`);
  const api = esplora(ctx.esploraUrl);

  function persist(data) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
    try {
      chmodSync(file, 0o600);
    } catch {
      /* best effort on non-POSIX */
    }
  }

  function loadMnemonic() {
    if (process.env.BITCODE_MNEMONIC) return process.env.BITCODE_MNEMONIC.trim();
    if (!existsSync(file)) {
      throw new Error(`no ${ctx.name} wallet. Run wallet_create first, or set BITCODE_MNEMONIC.`);
    }
    return JSON.parse(readFileSync(file, "utf8")).mnemonic;
  }

  const root = () => HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(loadMnemonic()), ctx.bip32);
  const account = () => root().derive(`m/84'/${ctx.coin}'/0'`);
  const nodeAt = (change, index) => root().derive(`m/84'/${ctx.coin}'/0'/${change}/${index}`);

  function addrAt(change, index) {
    const node = nodeAt(change, index);
    const p = btc.p2wpkh(node.publicKey, ctx.net);
    return { address: p.address, script: p.script, priv: node.privateKey };
  }

  function descriptor() {
    const r = root();
    const fp = (r.fingerprint >>> 0).toString(16).padStart(8, "0");
    const xpub = account().publicExtendedKey;
    return withChecksum(`wpkh([${fp}/84h/${ctx.coin}h/0h]${xpub}/<0;1>/*)`);
  }

  async function scanUtxos(gap) {
    const found = [];
    for (const change of [0, 1]) {
      for (let i = 0; i < gap; i++) {
        const { address, script, priv } = addrAt(change, i);
        for (const u of await api.utxos(address)) {
          found.push({
            txid: u.txid,
            vout: u.vout,
            value: BigInt(u.value),
            confirmed: !!u.status?.confirmed,
            address,
            script,
            priv,
          });
        }
      }
    }
    return found;
  }

  // Coin selection + unsigned transaction. Returns the tx plus a summary.
  async function planTx({ to, amountSats, feeRate, gap }) {
    const amount = BigInt(amountSats);
    const rate = Number(feeRate);
    const utxos = (await scanUtxos(gap)).sort((a, b) => (b.value > a.value ? 1 : -1));
    const selected = [];
    let inSum = 0n;
    let fee = 0n;
    for (const u of utxos) {
      selected.push(u);
      inSum += u.value;
      fee = BigInt(Math.ceil(vbytes(selected.length, 2) * rate));
      if (inSum >= amount + fee) break;
    }
    if (inSum < amount + fee) {
      throw new Error(`insufficient funds: have ${inSum} sats, need ${amount + fee} (amount + fee)`);
    }
    let change = inSum - amount - fee;
    const tx = new btc.Transaction();
    for (const u of selected) {
      tx.addInput({ txid: hexToBytes(u.txid), index: u.vout, witnessUtxo: { script: u.script, amount: u.value } });
    }
    tx.addOutputAddress(to, amount, ctx.net);
    if (change >= DUST) tx.addOutputAddress(addrAt(1, 0).address, change, ctx.net);
    else {
      fee += change;
      change = 0n;
    }
    return {
      tx,
      summary: {
        network: ctx.name,
        to,
        amountSats: Number(amount),
        feeSats: Number(fee),
        feeRate: rate,
        inputs: selected.length,
        changeSats: Number(change),
      },
    };
  }

  // Coin selection for a full sweep: every UTXO in, one output out, no
  // change (used by e.g. the CoinJoin temp wallet, which must never leave
  // residual UTXOs behind).
  async function planSweep({ to, feeRate, gap }) {
    const rate = Number(feeRate);
    const utxos = await scanUtxos(gap);
    if (!utxos.length) throw new Error("no funds to sweep");
    const inSum = utxos.reduce((s, u) => s + u.value, 0n);
    const fee = BigInt(Math.ceil(vbytes(utxos.length, 1) * rate));
    if (inSum <= fee) {
      throw new Error(`insufficient funds to sweep: have ${inSum} sats, fee ${fee} sats`);
    }
    const amount = inSum - fee;
    const tx = new btc.Transaction();
    for (const u of utxos) {
      tx.addInput({ txid: hexToBytes(u.txid), index: u.vout, witnessUtxo: { script: u.script, amount: u.value } });
    }
    tx.addOutputAddress(to, amount, ctx.net);
    return {
      tx,
      summary: {
        network: ctx.name,
        to,
        amountSats: Number(amount),
        feeSats: Number(fee),
        feeRate: rate,
        inputs: utxos.length,
        changeSats: 0,
      },
    };
  }

  return {
    file,
    exists: () => existsSync(file),
    descriptor,

    // Human-only: reveal the seed for backup. Never call from an agent tool.
    revealMnemonic: () => loadMnemonic(),

    // Creates the wallet; intentionally does NOT return the mnemonic.
    create({ force = false } = {}) {
      if (existsSync(file) && !force) throw new Error(`wallet already exists at ${file} (pass force to overwrite)`);
      const mnemonic = bip39.generateMnemonic(wordlist, 128);
      persist({ mnemonic, network: ctx.name, createdAt: new Date().toISOString() });
      return { file, network: ctx.name, descriptor: descriptor(), address0: addrAt(0, 0).address };
    },

    importMnemonic(mnemonic, { force = false } = {}) {
      const m = mnemonic.trim();
      if (!bip39.validateMnemonic(m, wordlist)) throw new Error("invalid BIP39 mnemonic");
      if (existsSync(file) && !force) throw new Error(`wallet already exists at ${file} (pass force to overwrite)`);
      persist({ mnemonic: m, network: ctx.name, createdAt: new Date().toISOString() });
      return { file, network: ctx.name, descriptor: descriptor(), address0: addrAt(0, 0).address };
    },

    receiveAddress: (index = 0) => addrAt(0, index).address,

    async listUtxos({ gap = 10 } = {}) {
      const utxos = await scanUtxos(gap);
      return utxos.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        sats: Number(u.value),
        address: u.address,
        confirmed: u.confirmed,
      }));
    },

    async balance({ gap = 10 } = {}) {
      const utxos = await scanUtxos(gap);
      const sats = utxos.reduce((s, u) => s + u.value, 0n);
      return {
        network: ctx.name,
        address0: addrAt(0, 0).address,
        sats: Number(sats),
        btc: Number(sats) / 1e8,
        utxos: utxos.length,
      };
    },

    // Build an UNSIGNED transaction and return it as a PSBT (base64) + summary.
    async createPsbt({ to, amountSats, feeRate, gap = 20 }) {
      const { tx, summary } = await planTx({ to, amountSats, feeRate, gap });
      return { psbt: b64(tx.toPSBT()), ...summary };
    },

    // Sign a PSBT locally with the seed and finalize. Optionally broadcast.
    async signPsbt({ psbt, broadcast = false, gap = 20 }) {
      if (ctx.name === "mainnet" && broadcast && !ctx.allowMainnetSpend) {
        throw new Error("mainnet broadcast disabled — set bitcoin.allowMainnetSpend=true to spend real BTC");
      }
      const tx = btc.Transaction.fromPSBT(fromB64(psbt));
      const seen = new Set();
      for (const change of [0, 1]) {
        for (let i = 0; i < gap; i++) {
          const { priv } = addrAt(change, i);
          const k = bytesToHex(priv);
          if (seen.has(k)) continue;
          seen.add(k);
          try {
            tx.sign(priv);
          } catch {
            /* key doesn't match any input; skip */
          }
        }
      }
      tx.finalize();
      const result = { network: ctx.name, txid: tx.id, vsize: tx.vsize, hex: tx.hex, broadcast: false };
      if (broadcast) {
        result.broadcastTxid = await api.broadcast(tx.hex);
        result.broadcast = true;
      }
      return result;
    },

    // Convenience: plan → sign → optionally broadcast in one call.
    async send({ to, amountSats, feeRate, broadcast = false, gap = 20 }) {
      const built = await this.createPsbt({ to, amountSats, feeRate, gap });
      const signed = await this.signPsbt({ psbt: built.psbt, broadcast, gap });
      return { ...built, ...signed, psbt: undefined };
    },

    // Build an UNSIGNED sweep transaction: every UTXO in, `to` gets it all
    // minus fee, no change output.
    async createSweepPsbt({ to, feeRate, gap = 20 }) {
      const { tx, summary } = await planSweep({ to, feeRate, gap });
      return { psbt: b64(tx.toPSBT()), ...summary };
    },

    // Convenience: sweep-plan → sign → optionally broadcast in one call.
    async sweep({ to, feeRate, broadcast = false, gap = 20 }) {
      const built = await this.createSweepPsbt({ to, feeRate, gap });
      const signed = await this.signPsbt({ psbt: built.psbt, broadcast, gap });
      return { ...built, ...signed, psbt: undefined };
    },
  };
}
