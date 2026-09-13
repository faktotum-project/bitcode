// Record actual terminal output; presentation timing is handled by render-cli.mjs.
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2] || '/tmp/bitcode-cli-recordings');
if (output === repo || output.startsWith(repo + '/')) throw new Error('Keep raw captures outside the website.');
await mkdir(output, { recursive: true });
const workspace = await mkdtemp(path.join(os.tmpdir(), 'bitcode-cli-demo-'));
const project = path.join(workspace, 'bitcode');
await mkdir(project);
for (const name of ['package.json', 'package-lock.json', 'bitcode.mjs', 'src', 'commands', 'scripts']) await cp(path.join(repo, name), path.join(project, name), { recursive: true });
const state = path.join(workspace, 'state');
await mkdir(state);
const base = { version: JSON.parse(await readFile(path.join(repo, 'package.json'))).version, recordedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), workingTreeModified: true };
const sanitize = text => text.replaceAll(project, '~/bitcode').replaceAll(state, '~/.bitcode').replaceAll(workspace, '~/demo');
async function capture(argv, steps = [], timeout = 60, extraEnv = {}) {
  const request = { argv, cwd: project, steps, timeout, env: { BITCODE_HOME: state, BITCODE_MODEL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '', GROQ_API_KEY: '', ...extraEnv } };
  const result = await new Promise((resolve, reject) => {
    const child = execFile('python3', [path.join(repo, 'scripts/demos/capture-pty.py')], { timeout: (timeout + 10) * 1000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout)));
    child.stdin.end(JSON.stringify(request));
  });
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${argv.join(' ')}\n${result.events.map(e=>e.data).join('')}`);
  for (const event of result.events) event.data = sanitize(event.data);
  return result;
}
async function save(id, data) { await writeFile(path.join(output, `${id}.json`), JSON.stringify({ ...base, id, ...data }, null, 2)); console.log('Captured', id); }
// A clone from the public URL is an instructional command, not a claimed network capture.
// The install actually runs against this exact working-tree snapshot, including login.
const install = await capture(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], [], 180);
if (process.argv[3] !== 'features') {
const version = await capture([process.execPath, 'bitcode.mjs', '--version']);
const doctor = await capture([process.execPath, 'bitcode.mjs', 'doctor']);
await save('installation', {
  title: 'Install. Open your terminal.', subtitle: 'Node.js 22+ · Git · Bash',
  note: 'CLI walkthrough · waits shortened',
  provenance: 'Clone and cd are instructional command animations. npm ci, doctor and --version output were captured from the current working-tree snapshot in a temporary directory. No remote clone is claimed. --ignore-scripts skips optional wallet builds.',
  segments: [
    { command: 'git clone https://github.com/faktotum-project/bitcode.git', caption: 'Get the source. Node.js 22+, Git and Bash are required.', instructional: true },
    { command: 'cd bitcode', caption: 'Enter the project directory.', instructional: true },
    { command: 'npm ci --ignore-scripts --no-audit --no-fund', caption: 'Install the core agent. Optional wallet builds are skipped.', capture: install },
    { command: 'node bitcode.mjs doctor', caption: 'Check providers, tools and optional dependencies.', capture: doctor, hold: 3 },
    { command: 'node bitcode.mjs --version', caption: 'bitcode is installed. Next, choose your provider.', capture: version, hold: 3 },
  ],
});
const login = await capture([process.execPath, 'bitcode.mjs', 'login', 'openai'], [{ waitFor: 'enter API key', type: 'example-key-not-a-credential', enter: true }]);
const settings = await capture([process.execPath, 'bitcode.mjs', '-m', 'openai/gpt-6-astra'], [
  { waitFor: 'Ctrl+D to quit.', type: '/setting', enter: true },
  { pause: 2, type: '/exit', enter: true },
]);
await save('configuration', {
  title: 'Choose a model. Make it yours.', subtitle: 'API key setup · masked input', note: 'Example key · no API request',
  provenance: 'Actual login and /setting output, using an explicitly fake example key in disposable BITCODE_HOME. No provider request, authentication validation or GPT model execution occurred. Home paths are normalized. Login stores a key; -m selects the model for this session.',
  segments: [
    { command: 'node bitcode.mjs login openai', caption: 'Enter your API key at the masked prompt.', capture: login, hold: 2 },
    { command: 'node bitcode.mjs -m openai/gpt-6-astra', caption: 'Select a model. /setting shows the saved key and active model.', capture: settings, interactive: true, hold: 2 },
  ],
});
}
// Use a real available local model and actual public mainnet fee data.
await writeFile(path.join(state, 'config.json'), JSON.stringify({ model: 'ollama/qwen3.8:27b', bitcoin: { network: 'mainnet' }, agent: { maxSteps: 6 } }));
const fees = await capture([process.execPath, 'bitcode.mjs', '--read-only'], [
  { waitFor: 'Ctrl+D to quit.', type: '/btc:fees', enter: true },
  // Bundled commands accept arguments: first Enter completes the menu entry,
  // second Enter submits it, just like a human using the actual TUI.
  { pause: .4, type: 'Reply in at most 50 words. No tables.', enter: true },
  { waitFor: 'sat/vB', timeout: 550, pause: .5 },
  // Queue /exit only after the next prompt, which follows the streamed answer.
  { waitFor: '› ', timeout: 550, pause: 2, type: '/exit', enter: true },
], 600);
const raw = fees.events.map(e => e.data).join('');
await writeFile(path.join(output, 'features-attempt.json'), JSON.stringify(fees, null, 2));
if (!raw.includes('fastest') || raw.includes('ERROR:') || raw.includes('error:')) throw new Error('Fee demo lacks successful tool evidence');
await save('features', {
  title: 'One command. A useful answer.', subtitle: 'Bitcoin fees · read-only', model: 'ollama/qwen3.8:27b', note: 'Real CLI output · recorded mainnet snapshot',
  provenance: 'Actual bitcode interactive CLI /btc:fees with ollama/qwen3.8:27b, mainnet and --read-only. Provider ID is the configured local tag, not independent model attestation. Tool output and assistant text are unmodified except normalized home paths. Waits shortened in the video.',
  segments: [{ command: 'node bitcode.mjs --read-only', caption: 'Run /btc:fees. The agent reads public data and explains the result.', capture: fees, interactive: true, hold: 4 }],
});
console.log('Raw captures:', output);
