// Shared tokens from the Bitcode design system. No terminal/browser side effects.
export const TOKEN = Object.freeze({
  bitcoinOrange: "#f7931a",
  orangeActive: "#d97b0f",
  canvas: "#f7f7f4",
  canvasSoft: "#fafaf7",
  card: "#ffffff",
  surfaceStrong: "#e6e5e0",
  hairline: "#e6e5e0",
  hairlineSoft: "#efeee8",
  hairlineStrong: "#cfcdc4",
  onPrimary: "#ffffff",
  ink: "#26251e",
  body: "#5a5852",
  muted: "#807d72",
  mutedSoft: "#a09c92",
  success: "#1f8a65",
  error: "#cf2d56",
});
export const STAGE = Object.freeze({
  pending: "#dfa88f",
  relayed: "#9fc9a2",
  mempool: "#9fbbe0",
  confirming: "#c0a8dd",
  confirmed: "#c08532",
});

export function stageForTool(name) {
  if (["bash", "exec_command", "write_stdin", "terminate_process"].includes(name)) return { hex: STAGE.relayed, name: "running" };
  if (["bitcoin_rpc", "btc_tx", "btc_address", "btc_block", "liquid_tx", "liquid_address", "liquid_block", "liquid_asset", "ln_channels"].includes(name)) return { hex: STAGE.relayed, name: "querying" };
  if (["read_file", "list_dir", "btc_fees", "btc_mempool", "liquid_fees", "liquid_mempool", "wallet_info", "wallet_new_address", "wallet_descriptor", "ln_info", "ln_balance", "ln_decode_invoice", "taproot_asset_balance", "grep", "glob", "web_fetch", "git_status", "git_diff", "git_log", "read_plan", "read_skill", "list_skills", "list_processes"].includes(name)) return { hex: STAGE.mempool, name: "reading" };
  if (["write_file", "edit_file", "patch", "update_plan", "wallet_create", "wallet_send", "btc_broadcast", "ln_invoice_pay", "taproot_asset_send"].includes(name)) return { hex: STAGE.confirming, name: "drafting" };
  return { hex: STAGE.pending, name: "thinking" };
}
