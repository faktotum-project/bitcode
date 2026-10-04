import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSats, parseSatManifest } from '../src/sats.mjs';
import { satTools } from '../src/sat-permissions.mjs';
import { satWorkspace, satHistory, recordSatRun } from '../src/sat-workspace.mjs';
import { runSat } from '../src/sat-runtime.mjs';
import { satEvents } from '../src/sat-events.mjs';
import { handleSlash } from '../src/cli.mjs';

const registry = loadSats();
const target = { spec: 'test/model', model: 'model', provider: {} };
const home = () => mkdtempSync(path.join(tmpdir(), 'bitcode-sat-'));
const tc = (name, args = {}) => ({ id: name, name, args });

test('Sat Registry validates manifests and rejects permission escalation', () => {
  assert.deepEqual(registry.map(s => s.id), ['node', 'script', 'hash', 'merkle']);
  const source = readFileSync(new URL('../sats/node/SAT.md', import.meta.url), 'utf8');
  assert.throws(() => parseSatManifest(source.replace('wallet: deny', 'wallet: allow')));
  assert.throws(() => parseSatManifest(source.replace('version: 1', 'version: 1\nversion: 2')));
  assert.throws(() => parseSatManifest(source.replace('id: node', 'id: ../../escape')));
  assert.throws(() => parseSatManifest(source.replace('  - bitcoin', '  - &anchor bitcoin')));
  const sat = { ...registry[0], tools: ['bash', 'bitcoin_rpc', 'wallet_send', 'read_file'] };
  assert.deepEqual(satTools(sat, sat.tools.map(name => ({ name }))).map(t => t.name), ['read_file']);
  assert.deepEqual(satTools({ ...sat, permissions: { ...sat.permissions, filesystem: 'deny' } }, [{ name: 'read_file' }]), []);
  assert.equal(satTools(registry[1], [{ name: 'bash', mutating: false }])[0].mutating, true);
});

test('Sat Identity is persistent, history is project scoped and contains no secrets', () => {
  const options = { home: home(), cwd: '/project-a' };
  const one = satWorkspace('node', options), two = satWorkspace('node', options);
  assert.equal(one.identity, two.identity);
  for (let i = 0; i < 55; i++) recordSatRun('node', { state: 'success', prompt: 'SECRET', result: 'SECRET' }, options);
  const history = satHistory('node', options);
  assert.equal(history.length, 50); assert.ok(!JSON.stringify(history).includes('SECRET'));
  assert.deepEqual(satHistory('node', { ...options, cwd: '/project-b' }), []);
  assert.throws(() => satWorkspace('../outside', options));
});

test('Sat Workspace refuses symlink directories', () => {
  const h = home(); mkdirSync(path.join(h, 'sats')); symlinkSync(tmpdir(), path.join(h, 'sats', 'node'));
  assert.throws(() => satWorkspace('node', { home: h }), /Unsafe/);
});

test('Merkle delegates through the same engine with independent tools and approval denial', async () => {
  const events = [], schemas = []; let calls = 0, mutations = 0, approvals = 0;
  const opts = { home: home(), cwd: '/project' };
  const answer = await runSat({ satId: 'merkle', registry, home: opts.home, context: { cwd: opts.cwd }, target,
    system: 'test', messages: [{ role: 'user', content: 'implement' }],
    tools: [{ name: 'write_file', run: () => { mutations++; return 'ok'; } }, { name: 'wallet_send', financial: true, run() { throw Error('never'); } }],
    hooks: { approve: () => { approvals++; return false; } }, onSatEvent: e => events.push(e),
    callModelImpl: async ({ tools }) => {
      schemas.push(tools.map(t => t.name));
      return [
        { toolCalls: [tc('sat_delegate', { agent: 'script', prompt: 'implement' })] },
        { toolCalls: [tc('write_file')] }, { text: 'denied' }, { text: 'approval required' },
      ][calls++];
    },
  });
  assert.equal(answer, 'approval required'); assert.equal(mutations, 0); assert.equal(approvals, 1);
  assert.deepEqual(schemas[0], ['sat_delegate']); assert.deepEqual(schemas[1], ['write_file']);
  assert.ok(events.some(e => e.type === 'delegation:start' && e.satId === 'script'));
  assert.ok(events.some(e => e.type === 'approval:required'));
  assert.equal(satHistory('script', opts).length, 1); assert.equal(satHistory('merkle', opts).length, 1);
});

test('Sat Runtime fails closed without an approval hook, and obeys read-only', async () => {
  for (const options of [{}, { readOnly: true, hooks: { approve: () => true } }]) {
    await runSat({ satId: 'script', persistence: false, target, messages: [], tools: ['bash', 'write_file', 'read_file'].map(name => ({ name, mutating: name !== 'read_file' })), ...options,
      callModelImpl: async ({ tools }) => { assert.deepEqual(tools.map(t => t.name), ['read_file']); return { text: 'ok' }; } });
  }
});

test('Sat Delegation never retries a child after a possible side effect', async () => {
  let parentCalls = 0, childCalls = 0, writes = 0;
  const answer = await runSat({ satId: 'merkle', persistence: false, target, messages: [],
    limits: { toolRetryAttempts: 2, toolRetryDelay: 0 }, hooks: { approve: () => true },
    tools: [{ name: 'write_file', run: () => { writes++; return 'written'; } }],
    callModelImpl: async ({ system }) => {
      if (system.includes('Sat Identity: Script')) {
        if (++childCalls === 1) return { toolCalls: [tc('write_file')] };
        throw Object.assign(new Error('provider unavailable after write'), { status: 503 });
      }
      if (++parentCalls === 1) return { toolCalls: [tc('sat_delegate', { agent: 'script', prompt: 'write once' })] };
      return { text: 'Inspect the partial result before retrying.' };
    },
  });
  assert.equal(writes, 1); assert.equal(childCalls, 2);
  assert.match(answer, /partial result/);
});

test('Sat State represents exhausted budgets as error, events strip raw payloads', async () => {
  const events = [];
  await runSat({ satId: 'hash', persistence: false, target, tools: [], messages: [], limits: { maxSteps: 0 }, onSatEvent: e => events.push(e) });
  assert.ok(events.some(e => e.type === 'sat:error'));
  const projected = satEvents({ type: 'tool.started', data: { stage: 'drafting', args: 'SECRET', result: 'SECRET' } });
  assert.equal(projected[0].state, 'writing'); assert.ok(!JSON.stringify(projected).includes('SECRET'));
});

test('CLI /sat selects the Sat for subsequent turns and reset leaves it', async () => {
  const ctx = { session: {}, messages: [] };
  await handleSlash('/sat merkle', ctx); assert.equal(ctx.session.satId, 'merkle');
  await handleSlash('/sat unknown', ctx); assert.equal(ctx.session.satId, 'merkle');
  await handleSlash('/reset', ctx); assert.equal(ctx.session.satId, undefined);
});
