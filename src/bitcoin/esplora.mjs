// Esplora REST client (mempool.space / blockstream.info compatible).
// Covers chain, mempool, fees, transactions, addresses, and tx broadcast.
import { httpGet, httpPost } from "../http.mjs";

export function esplora(baseURL) {
  const g = (p, json = true) => httpGet(`${baseURL}${p}`, { json });
  return {
    feesRecommended: () => g("/v1/fees/recommended"),
    // Standard Esplora fee-estimates (target confirmation blocks -> sat/vB);
    // mempool.space additionally exposes the friendlier /v1/fees/recommended
    // above, but plain Blockstream Esplora instances (e.g. Liquid) only have
    // this one.
    feeEstimates: () => g("/fee-estimates"),
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
    // Liquid/Elements-only endpoint (asset registry); harmless no-op path on
    // plain Bitcoin Esplora since nothing calls it there.
    asset: (assetId) => g(`/asset/${assetId}`),
  };
}
