import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fail } from './primitives.mjs';

const base = () => ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
  ...(existsSync('/usr/lib64') ? ['--symlink', 'usr/lib64', '/lib64'] : []),
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', '/home/agent',
  '--setenv', 'HOME', '/home/agent', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8'];
export function probeSandbox() {
  const p = spawnSync('bwrap', [...base(), '/usr/bin/true'], { encoding: 'utf8', timeout: 5000 });
  return { available: !p.error && p.status === 0, detail: p.error?.message || p.stderr?.trim() || 'bwrap isolated namespaces available' };
}
export function spawnWorker({ runtime, appDir, root, onMessage, onExit }) {
  const dir = path.dirname(runtime);
  const args = [...base(), '--ro-bind', appDir, '/app', '--bind', root, '/workspace', '--chdir', '/workspace',
    '--setenv', 'ELECTRON_RUN_AS_NODE', '1', '--setenv', 'BITCODE_HOME', '/home/agent/.bitcode'];
  // Never mount the host's home or /run. Electron's runtime directory contains only packaged binaries.
  const executable = runtime.startsWith('/usr/') ? runtime : `/runtime/${path.basename(runtime)}`;
  if (!runtime.startsWith('/usr/')) args.push('--ro-bind', dir, '/runtime');
  args.push(executable, '/app/worker.mjs');
  const child = spawn('bwrap', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
  let error = '', buffered = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    buffered = 0;
    if (line.length > 2 * 1024 * 1024) { child.kill('SIGKILL'); return; }
    try { onMessage(JSON.parse(line)); } catch { child.kill('SIGKILL'); }
  });
  child.stdout.on('data', chunk => { buffered += chunk.length; if (buffered > 4 * 1024 * 1024) child.kill('SIGKILL'); });
  child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
  child.on('error', err => onExit(fail('SANDBOX_UNAVAILABLE', err.message)));
  child.on('exit', code => { lines.close(); onExit(code ? fail('WORKER_EXIT', error || `Worker exited ${code}`) : null); });
  return { send: data => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(data) + '\n'); },
    stop: () => child.kill('SIGKILL'), pid: child.pid };
}
