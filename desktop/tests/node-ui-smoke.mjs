// Optional native smoke test. All state lives in a temporary home; no installation runs.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { _electron } = await import(process.env.BITCODE_PLAYWRIGHT_MODULE || 'playwright');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'bitcode-node-ui-'));
const env = { ...process.env, BITCODE_HOME: path.join(temp, 'state') }; delete env.ELECTRON_RUN_AS_NODE;
mkdirSync(path.join(env.BITCODE_HOME, 'desktop'), { recursive: true });
writeFileSync(path.join(env.BITCODE_HOME, 'desktop/settings.json'), JSON.stringify({ lang: 'it' }));
const app = await _electron.launch({ executablePath: path.join(desktop, 'node_modules/electron/dist/electron'), args: [desktop, `--user-data-dir=${path.join(temp, 'electron')}`], env });
try {
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Nodo', exact: true }).click();
  await page.getByRole('heading', { name: 'Nodo Bitcoin' }).waitFor();
  await page.getByLabel('Rete', { exact: true }).selectOption('signet');
  await page.getByLabel('Archivio', { exact: true }).selectOption('pruned');
  assert.equal(await page.getByRole('checkbox', { name: 'Explorer mempool con tema bitcode' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Prepara installazione', exact: true }).click();
  await page.getByRole('heading', { name: 'Riepilogo da approvare' }).waitFor();
  const jobs = await page.evaluate(async () => (await window.bitcode.invoke('node.jobs')).result);
  assert.equal(jobs.length, 0, 'Preview must not start installation');
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  const output = path.resolve(desktop, '../artifacts/fullnode/node-wizard.png'); mkdirSync(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: node wizard, network/profile selection, explorer constraint and read-only preview. Screenshot:', output);
} finally { await app.evaluate(({ app }) => app.exit(0)); }
