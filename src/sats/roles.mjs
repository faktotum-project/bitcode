import { SAT_IDS } from "./policy.mjs";

// Which Sat a tool call belongs to, by role: Node = Bitcoin infrastructure,
// Script = code and shell, Hash = reading and verification, Merkle = orchestration.
// Pure data: shared by the terminal UI and the desktop renderer.
const BITCOIN_PREFIXES = ["btc_", "bitcoin_", "wallet_", "ln_", "liquid_", "cashu_", "cj_", "rgb_", "taproot_", "wl_", "finance_"];
const SCRIPT_TOOLS = new Set(["bash", "write_file", "edit_file", "patch", "exec_command", "write_stdin", "terminate_process"]);
const MERKLE_TOOLS = new Set(["subagent", "sat_delegate", "update_plan", "read_plan", "todo_write", "ask_user"]);

export function satForTool(name, { activeSatId } = {}) {
  if (SAT_IDS.includes(activeSatId)) return activeSatId;
  const tool = String(name || "");
  if (BITCOIN_PREFIXES.some((prefix) => tool.startsWith(prefix))) return "node";
  if (SCRIPT_TOOLS.has(tool)) return "script";
  if (MERKLE_TOOLS.has(tool)) return "merkle";
  return "hash";
}
