import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, fsyncSync } from "node:fs";
import path from "node:path";
import { bitcodeHome } from "../paths.mjs";

const STATES = new Set(["prepared", "executing", "submitted", "confirmed", "unknown", "rejected"]);
const integer = (value, label) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} must be a nonnegative safe integer in sats`);
  return n;
};

export function validatePolicy(input) {
  const policy = {
    maxPaymentSats: integer(input.maxPaymentSats, "maxPaymentSats"),
    dailyLimitSats: integer(input.dailyLimitSats, "dailyLimitSats"),
    maxFeeSats: integer(input.maxFeeSats, "maxFeeSats"),
    minReserveSats: integer(input.minReserveSats, "minReserveSats"),
  };
  if (!policy.maxPaymentSats || !policy.dailyLimitSats || !policy.maxFeeSats) throw new Error("payment, daily and fee limits must be positive");
  return policy;
}

export function financeDir(root = process.cwd()) {
  const dir = path.resolve(bitcodeHome(), "finance");
  const project = path.resolve(root);
  if (dir === project || dir.startsWith(project + path.sep)) throw new Error("BITCODE_HOME finance state must be outside the project workspace");
  return dir;
}

function atomicJson(file, value) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
  } finally { closeSync(fd); }
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  const dirFd = openSync(path.dirname(file), "r");
  try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
}

export function openFinanceStore(root = process.cwd()) {
  const dir = financeDir(root);
  const checkBoundary = () => {
    const realDir = realpathSync(dir);
    const realRoot = realpathSync(root);
    if (realDir === realRoot || realDir.startsWith(realRoot + path.sep)) throw new Error("finance state resolves inside the project workspace");
  };
  const file = path.join(dir, "state.json");
  const lock = path.join(dir, "lock");
  const empty = () => ({ version: 1, policy: null, policyVersion: 0, proposals: [] });
  const read = () => {
    if (!existsSync(dir)) return empty();
    checkBoundary();
    const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : empty();
    if (data.version !== 1 || !Array.isArray(data.proposals)) throw new Error("invalid financial state; execution denied");
    if (data.policy != null) validatePolicy(data.policy);
    if (!Number.isSafeInteger(data.policyVersion) || data.policyVersion < 0) throw new Error("invalid financial policy version; execution denied");
    if (data.proposals.some(p => !STATES.has(p.status))) throw new Error("invalid financial proposal state; execution denied");
    if (data.proposals.some(p => proposalId(p) !== p.id)) throw new Error("financial proposal integrity check failed; execution denied");
    return data;
  };
  const update = fn => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    checkBoundary();
    chmodSync(dir, 0o700);
    let fd;
    try { fd = openSync(lock, "wx", 0o600); }
    catch (err) { if (err.code === "EEXIST") throw new Error(`financial state is locked at ${lock}; inspect the owner before recovery`); throw err; }
    try {
      writeFileSync(fd, `${process.pid}\n`);
      fsyncSync(fd);
      const state = read();
      const result = fn(state);
      atomicJson(file, state);
      return result;
    } finally { closeSync(fd); rmSync(lock, { force: true }); }
  };
  return { dir, file, read, update };
}

export function recoverFinanceLock(root = process.cwd()) {
  const dir = financeDir(root);
  const lock = path.join(dir, "lock");
  if (!existsSync(lock)) return false;
  const pid = Number(readFileSync(lock, "utf8").trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("lock owner is invalid; inspect manually");
  try { process.kill(pid, 0); throw new Error(`financial process ${pid} is still running`); }
  catch (err) { if (err.code !== "ESRCH") throw err; }
  rmSync(lock);
  return true;
}

export function proposalId(proposal) {
  const canonical = JSON.stringify({ network: proposal.network, wallet: proposal.wallet, to: proposal.to, amountSats: proposal.amountSats, feeSats: proposal.feeSats, feeRate: proposal.feeRate, balanceSats: proposal.balanceSats, outpoints: proposal.outpoints, psbt: proposal.psbt, policyVersion: proposal.policyVersion, createdAt: proposal.createdAt, expiresAt: proposal.expiresAt });
  return createHash("sha256").update(canonical).digest("hex");
}

export function checkPolicy(policy, proposal, state, now = new Date()) {
  validatePolicy(policy);
  if (proposal.amountSats > policy.maxPaymentSats) throw new Error("payment exceeds per-payment limit");
  if (proposal.feeSats > policy.maxFeeSats) throw new Error("fee exceeds maximum");
  const day = now.toISOString().slice(0, 10);
  const spent = state.proposals.filter(p => p.status !== "rejected" && (p.createdAt?.startsWith(day) || ["prepared", "executing", "submitted", "unknown"].includes(p.status)))
    .reduce((sum, p) => sum + BigInt(p.amountSats) + BigInt(p.feeSats), 0n);
  if (spent + BigInt(proposal.amountSats) + BigInt(proposal.feeSats) > BigInt(policy.dailyLimitSats)) throw new Error("daily limit or existing reservations exceeded");
  const reserved = state.proposals.filter(p => ["prepared", "executing", "submitted", "unknown"].includes(p.status))
    .reduce((sum, p) => sum + BigInt(p.amountSats) + BigInt(p.feeSats), 0n);
  if (BigInt(proposal.balanceSats) - reserved - BigInt(proposal.amountSats) - BigInt(proposal.feeSats) < BigInt(policy.minReserveSats)) throw new Error("minimum reserve would be breached");
}

export function assertProposal(state, id, expected = "prepared") {
  if (!/^[a-f0-9]{64}$/.test(id || "")) throw new Error("invalid proposal id");
  const p = state.proposals.find(x => x.id === id);
  if (!p) throw new Error("proposal not found");
  if (!STATES.has(p.status)) throw new Error("invalid proposal status");
  if (p.status !== expected) throw new Error(`proposal is ${p.status}, expected ${expected}`);
  if (proposalId(p) !== p.id) throw new Error("proposal integrity check failed");
  return p;
}
