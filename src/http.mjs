// Minimal zero-dependency HTTP(S) client shared by every vertical (Bitcoin
// Esplora/RPC, Liquid Esplora, Lightning LND/tapd REST).
import http from "node:http";
import https from "node:https";

const TIMEOUT_MS = 20_000;

// `tls` (https-only) lets callers pin a self-signed node certificate via
// `{ ca }` instead of disabling verification — see src/lightning/network.mjs.
// `ndjson: true` is for gRPC-gateway server-streaming endpoints (e.g. LND's
// SendPaymentV2), which reply with newline-delimited JSON objects instead of
// one JSON body; resolves with the *last* parsed object (the terminal state).
export function httpRequest(method, urlString, { body, headers = {}, json = true, ndjson = false, tls } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch {
      return reject(new Error(`bad URL: ${urlString}`));
    }
    const lib = u.protocol === "https:" ? https : http;
    const h = { ...headers };
    if (body != null) h["content-length"] = Buffer.byteLength(body);
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: h,
        ...(u.protocol === "https:" ? tls : undefined),
      },
      async (res) => {
        res.setEncoding("utf8");
        let data = "";
        for await (const c of res) data += c;
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${method} ${u.pathname}: ${data.slice(0, 300)}`));
        }
        if (ndjson) {
          const lines = data.split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines.length === 0) return reject(new Error(`empty streaming response from ${u.pathname}`));
          try {
            return resolve(JSON.parse(lines[lines.length - 1]));
          } catch {
            return reject(new Error(`could not parse streaming response from ${u.pathname}: ${lines[lines.length - 1].slice(0, 300)}`));
          }
        }
        if (!json) return resolve(data.trim());
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data.trim());
        }
      },
    );
    req.on("error", (e) => reject(new Error(`network error ${method} ${urlString}: ${e.code || e.message}`)));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout calling ${urlString}`)));
    if (body != null) req.write(body);
    req.end();
  });
}

export const httpGet = (url, opts) => httpRequest("GET", url, opts);
export const httpPost = (url, body, opts = {}) => httpRequest("POST", url, { ...opts, body });
export const httpPostJson = (url, obj, opts = {}) =>
  httpRequest("POST", url, { ...opts, body: JSON.stringify(obj), headers: { "content-type": "application/json", ...opts.headers } });
