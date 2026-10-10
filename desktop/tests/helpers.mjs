import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createController } from '../core/controller.mjs';

export const config = { model: 'ollama/test', providers: { ollama: { api: 'openai', baseURL: 'http://127.0.0.1:11434/v1', defaultModel: 'test' }, cloud: { api: 'openai', baseURL: 'https://api.example.com/v1', apiKey: 'sk-cloud-secret', defaultModel: 'big' } } };
export const tick = () => new Promise(r => setImmediate(r));
export const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

export function setup({ sandbox = { available: true }, callModelImpl, ...extra } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'bitcode-home-'));
  const root = mkdtempSync(path.join(tmpdir(), 'bitcode-proj-'));
  const events = [], workers = [];
  const spawnWorker = ({ onMessage, onExit, root: wroot }) => {
    const w = { sent: [], root: wroot, onMessage, onExit, pending: new Map(), stopped: false,
      send(msg) { this.sent.push(msg); if (msg.type === 'response') this.pending.get(msg.id)?.(msg); },
      stop() { if (!this.stopped) { this.stopped = true; onExit(null); } },
      request(method, params) { const id = Math.random().toString(36).slice(2); return new Promise(res => { this.pending.set(id, res); onMessage({ type: 'request', id, method, params }); }); } };
    workers.push(w); return w;
  };
  const c = createController({ home, appDir: '/nonexistent', sandbox, spawnWorker, config, emit: (ch, p) => events.push([ch, p]), callModelImpl, ...extra });
  return { c, home, root, events, workers };
}
export async function sessionIn(c, root, mode = 'assisted') {
  const p = await c.invoke('project.open', { path: root });
  return { p, s: await c.invoke('session.create', { projectId: p.projectId, mode }, 'ui:1') };
}
