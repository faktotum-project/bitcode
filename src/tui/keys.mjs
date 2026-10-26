// Raw terminal input -> key events: { name, ctrl, shift, alt, text } or
// { name: "paste", text } and { name: "mouse", button, x, y, press }.
const CSI_KEYS = {
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "backtab",
  "2~": "insert", "3~": "delete", "1~": "home", "4~": "end", "7~": "home", "8~": "end", "5~": "pageup", "6~": "pagedown",
};
const CONTROL = {
  "\x01": "home", "\x02": "ctrl-b", "\x03": "ctrl-c", "\x04": "ctrl-d", "\x05": "end", "\x0b": "ctrl-k", "\x0c": "ctrl-l",
  "\x0e": "ctrl-n", "\x0f": "ctrl-o", "\x10": "ctrl-p", "\x12": "ctrl-r", "\x14": "ctrl-t", "\x15": "ctrl-u", "\x17": "ctrl-w",
  "\x18": "ctrl-x", "\x0a": "ctrl-j",
};
const PASTE_START = "\x1b[200~", PASTE_END = "\x1b[201~";

export function* parseKeys(data) {
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    if (rest.startsWith(PASTE_START)) {
      const end = rest.indexOf(PASTE_END);
      const body = end < 0 ? rest.slice(PASTE_START.length) : rest.slice(PASTE_START.length, end);
      yield { name: "paste", text: body.replace(/\r\n?/g, "\n") };
      i += end < 0 ? rest.length : end + PASTE_END.length;
      continue;
    }
    let m;
    if ((m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest))) {
      yield { name: "mouse", button: +m[1], x: +m[2] - 1, y: +m[3] - 1, press: m[4] === "M" };
      i += m[0].length;
      continue;
    }
    if ((m = /^\x1b\[(\d+);(\d+)([A-Za-z~])/.exec(rest)) && m[1] === "1") {
      const mod = +m[2] - 1;
      yield { name: CSI_KEYS[m[3]] || "unknown", shift: !!(mod & 1), alt: !!(mod & 2), ctrl: !!(mod & 4) };
      i += m[0].length;
      continue;
    }
    if ((m = /^\x1b\[13;(\d+)[u~]/.exec(rest))) {
      yield { name: "enter", shift: true };
      i += m[0].length;
      continue;
    }
    if ((m = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest))) {
      const code = m[2] === "~" ? m[1] + "~" : m[2];
      yield { name: CSI_KEYS[code] || "unknown" };
      i += m[0].length;
      continue;
    }
    if ((m = /^\x1bO([A-Z])/.exec(rest))) {
      yield { name: CSI_KEYS[m[1]] || "unknown" };
      i += m[0].length;
      continue;
    }
    if (rest.startsWith("\x1b\r") || rest.startsWith("\x1b\n")) {
      yield { name: "enter", alt: true };
      i += 2;
      continue;
    }
    if (rest[0] === "\x1b" && rest[1] === "\x7f") {
      yield { name: "ctrl-w" };
      i += 2;
      continue;
    }
    const ch = rest[0];
    if (ch === "\x1b") { yield { name: "escape" }; i++; continue; }
    if (ch === "\r") { yield { name: "enter" }; i++; continue; }
    if (ch === "\t") { yield { name: "tab" }; i++; continue; }
    if (ch === "\x7f" || ch === "\b") { yield { name: "backspace" }; i++; continue; }
    if (ch < " ") { yield { name: CONTROL[ch] || "unknown" }; i++; continue; }
    let j = i;
    while (j < data.length && data[j] >= " " && data[j] !== "\x7f" && data[j] !== "\x1b") j++;
    yield { name: "text", text: data.slice(i, j) };
    i = j;
  }
}
