import { mkdirSync, lstatSync, readFileSync, writeFileSync, readdirSync, unlinkSync, linkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { bitcodeHome } from './paths.mjs';
import { SAT_IDS } from './sats.mjs';

function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe Sat Workspace directory');
  return dir;
}
export function satWorkspace(id, { home = bitcodeHome() } = {}) {
  if (!SAT_IDS.includes(id)) throw new Error('Unknown Sat');
  const root = privateDir(path.join(privateDir(path.join(home, 'sats')), id));
  const workspace = privateDir(path.join(root, 'workspace')), state = privateDir(path.join(root, 'state'));
  const file = path.join(state, 'identity.json');
  if (!existsSync(file)) {
    const temporary = path.join(state, `.identity-${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify({ id, identity: randomUUID(), createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    try { linkSync(temporary, file); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    finally { unlinkSync(temporary); }
  }
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Unsafe Sat Identity');
  const identity = JSON.parse(readFileSync(file, 'utf8'));
  if (identity.id !== id || !/^[a-f0-9-]{36}$/.test(identity.identity)) throw new Error('Invalid Sat Identity');
  return { ...identity, workspace, state };
}
// One immutable file per run avoids lost updates across CLI/desktop processes.
// Essential history intentionally contains no prompts, tool arguments or outputs.
export function recordSatRun(id, entry, { home, cwd = process.cwd() } = {}) {
  const { state } = satWorkspace(id, { home });
  const scope = createHash('sha256').update(path.resolve(cwd)).digest('hex');
  const dir = privateDir(path.join(state, scope));
  const record = { at: new Date().toISOString(), state: ['success', 'error', 'idle'].includes(entry.state) ? entry.state : 'error' };
  writeFileSync(path.join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  for (const f of readdirSync(dir).filter(f => /^\d+-[a-f0-9-]+\.json$/.test(f)).sort().slice(0, -50)) {
    try { unlinkSync(path.join(dir, f)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export function satHistory(id, { home, cwd = process.cwd() } = {}) {
  const { state } = satWorkspace(id, { home });
  const dir = path.join(state, createHash('sha256').update(path.resolve(cwd)).digest('hex'));
  try {
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe Sat State');
    return readdirSync(dir).filter(f => /^\d+-[a-f0-9-]+\.json$/.test(f)).sort().slice(-50).map(f => {
      const file = path.join(dir, f);
      if (lstatSync(file).isSymbolicLink()) throw new Error('Unsafe Sat Memory');
      return JSON.parse(readFileSync(file, 'utf8'));
    });
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
