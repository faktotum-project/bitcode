// The agentic loop: call the model, run any requested tools, feed results back,
// repeat until the model returns a final text answer with no tool calls.

import { callModel, isRetryable } from "./providers.mjs";
import { validateArgs, formatResult, isMutating, throwIfAborted, wait, withToolContext } from "./runtime.mjs";
import { createRunContext, observe, toolSummary } from "./runtime/events.mjs";

const MAX_STEPS = 50;

export function systemPrompt({ profile = "code", network = "signet", lightning = false, project } = {}) {
  if (profile === "rgb") return rgbSystemPrompt();
  const coding = [
    "You are bitcode, a careful coding agent running on the user's machine.",
    `Working directory: ${project?.root || process.cwd()}. OS: ${process.platform}. Date: ${new Date().toISOString().slice(0, 10)}.`,
    project?.commands?.length ? `Project command suggestions (inspect before using; they are not automatic): ${project.commands.map(x => x.command).join(", ")}.` : "No project test, lint, or build commands were detected.",
    "Tools are capability-scoped. Only call tools present in this request.",
    "Guidelines:",
    "- Inspect relevant files and existing conventions before changing anything.",
    "- Keep changes small and focused; do not rewrite unrelated code.",
    "- Verify work with a relevant command when practical, and report its actual output/result.",
    "- At completion, summarize changed files, verification run, and any remaining limitation.",
    "- Be concise and direct.",
    "- For blockchain/address intelligence, use available data tools before reporting findings. If this coding profile lacks them, explain that /profile bitcoin enables blockchain tools; do not fabricate balances, attribution, risk scores, official classifications or investigative findings.",
    `- Active Bitcoin network: ${network}. Confirm an address belongs to this network before queries; do not silently switch networks. A mainnet address cannot be investigated on signet.`,
  ];
  if (profile !== "bitcoin") return coding.join("\n");
  return [
    ...coding,
    "",
    "Bitcoin profile additions:",
    `Active Bitcoin network: ${network}.`,
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
    "",
    "Bitcoin safety rules:",
    "- Inspect before acting: query the chain/mempool and read files instead of guessing.",
    "- Money is irreversible. Before wallet_send, ln_invoice_pay, taproot_asset_send, cashu_melt, cashu_send, cashu_pay_request, or btc_broadcast, state network, destination, amount and fee, and let the user confirm. Never move funds the user did not ask for.",
    "- Default to test networks (signet/testnet). Treat mainnet spends as high-risk.",
    "- Amounts are in satoshis (1 BTC = 100,000,000 sats) or millisatoshis for Lightning. Show both when helpful.",
    "- Not your key, not your BTC: never suggest routing funds or keys through a custodial third party. Prefer self-hosted nodes (see /btc:node-install, /ln:node-install) over trusting a remote service for anything beyond public chain data.",
  ].join("\n");
}

// Kept short: the RGB profile is meant to run on a small on-device model.
function rgbSystemPrompt() {
  return [
    "You are bitcode's RGB wallet assistant. You operate one RGB Lightning Node on Bitcoin signet (test network, test funds only) through the tools in this request.",
    `Date: ${new Date().toISOString().slice(0, 10)}. Reply in the user's language, briefly.`,
    "Rules:",
    "- Every balance, address, asset ID, invoice and status you mention must come from a tool result in this conversation. Never invent or estimate them.",
    "- The node's on-chain address comes from mcp_kaleido_rln_get_address; balances from mcp_kaleido_rln_get_balances and mcp_kaleido_rln_list_assets.",
    "- Identify RGB assets by their full asset ID (rgb:...), taken from mcp_kaleido_rln_list_assets. A ticker like USDT is not an identifier.",
    "- Asset balances are raw base units; quote amounts only from balance_display, which is already converted. Never convert them yourself. Send amounts are in the same display units.",
    "- To receive an RGB asset, create an invoice with mcp_kaleido_rln_create_rgb_invoice and show it in full. For any asset and any amount, leave asset_id and amount out of the arguments entirely (never pass 0 or an empty string).",
    "- Do only what the user asked. Never issue an asset (mcp_kaleido_rln_issue_asset) unless the user explicitly asks to issue or create a new token.",
    "- If a tool call is denied or fails, stop and tell the user what happened. Do not try other tools to reach the same goal.",
    "- To send, call mcp_kaleido_rln_list_assets first, then mcp_kaleido_rln_send_asset with the full asset ID, the amount in display units, and the receiver's complete invoice string (rgb:...) copied unchanged as recipient_id. The user approves every spend in a separate confirmation; never claim funds moved until a tool result says so.",
    "- A successful send means the transfer was broadcast, not confirmed. Say it is pending; it is complete only when mcp_kaleido_rln_list_transfers shows it settled.",
    "- If receiving or issuing fails for lack of colorable UTXOs, say that mcp_kaleido_rln_create_utxos is needed; do not call it unasked.",
    "- Never ask for or reveal mnemonics, passwords or keys.",
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

export async function runAgent({ target, messages, system, tools, hooks = {}, limits = DEFAULT_LIMITS, fallbacks = [], signal, state = { totalToolCalls: 0 }, readOnly = false, context, callModelImpl = callModel }) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  signal ??= context?.signal;
  context = createRunContext({ ...context, signal });
  // Read-only investigations cannot delegate or create invoices, even when a
  // legacy adapter labels such operations as non-mutating.
  const available = readOnly ? tools.filter(t => !isMutating(t) && !["subagent", "ln_invoice_create"].includes(t.name)) : tools;
  const schemas = available.map(t => ({ name: t.name, description: t.description || t.name, parameters: t.parameters || { type: "object", properties: {} } }));
  const started = performance.now();
  let outcome = "error";
  context.bus?.enter(context);
  observe(context, "run.started", { model: target.spec || target.model });
  try {
    const finish = async text => {
      messages.push({ role: "assistant", content: text, toolCalls: [] });
      hooks.onDelta?.(text);
      hooks.onAssistantEnd?.(text);
      await hooks.onCheckpoint?.(messages);
      await hooks.onTurnEnd?.();
      return text;
    };
    for (let step = 0; step < limits.maxSteps; step++) {
      throwIfAborted(signal);
      observe(context, "model.started");
      const response = await callWithFallback([target, ...fallbacks], { system, messages, tools: schemas, onDelta: hooks.onDelta, signal }, hooks, callModelImpl);
      throwIfAborted(signal);
      observe(context, "model.finished");
      const { text, toolCalls = [], usage, providerState } = response;
      if (toolCalls.some(tc => !tc.id || !tc.name) || new Set(toolCalls.map(tc => tc.id)).size !== toolCalls.length) throw new Error("model returned missing or duplicate tool call IDs");
      messages.push({ role: "assistant", content: text || "", toolCalls: response.incomplete ? [] : toolCalls, ...(response.incomplete ? { incomplete: response.incomplete } : {}), ...(providerState ? { providerState } : {}), ...(usage ? { usage } : {}) });
      hooks.onAssistantEnd?.(text);
      if (usage) hooks.onUsage?.(usage);
      if (response.incomplete) {
        outcome = 'error';
        const notice = `[stopped: model output/context limit reached; response is incomplete, partial text retained, no tools from this turn executed. ${response.completionHint || 'Reduce context or increase the configured output budget.'}]`;
        await finish(notice);
        return notice + (text ? `\n\n${text}` : '');
      }
      if (!toolCalls.length) { await hooks.onCheckpoint?.(messages); await hooks.onTurnEnd?.(); outcome = "ok"; return text; }

      const results = new Array(toolCalls.length);
      const execution = { signal, hooks, limits, state, readOnly, target, fallbacks, context, approve: hooks.approve, callModelImpl };
      const execute = async (tc, i) => {
        const tool = available.find(t => t.name === tc.name);
        const publicTool = { ...toolSummary(tc, context.cwd), toolCallId: tc.id };
        const toolStarted = performance.now();
        let toolOutcome = tool ? "error" : "unknown_tool";
        observe(context, "tool.requested", publicTool);
        hooks.onToolStart?.(tc);
        let result;
        try {
          throwIfAborted(signal);
          if (i >= limits.maxToolCallsPerTurn || state.totalToolCalls >= limits.maxTotalToolCalls) throw new Error("tool budget exceeded");
          // Keep financial requests fail-closed even when a coding profile does
          // not expose the wallet tool at all. This avoids turning an accidental
          // payment request into a capability-discovery oracle.
          if (!tool && /^(wallet_send|btc_broadcast|bitcoin_rpc|ln_invoice_pay|taproot_asset_send|cashu_(melt|send|pay_request)|cj_wallet_drain)$/.test(tc.name)) throw new Error("tool call denied by the user");
          if (!tool) throw new Error(`unknown or unavailable tool "${tc.name}"`);
          validateArgs(tool, tc.args ?? {});
          state.totalToolCalls++;
          if (isMutating(tool) && hooks.approve) {
            observe(context, "approval.requested", publicTool);
            let approved = false;
            try { approved = await awaitApproval(() => hooks.approve(tc, tool, { signal }), signal) === true; }
            catch (err) { if (signal?.aborted) throw err; }
            observe(context, "approval.resolved", { ...publicTool, outcome: approved ? "approved" : "denied" });
            if (!approved) { toolOutcome = "denied"; throw new Error("tool call denied by the user"); }
          }
          if (isMutating(tool)) await hooks.onMutation?.(tc, tool);
          throwIfAborted(signal);
          observe(context, "tool.started", publicTool);
          result = await runToolWithRetry(tool, tc, limits, execution);
          toolOutcome = typeof result === "string" && result.startsWith("ERROR") ? "error" : "ok";
        } catch (err) {
          if (signal?.aborted) toolOutcome = "cancelled";
          result = `ERROR: ${signal?.aborted ? "cancelled; inspect state before retrying" : err.message}`;
        }
        results[i] = formatResult(result, limits.maxResultChars);
        observe(context, "tool.finished", { ...publicTool, outcome: toolOutcome, durationMs: performance.now() - toolStarted });
        await hooks.onToolEnd?.(tc, results[i], { outcome: toolOutcome, text: results[i] });
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
      if (state.totalToolCalls >= limits.maxTotalToolCalls) { outcome = "max_steps"; return await finish(`[stopped: reached tool budget of ${limits.maxTotalToolCalls}; task may be incomplete]`); }
    }
    outcome = "max_steps";
    return await finish(`[stopped: reached ${limits.maxSteps} steps without a final answer]`);
  } catch (err) {
    outcome = "error";
    throw err;
  } finally {
    observe(context, "run.finished", { outcome: signal?.aborted ? "cancelled" : outcome, durationMs: performance.now() - started });
    context.bus?.leave(context);
  }
}

async function callWithFallback(targets, req, hooks, callModelImpl) {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    let streamed = false;
    try {
      return await callModelImpl({ provider: target.provider, model: target.model, apiKey: target.apiKey, ...req,
        onDelta: piece => { streamed = true; req.onDelta?.(piece); } });
    } catch (err) {
      if (req.signal?.aborted || streamed || !isRetryable(err) || i === targets.length - 1) throw err;
      hooks.onFallback?.(target, targets[i + 1], err);
    }
  }
}

async function awaitApproval(approve, signal) {
  throwIfAborted(signal);
  if (!signal) return approve();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(approve), cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
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
