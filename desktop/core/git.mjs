import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fail } from './primitives.mjs';

const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
export function git(cwd, args, { input, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-C', cwd, ...args], { env, maxBuffer, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) reject(fail('GIT_FAILED', (stderr || error.message).trim().slice(0, 2000))); else resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function isRepoRoot(root) {
  try { return realpathSync((await git(root, ['rev-parse', '--show-toplevel'])).trim()) === realpathSync(root); } catch { return false; }
}

export async function status(root) {
  if (!await isRepoRoot(root)) return { repo: false, branch: null, files: [] };
  const out = await git(root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  const entries = out.split('\0').filter(Boolean);
  let branch = null; const files = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.startsWith('## ')) { branch = e.slice(3).split('...')[0]; continue; }
    const x = e[0], y = e[1]; let file = e.slice(3);
    if (x === 'R' || x === 'C') i++; // -z puts the rename source in the next entry
    files.push({ path: file, index: x, worktree: y });
  }
  return { repo: true, branch, files };
}

export const diff = (root, { path: p, staged = false } = {}) => git(root, ['diff', '--no-color', ...(staged ? ['--cached'] : []), '--', ...(p ? [p] : [])]);
export const stage = (root, paths) => git(root, ['add', '--', ...paths]);
export const unstage = (root, paths) => git(root, ['restore', '--staged', '--', ...paths]);
export const commit = (root, message) => git(root, ['commit', '-m', message]);

// Unattended runs (1A) work in a detached worktree outside the project; the
// result is applied to the project only by an explicit human integration.
export async function addWorktree(root, dir) {
  if (!await isRepoRoot(root)) throw fail('WORKTREE_UNAVAILABLE', 'Unattended mode needs a Git repository at the project root');
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await git(root, ['worktree', 'add', '--detach', dir, head]);
  return { dir, base: head };
}
export async function worktreePatch(dir) {
  await git(dir, ['add', '-A']);
  return git(dir, ['diff', '--cached', '--binary', '--no-color', 'HEAD']);
}
export async function integrateWorktree(root, dir) {
  const patch = await worktreePatch(dir);
  if (patch.trim()) await git(root, ['apply', '--3way', '--whitespace=nowarn', '-'], { input: patch });
  return patch;
}
export const removeWorktree = (root, dir) => git(root, ['worktree', 'remove', '--force', dir]);
