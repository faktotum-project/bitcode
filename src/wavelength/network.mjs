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
    : path.join(homedir(), ".bitcode", "wavelength", network);

  return {
    network,
    dataDir,
    arkServerAddress: w.arkServerAddress || preset.arkServerAddress,
    swapServerAddress: w.swapServerAddress || preset.swapServerAddress,
    walletEsploraUrl: w.walletEsploraUrl || preset.walletEsploraUrl,
    // Guardrails (update_wavelength.md §5): per-payment cap enforced in code
    // (G3) and the per-round operator fee cap the daemon accepts.
    maxPaySats: w.maxPaySats ?? 50_000,
    maxOperatorFeeSat: w.maxOperatorFeeSat ?? 1_000,
    allowMainnet: !!w.allowMainnet,
  };
}
