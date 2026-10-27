import { spawn } from "node:child_process";
import { executable } from "./diagnostics.mjs";

// Desktop 0.2 and earlier installed under the capitalized product name.
const LEGACY_INSTALL = "/opt/Bitcode/bitcode-desktop";

// The installed desktop app, preferring an explicit override for custom installs.
export function desktopExecutable(env = process.env) {
  return [env.BITCODE_DESKTOP_BIN, "/usr/bin/bitcode-desktop", "/opt/bitcode/bitcode-desktop", LEGACY_INSTALL, "bitcode-desktop"].filter(Boolean).map(executable).find(Boolean) || null;
}

// The packaged CLI runs on Electron with ELECTRON_RUN_AS_NODE; a child that
// inherits it would start as Node instead of opening the window.
export function launchDesktop({ env = process.env, cwd = process.cwd() } = {}) {
  const file = desktopExecutable(env);
  if (!file) throw new Error("bitcode desktop is not installed (install the .deb or set BITCODE_DESKTOP_BIN)");
  const { ELECTRON_RUN_AS_NODE, ...childEnv } = env;
  const child = spawn(file, [], { cwd, env: childEnv, detached: true, stdio: "ignore" });
  child.unref();
  return { executable: file, pid: child.pid };
}
