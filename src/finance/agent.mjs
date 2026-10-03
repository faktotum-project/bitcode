import { financeStatus, prepareBitcoin } from "./bitcoin.mjs";

export function assertFinanceModel(target) {
  if (target.provider?.api !== "openai") throw new Error("finance mode requires a local OpenAI-compatible model endpoint");
  const endpoint = new URL(target.provider.baseURL);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password)
    throw new Error("finance mode requires a loopback HTTP model endpoint");
}

export function financeAgentTools(config, root = process.cwd()) {
  return [
    {
      name: "finance_status", mutating: false,
      description: "Show the explicit Bitcoin testnet policy and proposal statuses; no signing or payment capability.",
      parameters: { type: "object", properties: {} },
      run: () => financeStatus({ root }),
    },
    {
      name: "finance_prepare", mutating: true,
      description: "Prepare an unsigned Bitcoin testnet payment proposal under deterministic limits. Returns a proposal ID for separate human review; cannot sign or broadcast.",
      parameters: { type: "object", properties: {
        to: { type: "string", minLength: 1 },
        amount_sats: { type: "integer", minimum: 1 },
        fee_rate: { type: "number", exclusiveMinimum: 0 },
      }, required: ["to", "amount_sats"], additionalProperties: false },
      run: ({ to, amount_sats, fee_rate }) => prepareBitcoin(config, { to, amountSats: amount_sats, feeRate: fee_rate, root }),
    },
  ];
}
