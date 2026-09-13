// Cashu wallet — wraps `cdk-cli` as a subprocess, the same pattern
// LND/tapd use for REST (but here it is CLI calls since cdk-cli is a
// terminal tool).  Every call spawns `cdk-cli` with the right flags and
// returns parsed JSON or plain text output.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { currentToolSignal } from "../runtime.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const CLI_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "deps", "cdk", "bin", "cdk-cli");

export function cdkCliPath() {
  if (existsSync(CLI_SRC)) return CLI_SRC;
  return "cdk-cli";
}

export async function runCdk(ctx, args) {
  const bin = ctx.cliPath || cdkCliPath();
  const cmd = [
    "--work-dir", ctx.workDir,
    "--unit", ctx.unit,
    "--non-interactive",
    ...(ctx.proxy ? ["--proxy", ctx.proxy] : []),
    ...args,
  ];
  try {
    const { stdout } = await execute(bin, cmd, { encoding: "utf8", timeout: 30_000, signal: currentToolSignal(), maxBuffer: 2 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const stderr = err.stderr?.trim() || "";
    if (args[0] === "mint" && /Timed out.*waiting for.*quote to be paid/i.test(stderr) && /Please pay:/.test(err.stdout || "")) return `Quote created; payment pending. Claim with cashu_mint_pending after paying.\n${err.stdout.trim()}`;
    const msg = [err.stdout?.trim(), stderr || (err.code === "ENOENT" ? "cdk-cli not installed; run npm run build:cdk" : err.message)].filter(Boolean).join("\n");
    throw new Error(`cdk-cli error: ${msg}`);
  }
}

export function cashuWallet(ctx) {
  return {
    balance: async () => {
      const out = await runCdk(ctx, ["balance"]);
      return out;
    },

    mint: async (amount) => {
      const out = await runCdk(ctx, ["mint", "--wait-duration", "1", "--", ctx.mintUrl, String(amount)]);
      return out;
    },

    melt: async (invoice) => {
      const out = await runCdk(ctx, ["melt", "--mint-url", ctx.mintUrl, "--invoice", invoice]);
      return out;
    },

    send: async (amount, locktimeSec) => {
      const args = ["send", "--mint-url", ctx.mintUrl, "--amount", String(amount)];
      if (locktimeSec != null) args.push("--locktime", String(locktimeSec));
      const out = await runCdk(ctx, args);
      return out;
    },

    receive: async (token) => {
      const out = await runCdk(ctx, ["receive", "--", token]);
      return out;
    },

    decodeToken: async (token) => {
      const out = await runCdk(ctx, ["decode-token", "--", token]);
      return out;
    },

    mintInfo: async (mintUrl) => {
      const out = await runCdk(ctx, ["mint-info", "--", mintUrl || ctx.mintUrl]);
      return out;
    },

    pendingMints: async () => {
      const out = await runCdk(ctx, ["mint-pending"]);
      return out;
    },

    checkPending: async () => {
      const out = await runCdk(ctx, ["check-pending"]);
      return out;
    },

    listProofs: async () => {
      const out = await runCdk(ctx, ["list-mint-proofs"]);
      // Proof secrets are bearer material; keep them out of model context.
      return out.split("\n").map(line => { const cols = line.split("|"); if (cols.length >= 6 && /^\s*\d+\s*$/.test(cols[1])) cols[4] = " [redacted] "; return cols.join("|"); }).join("\n");
    },

    restore: async () => {
      const out = await runCdk(ctx, ["restore", "--", ctx.mintUrl]);
      return out;
    },

    burn: async (token) => {
      const out = await runCdk(ctx, ["burn", token]);
      return out;
    },

    createRequest: async (amount, description) => {
      const args = ["create-request", "--amount", String(amount), "--transport", "none", "--mints", ctx.mintUrl];
      if (description) args.push("--", description);
      const out = await runCdk(ctx, args);
      return out;
    },

    payRequest: async (request) => {
      const out = await runCdk(ctx, ["pay-request", "--", request]);
      return out;
    },

    decodeRequest: async (request) => {
      const out = await runCdk(ctx, ["decode-request", "--", request]);
      return out;
    },
  };
}
