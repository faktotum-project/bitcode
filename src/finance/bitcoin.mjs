import { wallet } from "../bitcoin/wallet.mjs";
import { esplora } from "../bitcoin/esplora.mjs";
import { resolveNetwork } from "../bitcoin/network.mjs";
import { assertProposal, checkPolicy, openFinanceStore, proposalId, validatePolicy } from "./store.mjs";

function networkContext(config) {
  const ctx = resolveNetwork(config);
  if (!["signet", "testnet", "testnet4"].includes(ctx.name)) throw new Error("Phase 1 financial execution is limited to Bitcoin test networks");
  const endpoint = new URL(ctx.esploraUrl);
  if (!config.bitcoin?.esploraUrl || !["127.0.0.1", "[::1]"].includes(endpoint.hostname) || endpoint.protocol !== "http:" || endpoint.username || endpoint.password)
    throw new Error("finance requires an explicitly configured local HTTP Esplora endpoint");
  return ctx;
}

function event(state, type, id, detail = {}) {
  state.events ||= [];
  state.events.push({ at: new Date().toISOString(), type, id, ...detail });
}

export function setFinancePolicy(input, { root = process.cwd() } = {}) {
  const policy = validatePolicy(input);
  const store = openFinanceStore(root);
  return store.update(state => {
    if (state.proposals.some(p => ["executing", "unknown"].includes(p.status))) throw new Error("reconcile executing or unknown payments before changing policy");
    state.policy = policy;
    state.policyVersion++;
    for (const p of state.proposals) if (p.status === "prepared") p.status = "rejected";
    event(state, "policy_changed", null, { version: state.policyVersion });
    return { policy, version: state.policyVersion };
  });
}

export function financeStatus({ root = process.cwd() } = {}) {
  const state = openFinanceStore(root).read();
  return { policy: state.policy, policyVersion: state.policyVersion, proposals: state.proposals.map(({ psbt, ...p }) => p) };
}

export async function prepareBitcoin(config, { to, amountSats, feeRate, root = process.cwd(), now = new Date(), walletImpl, apiImpl } = {}) {
  const ctx = networkContext(config);
  const store = openFinanceStore(root);
  const state = store.read();
  if (!state.policy) throw new Error("set an explicit financial policy first");
  const amount = Number(amountSats);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amountSats must be a positive safe integer");
  if (amount > state.policy.maxPaymentSats) throw new Error("payment exceeds per-payment limit");
  const api = apiImpl || esplora(ctx.esploraUrl);
  const w = walletImpl || wallet(ctx);
  const rate = feeRate == null ? Number((await api.feesRecommended()).halfHourFee) : Number(feeRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new Error("invalid fee rate");
  const built = await w.createPsbt({ to, amountSats: amount, feeRate: rate });
  if (!Array.isArray(built.outpoints) || !built.outpoints.length || built.outpoints.some(x => typeof x !== "string" || !/^[a-f0-9]{64}:[0-9]+$/.test(x))) throw new Error("wallet did not identify the unsigned transaction inputs");
  const balance = await w.balance({ gap: 20 });
  const proposal = {
    network: ctx.name, wallet: w.file, to: built.to, amountSats: built.amountSats,
    feeSats: built.feeSats, feeRate: built.feeRate, balanceSats: balance.sats,
    outpoints: built.outpoints,
    psbt: built.psbt, policyVersion: state.policyVersion,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), status: "prepared",
  };
  proposal.id = proposalId(proposal);
  return store.update(current => {
    if (!current.policy || current.policyVersion !== proposal.policyVersion) throw new Error("policy changed during preparation");
    for (const p of current.proposals) if (p.status === "prepared" && new Date(p.expiresAt) <= now) { p.status = "rejected"; event(current, "expired", p.id); }
    if (current.proposals.some(p => p.id === proposal.id)) throw new Error("identical proposal already exists");
    const used = new Set(current.proposals.filter(p => ["prepared", "executing", "submitted", "unknown"].includes(p.status)).flatMap(p => p.outpoints || []));
    if (proposal.outpoints.some(outpoint => used.has(outpoint))) throw new Error("transaction inputs are already reserved by another proposal");
    checkPolicy(current.policy, proposal, current, now);
    current.proposals.push(proposal);
    event(current, "prepared", proposal.id, { network: ctx.name, amountSats: amount });
    const { psbt, ...publicProposal } = proposal;
    return publicProposal;
  });
}

export async function executeBitcoin(config, id, { approve, root = process.cwd(), walletImpl, apiImpl, now = new Date() } = {}) {
  const ctx = networkContext(config);
  if (typeof approve !== "function") throw new Error("trusted human approval callback required");
  const store = openFinanceStore(root);
  const initial = assertProposal(store.read(), id);
  if (initial.network !== ctx.name) throw new Error("proposal network mismatch");
  if (new Date(initial.expiresAt) <= now) throw new Error("proposal expired");
  if (!await approve({ ...initial, psbt: undefined })) return { status: "rejected_by_user", id };
  const w = walletImpl || wallet(ctx);
  const balance = await w.balance({ gap: 20 });
  const available = new Set((await w.listUtxos({ gap: 20 })).map(u => `${u.txid}:${u.vout}`));
  const prepared = store.update(state => {
    const p = assertProposal(state, id);
    if (p.network !== ctx.name || p.wallet !== w.file || p.policyVersion !== state.policyVersion || new Date(p.expiresAt) <= now) throw new Error("proposal changed, expired or policy changed");
    if (p.outpoints.some(outpoint => !available.has(outpoint))) throw new Error("proposal input was spent or is no longer available");
    checkPolicy(state.policy, { ...p, balanceSats: balance.sats }, { ...state, proposals: state.proposals.filter(x => x.id !== id) }, now);
    p.status = "executing";
    event(state, "approved", id, { policyVersion: p.policyVersion });
    return { ...p };
  });
  let signed;
  try {
    signed = await w.signPsbt({ psbt: prepared.psbt, broadcast: false });
    store.update(state => {
      const p = assertProposal(state, id, "executing");
      p.txid = signed.txid;
      event(state, "signed", id, { txid: signed.txid });
    });
  } catch (err) {
    store.update(state => { const p = assertProposal(state, id, "executing"); p.status = "rejected"; event(state, "sign_failed", id); });
    throw err;
  }
  const api = apiImpl || esplora(ctx.esploraUrl);
  try {
    const broadcastTxid = String(await api.broadcast(signed.hex)).trim();
    if (broadcastTxid !== signed.txid) throw new Error("broadcast returned a different txid");
    store.update(state => { const p = assertProposal(state, id, "executing"); p.status = "submitted"; event(state, "submitted", id, { txid: signed.txid }); });
    return { status: "submitted", id, txid: signed.txid };
  } catch (err) {
    store.update(state => { const p = assertProposal(state, id, "executing"); p.status = "unknown"; event(state, "broadcast_unknown", id, { txid: signed.txid }); });
    throw new Error(`broadcast outcome unknown for ${signed.txid}; reconcile before any new payment (${err.message})`);
  }
}

export async function reconcileBitcoin(config, id, { root = process.cwd(), apiImpl } = {}) {
  const ctx = networkContext(config);
  const store = openFinanceStore(root);
  const p = store.read().proposals.find(x => x.id === id);
  if (!p || !["submitted", "unknown", "executing"].includes(p.status) || !p.txid) throw new Error("proposal has no transaction to reconcile");
  if (p.network !== ctx.name) throw new Error("proposal network mismatch");
  const api = apiImpl || esplora(ctx.esploraUrl);
  const tx = await api.tx(p.txid);
  if (tx.txid !== p.txid || !Array.isArray(tx.vout) || !tx.vout.some(output => output.scriptpubkey_address === p.to && output.value === p.amountSats) || !Number.isSafeInteger(tx.fee) || tx.fee > p.feeSats)
    throw new Error("chain transaction does not match the approved proposal");
  return store.update(state => {
    const current = state.proposals.find(x => x.id === id);
    if (!current || current.txid !== p.txid) throw new Error("proposal changed during reconciliation");
    current.status = tx.status?.confirmed ? "confirmed" : "submitted";
    event(state, "reconciled", id, { txid: p.txid, status: current.status });
    return { id, txid: p.txid, status: current.status };
  });
}

export function recoverBitcoinOperation(id, { root = process.cwd() } = {}) {
  const store = openFinanceStore(root);
  return store.update(state => {
    const p = assertProposal(state, id, "executing");
    p.status = p.txid ? "unknown" : "rejected";
    event(state, "recovered_after_interruption", id, { status: p.status, ...(p.txid ? { txid: p.txid } : {}) });
    return { id, status: p.status, txid: p.txid || null };
  });
}
