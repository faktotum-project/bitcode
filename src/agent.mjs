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
    "- Wavelength (Lightning Labs' self-custodial Bitcoin/Lightning/Ark wallet, no node needed; registered only when config.wavelength is set): wl_info, wl_balance.",
    "Cashu ecash tools:",
    "- Wallet: cashu_balance, cashu_mint, cashu_melt, cashu_send, cashu_receive, cashu_decode_token, cashu_list_proofs.",
    "- Mint: cashu_mint_info, cashu_mintd_start, cashu_mintd_stop, cashu_mintd_status.",
    "- Payment requests (NUT-18): cashu_create_request, cashu_pay_request, cashu_decode_request.",
    "Coding tools: bash, read_file, write_file, edit_file, list_dir, grep (regex content search), glob (find files by pattern), patch (apply a unified diff).",
    "",
    "Guidelines:",
    "- Inspect before acting: query the chain/mempool and read files instead of guessing.",
    "- Money is irreversible. Before wallet_send, ln_invoice_pay, taproot_asset_send, cashu_melt, cashu_send, cashu_pay_request, or btc_broadcast, state network, destination, amount and fee, and let the user confirm. Never move funds the user did not ask for.",
    "- Default to test networks (signet/testnet). Treat mainnet spends as high-risk.",
    "- Amounts are in satoshis (1 BTC = 100,000,000 sats) or millisatoshis for Lightning. Show both when helpful.",
    "- Not your key, not your BTC: never suggest routing funds or keys through a custodial third party. Prefer self-hosted nodes (see /btc:node-install, /ln:node-install) over trusting a remote service for anything beyond public chain data.",
    "- When the task is done, stop calling tools and give a short, plain summary that shows your work.",
    "- Be concise and direct.",
  ].join("\n");
}

// Per-run limits. Defaults preserve historical behaviour (50 steps, unbounded
// tool calls, no retries). Override via config.agent.* → agentLimits().
export const DEFAULT_LIMITS = {
  maxSteps: MAX_STEPS,
  maxToolCallsPerTurn: Infinity,
  maxTotalToolCalls: Infinity,
  toolRetryAttempts: 0,
  toolRetryDelay: 500,
};

export function agentLimits(config = {}) {
  const a = config.agent || {};
  const pick = (v, d) => (typeof v === "number" && v >= 0 ? v : d);
  return {
    maxSteps: pick(a.maxSteps, DEFAULT_LIMITS.maxSteps),
    maxToolCallsPerTurn: pick(a.maxToolCallsPerTurn, DEFAULT_LIMITS.maxToolCallsPerTurn),
    maxTotalToolCalls: pick(a.maxTotalToolCalls, DEFAULT_LIMITS.maxTotalToolCalls),
    toolRetryAttempts: pick(a.toolRetryAttempts, DEFAULT_LIMITS.toolRetryAttempts),
    toolRetryDelay: pick(a.toolRetryDelay, DEFAULT_LIMITS.toolRetryDelay),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Drives one turn (one user request) to completion.
//   target  : resolved model from config.resolveModel()
//   messages: canonical message array (mutated in place; carries history)
//   system  : system prompt string
//   hooks   : { onDelta, onAssistantEnd, onToolStart, onToolEnd, approve }
//   limits  : from agentLimits(config)
//   fallbacks: optional [target, …] tried in order if the model call fails
// Returns the final assistant text.
export async function runAgent({ target, messages, system, tools, hooks = {}, limits = DEFAULT_LIMITS, fallbacks = [] }) {
  const schemas = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  let totalToolCalls = 0;

  for (let step = 0; step < limits.maxSteps; step++) {
    const { text, toolCalls } = await callWithFallback(
      [target, ...fallbacks],
      { system, messages, tools: schemas, onDelta: hooks.onDelta },
      hooks,
    );

    messages.push({ role: "assistant", content: text || "", toolCalls });
    hooks.onAssistantEnd?.(text);

    if (!toolCalls || toolCalls.length === 0) return text;

    // Phase 1 — resolve each call: budget check, then interactive approval
    // (sequential, so two prompts never race for stdin).
    const decisions = [];
    for (let k = 0; k < toolCalls.length; k++) {
      const tc = toolCalls[k];
      const overBudget = k >= limits.maxToolCallsPerTurn || totalToolCalls >= limits.maxTotalToolCalls;
      const tool = overBudget ? null : tools.find((t) => t.name === tc.name);
      let approved = true;
      if (!overBudget) {
        totalToolCalls++;
        if (tool?.mutating && hooks.approve) approved = await hooks.approve(tc, tool);
      }
      decisions.push({ tc, tool, approved, overBudget });
    }

    // Phase 2 — announce all (ordered), so the reasoning log stays readable.
    for (const d of decisions) hooks.onToolStart?.(d.tc);

    // Phase 3 — run independent calls concurrently.
    const results = await Promise.all(
      decisions.map((d) => {
        if (d.overBudget) return Promise.resolve("ERROR: tool budget exceeded for this turn");
        if (!d.approved) return Promise.resolve("Tool call denied by the user.");
        return runToolWithRetry(d.tool, d.tc, limits);
      }),
    );

    // Phase 4 — report + append results in original order (tool_result must
    // pair with each tool_use the model emitted).
    decisions.forEach((d, i) => {
      hooks.onToolEnd?.(d.tc, results[i]);
      messages.push({ role: "tool", toolCallId: d.tc.id, name: d.tc.name, content: results[i] });
    });
  }

  return `[stopped: reached ${limits.maxSteps} steps without a final answer]`;
}

// Try each target in turn; the first that returns wins. A failure falls through
// to the next (e.g. cloud provider down → local model). Throws the last error
// if every target fails.
async function callWithFallback(targets, req, hooks) {
  let lastErr;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    try {
      return await callModel({
        provider: target.provider,
        model: target.model,
        apiKey: target.apiKey,
        ...req,
      });
    } catch (err) {
      lastErr = err;
      if (i < targets.length - 1) hooks.onFallback?.(target, targets[i + 1], err);
    }
  }
  throw lastErr;
}

async function runToolWithRetry(tool, tc, limits) {
  if (!tool) return `ERROR: unknown tool "${tc.name}"`;
  const attempts = Math.max(0, Number(limits.toolRetryAttempts) || 0);
  let lastErr;
  for (let a = 0; a <= attempts; a++) {
    try {
      return String(await tool.run(tc.args || {}));
    } catch (err) {
      lastErr = err;
      if (a < attempts) await sleep(limits.toolRetryDelay * Math.pow(2, a));
    }
  }
  return `ERROR: ${lastErr?.message || String(lastErr)}`;
}
