// The engine boundary for Wavelength. All wallet logic (keys, VTXO signing,
// Ark rounds, Lightning swaps) lives in Lightning Labs' wavewalletdk daemon,
// which the official SDK drives through a fixed set of facade methods —
// verified against @lightninglabs/wavelength-core@0.1.0 (dist/facade.d.ts),
// not assumed. bitcode reaches the daemon through a pluggable transport with
// a single method:
//
//   transport.call(method, params) -> Promise<result>
//
// where `method` is one of FACADE_METHODS. No transport ships yet: the
// native daemon build is still pending (update_wavelength.md §3, Opzione B),
// so until one is wired in every call fails with an actionable error and
// tests inject a mock. Keeping the boundary this narrow means the tools
// above it never need to know which option lands underneath.
export const FACADE_METHODS = [
  "start",
  "stop",
  "getInfo",
  "status",
  "balance",
  "createWallet",
  "unlockWallet",
  "openWalletFromPasskey",
  "deposit",
  "receive",
  "prepareSend",
  "sendPrepared",
  "list",
  "exit",
  "exitStatus",
  "exitSummary",
  "getExitPlan",
  "sweepWallet",
  "confirmedBalanceSat",
  "pendingInboundSat",
  "walletReady",
  "isRunning",
];

export function wavelengthEngine(ctx, transport = null) {
  const call = (method, params) => {
    if (!FACADE_METHODS.includes(method)) {
      throw new Error(`unknown wavelength facade method "${method}"`);
    }
    if (!transport) {
      throw new Error(
        "wavelength engine transport not available yet: the wavewalletdk daemon build is pending (update_wavelength.md, Fase 0/Opzione B)",
      );
    }
    return transport.call(method, params);
  };

  // Phase-1 surface: read-only status and balance. Wallet lifecycle,
  // receive, and the prepareSend/sendPrepared pay flow arrive with phases
  // 2-3 of the plan.
  return {
    getInfo: () => call("getInfo"),
    status: () => call("status"),
    balance: () => call("balance"),
  };
}
