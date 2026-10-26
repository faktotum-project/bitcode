import { spawn } from 'node:child_process';
import { nodeError } from './model.mjs';
// The last stderr line is the actionable one (cargo, npm, gpg, the helper's sanitized JSON error).
export function failure(file, code, stderr) {
  const last = stderr.split('\n').map(line => line.trim()).filter(Boolean).at(-1);
  return `${file} exited ${code}` + (last ? `: ${last.slice(0, 300)}` : '');
}
export function execute(file, args = [], { cwd, input, signal, timeout = 120_000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, signal });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout); timer.unref();
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-8_000_000); onLine?.(b.toString()); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-64_000); });
    child.on('error', e => { clearTimeout(timer); reject(nodeError('COMMAND_UNAVAILABLE', `${file}: ${e.code}`)); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(Object.assign(nodeError('COMMAND_FAILED', failure(file, code, stderr)), { stdout, stderr })); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
