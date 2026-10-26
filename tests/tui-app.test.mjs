import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createApp } from "../src/tui/app.mjs";
import { createTheme } from "../src/tui/theme.mjs";

function terminal(columns = 100, rows = 30) {
  const output = Object.assign(new EventEmitter(), { columns, rows, write: () => true });
  const input = Object.assign(new EventEmitter(), { isTTY: false, setEncoding() {}, resume() {}, pause() {} });
  return { input, output };
}
function app(options = {}) {
  const { input, output } = terminal(options.columns, options.rows);
  const ui = createApp({ input, output, theme: createTheme("dark"), lang: "en", mouse: false,
    status: () => ({ model: "mock/demo", profile: "code", network: "signet", permission: "suggest", cwd: "/tmp/demo" }),
    commands: [{ name: "help", hint: "show commands", group: "Session" }, { name: "plan", hint: "plan a task", args: true, group: "Work" }], ...options });
  ui.start();
  return { ui, input, type: (data) => input.emit("data", data) };
}

test("home screen shows the mark, the four Sats and the mode", (t) => {
  const { ui } = app();
  t.after(() => ui.stop());
  const screen = ui.snapshot();
  assert.match(screen, /bitcode/);
  assert.match(screen, /Node Bitcoin\s+■ Script code\s+⬢ Hash verify\s+◆ Merkle plans/);
  assert.match(screen, /BUILD\s+demo · code · signet · suggest/);
});

test("typing / opens the command menu and enter submits the chosen command", async (t) => {
  const { ui, type } = app();
  t.after(() => ui.stop());
  const input = ui.readInput();
  type("/");
  assert.match(ui.snapshot(), /\/help\s+show commands/);
  type("\r");
  assert.deepEqual(await input, { line: "/help", typed: "/help" });
});

test("tab switches to plan mode and plain requests become /plan", async (t) => {
  const { ui, type } = app();
  t.after(() => ui.stop());
  const input = ui.readInput();
  type("\t");
  assert.match(ui.snapshot(), /PLAN/);
  type("map the wallet code\r");
  assert.deepEqual(await input, { line: "/plan map the wallet code", typed: "map the wallet code" });
});

test("approvals take y, a or n and payments never offer always", async (t) => {
  const { ui, type } = app();
  t.after(() => ui.stop());
  let pending = ui.approve({ tool: "edit_file", sat: "script", diff: "-a\n+b" });
  assert.match(ui.snapshot(), /Script wants to use edit_file/);
  type("a");
  assert.equal(await pending, "always");
  pending = ui.approve({ tool: "wallet_send", sat: "node", financial: true, args: { amount: 1000 } });
  assert.doesNotMatch(ui.snapshot(), /always this session/);
  type("a");
  type("n");
  assert.equal(await pending, "deny");
});

test("escape twice interrupts a running turn", (t) => {
  const { ui, type } = app();
  t.after(() => ui.stop());
  let interrupted = 0;
  ui.onInterrupt(() => interrupted++);
  ui.runStart({});
  type("\x1b");
  assert.match(ui.snapshot(), /esc again to interrupt/);
  type("\x1b");
  assert.equal(interrupted, 1);
});

test("stray writes become transcript notes and the sidebar lights the working Sat", (t) => {
  const { ui } = app({ columns: 130 });
  t.after(() => ui.stop());
  ui.user("check fees");
  ui.runStart({});
  ui.toolStart("1", { name: "btc_fees", preview: "" });
  ui.busEvent({ type: "tool.started", data: { tool: "btc_fees", stage: "reading" } });
  process.stderr.write("warning from a tool\n");
  const screen = ui.snapshot();
  assert.match(screen, /warning from a tool/);
  assert.match(screen, /Node\s+btc fees/);
  assert.match(screen, /SATS/);
});

test("the line REPL stays for pipes, plain terminals and BITCODE_UI=line", async () => {
  const { fullscreenSupported } = await import("../src/tui/presenter.mjs");
  const caps = { tty: true, level: "full" };
  assert.equal(fullscreenSupported(caps, {}, { isTTY: true }), true);
  assert.equal(fullscreenSupported(caps, { BITCODE_UI: "line" }, { isTTY: true }), false);
  assert.equal(fullscreenSupported(caps, {}, { isTTY: false }), false);
  assert.equal(fullscreenSupported({ tty: true, level: "text" }, {}, { isTTY: true }), false);
});
