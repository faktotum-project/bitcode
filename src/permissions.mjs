import { spawnSync } from "node:child_process";

export const PERMISSION_MODES = new Set(["suggest", "auto-edit", "full-auto"]);

export function resolvePermissions({ config = {}, cliPermission, readOnly = false } = {}) {
  let mode = cliPermission ?? config.permissions?.mode ?? "auto-edit";
  if (!PERMISSION_MODES.has(mode)) throw new Error(`invalid permission mode "${mode}"; use suggest, auto-edit or full-auto`);
  const allow = new Set((Array.isArray(config.permissions?.allow) ? config.permissions.allow : []).map(normalizeCommand).filter(Boolean));
  return { mode, readOnly: !!readOnly, allow, sandbox: mode === "full-auto" };
}

export function normalizeCommand(command) {
  return typeof command === "string" ? command.trim().replace(/\s+/g, " ") : "";
}

// This is intentionally a small grammar. Shell syntax, quoting, expansion and
// redirection are all rejected rather than trying to parse bash safely.
export function isReadOnlyCommand(command) {
  const value = normalizeCommand(command);
  if (!value || /[|&;<>()`$\\\n\r'\"]/.test(value)) return false;
  const parts = value.split(" ");
  const [bin, sub] = parts;
  if (!parts.every(part => /^[A-Za-z0-9_@%+=:,./*?~-]+$/.test(part))) return false;
  if (["pwd", "ls", "cat", "head", "tail", "rg", "grep"].includes(bin)) return true;
  return bin === "git" && ["status", "diff", "log", "show", "branch", "rev-parse", "ls-files"].includes(sub);
}

export function mayAutoApprove({ tool, args = {}, permissions }) {
  if (tool.financial) return false;
  if (permissions.readOnly) return false;
  if (permissions.mode === "full-auto") return true;
  if (permissions.mode === "suggest") return false;
  if (["write_file", "edit_file", "patch"].includes(tool.name)) return true;
  if (["bash", "exec_command"].includes(tool.name)) {
    const command = normalizeCommand(args.command);
    return isReadOnlyCommand(command) || permissions.allow.has(command);
  }
  return false;
}

export function bubblewrapAvailable() {
  const probe = spawnSync("bwrap", ["--version"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}
