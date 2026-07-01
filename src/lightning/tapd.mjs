// Taproot Assets (tapd) REST client — the protocol Tether's USD₮ actually
// runs on over Lightning today (live since March 2026), unlike RGB which
// has no live network yet. Endpoints verified against Lightning Labs' API
// reference (lightning.engineering/api-docs/api/taproot-assets):
//   GET  /v1/taproot-assets/assets/balance   - asset balances
//   GET  /v1/taproot-assets/assets           - list assets
//   POST /v1/taproot-assets/addrs            - new receive address
//   POST /v1/taproot-assets/send             - send assets
// Auth: same macaroon-header pattern as LND (see lnd.mjs), separate
// macaroon/cert since tapd is a separate daemon/port.
import { httpGet, httpPostJson } from "../http.mjs";

const hexToBase64 = (hex) => Buffer.from(hex, "hex").toString("base64");

export function tapd(cfg) {
  const authHeaders = { "grpc-metadata-macaroon": cfg.macaroonHex };
  const g = (path) => httpGet(`${cfg.restUrl}${path}`, { headers: authHeaders, tls: cfg.tls });
  const p = (path, body) => httpPostJson(`${cfg.restUrl}${path}`, body, { headers: authHeaders, tls: cfg.tls });

  return {
    listBalances: () => g("/v1/taproot-assets/assets/balance"),
    listAssets: () => g("/v1/taproot-assets/assets"),
    newAddress: ({ assetIdHex, amount }) =>
      p("/v1/taproot-assets/addrs", { asset_id: hexToBase64(assetIdHex), amt: String(amount) }),
    send: ({ tapAddrs }) => p("/v1/taproot-assets/send", { tap_addrs: tapAddrs }),
  };
}
