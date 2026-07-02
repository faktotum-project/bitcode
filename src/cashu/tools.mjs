// Cashu agent tools — wallet and mint operations through cdk-cli / cdk-mintd.
//
// These are registered similarly to lightning tools: always available when
// a mint URL is configured (defaults to testnet if missing).
import { resolveCashuNetwork } from "./network.mjs";
import { cashuWallet } from "./wallet.mjs";
import { cashuMint } from "./mint.mjs";

export function cashuTools(config) {
  const ctx = resolveCashuNetwork(config);
  const w = cashuWallet(ctx);
  const m = cashuMint(ctx);

  return [
    {
      name: "cashu_balance",
      mutating: false,
      description: "Show the Cashu wallet balance for the active mint.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const b = await w.balance();
        return `mint ${ctx.mintUrl} (${ctx.name})\n${b}`;
      },
    },
    {
      name: "cashu_mint",
      mutating: true,
      description: "Mint (receive) ecash tokens by paying a BOLT11 Lightning invoice. amount in sats. Returns a quote; pay the invoice to finalise, then run cashu_mint_pending.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number", description: "Amount in satoshis to mint." } },
        required: ["amount"],
      },
      run: async ({ amount }) => {
        const r = await w.mint(amount);
        return `mint quote for ${amount} sats at ${ctx.mintUrl}\n${r}`;
      },
    },
    {
      name: "cashu_mint_pending",
      mutating: true,
      description: "Claim any pending mint quotes that have been paid (run after paying the BOLT11 invoice from a cashu_mint quote).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = await w.pendingMints();
        return r || "no pending mints to claim";
      },
    },
    {
      name: "cashu_melt",
      mutating: true,
      description: "Pay a BOLT11 Lightning invoice by melting (spending) ecash tokens from the wallet. Irreversible — confirm amount and destination first.",
      parameters: {
        type: "object",
        properties: { invoice: { type: "string", description: "BOLT11 Lightning invoice to pay." } },
        required: ["invoice"],
      },
      run: async ({ invoice }) => {
        const r = await w.melt(invoice);
        return `melt result at ${ctx.mintUrl}\n${r}`;
      },
    },
    {
      name: "cashu_send",
      mutating: true,
      description: "Send ecash tokens as a token string (to be transferred out-of-band to the recipient). Amount in sats. Optional locktime_seconds locks the token until that many seconds from now.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in satoshis to send." },
          locktime_seconds: { type: "number", description: "Optional locktime in seconds from now." },
        },
        required: ["amount"],
      },
      run: async ({ amount, locktime_seconds }) => {
        const r = await w.send(amount, locktime_seconds);
        return `send ${amount} sats from ${ctx.mintUrl}\n${r}`;
      },
    },
    {
      name: "cashu_receive",
      mutating: true,
      description: "Receive ecash tokens into the wallet (token string from cashu_send or another Cashu wallet).",
      parameters: {
        type: "object",
        properties: { token: { type: "string", description: "The ecash token string (cashuA...)." } },
        required: ["token"],
      },
      run: async ({ token }) => {
        const r = await w.receive(token);
        return `receive result\n${r}`;
      },
    },
    {
      name: "cashu_decode_token",
      mutating: false,
      description: "Decode an ecash token to inspect its contents (amounts, mint URLs, proofs) without receiving it.",
      parameters: {
        type: "object",
        properties: { token: { type: "string", description: "The ecash token string (cashuA...)." } },
        required: ["token"],
      },
      run: async ({ token }) => {
        const r = await w.decodeToken(token);
        return r;
      },
    },
    {
      name: "cashu_mint_info",
      mutating: false,
      description: "Get public info from a Cashu mint: supported NUTs, contact info, fee schedule.",
      parameters: {
        type: "object",
        properties: { mint_url: { type: "string", description: "Mint URL (defaults to the configured mint)." } },
      },
      run: async ({ mint_url }) => {
        const r = await w.mintInfo(mint_url);
        return r;
      },
    },
    {
      name: "cashu_restore",
      mutating: false,
      description: "Restore proofs from seed by scanning the mint for unspent proofs.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = await w.restore();
        return r;
      },
    },
    {
      name: "cashu_list_proofs",
      mutating: false,
      description: "List all proofs (unspent ecash tokens) the wallet knows about across all mints.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = await w.listProofs();
        return r || "no proofs stored";
      },
    },
    {
      name: "cashu_create_request",
      mutating: true,
      description: "Create a payment request (NUT-18) that others can pay via cashu_pay_request. Returns a request string.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in satoshis." },
          description: { type: "string", description: "Optional description." },
        },
        required: ["amount"],
      },
      run: async ({ amount, description }) => {
        const r = await w.createRequest(amount, description);
        return `payment request for ${amount} sats\n${r}`;
      },
    },
    {
      name: "cashu_pay_request",
      mutating: true,
      description: "Pay a payment request (NUT-18) using ecash tokens from the wallet.",
      parameters: {
        type: "object",
        properties: { request: { type: "string", description: "The payment request string." } },
        required: ["request"],
      },
      run: async ({ request }) => {
        const r = await w.payRequest(request);
        return r;
      },
    },
    {
      name: "cashu_decode_request",
      mutating: false,
      description: "Decode a payment request (NUT-18) without paying it.",
      parameters: {
        type: "object",
        properties: { request: { type: "string", description: "The payment request string." } },
        required: ["request"],
      },
      run: async ({ request }) => {
        const r = await w.decodeRequest(request);
        return r;
      },
    },
    {
      name: "cashu_mintd_start",
      mutating: true,
      description: "Start a local Cashu mint daemon (cdk-mintd) for development/regtest. Requires a built cdk-mintd binary (run scripts/build-cdk.sh first).",
      parameters: {
        type: "object",
        properties: {
          config: { type: "string", description: "Path to a mint config file." },
          seed_file: { type: "string", description: "Path to a seed phrase file." },
        },
      },
      run: async ({ config, seed_file }) => {
        const r = m.start({ config, seedFile: seed_file });
        return `local mint at ${ctx.mintUrl}\nstatus ${r.status}${r.pid ? ` · pid ${r.pid}` : ""}`;
      },
    },
    {
      name: "cashu_mintd_stop",
      mutating: true,
      description: "Stop the local Cashu mint daemon.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = m.stop();
        return `mintd ${r.status}`;
      },
    },
    {
      name: "cashu_mintd_status",
      mutating: false,
      description: "Check whether the local Cashu mint daemon is running.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = m.status();
        return `mintd ${r.status}${r.pid ? ` · pid ${r.pid}` : ""} · work-dir ${r.workDir}`;
      },
    },
  ];
}
