// Resolve the active Bitcoin network from config into everything the tools need:
// an Esplora base URL, the @scure/btc-signer network params, the BIP44 coin type,
// the default Core RPC port, and the cookie subdirectory.
import * as btc from "@scure/btc-signer";

// BIP32 extended-key version bytes (so xpub vs tpub renders correctly in descriptors).
const XPUB = { private: 0x0488ade4, public: 0x0488b21e };
const TPUB = { private: 0x04358394, public: 0x043587cf };

const NETWORKS = {
  mainnet: {
    esplora: "https://mempool.space/api",
    net: btc.NETWORK,
    coin: 0,
    rpcPort: 8332,
    cookieDir: "",
    bip32: XPUB,
  },
  testnet: {
    esplora: "https://mempool.space/testnet/api",
    net: btc.TEST_NETWORK,
    coin: 1,
    rpcPort: 18332,
    cookieDir: "testnet3",
    bip32: TPUB,
  },
  testnet4: {
    esplora: "https://mempool.space/testnet4/api",
    net: btc.TEST_NETWORK,
    coin: 1,
    rpcPort: 48332,
    cookieDir: "testnet4",
    bip32: TPUB,
  },
  signet: {
    esplora: "https://mempool.space/signet/api",
    net: btc.TEST_NETWORK,
    coin: 1,
    rpcPort: 38332,
    cookieDir: "signet",
    bip32: TPUB,
  },
};

export function resolveNetwork(config = {}) {
  const b = config.bitcoin || {};
  const name = b.network || "signet";
  const base = NETWORKS[name];
  if (!base) {
    throw new Error(`unknown bitcoin.network "${name}" (use: ${Object.keys(NETWORKS).join(", ")})`);
  }
  return {
    name,
    esploraUrl: b.esploraUrl || base.esplora,
    net: base.net,
    coin: base.coin,
    rpcPort: base.rpcPort,
    cookieDir: base.cookieDir,
    bip32: base.bip32,
    rpc: b.rpc || null,
    allowMainnetSpend: !!b.allowMainnetSpend,
  };
}
