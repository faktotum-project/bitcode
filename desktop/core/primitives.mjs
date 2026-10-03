import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const fail = (code, message = code) => Object.assign(new Error(message), { code });
export const hash = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export function atomicJSON(file, data) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
export function loadJSON(file, fallback) {
  if (!existsSync(file)) return structuredClone(fallback);
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw fail('STATE_CORRUPT', `Invalid state: ${path.basename(file)}`); }
}
export function within(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function workspacePath(root, relative = '.', { write = false } = {}) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) throw fail('INVALID_PATH');
  const candidate = path.resolve(root, relative);
  if (!within(root, candidate) || relative.split(/[\\/]/).some(p => ['.bitcode', '.aws', '.ssh', '.gnupg'].includes(p))) throw fail('PATH_DENIED');
  if (write && relative.split(/[\\/]/).includes('.git')) throw fail('PATH_DENIED');
  let existing = candidate;
  while (!existsSync(existing)) existing = path.dirname(existing);
  if (!within(root, realpathSync(existing))) throw fail('SYMLINK_ESCAPE');
  return candidate;
}

export class Semaphore {
  constructor(limit = 1) { this.limit = limit; this.active = 0; this.queue = []; }
  acquire(signal) {
    if (signal?.aborted) return Promise.reject(fail('CANCELLED'));
    return new Promise((resolve, reject) => {
      const entry = { signal, resolve, reject, abort: () => { this.queue = this.queue.filter(x => x !== entry); reject(fail('CANCELLED')); } };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry); this.pump();
    });
  }
  pump() {
    while (this.active < this.limit && this.queue.length) {
      const item = this.queue.shift(); item.signal?.removeEventListener('abort', item.abort);
      if (item.signal?.aborted) { item.reject(fail('CANCELLED')); continue; }
      this.active++; let released = false;
      item.resolve(() => { if (released) return; released = true; this.active--; this.pump(); });
    }
  }
  async use(fn, signal) { const release = await this.acquire(signal); try { return await fn(); } finally { release(); } }
}

export class Approvals {
  constructor({ emit = () => {}, redact = x => x, ttl = 900_000, now = Date.now } = {}) {
    this.entries = new Map(); this.key = randomBytes(32); Object.assign(this, { emit, redact, ttl, now });
  }
  request({ sessionId, runId, subject, kind = 'tool', signal }) {
    if (signal?.aborted) return Promise.reject(fail('CANCELLED'));
    const id = `apr_${randomBytes(16).toString('hex')}`;
    const action = structuredClone(subject);
    const digest = createHmac('sha256', this.key).update(canonical({ id, sessionId, runId, kind, action })).digest('hex');
    const publicRequest = { id, sessionId, runId, kind, digest, subject: this.redact(action), expiresAt: this.now() + this.ttl, status: 'pending' };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(false, 'expired'), this.ttl); timer.unref?.();
      const abort = () => settle(false, 'cancelled');
      const settle = (decision, status) => {
        const entry = this.entries.get(id); if (!entry || entry.publicRequest.status !== 'pending') return;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        entry.publicRequest.status = status; this.emit('approval', entry.publicRequest); resolve(decision);
      };
      this.entries.set(id, { publicRequest, action, settle, reject });
      signal?.addEventListener('abort', abort, { once: true }); this.emit('approval', publicRequest);
    });
  }
  resolve({ id, digest, sessionId, decision }) {
    const e = this.entries.get(id); if (!e) throw fail('NOT_FOUND');
    if (e.publicRequest.sessionId !== sessionId) throw fail('APPROVAL_WRONG_SESSION');
    if (e.publicRequest.status !== 'pending') throw fail('APPROVAL_CONSUMED');
    if (this.now() >= e.publicRequest.expiresAt) { e.settle(false, 'expired'); throw fail('APPROVAL_EXPIRED'); }
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || !timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(e.publicRequest.digest, 'hex'))) throw fail('APPROVAL_DIGEST_MISMATCH');
    if (!['approve', 'deny'].includes(decision)) throw fail('INVALID_PARAMS');
    e.settle(decision === 'approve', decision === 'approve' ? 'approved' : 'denied'); return true;
  }
  list() { return [...this.entries.values()].map(e => e.publicRequest).filter(e => e.status === 'pending'); }
  close() { for (const e of this.entries.values()) e.settle(false, 'cancelled'); }
}

export class Redactor {
  constructor() { this.values = new Set(); }
  add(value) { if (typeof value === 'string' && value.length >= 4) this.values.add(value); }
  text(value) { let text = String(value); for (const secret of this.values) text = text.split(secret).join('[redacted]'); return text; }
  value(value) { return JSON.parse(this.text(JSON.stringify(value ?? null))); }
}
