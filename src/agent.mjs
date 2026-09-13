// The agentic loop: call the model, run any requested tools, feed results back,
// repeat until the model returns a final text answer with no tool calls.

import { callModel, isRetryable } from "./providers.mjs";
import { validateArgs, formatResult, isMutating, throwIfAborted, wait, withToolContext } from "./runtime.mjs";

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
    "Coding tools: bash, exec_command/write_stdin/list_processes/terminate_process, read_file (line ranges), write_file, edit_file, list_dir, grep, glob, patch, git_status, git_diff, git_log, web_fetch, update_plan/read_plan, ask_user, list_skills/read_skill. MCP tools, resources and prompts are available when configured. Only call tools present in this request.",
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

// Limits are shared with delegated runs. Mutations form execution barriers:
// reads before a write complete first; later reads observe the write.
export const DEFAULT_LIMITS = {
  maxSteps: MAX_STEPS, maxToolCallsPerTurn: 16, maxTotalToolCalls: 200,
  maxParallelTools: 4, maxResultChars: 50_000,
  toolRetryAttempts: 0, toolRetryDelay: 500,
};

export function agentLimits(config = {}) {
  const a = config.agent || {};
  return Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => {
    const value = a[key] ?? (key === "toolRetryAttempts" ? a.maxRetries : undefined);
    const min = ["maxParallelTools", "maxResultChars"].includes(key) ? 1 : 0;
    return [key, Number.isSafeInteger(value) && value >= min ? value : fallback];
  }));
}

export async function runAgent({ target, messages, system, tools, hooks = {}, limits = DEFAULT_LIMITS, fallbacks = [], signal, state = { totalToolCalls: 0 }, readOnly = false }) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  const available = readOnly ? tools.filter(t => !isMutating(t)) : tools;
  const schemas = available.map(t => ({ name: t.name, description: t.description || t.name, parameters: t.parameters || { type: "object", properties: {} } }));
  const finish = async text => {
    messages.push({ role: "assistant", content: text, toolCalls: [] });
    hooks.onDelta?.(text);
    hooks.onAssistantEnd?.(text);
    await hooks.onCheckpoint?.(messages);
    return text;
  };
  for (let step = 0; step < limits.maxSteps; step++) {
    throwIfAborted(signal);
    const response = await callWithFallback([target, ...fallbacks], { system, messages, tools: schemas, onDelta: hooks.onDelta, signal }, hooks);
    const { text, toolCalls = [], usage, providerState } = response;
    if (toolCalls.some(tc => !tc.id || !tc.name) || new Set(toolCalls.map(tc => tc.id)).size !== toolCalls.length) throw new Error("model returned missing or duplicate tool call IDs");
    messages.push({ role: "assistant", content: text || "", toolCalls, ...(providerState ? { providerState } : {}), ...(usage ? { usage } : {}) });
    hooks.onAssistantEnd?.(text);
    if (usage) hooks.onUsage?.(usage);
    if (!toolCalls.length) { await hooks.onCheckpoint?.(messages); return text; }

    const results = new Array(toolCalls.length);
    const context = { signal, hooks, limits, state, readOnly, target, fallbacks };
    const execute = async (tc, i) => {
      const tool = available.find(t => t.name === tc.name);
      hooks.onToolStart?.(tc);
      let result;
      try {
        throwIfAborted(signal);
        if (i >= limits.maxToolCallsPerTurn || state.totalToolCalls >= limits.maxTotalToolCalls) throw new Error("tool budget exceeded");
        if (!tool) throw new Error(`unknown or unavailable tool "${tc.name}"`);
        validateArgs(tool, tc.args ?? {});
        state.totalToolCalls++;
        if (isMutating(tool) && hooks.approve && !await hooks.approve(tc, tool)) throw new Error("tool call denied by the user");
        throwIfAborted(signal);
        result = await runToolWithRetry(tool, tc, limits, context);
      } catch (err) {
        result = `ERROR: ${signal?.aborted ? "cancelled; inspect state before retrying" : err.message}`;
      }
      results[i] = formatResult(result, limits.maxResultChars);
      hooks.onToolEnd?.(tc, results[i]);
    };
    // Only explicitly read-only tools may overlap. Approval is requested at
    // execution time, after preceding mutations and their results are known.
    let reads = [];
    const flush = async () => { await Promise.all(reads); reads = []; };
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const tool = available.find(t => t.name === tc.name);
      if (isMutating(tool) || tool?.serial) { await flush(); await execute(tc, i); }
      else { reads.push(execute(tc, i)); if (reads.length >= limits.maxParallelTools) await flush(); }
    }
    await flush();
    toolCalls.forEach((tc, i) => messages.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: results[i] }));
    await hooks.onCheckpoint?.(messages);
    throwIfAborted(signal);
    if (state.totalToolCalls >= limits.maxTotalToolCalls) return finish(`[stopped: reached tool budget of ${limits.maxTotalToolCalls}; task may be incomplete]`);
  }
  return finish(`[stopped: reached ${limits.maxSteps} steps without a final answer]`);
}

async function callWithFallback(targets, req, hooks) {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    let streamed = false;
    try {
      return await callModel({ provider: target.provider, model: target.model, apiKey: target.apiKey, ...req,
        onDelta: piece => { streamed = true; req.onDelta?.(piece); } });
    } catch (err) {
      if (req.signal?.aborted || streamed || !isRetryable(err) || i === targets.length - 1) throw err;
      hooks.onFallback?.(target, targets[i + 1], err);
    }
  }
}

async function runToolWithRetry(tool, tc, limits, context) {
  // Never automatically replay side effects: a failed response may have
  // followed a successful payment, write or process launch.
  const retries = !isMutating(tool) && tool.retryable !== false ? limits.toolRetryAttempts : 0;
  for (let a = 0; ; a++) {
    try {
      throwIfAborted(context.signal);
      return await withToolContext(context, () => tool.run(tc.args ?? {}, context));
    } catch (err) {
      if (context.signal?.aborted || a >= retries) throw err;
      await wait(limits.toolRetryDelay * 2 ** a, context.signal);
    }
  }
}
