// Optional native UI check with a deliberately failing local provider.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { _electron } = await import(process.env.BITCODE_PLAYWRIGHT_MODULE || 'playwright');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), 'bitcode-run-error-ui-'));
const root = path.join(temporary, 'project'), home = path.join(temporary, 'state');
mkdirSync(root); mkdirSync(home);
const server = http.createServer((req, res) => {
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Invalid test credential sk-ui-test-secret' } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
writeFileSync(path.join(home, 'config.json'), JSON.stringify({ model: 'broken/test', providers: { broken: {
  api: 'openai', baseURL: `http://127.0.0.1:${server.address().port}/v1`, local: true, apiKey: 'sk-ui-test-secret', defaultModel: 'test',
} } }));
const env = { ...process.env, BITCODE_HOME: home }; delete env.ELECTRON_RUN_AS_NODE; delete env.BITCODE_MODEL;
let app;
try {
  app = await _electron.launch({ executablePath: path.join(desktop, 'node_modules/electron/dist/electron'),
    args: [desktop, `--user-data-dir=${path.join(temporary, 'electron')}`], env });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Attività', exact: true }).waitFor();
  const original = 'Diagnostica questo problema ' + 'nel progetto '.repeat(18) + 'richiesta completa finale';
  await page.evaluate(async ({ root, original }) => {
    const invoke = async (method, params) => { const r = await window.bitcode.invoke(method, params); if (!r.ok) throw Error(r.error.message); return r.result; };
    const project = await invoke('project.open', { path: root });
    const session = await invoke('session.create', { projectId: project.projectId, model: 'broken/test' });
    await invoke('chat.submit', { sessionId: session.sessionId, text: original });
  }, { root, original });
  await page.getByRole('button', { name: 'Attività', exact: true }).click();
  await page.getByRole('button', { name: 'Dettagli errore', exact: true }).waitFor({ timeout: 20000 });
  assert.match(await page.locator('table.list').innerText(), /HTTP_401/);
  await page.getByRole('button', { name: 'Dettagli errore', exact: true }).click();
  const dialog = page.locator('dialog.run-error'); await dialog.waitFor();
  const prompt = await dialog.locator('textarea').inputValue();
  assert.ok(prompt.includes(original)); assert.ok(prompt.includes(root));
  assert.match(prompt, /HTTP_401/); assert.doesNotMatch(await dialog.innerText(), /sk-ui-test-secret/);
  assert.doesNotMatch(prompt, /sk-ui-test-secret/);
  await dialog.getByRole('button', { name: 'Copia prompt fix', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog.run-error button.primary')?.classList.contains('done'));
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), prompt);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('PASS: real worker/provider HTTP_401, error table, full fix prompt, native clipboard, Escape, no renderer errors.');
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
