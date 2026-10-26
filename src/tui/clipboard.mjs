// System clipboard for the full-screen UI. Mouse capture hides the terminal's own
// copy/paste menu, so the app copies and pastes itself: wl-clipboard on Wayland,
// xclip or xsel on X11, and OSC 52 so copying also works over SSH.
import { spawnSync } from "node:child_process";

const has = (command) => spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;

function tools(env, primary) {
  const list = [];
  if (env.WAYLAND_DISPLAY) list.push({ read: ["wl-paste", ["--no-newline", ...(primary ? ["--primary"] : [])]], write: ["wl-copy", primary ? ["--primary"] : []] });
  if (env.DISPLAY) {
    const selection = primary ? "primary" : "clipboard";
    list.push({ read: ["xclip", ["-selection", selection, "-o"]], write: ["xclip", ["-selection", selection, "-i"]] });
    list.push({ read: ["xsel", [primary ? "-p" : "-b", "-o"]], write: ["xsel", [primary ? "-p" : "-b", "-i"]] });
  }
  if (process.platform === "darwin") list.push({ read: ["pbpaste", []], write: ["pbcopy", []] });
  return list.filter((t) => has(t.read[0]));
}

// -> clipboard text, or null when no clipboard tool is available.
export function readClipboard({ env = process.env, primary = false } = {}) {
  for (const tool of tools(env, primary)) {
    const result = spawnSync(tool.read[0], tool.read[1], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    if (result.status === 0) return result.stdout;
  }
  return null;
}

// Copies through OSC 52 (terminal) and the first working system tool. -> true if a tool accepted it.
export function writeClipboard(text, { env = process.env, write = (s) => process.stdout.write(s) } = {}) {
  write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
  for (const tool of tools(env, false)) {
    // xclip and xsel stay alive to serve the selection, so they must not hold our stdio.
    const result = spawnSync(tool.write[0], tool.write[1], { input: text, timeout: 2000, stdio: ["pipe", "ignore", "ignore"] });
    if (result.status === 0 || result.error?.code === "ETIMEDOUT") return true;
  }
  return false;
}
