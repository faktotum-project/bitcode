// Temporary CoinJoin wallet (update_cj.md G1, G9): fully isolated from the
// main bitcode wallet — separate file, never touched by wallet_send/wallet_*
// tools. Exists only for the duration of a /btc:coinjoin operation and is
// destroyed at the end (G4: never leave residual UTXOs, so drainAll always
// sweeps everything out first).
import { existsSync, unlinkSync, statSync, writeFileSync } from "node:fs";
import { wallet } from "../bitcoin/wallet.mjs";

export function coinjoinWallet(ctx) {
  const w = wallet({ ...ctx, name: `coinjoin.${ctx.name}` });

  return {
    ...w,

    // These delegate to the isolated `coinjoin.<net>` wallet but report the
    // plain network name back to the caller (the `coinjoin.` prefix is an
    // internal file-naming detail, not something the user should see).
    async balance(opts) {
      return { ...(await w.balance(opts)), network: ctx.name };
    },

    // Sweep every UTXO to `to`, leaving zero change (G4).
    async drainAll(to, { feeRate, gap = 20, broadcast = true } = {}) {
      return { ...(await w.sweep({ to, feeRate, broadcast, gap })), network: ctx.name };
    },

    async verifyEmpty({ gap = 20 } = {}) {
      const bal = await w.balance({ gap });
      return { empty: bal.sats === 0, sats: bal.sats };
    },

    // Overwrite the wallet file with zeros before deleting it, then remove
    // it. Best-effort secure erase — not a substitute for full-disk
    // encryption, but leaves no plaintext seed lying around after teardown.
    destroy() {
      if (!existsSync(w.file)) return { destroyed: false };
      const size = statSync(w.file).size;
      writeFileSync(w.file, Buffer.alloc(size, 0));
      unlinkSync(w.file);
      return { destroyed: true, file: w.file };
    },
  };
}
