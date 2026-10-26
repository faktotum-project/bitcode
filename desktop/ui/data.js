// Loading projects, sessions, git and status from the main process.
import { wb } from './app.js';
import { api, project } from './dom.js';
import { renderPanel } from './panel.js';
import { S, SATS } from './state.js';

// ---------- data ----------
export async function loadAll() {
  S.projects = await api('project.list');
  S.sessions = await api('session.list');
}
export async function selectProject(id, { openLatest = false } = {}) {
  if (S.projectId !== id) { wb.invalidateGit(); S.files = null; S.projectId = id; S.tree.clear(); S.expanded = new Set(['.']); for (const tab of S.tabs) tab.view?.destroy(); S.tabs = []; S.active = null; }
  await Promise.all([loadTree('.').catch(() => {}), refreshGit(), loadCommandList()]);
  if (openLatest) { const s = S.sessions.find(x => x.projectId === id); if (s) await openSession(s.sessionId); else { S.sessionId = null; S.session = null; } }
}
export async function loadCommandList() { try { S.commands = await api('commands.list', { projectId: S.projectId }); } catch { S.commands = []; } }
export async function loadTree(path) { S.tree.set(path, await api('fs.tree', { projectId: S.projectId, path })); }
export async function loadSessions() { S.sessions = await api('session.list'); }
export async function openSession(id) {
  S.notes = [];
  const meta = S.sessions.find(s => s.sessionId === id);
  if (meta && meta.projectId !== S.projectId) await selectProject(meta.projectId);
  S.sessionId = id; S.session = await api('session.open', { sessionId: id }); S.live.clear(); S.view = 'chat';
  S.agent = S.session.satId || '';
  for (const s of SATS) S.sats[s] = { st: 'idle' };
}
export async function refreshGit() { if (S.projectId) { try { S.git = await api('git.status', { projectId: S.projectId }); } catch { S.git = null; } wb.invalidateDiffs(); if (['git', 'files', 'changes'].includes(S.panel)) renderPanel(); } }
export async function refreshStatus() {
  S.status = await api('app.status'); S.pending = S.status.pending; S.settings = S.status.settings;
  for (const r of S.status.runs) S.runs.set(r.runId, r);
}
