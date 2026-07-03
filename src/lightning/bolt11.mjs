// BOLT11 Lightning invoice decoder — pure JS, no Lightning node required.
// Spec: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
// Reuses the bech32 codec already vendored transitively via @scure/btc-signer
// (see package.json) instead of adding a dedicated npm package for this.
//
// Known limitations (documented, not bugs): the ECDSA signature is reported
// raw but not verified/recovered (would need secp256k1 pubkey recovery);
// fallback addresses (`f`) are reported as witness-version + hex program,
// not re-encoded into a bech32/base58 address string.
import { bech32 } from "@scure/base";

const NETWORK_BY_PREFIX = { lnbc: "mainnet", lntb: "testnet", lntbs: "signet", lnbcrt: "regtest" };
const MSAT_PER_UNIT = 1e11; // 1 "bitcoin" unit (the HRP amount) = 1e11 millisatoshi
const MULTIPLIER = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };

// BOLT11 tagged-field type numbers (the letter and the number are NOT the
// same value — e.g. features is letter "9" but type number 5; fallback
// address is letter "f" but type number 9. Mixing these up is the classic
// off-by-letter bug in hand-rolled decoders.)
const TYPE_PAYMENT_HASH = 1;
const TYPE_ROUTE_HINT = 3;
const TYPE_EXPIRY = 6;
const TYPE_FALLBACK = 9;
const TYPE_DESCRIPTION = 13;
const TYPE_PAYMENT_SECRET = 16;
const TYPE_PAYEE_NODE_KEY = 19;
const TYPE_DESCRIPTION_HASH = 23;
const TYPE_MIN_FINAL_CLTV = 24;
const TYPE_METADATA = 27;
const TYPE_FEATURES = 5;

function wordsToInt(words) {
  let n = 0n;
  for (const w of words) n = (n << 5n) | BigInt(w);
  return n;
}

// 5-bit words -> bytes, discarding any trailing <8-bit remainder (padding).
function wordsToBytes(words) {
  let acc = 0, bits = 0;
  const out = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function parseFallback(field) {
  // First 5-bit word is the witness version (0-16), or 17/18 for the
  // legacy P2PKH/P2SH markers; the rest is the program/hash.
  const version = field[0];
  const programBytes = wordsToBytes(field.slice(1));
  return { version, programHex: toHex(programBytes) };
}

function parseRouteHints(bytes) {
  const ENTRY_LEN = 51; // 33 (pubkey) + 8 (scid) + 4 (fee_base) + 4 (fee_prop) + 2 (cltv) bytes
  const hints = [];
  for (let off = 0; off + ENTRY_LEN <= bytes.length; off += ENTRY_LEN) {
    const pubkey = bytes.subarray(off, off + 33);
    const scid = bytes.subarray(off + 33, off + 41);
    const feeBase = bytes.subarray(off + 41, off + 45);
    const feeProp = bytes.subarray(off + 45, off + 49);
    const cltv = bytes.subarray(off + 49, off + 51);
    const u32 = (b) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const u16 = (b) => (b[0] << 8) | b[1];
    let scidBig = 0n;
    for (const b of scid) scidBig = (scidBig << 8n) | BigInt(b);
    hints.push({
      pubkey: toHex(pubkey),
      shortChannelId: `${Number(scidBig >> 40n)}x${Number((scidBig >> 16n) & 0xffffffn)}x${Number(scidBig & 0xffffn)}`,
      feeBaseMsat: u32(feeBase),
      feeProportionalMillionths: u32(feeProp),
      cltvExpiryDelta: u16(cltv),
    });
  }
  return hints;
}

export function decodeBolt11(invoice) {
  const s = String(invoice).trim().toLowerCase();
  const { prefix, words } = bech32.decode(s, false); // false = no length limit (real invoices exceed BIP173's 90 chars)

  const m = prefix.match(/^(lnbc|lntb|lntbs|lnbcrt)(\d+)?([munp])?$/);
  if (!m) throw new Error(`not a BOLT11 invoice (bad human-readable prefix "${prefix}")`);
  const network = NETWORK_BY_PREFIX[m[1]];

  let amountMsat = null;
  if (m[2]) {
    const factor = m[3] ? MULTIPLIER[m[3]] : 1;
    amountMsat = Number(m[2]) * factor * MSAT_PER_UNIT;
  }

  const SIG_WORDS = 104; // 520 bits / 5
  if (words.length < 7 + SIG_WORDS) throw new Error("invoice too short to contain timestamp + signature");
  const timestamp = Number(wordsToInt(words.slice(0, 7)));
  const dataWords = words.slice(7, words.length - SIG_WORDS);
  const sigBytes = wordsToBytes(words.slice(words.length - SIG_WORDS)); // 65 bytes: 64-byte R||S + 1-byte recovery id

  const out = {
    network,
    amountMsat,
    amountSats: amountMsat == null ? null : amountMsat / 1000,
    timestamp,
    timestampIso: new Date(timestamp * 1000).toISOString(),
    expirySeconds: 3600, // BOLT11 default when no `x` field is present
    minFinalCltvExpiry: 18, // BOLT11 default when no `c` field is present
    paymentHash: null,
    paymentSecret: null,
    description: null,
    descriptionHash: null,
    payeeNodeKey: null,
    metadataHex: null,
    fallback: null,
    routeHints: [],
    features: null,
    signature: { hex: toHex(sigBytes.subarray(0, 64)), recoveryFlag: sigBytes[64] },
  };

  let i = 0;
  while (i + 3 <= dataWords.length) {
    const type = dataWords[i];
    const dataLength = Number(wordsToInt(dataWords.slice(i + 1, i + 3)));
    const field = dataWords.slice(i + 3, i + 3 + dataLength);
    i += 3 + dataLength;

    switch (type) {
      case TYPE_PAYMENT_HASH:
        out.paymentHash = toHex(wordsToBytes(field).subarray(0, 32));
        break;
      case TYPE_PAYMENT_SECRET:
        out.paymentSecret = toHex(wordsToBytes(field).subarray(0, 32));
        break;
      case TYPE_DESCRIPTION:
        out.description = Buffer.from(wordsToBytes(field)).toString("utf8");
        break;
      case TYPE_DESCRIPTION_HASH:
        out.descriptionHash = toHex(wordsToBytes(field).subarray(0, 32));
        break;
      case TYPE_PAYEE_NODE_KEY:
        out.payeeNodeKey = toHex(wordsToBytes(field).subarray(0, 33));
        break;
      case TYPE_EXPIRY:
        out.expirySeconds = Number(wordsToInt(field));
        break;
      case TYPE_MIN_FINAL_CLTV:
        out.minFinalCltvExpiry = Number(wordsToInt(field));
        break;
      case TYPE_METADATA:
        out.metadataHex = toHex(wordsToBytes(field));
        break;
      case TYPE_FEATURES:
        out.features = toHex(wordsToBytes(field));
        break;
      case TYPE_FALLBACK:
        out.fallback = parseFallback(field);
        break;
      case TYPE_ROUTE_HINT:
        out.routeHints.push(...parseRouteHints(wordsToBytes(field)));
        break;
      default:
        break; // unknown/future tagged field: skip, per BOLT11 reader rules
    }
  }

  return out;
}
