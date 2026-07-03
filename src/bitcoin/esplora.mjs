// Esplora REST client (mempool.space / blockstream.info compatible).
// Covers chain, mempool, fees, transactions, addresses, and tx broadcast.
import { httpGet, httpPost } from "./http.mjs";

export function esplora(baseURL) {
  const g = (p, json = true) => httpGet(`${baseURL}${p}`, { json });
  return {
    feesRecommended: () => g("/v1/fees/recommended"),
    mempool: () => g("/mempool"),
    mempoolRecent: () => g("/mempool/recent"),
    tipHeight: () => g("/blocks/tip/height", false),
    tipHash: () => g("/blocks/tip/hash", false),
    block: (hash) => g(`/block/${hash}`),
    blockHashByHeight: (h) => g(`/block-height/${h}`, false),
    tx: (txid) => g(`/tx/${txid}`),
    txHex: (txid) => g(`/tx/${txid}/hex`, false),
    address: (addr) => g(`/address/${addr}`),
    utxos: (addr) => g(`/address/${addr}/utxo`),
    addressTxs: (addr) => g(`/address/${addr}/txs`),
    broadcast: (rawHex) => httpPost(`${baseURL}/tx`, rawHex, { json: false }),
  };
}
