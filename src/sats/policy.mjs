const read = ["read_file", "list_dir"];
export const SAT_IDS = Object.freeze(["node", "script", "hash", "merkle"]);
export const POLICIES = Object.freeze({
  node: Object.freeze([
    ...read,
    "btc_fees",
    "btc_mempool",
    "btc_tx",
    "btc_address",
    "btc_block",
    "liquid_fees",
    "liquid_mempool",
    "liquid_tx",
    "liquid_address",
    "liquid_block",
    "liquid_asset",
    "ln_decode_invoice",
    "ln_info",
    "ln_balance",
    "ln_channels",
    "taproot_asset_balance",
  ]),
  script: Object.freeze([
    ...read,
    "write_file",
    "edit_file",
    "bash",
    "ln_decode_invoice",
  ]),
  hash: Object.freeze([...read, "ln_decode_invoice"]),
  merkle: Object.freeze([...read, "ln_decode_invoice"]),
});
export function toolsForAgent(id, tools) {
  const allowed = Object.hasOwn(POLICIES, id) ? POLICIES[id] : null;
  return tools.filter(
    (t) => t.name !== "subagent" && (!allowed || allowed.includes(t.name)),
  );
}
