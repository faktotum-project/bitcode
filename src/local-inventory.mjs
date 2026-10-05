// Inventory of the models available on this machine, whoever downloaded them:
// running inference servers (configured or not) and model files on disk from
// Ollama, LM Studio, llama.cpp, Jan and the Hugging Face cache. Each model gets a
// memory-fit estimate against this machine's RAM and GPU memory.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { allProviders } from "./config.mjs";
import { isLocalProvider, listLocalModels } from "./local-models.mjs";

const GB = 1024 ** 3;

// Well-known local OpenAI-compatible servers and their default ports.
export const KNOWN_RUNTIMES = [
  { name: "ollama", label: "Ollama", baseURL: "http://127.0.0.1:11434/v1", discovery: "ollama" },
  { name: "lmstudio", label: "LM Studio", baseURL: "http://127.0.0.1:1234/v1" },
  { name: "llamacpp", label: "llama.cpp / LocalAI", baseURL: "http://127.0.0.1:8080/v1" },
  { name: "vllm", label: "vLLM", baseURL: "http://127.0.0.1:8000/v1" },
  { name: "jan", label: "Jan", baseURL: "http://127.0.0.1:1337/v1" },
  { name: "koboldcpp", label: "KoboldCpp", baseURL: "http://127.0.0.1:5001/v1" },
  { name: "textgen", label: "text-generation-webui", baseURL: "http://127.0.0.1:5000/v1" }
];

const read = file => { try { return readFileSync(file, "utf8").trim(); } catch { return null; } };

export function machineResources() {
  const meminfo = read("/proc/meminfo") || "";
  const kb = key => Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] || 0) * 1024;
  const ram = { total: kb("MemTotal") || os.totalmem(), available: kb("MemAvailable") || os.freemem() };
  const gpus = [];
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.trim().split("\n").filter(Boolean)) {
      const [name, total, free] = line.split(",").map(x => x.trim());
      gpus.push({ vendor: "nvidia", name, vram: Number(total) * 1024 ** 2, vramFree: Number(free) * 1024 ** 2, unified: false });
    }
  } catch {}
  try {
    for (const card of readdirSync("/sys/class/drm").filter(c => /^card\d+$/.test(c))) {
      const dev = path.join("/sys/class/drm", card, "device");
      const vendor = read(path.join(dev, "vendor"));
      if (vendor === "0x1002") {
        const vram = Number(read(path.join(dev, "mem_info_vram_total")) || 0), used = Number(read(path.join(dev, "mem_info_vram_used")) || 0);
        const gtt = Number(read(path.join(dev, "mem_info_gtt_total")) || 0);
        // APUs carve out a small VRAM window and use system RAM (GTT) for the rest.
        gpus.push({ vendor: "amd", name: "AMD Radeon", vram, vramFree: Math.max(0, vram - used), gtt, unified: vram < 8 * GB && gtt > vram });
      } else if (vendor === "0x8086") gpus.push({ vendor: "intel", name: "Intel Graphics", vram: 0, vramFree: 0, unified: true });
    }
  } catch {}
  return { ram, gpus, cpus: os.cpus().length, platform: process.platform };
}

// Memory needed to run a model ≈ weights + KV cache/runtime overhead.
export function fitFor(sizeBytes, machine) {
  if (!sizeBytes) return { fit: "unknown" };
  const need = sizeBytes * 1.2 + 0.5 * GB;
  const dedicated = Math.max(0, ...machine.gpus.filter(g => !g.unified).map(g => g.vram));
  if (dedicated && need <= dedicated) return { fit: "gpu", need };
  // Judge against total RAM minus a reserve for the OS and other apps, not the
  // momentary free memory (which drops while a runtime keeps a model loaded).
  if (need <= machine.ram.total * 0.75) return { fit: "ram", need };
  if (need <= machine.ram.total * 0.9) return { fit: "tight", need };
  return { fit: "too-big", need };
}

const exists = p => { try { return existsSync(p); } catch { return false; } };
function walk(dir, match, depth = 4, out = []) {
  if (depth < 0 || !exists(dir)) return out;
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, match, depth - 1, out);
    else if (match(e.name)) { try { out.push({ path: p, size: statSync(p).size }); } catch {} }
  }
  return out;
}

// Model files on disk, grouped by the tool that stores them.
export function diskModels({ home = os.homedir() } = {}) {
  const found = [];
  for (const root of [path.join(home, ".ollama/models"), "/usr/share/ollama/.ollama/models", "/var/lib/ollama/.ollama/models"]) {
    const lib = path.join(root, "manifests", "registry.ollama.ai");
    if (!exists(lib)) continue;
    for (const m of walk(lib, () => true, 3)) {
      const rel = path.relative(lib, m.path).split(path.sep);
      if (rel.length !== 3) continue;
      let size = 0;
      try { size = JSON.parse(readFileSync(m.path, "utf8")).layers?.reduce((n, l) => n + (l.size || 0), 0) || 0; } catch {}
      const name = `${rel[0] === "library" ? "" : rel[0] + "/"}${rel[1]}:${rel[2]}`;
      if (!found.some(f => f.runtime === "ollama" && f.name === name)) found.push({ runtime: "ollama", name, size, path: m.path, format: "ollama" });
    }
  }
  const gguf = (runtime, dirs, depth = 5) => {
    for (const dir of dirs) for (const f of walk(dir, n => n.endsWith(".gguf") && !/mmproj/i.test(n), depth))
      if (!found.some(x => x.path === f.path)) found.push({ runtime, name: path.basename(f.path, ".gguf"), size: f.size, path: f.path, format: "gguf" });
  };
  gguf("lmstudio", [path.join(home, ".lmstudio/models"), path.join(home, ".cache/lm-studio/models")]);
  gguf("llamacpp", [path.join(home, ".cache/llama.cpp"), path.join(home, "models"), path.join(home, ".local/share/llama.cpp")], 3);
  gguf("jan", [path.join(home, "jan/models"), path.join(home, ".local/share/Jan/data/models")]);
  const hub = path.join(home, ".cache/huggingface/hub");
  if (exists(hub)) {
    for (const repo of readdirSync(hub).filter(d => d.startsWith("models--"))) {
      const files = walk(path.join(hub, repo, "snapshots"), n => /\.(gguf|safetensors)$/.test(n), 4);
      if (!files.length) continue;
      const name = repo.slice(8).replace("--", "/");
      found.push({ runtime: "huggingface", name, size: files.reduce((n, f) => n + f.size, 0), path: path.join(hub, repo), format: files.some(f => f.path.endsWith(".gguf")) ? "gguf" : "safetensors" });
    }
  }
  return found;
}

const sameBase = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.port === y.port && ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"].includes(x.hostname) === ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"].includes(y.hostname); } catch { return false; } };

// Everything in one call: machine, configured local providers, servers found on
// well-known ports but not configured, and downloaded models not being served.
export async function localInventory(config = {}, { timeoutMs = 800, home } = {}) {
  const machine = machineResources();
  const providers = Object.entries(allProviders(config)).filter(([, p]) => isLocalProvider(p));
  const configured = await Promise.all(providers.map(async ([name, provider]) => ({ name, baseURL: provider.baseURL, configured: true, ...(await listLocalModels(name, provider, { timeoutMs })) })));
  // A runtime is "detected" only if no configured provider already owns its
  // address or its name: two providers called "ollama" would make specs ambiguous.
  const others = KNOWN_RUNTIMES.filter(r => !providers.some(([name, p]) => name === r.name || sameBase(p.baseURL, r.baseURL)));
  const detected = (await Promise.all(others.map(async r => ({ name: r.name, label: r.label, baseURL: r.baseURL, configured: false, ...(await listLocalModels(r.name, { api: "openai", baseURL: r.baseURL, discovery: r.discovery }, { timeoutMs })) }))))
    .filter(d => d.running);
  const disk = diskModels({ home });
  const servers = [...configured, ...detected].map(s => ({
    ...s,
    label: s.label || KNOWN_RUNTIMES.find(r => r.name === s.name || sameBase(r.baseURL, s.baseURL))?.label || s.name,
    models: s.models.map(m => {
      const onDisk = disk.find(d => d.runtime === "ollama" && d.name.replace(/:latest$/, "") === m.id.replace(/:latest$/, "")) || disk.find(d => d.name === m.id || path.basename(d.path, ".gguf") === m.id);
      const size = m.size || onDisk?.size || 0;
      return { ...m, spec: `${s.name}/${m.id}`, size, ...fitFor(size, machine) };
    })
  }));
  const served = new Set(servers.flatMap(s => s.models.map(m => m.id.replace(/:latest$/, ""))));
  const idle = disk.filter(d => !served.has(d.name.replace(/:latest$/, "")) && !servers.some(s => s.models.some(m => d.path.includes(m.id))))
    .map(d => ({ ...d, ...fitFor(d.size, machine), hint: serveHint(d) }));
  return { machine, servers, idle };
}

function serveHint(d) {
  if (d.runtime === "ollama") return "ollama serve";
  if (d.runtime === "lmstudio") return "LM Studio → Developer → Start Server, then load the model";
  if (d.format === "gguf") return `llama-server -m "${d.path}" --port 8080`;
  if (d.runtime === "huggingface") return `vllm serve ${d.name}`;
  return null;
}

// Best local model to start on: the provider's declared default if it fits in
// memory, otherwise the largest served model that fits (GPU or free RAM).
export function bestLocalModel(inventory, config = {}) {
  const providers = allProviders(config);
  const fits = inventory.servers.filter(s => s.configured).flatMap(s => s.models
    .filter(m => ["gpu", "ram"].includes(m.fit))
    .map(m => ({ ...m, preferred: providers[s.name]?.defaultModel === m.id })));
  return (fits.find(m => m.preferred) || fits.sort((a, b) => (b.size || 0) - (a.size || 0))[0])?.spec || null;
}

// Provider entry for a runtime found on a well-known port but not configured.
export function runtimeProvider(name) {
  const r = KNOWN_RUNTIMES.find(x => x.name === name);
  return r ? { api: "openai", baseURL: r.baseURL, keyEnv: null, local: true, ...(r.discovery ? { discovery: r.discovery } : {}) } : null;
}
