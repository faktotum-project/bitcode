// Linux/macOS development smoke for the actual npm archive from a foreign cwd.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), "bc-sats-package-"));
function run(bin, args, cwd = root) {
  if (bin === "npm" && process.env.npm_execpath) {
    args = [process.env.npm_execpath, ...args];
    bin = process.execPath;
  }
  const result = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Command failed");
  return result.stdout;
}
try {
  const archive = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp, "--cache", path.join(temp, "cache")]))[0];
  const files = new Set(archive.files.map(f => f.path));
  for (const id of ['node', 'script', 'hash', 'merkle']) assert.ok(files.has(`sats/${id}/SAT.md`));
  for (const name of ['sats', 'sat-runtime', 'sat-workspace', 'sat-permissions', 'sat-events', 'sat-computer']) assert.ok(files.has(`src/${name}.mjs`));
  for (const f of ["agents/node.md", "agents/script.md", "agents/hash.md", "agents/merkle.md", "ui/sats/fonts/Inter-LICENSE.txt", "ui/sats/fonts/JetBrainsMono-OFL.txt", "src/subagents.mjs", "assets/sats/manifest.json"]) assert.ok(files.has(f), f);
  assert.equal([...files].some(f => f.includes("assets/sats/sources/") || f.includes("/masters/") || f.endsWith("/working.gif") || f.startsWith("bitcode sats/")), false);
  run("tar", ["-xzf", path.join(temp, archive.filename), "-C", temp]);
  const pkg = path.join(temp, "package");
  // Reuse the installed production dependencies; no install scripts or network.
  await symlink(path.join(root, "node_modules"), path.join(pkg, "node_modules"), "dir");
  const module = f => import(pathToFileURL(path.join(pkg, f)).href);
  const { loadAgents } = await module("src/agents.mjs");
  const agents = loadAgents({ userDir: path.join(temp, "empty-personas") });
  assert.deepEqual(agents.map(a => a.name), ["node", "script", "hash", "merkle"]);
  const { createEventBus } = await module("src/runtime/events.mjs");
  const { startSatsServer } = await module("src/sats/server.mjs");
  const { runSubagent } = await module("src/subagents.mjs");
  const bus = createEventBus();
  process.chdir(temp);
  const { loadSats } = await module('src/sats.mjs');
  const { runSat } = await module('src/sat-runtime.mjs');
  assert.equal(loadSats().length, 4);
  assert.equal(await runSat({ satId: 'merkle', persistence: false, target: { provider: {}, model: 'mock' }, tools: [], messages: [],
    callModelImpl: async ({ tools }) => { assert.ok(tools.some(t => t.name === 'sat_delegate')); return { text: 'packaged Sat works' }; } }), 'packaged Sat works');
  const panel = await startSatsServer({ bus, network: "testnet4" });
  try {
    const attached = await fetch(panel.origin + "/api/attach", { method: "POST", headers: { Origin: panel.origin, "Content-Type": "application/json" }, body: JSON.stringify({ token: new URL(panel.url).hash.slice(7) }) });
    const Cookie = attached.headers.get("set-cookie").split(";")[0];
    const bootstrap = await (await fetch(panel.origin + "/api/bootstrap", { headers: { Cookie } })).json();
    assert.equal(bootstrap.network, "testnet4");
    for (const route of ["/", "/ui/app.mjs", "/ui/styles.css", "/ui/state.mjs", "/ui/fonts/InterVariable.woff2", "/ui/fonts/JetBrainsMono-Regular.woff2", ...bootstrap.registry.flatMap(a => [a.poster, a.avatar, ...Object.values(a.poses)])]) {
      const response = await fetch(panel.origin + route); assert.equal(response.status, 200, route); assert.ok((await response.arrayBuffer()).byteLength);
    }
    assert.equal(await runSubagent({ agent: "node", prompt: "inspect", agents, target: { provider: {}, model: "mock" }, tools: [], parentContext: { bus }, callModelImpl: async () => ({ text: "packaged companion works" }) }), "packaged companion works");
    assert.match(run(process.execPath, [path.join(pkg, "bitcode.mjs"), "--help"], temp), /--sats/);
  } finally { await panel.close(); }
  process.stdout.write(JSON.stringify({ status: "passed", archiveBytes: archive.size, unpackedBytes: archive.unpackedSize, entries: archive.entryCount, satsFiles: [...files].filter(f => f.startsWith("assets/sats/")).length }) + "\n");
} finally { process.chdir(root); await rm(temp, { recursive: true, force: true }); }
