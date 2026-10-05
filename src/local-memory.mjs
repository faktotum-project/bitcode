// Memory used by the local model's own process, read where the runtime reports it.
// Ollama says exactly (size / size_vram); other runtimes fall back to the resident
// size of their process. Cloud models and unknown runtimes return null: nothing is guessed.
import { execFile } from 'node:child_process';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
const PROCESS = { ollama: /ollama/i, lmstudio: /lm.?studio|lms/i, llamacpp: /llama-?(server|cpp)|localai/i, vllm: /vllm/i, koboldcpp: /koboldcpp/i, jan: /^jan|cortex/i, textgen: /text-?generation|server\.py/i };

export const isLocalBase = baseURL => { try { return LOOPBACK.has(new URL(baseURL).hostname); } catch { return false; } };

async function ollamaPs(baseURL, model, fetchImpl) {
  const origin = new URL(baseURL).origin;
  const res = await fetchImpl(`${origin}/api/ps`, { signal: AbortSignal.timeout(900) });
  if (!res.ok) return null;
  const list = (await res.json()).models;
  if (!Array.isArray(list) || !list.length) return null;
  const same = list.filter(x => x.name === model || x.model === model || String(x.name).split(':')[0] === String(model).split(':')[0]);
  const used = same.length ? same : list;
  return { bytes: used.reduce((n, x) => n + Number(x.size || 0), 0), vram: used.reduce((n, x) => n + Number(x.size_vram || 0), 0), source: 'ollama' };
}
function residentSize(name, execImpl) {
  const pattern = PROCESS[name]; if (!pattern || process.platform === 'win32') return Promise.resolve(null);
  return new Promise(resolve => execImpl('ps', ['-eo', 'rss=,comm='], { timeout: 1500 }, (err, stdout) => {
    if (err) return resolve(null);
    const rows = String(stdout).split('\n').map(l => l.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean).filter(m => pattern.test(m[2]));
    const kb = rows.reduce((n, m) => n + Number(m[1]), 0);
    resolve(kb > 0 ? { bytes: kb * 1024, vram: 0, source: 'process' } : null);
  }));
}
export async function readLocalMemory({ providerName, baseURL, model, fetchImpl = fetch, execImpl = execFile }) {
  if (!baseURL || !isLocalBase(baseURL)) return null;
  try { if (providerName === 'ollama' || /:11434$/.test(new URL(baseURL).host)) { const m = await ollamaPs(baseURL, model, fetchImpl); if (m?.bytes) return m; } } catch {}
  return residentSize(providerName, execImpl);
}

// Polls in the background while a run is active; `get()` is always instant.
export function createMemoryProbe(args, { intervalMs = 2000, read = readLocalMemory, onValue } = {}) {
  let value = null, timer = null, stopped = false;
  const poll = async () => { try { const v = await read(args); if (!stopped) { const changed = JSON.stringify(v) !== JSON.stringify(value); value = v; if (changed) onValue?.(v); } } catch {} };
  if (args.baseURL && isLocalBase(args.baseURL)) { poll(); timer = setInterval(poll, intervalMs); timer.unref?.(); }
  return { get: () => value, stop() { stopped = true; if (timer) clearInterval(timer); } };
}
