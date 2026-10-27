// Explicit host acceptance of an already-running installation. It registers a
// temporary adoption, stops/starts/restarts it, then detaches while retaining
// the original services, data and configuration. The caller's state is intact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createNodeService, HELPER } from '../../src/node/service.mjs';
import { execute } from '../../src/node/process.mjs';

const { values } = parseArgs({ options: { id: { type: 'string' }, yes: { type: 'boolean' }, sudo: { type: 'boolean' } } });
if (!values.id || !values.yes) throw Error('Provide --id EXISTING_INSTANCE --yes after reviewing the temporary interruption to its services.');
const originalService = createNodeService();
const original = originalService.list().find(i => i.id === values.id);
if (original?.mode !== 'adopted') throw Error('Select an existing adopted instance with reviewed service names.');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-adoption-smoke-'));
const id = `release-adopt-${Date.now()}`;
const admin = async payload => JSON.parse((await execute(values.sudo ? 'sudo' : 'pkexec',
  [...(values.sudo ? ['-n'] : []), '/usr/bin/python3', '-I', HELPER],
  { input: JSON.stringify(payload), timeout: 180_000 })).stdout);
const service = createNodeService({ home, admin });
const report = { id, network: original.network, startedAt: new Date().toISOString(), checks: [] };
const fingerprint = () => createHash('sha256').update(fs.readFileSync(path.join(original.datadir, 'bitcoin.conf'))).digest('hex');
const waitReady = async () => {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const status = await service.status(id);
    if (status.ready) return status;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('Adopted node did not return to full readiness in three minutes');
};
let adopted = false;
let needsStart = false;
try {
  const before = await originalService.status(original.id);
  assert.equal(before.ready, true, 'Original Core, indexes and explorer must be ready before the test');
  const configHash = fingerprint();
  await service.connect({ ...original, id }, { confirmed: true, adopt: true }); adopted = true;
  report.checks.push('temporary adoption of the exact live data directory and owned services');
  needsStart = true;
  await service.control(id, 'stop', { confirmed: true });
  assert.equal((await service.status(id)).error?.code, 'NODE_NOT_RUNNING');
  await service.control(id, 'start', { confirmed: true });
  await waitReady(); needsStart = false;
  report.checks.push('adopted stop/start returns Core, indexes and explorer to readiness');
  needsStart = true;
  await service.control(id, 'restart', { confirmed: true });
  const after = await waitReady(); needsStart = false;
  assert.ok(after.core.blocks >= before.core.blocks);
  assert.equal(fingerprint(), configHash);
  report.core = after.core; report.explorer = after.explorerStatus;
  report.checks.push('adopted restart retains blocks and the original configuration');
  report.passed = true;
} catch (error) { report.passed = false; report.error = { code: error.code, message: error.message }; process.exitCode = 1; }
finally {
  if (adopted) {
    try {
      if (needsStart) { await service.control(id, 'start', { confirmed: true }); await waitReady(); }
      await service.control(id, 'uninstall', { confirmed: true });
      assert.equal((await originalService.status(original.id)).ready, true);
      assert.equal(originalService.list().find(i => i.id === original.id).mode, 'adopted');
      report.checks.push('detach leaves original services ready and original bitcode adoption intact');
    } catch (error) { report.passed = false; report.cleanupError = error.message; process.exitCode = 1; }
  }
  if (report.cleanupError) report.recoveryHome = home;
  else fs.rmSync(home, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
}
