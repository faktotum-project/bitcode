// The agentic loop: call the model, run any requested tools, feed results back,
// repeat until the model returns a final text answer with no tool calls.

import { callModel } from "./providers.mjs";

const MAX_STEPS = 50;

export function systemPrompt({ network = "signet", lightning = false } = {}) {
  return [
    "You are bitcode, a vertical AI agent for Bitcoin running on the user's machine.",
    "You read the chain, the mempool and fees, drive a full Bitcoin Core node, and operate an HD wallet — and you can also do general coding tasks on this machine.",
    `Active Bitcoin network: ${network}. Working directory: ${process.cwd()}.`,
    `OS: ${process.platform}. Date: ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "Bitcoin tools:",
    "- Chain/mempool/fees: btc_fees, btc_mempool, btc_tx, btc_address, btc_block.",
    "- Full node: bitcoin_rpc(method, params) talks to local Bitcoin Core.",
    "- Wallet: wallet_create, wallet_info, wallet_new_address, wallet_descriptor, wallet_send, btc_broadcast.",
    "- Liquid sidechain (read-only, public infra, no wallet): liquid_fees, liquid_mempool, liquid_tx, liquid_address, liquid_block, liquid_asset.",
    "- Lightning: ln_decode_invoice always works (no node needed)." +
      (lightning
        ? " Node connected: ln_info, ln_balance, ln_channels, ln_invoice_create, ln_invoice_pay, and (if tapd configured) taproot_asset_balance, taproot_asset_send."
        : " No Lightning node configured — ln_info/ln_balance/ln_invoice_* etc. are unavailable until config.lightning.lndRestUrl is set."),
    "Coding tools: bash, read_file, write_file, edit_file, list_dir.",
    "",
    "Guidelines:",
    "- Inspect before acting: query the chain/mempool and read files instead of guessing.",
    "- Money is irreversible. Before wallet_send, ln_invoice_pay, taproot_asset_send, or btc_broadcast, state network, destination, amount and fee, and let the user confirm. Never move funds the user did not ask for.",
    "- Default to test networks (signet/testnet). Treat mainnet spends as high-risk.",
    "- Amounts are in satoshis (1 BTC = 100,000,000 sats) or millisatoshis for Lightning. Show both when helpful.",
    "- Not your key, not your BTC: never suggest routing funds or keys through a custodial third party. Prefer self-hosted nodes (see /btc:node-install, /ln:node-install) over trusting a remote service for anything beyond public chain data.",
    "- When the task is done, stop calling tools and give a short, plain summary that shows your work.",
    "- Be concise and direct.",
  ].join("\n");
}

// Drives one turn (one user request) to completion.
//   target  : resolved model from config.resolveModel()
//   messages: canonical message array (mutated in place; carries history)
//   system  : system prompt string
//   hooks   : { onAssistantText, onToolStart, onToolEnd, approve }
// Returns the final assistant text.
export async function runAgent({ target, messages, system, tools, hooks = {} }) {
  const schemas = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  for (let step = 0; step < MAX_STEPS; step++) {
    const { text, toolCalls } = await callModel({
      provider: target.provider,
      model: target.model,
      apiKey: target.apiKey,
      system,
      messages,
      tools: schemas,
      onDelta: hooks.onDelta,
    });

    messages.push({ role: "assistant", content: text || "", toolCalls });
    hooks.onAssistantEnd?.(text);

    if (!toolCalls || toolCalls.length === 0) return text;

    for (const tc of toolCalls) {
      hooks.onToolStart?.(tc);
      const result = await executeTool(tc, tools, hooks);
      hooks.onToolEnd?.(tc, result);
      messages.push({
        role: "tool",
        toolCallId: tc.id,
        name: tc.name,
        content: result,
      });
    }
  }

  return `[stopped: reached ${MAX_STEPS} steps without a final answer]`;
}

async function executeTool(tc, tools, hooks) {
  const tool = tools.find((t) => t.name === tc.name);
  if (!tool) return `ERROR: unknown tool "${tc.name}"`;

  if (tool.mutating && hooks.approve) {
    const ok = await hooks.approve(tc, tool);
    if (!ok) return "Tool call denied by the user.";
  }

  try {
    return String(await tool.run(tc.args || {}));
  } catch (err) {
    return `ERROR: ${err?.message || String(err)}`;
  }
}
