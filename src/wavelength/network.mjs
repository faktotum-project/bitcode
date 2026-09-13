import { bitcodeHome } from "../paths.mjs";
// Resolves Wavelength config from config.wavelength. Wavelength is Lightning
// Labs' self-custodial Bitcoin/Lightning/Ark wallet toolkit: no node, no
// channels, keys stay on this machine. Entirely optional — if the key is
// absent the wl_* tools simply aren't registered (see src/tools.mjs), the
// same opt-in contract as config.lightning.
//
// Endpoint presets are copied verbatim from the published SDK
// (@lightninglabs/wavelength-core@0.1.0, networkDefaults in dist/config.js)
// rather than assumed: public REST gateways exist only for signet, testnet
// and testnet4. mainnet has no public deployment yet — the SDK itself
// rejects mainnet configs without an explicit allowMainnet flag — so here it
// demands both allowMainnet and hand-built endpoints. regtest is local-only
// and needs explicit endpoints too.
//
// The engine itself is Lightning Labs' `waved` daemon (a separate Go project,
// github.com/lightninglabs/wavelength — see scripts/build-wavelength.sh),
// which bitcode vendors and runs locally. These endpoints are what *waved*
// dials outward to (the hosted operator + swap server + esplora indexer);
// the daemon's own local RPC (what bitcode's wavecli-mcp transport connects
// to) is configured separately below, all scoped under dataDir so multiple
// networks never collide.
import { homedir } from "node:os";
import path from "node:path";

const PRESETS = {
  signet: {
    arkServerAddress: "https://signet.wavelength-rest.lightning.finance",
    swapServerAddress: "https://signet.swapd-rest.lightning.finance",
    walletEsploraUrl: "https://mempool-signet.testnet.lightningcluster.com/api",
  },
  testnet: {
    arkServerAddress: "https://test.wavelength-rest.lightning.finance",
    swapServerAddress: "https://test.swapd-rest.lightning.finance",
    walletEsploraUrl: "https://mempool-testnet3.testnet.lightningcluster.com/api",
  },
  testnet4: {
    arkServerAddress: "https://test4.wavelength-rest.lightning.finance",
    swapServerAddress: "https://test4.swapd-rest.lightning.finance",
    walletEsploraUrl: "https://mempool-testnet4.testnet.lightningcluster.com/api",
  },
};

// All three hosted presets are REST gateways (hostnames say so: "-rest-"),
// not gRPC — confirmed against a live `waved --help`, whose
// --server.transport/--swap.servertransport default to "grpc" and must be
// overridden to "rest" for these endpoints. A hand-built endpoint (mainnet,
// regtest) may be either, so it isn't forced here.
const PRESET_TRANSPORT = "rest";

export function resolveWavelength(config = {}) {
  const w = config.wavelength;
  if (!w) return null; // not configured: Wavelength tools are off

  const network = w.network || "signet";
  let preset = PRESETS[network];
  if (network === "mainnet") {
    if (!w.allowMainnet) {
      throw new Error('wavelength.network "mainnet" requires wavelength.allowMainnet: true — and Wavelength has no public mainnet deployment yet');
    }
    if (!w.arkServerAddress) {
      throw new Error("wavelength mainnet has no endpoint preset: set wavelength.arkServerAddress explicitly");
    }
    preset = {};
  } else if (network === "regtest") {
    if (!w.arkServerAddress) {
      throw new Error("wavelength regtest has no endpoint preset: set wavelength.arkServerAddress explicitly");
    }
    preset = {};
  } else if (!preset) {
    throw new Error(`unknown wavelength.network "${network}" (use: signet, testnet, testnet4, regtest, mainnet)`);
  }

  const dataDir = w.dataDir
    ? path.resolve(w.dataDir.replace(/^~/, homedir()))
    : path.join(bitcodeHome(), "wavelength", network);

  return {
    network,
    dataDir,
    arkServerAddress: w.arkServerAddress || preset.arkServerAddress,
    // "rest" for the hosted presets (their hostnames confirm it); a
    // hand-built endpoint keeps waved's own default (grpc) unless told
    // otherwise, since we can't assume what a custom operator speaks.
    arkServerTransport: w.arkServerTransport || (!w.arkServerAddress && preset.arkServerAddress ? PRESET_TRANSPORT : undefined),
    swapServerAddress: w.swapServerAddress || preset.swapServerAddress,
    swapServerTransport: w.swapServerTransport || (!w.swapServerAddress && preset.swapServerAddress ? PRESET_TRANSPORT : undefined),
    walletEsploraUrl: w.walletEsploraUrl || preset.walletEsploraUrl,
    // Guardrails (update_wavelength.md §5): per-payment cap enforced in code
    // (G3) and the per-round operator fee cap the daemon accepts.
    maxPaySats: w.maxPaySats ?? 50_000,
    maxOperatorFeeSat: w.maxOperatorFeeSat ?? 1_000,
    allowMainnet: !!w.allowMainnet,
    // Local daemon RPC (G6/G8: TLS + macaroon always on, no dev bypass
    // flags). One waved instance per dataDir, so per-network defaults never
    // collide as long as each network keeps its own dataDir (the default).
    rpcListenAddr: w.rpcListenAddr || "127.0.0.1:10029",
    rpcMacaroonPath: path.join(dataDir, "rpc.macaroon"),
    rpcTlsCertPath: path.join(dataDir, "tls.cert"),
    rpcTlsKeyPath: path.join(dataDir, "tls.key"),
  };
}
