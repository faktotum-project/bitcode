// Check the actual .deb payload, including its bundled Node runtime and CLI,
// from a directory outside the source checkout. No package installation runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const desktopVersion = readJSON(path.join(root, 'desktop/package.json')).version;
const cliVersion = readJSON(path.join(root, 'package.json')).version;
const archive = path.resolve(process.argv[2] || path.join(root, `desktop/release/bitcode-desktop_${desktopVersion}_amd64.deb`));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-deb-check-'));
try {
  const fields = execFileSync('dpkg-deb', ['--field', archive, 'Package', 'Version', 'Architecture'], { encoding: 'utf8' });
  assert.match(fields, /Package: bitcode-desktop/);
  assert.ok(fields.includes(`Version: ${desktopVersion}\n`));
  execFileSync('dpkg-deb', ['--extract', archive, temp]);
  const app = path.join(temp, 'opt/bitcode/resources/app');
  assert.equal(readJSON(path.join(app, 'package.json')).version, desktopVersion);
  const cli = path.join(app, 'dist/cli');
  assert.equal(readJSON(path.join(cli, 'package.json')).version, cliVersion);
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const resourceRoot = path.join(root, 'src/node');
  const resources = fs.readdirSync(resourceRoot, { recursive: true }).filter(relative => !relative.includes('__pycache__') && fs.statSync(path.join(resourceRoot, relative)).isFile());
  for (const relative of resources) {
    const expected = hash(path.join(root, 'src/node', relative));
    assert.equal(hash(path.join(app, 'dist/node-resources', relative)), expected, relative);
    assert.equal(hash(path.join(cli, 'src/node', relative)), expected, relative);
  }
  assert.ok(fs.existsSync(path.join(app, 'dist/skills/bitcoin-fullnode/SKILL.md')));
  assert.ok(fs.existsSync(path.join(cli, 'content/skills/bitcoin-fullnode/references/workflow.md')));
  assert.ok(fs.existsSync(path.join(temp, 'usr/share/applications/bitcode-desktop.desktop')));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', BITCODE_HOME: path.join(temp, 'state') };
  const executable = path.join(temp, 'opt/bitcode/bitcode-desktop');
  const run = args => execFileSync(executable, [path.join(cli, 'bitcode.mjs'), ...args], { cwd: temp, env, encoding: 'utf8', timeout: 30_000 });
  assert.match(run(['--version']), new RegExp(cliVersion.replaceAll('.', '\\.')));
  const plan = JSON.parse(run(['node', 'plan', '--network', 'mainnet', '--profile', 'pruned', '--rpc-port', '58332', '--p2p-port', '58333', '--json']));
  assert.equal(plan.instance.ports.rpc, 58332); assert.equal(plan.instance.ports.p2p, 58333);
  const commands = JSON.parse(run(['node', 'commands', '--explorer', '--json']));
  assert.ok(commands.bootstrap.includes(path.join(cli, 'src/node/node-helper.py')));
  let wizard = false;
  if (process.env.BITCODE_RELEASE_UI_SMOKE === '1') {
    execFileSync(process.execPath, [path.join(root, 'desktop/tests/node-ui-smoke.mjs')], { cwd: temp, env: { ...env, BITCODE_DESKTOP_EXECUTABLE: executable }, stdio: ['ignore', 'pipe', 'inherit'], timeout: 60_000 });
    wizard = true;
  }
  console.log(JSON.stringify({ passed: true, archive, desktopVersion, cliVersion, fields: fields.trim().split('\n'), sha256: hash(archive), packagedWizard: wizard, checks: ['Debian identity', 'bundled CLI version and runtime', 'node helper, keys, web service and fonts', 'bundled skill', 'desktop entry', 'Mainnet installation preview from a foreign cwd', ...(wizard ? ['native wizard from the extracted Debian package'] : [])] }, null, 2));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
