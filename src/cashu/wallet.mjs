// Cashu wallet — wraps `cdk-cli` as a subprocess, the same pattern
// LND/tapd use for REST (but here it is CLI calls since cdk-cli is a
// terminal tool).  Every call spawns `cdk-cli` with the right flags and
// returns parsed JSON or plain text output.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "deps", "cdk", "bin", "cdk-cli");

function cdkCliPath() {
  if (existsSync(CLI_SRC)) return CLI_SRC;
  return "cdk-cli";
}

function run(ctx, args) {
  const bin = cdkCliPath();
  const cmd = [
    bin,
    "--work-dir", ctx.workDir,
    "--unit", ctx.unit,
    "--non-interactive",
    ...(ctx.proxy ? ["--proxy", ctx.proxy] : []),
    ...args,
  ].join(" ");
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 30_000 });
    return out.trim();
  } catch (err) {
    const stderr = err.stderr?.trim() || "";
    const msg = stderr || err.message || String(err);
    throw new Error(`cdk-cli error: ${msg}`);
  }
}

export function cashuWallet(ctx) {
  return {
    balance: async () => {
      const out = run(ctx, ["balance"]);
      return out;
    },

    mint: async (amount) => {
      const out = run(ctx, ["mint", "--amount", String(amount)]);
      return out;
    },

    melt: async (invoice) => {
      const out = run(ctx, ["melt", invoice]);
      return out;
    },

    send: async (amount, locktimeSec) => {
      const args = ["send", "--amount", String(amount)];
      if (locktimeSec != null) args.push("--locktime", String(locktimeSec));
      const out = run(ctx, args);
      return out;
    },

    receive: async (token) => {
      const out = run(ctx, ["receive", token]);
      return out;
    },

    decodeToken: async (token) => {
      const out = run(ctx, ["decode-token", token]);
      return out;
    },

    mintInfo: async (mintUrl) => {
      const out = run(ctx, ["mint-info", mintUrl || ctx.mintUrl]);
      return out;
    },

    pendingMints: async () => {
      const out = run(ctx, ["mint-pending"]);
      return out;
    },

    checkPending: async () => {
      const out = run(ctx, ["check-pending"]);
      return out;
    },

    listProofs: async () => {
      const out = run(ctx, ["list-mint-proofs"]);
      return out;
    },

    restore: async () => {
      const out = run(ctx, ["restore"]);
      return out;
    },

    burn: async (token) => {
      const out = run(ctx, ["burn", token]);
      return out;
    },

    createRequest: async (amount, description) => {
      const args = ["create-request", "--amount", String(amount)];
      if (description) args.push("--description", description);
      const out = run(ctx, args);
      return out;
    },

    payRequest: async (request) => {
      const out = run(ctx, ["pay-request", request]);
      return out;
    },

    decodeRequest: async (request) => {
      const out = run(ctx, ["decode-request", request]);
      return out;
    },
  };
}
