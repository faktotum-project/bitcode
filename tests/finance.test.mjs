import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { executeBitcoin, financeStatus, prepareBitcoin, reconcileBitcoin, recoverBitcoinOperation, setFinancePolicy } from "../src/finance/bitcoin.mjs";
import { openFinanceStore, proposalId } from "../src/finance/store.mjs";
import { assertFinanceModel, financeAgentTools } from "../src/finance/agent.mjs";

function setup(t) {
  const base = mkdtempSync(path.join(tmpdir(), "bitcode-finance-"));
  const old = process.env.BITCODE_HOME;
  process.env.BITCODE_HOME = path.join(base, "home");
  const root = path.join(base, "project");
  mkdirSync(root);
  t.after(() => { if (old === undefined) delete process.env.BITCODE_HOME; else process.env.BITCODE_HOME = old; rmSync(base, { recursive: true, force: true }); });
  const config = { bitcoin: { network: "signet", esploraUrl: "http://127.0.0.1:3000/api" } };
  const calls = { sign: 0, broadcast: 0 };
  const outpoint = to => `${createHash("sha256").update(to).digest("hex")}:0`;
  const walletImpl = {
    file: path.join(base, "wallet.signet.json"),
    createPsbt: async ({ to, amountSats, feeRate }) => ({ to, amountSats, feeRate, feeSats: 500, outpoints: [outpoint(to)], psbt: "unsigned-psbt" }),
    balance: async () => ({ sats: 100_000 }),
    listUtxos: async () => ["tb1test", "tb1first", "tb1second", "tb1fee"].map(to => ({ txid: outpoint(to).split(":")[0], vout: 0 })),
    signPsbt: async () => { calls.sign++; return { txid: "a".repeat(64), hex: "deadbeef" }; },
  };
  const apiImpl = {
    broadcast: async () => { calls.broadcast++; return "a".repeat(64); },
    tx: async () => ({ txid: "a".repeat(64), vout: [{ scriptpubkey_address: "tb1test", value: 10_000 }], fee: 500, status: { confirmed: true } }),
  };
  const policy = { maxPaymentSats: 20_000, dailyLimitSats: 30_000, maxFeeSats: 1_000, minReserveSats: 40_000 };
  setFinancePolicy(policy, { root });
  return { root, config, calls, walletImpl, apiImpl, policy };
}

test("proposal is reviewed, consumed once, and reconciled without exposing PSBT", async t => {
  const x = setup(t);
  const proposal = await prepareBitcoin(x.config, { root: x.root, walletImpl: x.walletImpl, apiImpl: x.apiImpl, to: "tb1test", amountSats: 10_000, feeRate: 2 });
  assert.equal(proposal.psbt, undefined);
  assert.equal(proposal.status, "prepared");
  assert.equal(financeStatus({ root: x.root }).proposals[0].psbt, undefined);
  let reviewed;
  const result = await executeBitcoin(x.config, proposal.id, { ...x, approve: p => { reviewed = p; return true; } });
  assert.equal(reviewed.id, proposal.id);
  assert.equal(result.status, "submitted");
  assert.deepEqual(x.calls, { sign: 1, broadcast: 1 });
  await assert.rejects(executeBitcoin(x.config, proposal.id, { ...x, approve: () => true }), /submitted/);
  assert.equal((await reconcileBitcoin(x.config, proposal.id, x)).status, "confirmed");
});

test("reading finance status does not create or modify the finance directory", t => {
  const base = mkdtempSync(path.join(tmpdir(), "bitcode-finance-read-"));
  const old = process.env.BITCODE_HOME;
  process.env.BITCODE_HOME = path.join(base, "home");
  const root = path.join(base, "project");
  mkdirSync(root);
  t.after(() => { if (old === undefined) delete process.env.BITCODE_HOME; else process.env.BITCODE_HOME = old; rmSync(base, { recursive: true, force: true }); });
  assert.equal(financeStatus({ root }).policy, null);
  assert.equal(openFinanceStore(root).read().proposals.length, 0);
  assert.equal(existsSync(path.join(base, "home", "finance")), false);
});

test("denial, policy limits, expiry and policy changes fail before signing", async t => {
  const x = setup(t);
  await assert.rejects(prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 21_000, feeRate: 2 }), /per-payment/);
  const proposal = await prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 10_000, feeRate: 2 });
  assert.equal((await executeBitcoin(x.config, proposal.id, { ...x, approve: () => false })).status, "rejected_by_user");
  assert.deepEqual(x.calls, { sign: 0, broadcast: 0 });
  await assert.rejects(executeBitcoin(x.config, proposal.id, { ...x, approve: () => true, now: new Date(Date.now() + 20 * 60_000) }), /expired/);
  setFinancePolicy(x.policy, { root: x.root });
  await assert.rejects(executeBitcoin(x.config, proposal.id, { ...x, approve: () => true }), /rejected/);
});

test("unknown broadcast stays reserved and is never retried", async t => {
  const x = setup(t);
  const proposal = await prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 10_000, feeRate: 2 });
  const brokenApi = { ...x.apiImpl, broadcast: async () => { x.calls.broadcast++; throw new Error("timeout"); } };
  await assert.rejects(executeBitcoin(x.config, proposal.id, { ...x, apiImpl: brokenApi, approve: () => true }), /outcome unknown/);
  assert.equal(financeStatus({ root: x.root }).proposals[0].status, "unknown");
  await assert.rejects(executeBitcoin(x.config, proposal.id, { ...x, approve: () => true }), /unknown/);
  assert.deepEqual(x.calls, { sign: 1, broadcast: 1 });
  await assert.rejects(reconcileBitcoin(x.config, proposal.id, { ...x, apiImpl: { ...x.apiImpl, tx: async () => ({ txid: "a".repeat(64), vout: [], fee: 500, status: { confirmed: true } }) } }), /does not match/);
  assert.equal(financeStatus({ root: x.root }).proposals[0].status, "unknown");
});

test("proposal hash and workspace boundary are enforced", async t => {
  const x = setup(t);
  const proposal = await prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 10_000, feeRate: 2 });
  assert.equal(proposal.id, proposalId(openFinanceStore(x.root).read().proposals[0]));
  openFinanceStore(x.root).update(state => { state.proposals[0].amountSats = 1; });
  await assert.rejects(executeBitcoin(x.config, proposal.id, { ...x, approve: () => true }), /integrity/);
  process.env.BITCODE_HOME = x.root;
  assert.throws(() => openFinanceStore(x.root), /outside the project/);
});

test("local finance assistant only receives proposal tools", t => {
  const x = setup(t);
  assert.deepEqual(financeAgentTools(x.config, x.root).map(tool => tool.name), ["finance_status", "finance_prepare"]);
  assert.throws(() => assertFinanceModel({ provider: { api: "openai", baseURL: "https://example.com/v1" } }), /loopback/);
  assert.throws(() => assertFinanceModel({ provider: { api: "responses", baseURL: "http://127.0.0.1:3000/v1" } }), /local/);
  assert.doesNotThrow(() => assertFinanceModel({ provider: { api: "openai", baseURL: "http://127.0.0.1:3000/v1" } }));
});

test("fee, reserve, daily reservations and remote endpoints fail closed", async t => {
  const x = setup(t);
  const first = await prepareBitcoin(x.config, { ...x, to: "tb1first", amountSats: 18_000, feeRate: 2 });
  assert.equal(first.status, "prepared");
  await assert.rejects(prepareBitcoin(x.config, { ...x, to: "tb1second", amountSats: 18_000, feeRate: 2 }), /daily limit/);
  await assert.rejects(prepareBitcoin({ bitcoin: { network: "mainnet", esploraUrl: "http://127.0.0.1:3000/api" } }, { ...x, to: "bc1bad", amountSats: 1 }), /test networks/);
  await assert.rejects(prepareBitcoin({ bitcoin: { network: "signet", esploraUrl: "https://mempool.space/signet/api" } }, { ...x, to: "tb1bad", amountSats: 1 }), /local HTTP/);
  x.walletImpl.createPsbt = async ({ to, amountSats, feeRate }) => ({ to, amountSats, feeRate, feeSats: 1_001, outpoints: [createHash("sha256").update(to).digest("hex") + ":0"], psbt: "different" });
  await assert.rejects(prepareBitcoin(x.config, { ...x, to: "tb1fee", amountSats: 1_000, feeRate: 2 }), /fee exceeds/);
});

test("an input cannot be reserved by two different proposals", async t => {
  const x = setup(t);
  const first = await prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 10_000, feeRate: 2 });
  x.walletImpl.createPsbt = async ({ to, amountSats, feeRate }) => ({ to, amountSats, feeRate, feeSats: 500, outpoints: first.outpoints, psbt: "second-unsigned-psbt" });
  await assert.rejects(prepareBitcoin(x.config, { ...x, to: "tb1other", amountSats: 10_000, feeRate: 2 }), /inputs are already reserved/);
});

test("interrupted execution is recovered without an automatic retry", async t => {
  const x = setup(t);
  const p = await prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 10_000, feeRate: 2 });
  openFinanceStore(x.root).update(state => { state.proposals[0].status = "executing"; });
  assert.equal(recoverBitcoinOperation(p.id, { root: x.root }).status, "rejected");
  const next = await prepareBitcoin(x.config, { ...x, to: "tb1test", amountSats: 10_000, feeRate: 2, now: new Date(Date.now() + 1000) });
  openFinanceStore(x.root).update(state => { const q = state.proposals.find(item => item.id === next.id); q.status = "executing"; q.txid = "a".repeat(64); });
  assert.equal(recoverBitcoinOperation(next.id, { root: x.root }).status, "unknown");
  assert.deepEqual(x.calls, { sign: 0, broadcast: 0 });
});
