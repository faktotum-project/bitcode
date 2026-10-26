// Readable text for interactive slash commands that used to print raw JSON.
// The --json subcommands keep printing data; these are for people.
import * as t from "./theme.mjs";

const n = (value) => Number(value || 0).toLocaleString("en-US");

export function keyValues(rows) {
  const shown = rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  const width = Math.max(0, ...shown.map(([key]) => key.length)) + 2;
  return shown.map(([key, value]) => `  ${t.faint(key.padEnd(width))}${t.body(String(value))}`);
}

export function statusText(s) {
  const lines = [t.label("Session"), ...keyValues([
    ["model", s.model], ["profile", s.profile], ["root", s.root],
    ["permissions", s.permissions ? `${s.permissions.mode}${s.permissions.allow.length ? ` · allow ${s.permissions.allow.join(", ")}` : ""}` : undefined],
    ["read-only", s.readOnly ? "yes" : undefined],
  ]), t.label("Context"), ...keyValues([
    ["messages", n(s.messages)], ["estimated", `${n(s.estimated_tokens)} tokens`],
    ["used", `↑${n(s.usage.input_tokens)} ↓${n(s.usage.output_tokens)} tokens`],
  ])];
  if (s.commands?.length) lines.push(t.label("Project commands"), ...s.commands.map((c) => `  ${t.body(typeof c === "string" ? c : c.command || c.name || JSON.stringify(c))}`));
  if (s.plan?.steps?.length) {
    lines.push(t.label("Plan"));
    for (const step of s.plan.steps) lines.push(`  ${step.status === "completed" ? t.ok("☑") : step.status === "in_progress" ? t.accent("◐") : t.faint("☐")} ${t.body(step.step)}`);
  }
  return lines.join("\n");
}

export function listText(title, items, { name = (x) => x.name, detail = (x) => x.description || "" } = {}) {
  if (!items.length) return `${t.label(title)}\n  ${t.faint("none")}`;
  const width = Math.min(28, Math.max(...items.map((x) => String(name(x)).length)) + 2);
  return [t.label(title), ...items.map((x) => `  ${t.accent(String(name(x)).padEnd(width))}${t.muted(detail(x))}`)].join("\n");
}

export function mcpText(servers) {
  if (!servers.length) return `${t.label("MCP servers")}\n  ${t.faint("none configured")}`;
  return [t.label("MCP servers"), ...servers.map((s) => `  ${s.ok ? t.ok("●") : t.danger("●")} ${t.body(s.name)}  ${t.faint(s.ok ? `${s.tools} tools` : s.error || "")}`)].join("\n");
}

export function satInfoText(sat) {
  const permissions = Object.entries(sat.permissions || {}).map(([k, v]) => `${k} ${v}`).join(" · ");
  const lines = [t.label(sat.name), ...keyValues([
    ["role", sat.role], ["permissions", permissions], ["tools", (sat.tools || []).join(", ")],
    ["capabilities", (sat.capabilities || []).join(", ")], ["workspace", typeof sat.workspace === "string" ? sat.workspace : undefined],
  ])];
  const history = Array.isArray(sat.history) ? sat.history : [];
  if (history.length) lines.push(t.label("Recent work"), ...history.slice(-5).map((h) => `  ${t.faint(h.at || h.createdAt || "")} ${t.body(h.summary || h.task || h.title || JSON.stringify(h))}`));
  return lines.join("\n");
}
