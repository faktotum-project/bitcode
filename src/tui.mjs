// Minimal zero-dependency terminal UI, in the style of claude code /
// opencode / codex: a raw-mode line editor whose "/" input pops an inline
// dropdown of suggested commands — filtered as you type, navigated with
// the arrow keys (or mouse click / scroll wheel), completed with Tab,
// run with Enter, dismissed with Esc. Also provides plain questions and
// masked secret input for API-key setup.
//
// Styling comes from the bitcode design system via ./theme.mjs.
// Falls back to node:readline when stdin is not a TTY (pipes, scripts).

import readline from "node:readline";
import * as t from "./theme.mjs";

const stdin = process.stdin;
const stdout = process.stdout;

const MAX_ROWS = 8;

// ---- mouse tracking (only while a menu is on screen) ----

const MOUSE_ON = "\x1b[?1002;1006h";
const MOUSE_OFF = "\x1b[?1002;1006l";
let mouseActive = false;

function setMouse(on) {
  if (!stdout.isTTY || on === mouseActive) return;
  mouseActive = on;
  stdout.write(on ? MOUSE_ON : MOUSE_OFF);
}

process.on("exit", () => {
  if (mouseActive) stdout.write(MOUSE_OFF);
});

// ---- key/event parsing from the raw byte stream ----

const CSI_KEYS = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  "3~": "del",
  "1~": "home",
  "4~": "end",
  "7~": "home",
  "8~": "end",
};

const CTRL_KEYS = {
  "\x03": "ctrl-c",
  "\x04": "ctrl-d",
  "\x01": "home",
  "\x05": "end",
  "\x0b": "ctrl-k",
  "\x15": "ctrl-u",
  "\x17": "ctrl-w",
};

function* parseEvents(data) {
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === "\x1b") {
      const rest = data.slice(i);
      let m;
      if ((m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest))) {
        yield { type: "mouse", b: +m[1], x: +m[2], y: +m[3], press: m[4] === "M" };
        i += m[0].length;
        continue;
      }
      if ((m = /^\x1b\[(\d+);(\d+)R/.exec(rest))) {
        yield { type: "cpr", row: +m[1], col: +m[2] };
        i += m[0].length;
        continue;
      }
      if ((m = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest))) {
        const code = m[2] === "~" ? m[1] + "~" : m[2];
        yield { type: CSI_KEYS[code] || "unknown" };
        i += m[0].length;
        continue;
      }
      if ((m = /^\x1bO([A-Z])/.exec(rest))) {
        yield { type: CSI_KEYS[m[1]] || "unknown" };
        i += m[0].length;
        continue;
      }
      yield { type: "esc" };
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      yield { type: "enter" };
      i += 1;
      continue;
    }
    if (ch === "\t") {
      yield { type: "tab" };
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      yield { type: "backspace" };
      i += 1;
      continue;
    }
    if (ch < " ") {
      yield { type: CTRL_KEYS[ch] || "unknown" };
      i += 1;
      continue;
    }
    let j = i;
    while (j < data.length && data[j] >= " " && data[j] !== "\x7f" && data[j] !== "\x1b") j++;
    yield { type: "text", text: data.slice(i, j) };
    i = j;
  }
}

// ---- helpers ----

function visibleWidth(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").length;
}

function clip(s, n) {
  s = String(s);
  return n > 0 && s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s;
}

function withRaw(handler) {
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", handler);
  return () => {
    stdin.off("data", handler);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}

// Non-TTY fallback (pipes, scripts, CI). A single persistent readline interface
// serves every readLine/question/readSecret call, so multi-line piped input is
// consumed line by line without losing buffered data between calls. Resolves to
// null once stdin closes (EOF).
let sharedRL = null;
let rlClosed = false;
const lineBuffer = [];
const lineWaiters = [];

function ensureRL() {
  if (sharedRL || rlClosed) return;
  sharedRL = readline.createInterface({ input: stdin });
  sharedRL.on("line", (line) => {
    const w = lineWaiters.shift();
    if (w) w(line);
    else lineBuffer.push(line);
  });
  sharedRL.on("close", () => {
    rlClosed = true;
    while (lineWaiters.length) lineWaiters.shift()(null);
  });
}

function fallbackLine(prompt) {
  if (prompt) stdout.write(prompt);
  ensureRL();
  if (lineBuffer.length) return Promise.resolve(lineBuffer.shift());
  if (rlClosed) return Promise.resolve(null);
  return new Promise((resolve) => lineWaiters.push(resolve));
}

// ---- interactive line editor with dropdown ----

// menu(input) → null | [{ label, hint, insert, submit }]
//   label:  what the row shows (e.g. "/btc:fees")
//   hint:   dim description on the right
//   insert: what accepting the row puts in the buffer
//   submit: true → Enter on the row runs it immediately
export function readLine({ prompt = "", menu = null, history = [] } = {}) {
  if (!stdin.isTTY) return fallbackLine(prompt);

  return new Promise((resolve) => {
    let buf = "";
    let pos = 0;
    let sel = 0;
    let items = [];
    let total = 0;
    let dismissed = false;
    let inputRow = null;
    let hIdx = history.length;
    let savedDraft = "";

    const promptW = visibleWidth(prompt);

    function refreshMenu(resetSel) {
      if (!menu || dismissed) {
        items = [];
        total = 0;
      } else {
        const list = menu(buf) || [];
        total = list.length;
        items = list.slice(0, MAX_ROWS);
      }
      if (resetSel) sel = 0;
      if (sel >= items.length) sel = Math.max(0, items.length - 1);
    }

    function render(final = false) {
      let outStr = "\r\x1b[J" + prompt + buf;
      if (!final && items.length) {
        const nameW = Math.max(...items.map((it) => it.label.length)) + 2;
        const cols = stdout.columns || 80;
        for (let k = 0; k < items.length; k++) {
          const it = items[k];
          const on = k === sel;
          const name = it.label.padEnd(nameW);
          const hint = clip(it.hint || "", cols - nameW - 6);
          outStr +=
            "\n" +
            (on
              ? t.accent("› ") + t.bold(name) + t.body(hint)
              : "  " + t.body(name) + t.faint(hint));
        }
        const more = total > items.length ? ` · +${total - items.length} more` : "";
        outStr += "\n" + t.faint(`  ↑↓ select · tab complete · ⏎ run · esc close${more}`);
        outStr += `\x1b[${items.length + 1}A`;
      }
      outStr += "\r";
      const col = promptW + pos;
      if (col > 0) outStr += `\x1b[${col}C`;
      stdout.write(outStr);
      if (!final && items.length) {
        stdout.write("\x1b[6n"); // learn the input row, so mouse clicks can map to menu rows
        setMouse(true);
      } else {
        setMouse(false);
      }
    }

    function finish(value) {
      items = [];
      render(true);
      stdout.write("\n");
      stop();
      setMouse(false);
      resolve(value);
    }

    function accept(it) {
      buf = it.insert;
      pos = buf.length;
      if (it.submit) return finish(buf);
      dismissed = false;
      refreshMenu(true);
      render();
    }

    function move(d) {
      if (!items.length) return;
      sel = (sel + d + items.length) % items.length;
      render();
    }

    function edited(resetSel = true) {
      dismissed = false;
      refreshMenu(resetSel);
      render();
    }

    function onEvent(ev) {
      switch (ev.type) {
        case "cpr":
          inputRow = ev.row;
          return;
        case "mouse": {
          if (!ev.press || !items.length) return;
          if (ev.b === 64) return move(-1); // wheel up
          if (ev.b === 65) return move(1); // wheel down
          if ((ev.b & 3) === 0 && inputRow != null) {
            const idx = ev.y - inputRow - 1;
            if (idx >= 0 && idx < items.length) {
              sel = idx;
              accept(items[idx]);
            }
          }
          return;
        }
        case "text":
          buf = buf.slice(0, pos) + ev.text + buf.slice(pos);
          pos += ev.text.length;
          return edited();
        case "backspace":
          if (pos > 0) {
            buf = buf.slice(0, pos - 1) + buf.slice(pos);
            pos--;
            return edited();
          }
          return render();
        case "del":
          if (pos < buf.length) {
            buf = buf.slice(0, pos) + buf.slice(pos + 1);
            return edited();
          }
          return render();
        case "left":
          if (pos > 0) pos--;
          return render();
        case "right":
          if (pos < buf.length) pos++;
          return render();
        case "home":
          pos = 0;
          return render();
        case "end":
          pos = buf.length;
          return render();
        case "ctrl-u":
          buf = buf.slice(pos);
          pos = 0;
          return edited();
        case "ctrl-k":
          buf = buf.slice(0, pos);
          return edited();
        case "ctrl-w": {
          const head = buf.slice(0, pos).replace(/\S+\s*$/, "");
          buf = head + buf.slice(pos);
          pos = head.length;
          return edited();
        }
        case "up":
          if (items.length) return move(-1);
          if (hIdx > 0) {
            if (hIdx === history.length) savedDraft = buf;
            hIdx--;
            buf = history[hIdx];
            pos = buf.length;
            dismissed = true;
            refreshMenu(true);
            return render();
          }
          return;
        case "down":
          if (items.length) return move(1);
          if (hIdx < history.length) {
            hIdx++;
            buf = hIdx === history.length ? savedDraft : history[hIdx];
            pos = buf.length;
            dismissed = true;
            refreshMenu(true);
            return render();
          }
          return;
        case "tab":
          if (items.length) {
            buf = items[sel].insert;
            pos = buf.length;
            refreshMenu(true);
            return render();
          }
          return;
        case "enter":
          if (items.length) return accept(items[sel]);
          return finish(buf);
        case "esc":
          if (items.length) {
            dismissed = true;
            refreshMenu(false);
            return render();
          }
          return;
        case "ctrl-c":
          if (buf) {
            buf = "";
            pos = 0;
            return edited();
          }
          return finish(null);
        case "ctrl-d":
          if (!buf) return finish(null);
          return;
      }
    }

    const stop = withRaw((data) => {
      for (const ev of parseEvents(data)) onEvent(ev);
    });

    refreshMenu(true);
    render();
  });
}

// Plain one-line question (no menu). Returns "" if cancelled.
export async function question(prompt) {
  const ans = await readLine({ prompt });
  return ans == null ? "" : ans;
}

// Masked input for secrets (API keys). Echoes "•" per character.
// Returns "" if cancelled.
export function readSecret({ prompt = "" } = {}) {
  if (!stdin.isTTY) return fallbackLine(prompt).then((x) => x ?? "");

  return new Promise((resolve) => {
    let buf = "";

    function render() {
      stdout.write("\r\x1b[K" + prompt + "•".repeat(Math.min(buf.length, 40)));
    }

    function finish(value) {
      stdout.write("\n");
      stop();
      resolve(value);
    }

    const stop = withRaw((data) => {
      for (const ev of parseEvents(data)) {
        if (ev.type === "text") {
          buf += ev.text;
          render();
        } else if (ev.type === "backspace") {
          buf = buf.slice(0, -1);
          render();
        } else if (ev.type === "enter") {
          return finish(buf.trim());
        } else if (ev.type === "ctrl-c" || ev.type === "ctrl-d" || ev.type === "esc") {
          return finish("");
        }
      }
    });

    render();
  });
}
