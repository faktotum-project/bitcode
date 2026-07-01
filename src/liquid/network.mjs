// Liquid (Blockstream's Bitcoin sidechain) network config. Read-only only:
// Liquid uses Elements/confidential transactions, which @scure/btc-signer
// (Bitcoin-only) cannot sign — so unlike src/bitcoin/network.mjs there is no
// wallet here, just chain/mempool/asset queries via the same Esplora API
// shape Bitcoin already uses (public Blockstream infrastructure).
const NETWORKS = {
  mainnet: { esplora: "https://blockstream.info/liquid/api" },
  testnet: { esplora: "https://blockstream.info/liquidtestnet/api" },
};

export function resolveLiquidNetwork(config = {}) {
  const l = config.liquid || {};
  const name = l.network || "mainnet";
  const base = NETWORKS[name];
  if (!base) {
    throw new Error(`unknown liquid.network "${name}" (use: ${Object.keys(NETWORKS).join(", ")})`);
  }
  return { name, esploraUrl: l.esploraUrl || base.esplora };
}
