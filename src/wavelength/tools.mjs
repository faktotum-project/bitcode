// Wavelength agent tools — self-custodial Bitcoin/Lightning/Ark wallet via
// Lightning Labs' wavewalletdk engine. Registered only when
// config.wavelength is set (same opt-in contract as the LND tools), but
// unlike LND this needs no node of your own: the engine holds its own keys
// locally and talks to Lightning Labs' public signet/testnet operators.
// Phase 1 of update_wavelength.md: read-only tools only.
import { resolveWavelength } from "./network.mjs";
import { wavelengthEngine } from "./engine.mjs";

export function wavelengthTools(config, { transport = null } = {}) {
  const ctx = resolveWavelength(config);
  if (!ctx) return [];
  const engine = wavelengthEngine(ctx, transport);

  return [
    {
      name: "wl_info",
      mutating: false,
      description:
        "Wavelength wallet engine status: network, daemon version, operator connection, wallet state. Self-custodial Bitcoin/Lightning/Ark wallet — no Lightning node required.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const i = await engine.getInfo();
        return (
          `wavelength ${i.network} · daemon ${i.version || "(unknown)"} · block ${i.blockHeight}\n` +
          `operator ${ctx.arkServerAddress} · connected ${i.serverConnected}\n` +
          `wallet ${i.walletState}${i.identityPubKey ? ` · identity ${i.identityPubKey.slice(0, 16)}…` : ""}`
        );
      },
    },
    {
      name: "wl_balance",
      mutating: false,
      description: "Wavelength self-custodial wallet balance: confirmed, pending in/out, and credit, in sats.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const b = await engine.balance();
        return (
          `confirmed ${b.confirmedSat} sats\n` +
          `pending in ${b.pendingInSat} · pending out ${b.pendingOutSat}\n` +
          `credit available ${b.creditAvailableSat} · reserved ${b.creditReservedSat}`
        );
      },
    },
  ];
}
