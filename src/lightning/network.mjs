// Resolves Lightning (LND) and Taproot Assets (tapd) REST config from
// config.lightning. Entirely optional — if lndRestUrl isn't set, the
// Lightning tools simply aren't registered (see src/tools.mjs).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function expandHome(p) {
  if (!p) return p;
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
}

// Pin the node's TLS certificate instead of disabling verification — a
// Lightning node is meant to be yours; trust it explicitly, don't blind the
// client. Returns undefined (system CA store) if no cert is configured.
function loadTlsOptions(certPath) {
  if (!certPath) return undefined;
  return { ca: readFileSync(expandHome(certPath)) };
}

function loadMacaroonHex(l, hexKey, pathKey) {
  if (l[hexKey]) return l[hexKey];
  if (l[pathKey]) return readFileSync(expandHome(l[pathKey])).toString("hex");
  return null;
}

export function resolveLightning(config = {}) {
  const l = config.lightning || {};
  if (!l.lndRestUrl) return null; // not configured: Lightning tools are off

  const lnd = {
    restUrl: l.lndRestUrl.replace(/\/$/, ""),
    macaroonHex: loadMacaroonHex(l, "lndMacaroonHex", "lndMacaroonPath"),
    tls: loadTlsOptions(l.tlsCertPath),
  };
  if (!lnd.macaroonHex) {
    throw new Error("lightning.lndRestUrl is set but no lndMacaroonHex/lndMacaroonPath was provided");
  }

  let tapd = null;
  if (l.tapdRestUrl) {
    tapd = {
      restUrl: l.tapdRestUrl.replace(/\/$/, ""),
      macaroonHex: loadMacaroonHex(l, "tapdMacaroonHex", "tapdMacaroonPath"),
      tls: loadTlsOptions(l.tapdTlsCertPath || l.tlsCertPath),
    };
    if (!tapd.macaroonHex) {
      throw new Error("lightning.tapdRestUrl is set but no tapdMacaroonHex/tapdMacaroonPath was provided");
    }
  }

  return { lnd, tapd };
}
