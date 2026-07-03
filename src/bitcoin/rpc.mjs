// JSON-RPC client for a local Bitcoin Core node (full-node developer tooling).
// Auth resolves from config (user/pass) or the node's .cookie file.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { httpPost } from "./http.mjs";

function cookiePath(ctx) {
  return ctx.rpc?.cookieFile || path.join(homedir(), ".bitcoin", ctx.cookieDir, ".cookie");
}

function resolveAuth(ctx) {
  if (ctx.rpc?.user && ctx.rpc?.pass) return `${ctx.rpc.user}:${ctx.rpc.pass}`;
  const cookie = cookiePath(ctx);
  try {
    return readFileSync(cookie, "utf8").trim();
  } catch {
    throw new Error(
      `no RPC auth: set bitcoin.rpc.user/pass in config, or ensure the node cookie exists at ${cookie}`,
    );
  }
}

export async function bitcoinRpc(ctx, method, params = []) {
  const url = ctx.rpc?.url || `http://127.0.0.1:${ctx.rpcPort}`;
  const auth = resolveAuth(ctx);
  const body = JSON.stringify({ jsonrpc: "1.0", id: "bitcode", method, params });
  const headers = {
    "content-type": "text/plain",
    authorization: "Basic " + Buffer.from(auth).toString("base64"),
  };
  let res;
  try {
    res = await httpPost(url, body, { headers, json: true });
  } catch (err) {
    throw new Error(`${err.message} — is bitcoind running with server=1 on ${url}?`);
  }
  if (res && res.error) {
    throw new Error(`RPC ${method}: ${res.error.message || JSON.stringify(res.error)}`);
  }
  return res?.result;
}
