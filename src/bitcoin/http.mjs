// Minimal zero-dependency HTTP(S) client for Esplora + Bitcoin Core RPC.
import http from "node:http";
import https from "node:https";

const TIMEOUT_MS = 20_000;

export function httpRequest(method, urlString, { body, headers = {}, json = true } = {}) {
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
      },
      async (res) => {
        res.setEncoding("utf8");
        let data = "";
        for await (const c of res) data += c;
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${method} ${u.pathname}: ${data.slice(0, 300)}`));
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
