// LND REST client. Endpoints and auth verified against Lightning Labs' API
// reference (lightning.engineering/api-docs) rather than assumed:
//   GET  /v1/getinfo                  - node info
//   GET  /v1/balance/blockchain       - on-chain balance
//   GET  /v1/balance/channels         - channel balance
//   GET  /v1/channels                 - list channels
//   POST /v1/invoices                 - create invoice
//   GET  /v1/invoice/{r_hash_str}     - look up invoice
//   POST /v2/router/send              - pay invoice (server-streaming NDJSON;
//                                        the older /v1/channels/transactions
//                                        SendPaymentSync is deprecated)
// Auth: header "Grpc-Metadata-macaroon: <hex>" (confirmed against LND docs
// and lightningnetwork/lnd's own macaroon docs), never a bearer token or
// anything that could be confused with a cookie sent to a third party.
import { httpGet, httpPostJson } from "../http.mjs";

export function lnd(cfg) {
  const authHeaders = { "grpc-metadata-macaroon": cfg.macaroonHex };
  const g = (p) => httpGet(`${cfg.restUrl}${p}`, { headers: authHeaders, tls: cfg.tls });
  const p = (path, body, opts = {}) => httpPostJson(`${cfg.restUrl}${path}`, body, { headers: authHeaders, tls: cfg.tls, ...opts });

  return {
    getInfo: () => g("/v1/getinfo"),
    walletBalance: () => g("/v1/balance/blockchain"),
    channelBalance: () => g("/v1/balance/channels"),
    listChannels: () => g("/v1/channels"),
    createInvoice: ({ valueMsat, memo, expiry }) =>
      p("/v1/invoices", { value_msat: String(valueMsat), memo: memo || "", expiry: expiry ? String(expiry) : undefined }),
    lookupInvoice: (rHashStr) => g(`/v1/invoice/${rHashStr}`),
    // timeout_seconds bounds how long LND searches for a route before giving
    // up, which also bounds how long the NDJSON stream stays open.
    payInvoice: ({ paymentRequest, timeoutSeconds = 60, feeLimitSat }) =>
      p(
        "/v2/router/send",
        {
          payment_request: paymentRequest,
          timeout_seconds: timeoutSeconds,
          fee_limit_sat: feeLimitSat != null ? String(feeLimitSat) : undefined,
        },
        { ndjson: true },
      ),
  };
}
