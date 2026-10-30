// RGB Lightning Nodes on this computer: what state each one is in and the
// command that moves it forward. Commands run only in a terminal the user
// sees (main.mjs); passwords and mnemonics are typed there, never seen here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// rgb-lightning-node 0.10 answers every API call with a named error until the
// wallet is initialized and unlocked; /networkinfo is the cheapest probe.
const NAMED = { LockedNode: 'locked', NotInitialized: 'uninitialized', ChangingState: 'busy' };
const MESSAGE = [[/node is locked/i, 'locked'], [/not (been )?initiali[sz]ed/i, 'uninitialized'], [/changing state|unlocking/i, 'busy']];
const UNREACHABLE = /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|fetch failed|timeout|aborted/i;

export const FIX = { locked: 'unlock', uninitialized: 'init', stopped: 'start' };

export async function probeNode(nodeUrl, fetchImpl = fetch, timeoutMs = 10_000) {
  let res, body;
  try {
    res = await fetchImpl(new URL('/networkinfo', nodeUrl), { signal: AbortSignal.timeout(timeoutMs) });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    const detail = [e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(' ');
    return { status: UNREACHABLE.test(detail) || e.name === 'TimeoutError' ? 'stopped' : 'error', error: e.message };
  }
  if (res.ok) return { status: 'connected', info: body };
  const error = body?.error || `HTTP ${res.status}`;
  const status = NAMED[body?.name] || MESSAGE.find(([re]) => re.test(error))?.[1] || 'error';
  return { status, error };
}

// kaleido-cli spawns one Docker Compose project per node under ~/.kaleido;
// the API is the host port published for container port 3001.
export function discoverNodes(kaleidoHome) {
  let dirs = [];
  try { dirs = readdirSync(kaleidoHome, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return []; }
  return dirs.flatMap(name => {
    const composeFile = path.join(kaleidoHome, name, 'docker-compose.yml');
    let text; try { text = readFileSync(composeFile, 'utf8'); } catch { return []; }
    const port = /^\s*-\s*["']?(?:[\d.]+:)?(\d+):3001["']?\s*$/m.exec(text)?.[1];
    return port ? [{ name, nodeUrl: `http://localhost:${port}`, composeFile }] : [];
  });
}

export const sameNode = (a, b) => {
  try { const x = new URL(a), y = new URL(b), local = h => ['localhost', '127.0.0.1', '[::1]'].includes(h) ? 'localhost' : h; return local(x.hostname) === local(y.hostname) && x.port === y.port; }
  catch { return false; }
};

// The installer puts kaleido in ~/.local/local/bin, which is usually not on PATH.
export function kaleidoBinary(env = process.env, homeDir = os.homedir()) {
  const onPath = (env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'kaleido'));
  return [...onPath, path.join(homeDir, '.local', 'local', 'bin', 'kaleido'), path.join(homeDir, '.local', 'bin', 'kaleido')].find(f => existsSync(f)) || null;
}

const quote = s => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;

export function fixCommand(action, node, kaleido) {
  if (action === 'start') return node.composeFile ? `docker compose -f ${quote(node.composeFile)} up -d` : null;
  if (!['unlock', 'init'].includes(action) || !kaleido) return null;
  return `${quote(kaleido)} --node-url ${quote(node.nodeUrl)} node ${action}`;
}
