// Cashu network / mint URL resolution.
// Each "network" is just a well-known Cashu mint you can connect to, or a
// placeholder for a local mintd instance.
//
// Config shape in ~/.bitcode/config.json:
//   "cashu": {
//     "network": "mainnet",          // one of the keys below
//     "mintUrl": "https://..."       // override the default mint URL
//     "workDir": "~/.bitcode/cashu"  // wallet database + seed location
//   }

import { homedir } from "node:os";
import path from "node:path";

const WELL_KNOWN_MINTS = {
  mainnet: { mintUrl: "https://mint.minibits.cash/Bitcoin" },
  testnet: { mintUrl: "https://testnut.cashu.space" },
  regtest: { mintUrl: "http://127.0.0.1:3338" },
};

export function resolveCashuNetwork(config = {}) {
  const c = config.cashu || {};
  const name = c.network || "testnet";
  const base = WELL_KNOWN_MINTS[name];
  if (!base) {
    throw new Error(`unknown cashu.network "${name}" (use: ${Object.keys(WELL_KNOWN_MINTS).join(", ")})`);
  }
  const mintUrl = c.mintUrl || base.mintUrl;
  const workDir = c.workDir
    ? path.resolve(c.workDir.replace(/^~/, homedir()))
    : path.join(homedir(), ".bitcode", "cashu", name);
  return {
    name,
    mintUrl,
    workDir,
    unit: c.unit || "sat",
    proxy: c.proxy || null,
  };
}
