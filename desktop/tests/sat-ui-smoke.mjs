// Optional native UI check. Supply a development-only Playwright module path.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const playwright = await import(process.env.BITCODE_PLAYWRIGHT_MODULE || 'playwright');
const { _electron } = playwright._electron ? playwright : playwright.default;
const desktop = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'bitcode-sat-ui-'));
const root = path.join(temporary, 'project'); mkdirSync(root);
const env = { ...process.env, BITCODE_HOME: path.join(temporary, 'state') }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: path.join(desktop, 'node_modules/electron/dist/electron'),
  args: [desktop, '--no-sandbox', '--ozone-platform=x11', `--user-data-dir=${path.join(temporary, 'electron')}`], env });
try {
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('.shead');
  await page.evaluate(async root => {
    const invoke = async (method, params) => { const r = await window.bitcode.invoke(method, params); if (!r.ok) throw Error(r.error.message); return r.result; };
    const project = await invoke('project.open', { path: root });
    await invoke('session.create', { projectId: project.projectId, name: 'Sat UI verification', satId: 'merkle' });
  }, root);
  await page.reload(); await page.waitForSelector('#prompt');
  const agent = () => page.locator('.cchip.agent .clabel').innerText();
  assert.equal(await agent(), 'Merkle');
  await page.getByRole('button', { name: 'Merkle · orchestration', exact: true }).click();
  await page.getByRole('menuitem', { name: 'About Merkle' }).click();
  await page.locator('dialog').waitFor();
  assert.match(await page.locator('dialog').innerText(), /orchestration/);
  assert.match(await page.locator('dialog').innerText(), /wallet: deny/);
  assert.match(await page.locator('dialog').innerText(), /Sat Identity/);
  const screenshot = fileURLToPath(new URL('../../artifacts/sats/desktop-sat-info.png', import.meta.url));
  mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  await page.keyboard.press('Escape');
  await page.locator('#prompt').fill('/sat hash'); await page.locator('#prompt').press('Enter');
  await page.waitForFunction(() => document.querySelector('.cchip.agent .clabel')?.textContent === 'Hash');
  await page.reload(); await page.waitForSelector('#prompt');
  assert.equal(await agent(), 'Hash');
  assert.deepEqual(errors, []);
  console.log('PASS: native Electron Sat selection, manifest/identity dialog, slash command, reload persistence; no renderer errors.');
  console.log(`Screenshot: ${screenshot}`);
} finally { await app.evaluate(({ app }) => app.exit(0)); }
