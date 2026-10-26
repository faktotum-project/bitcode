// Renderer entry: wires the workbench and finance views, subscribes to the main process and boots.
// Each area of the UI lives in its own module (shell, sidebar, thread, composer, panel, pages, ...).
import { oneDark } from '@codemirror/theme-one-dark';
import { t, setLang, errorText } from './i18n.js';
import { icon } from './icons.js';
import { createNodesView } from './nodes.js';
import { createFinanceView } from './finance.js';
import { createWorkbench } from './workbench.js';
import { renderComposer, resetHistory } from './composer.js';
import { loadAll, loadSessions, openSession, refreshGit, refreshStatus, selectProject } from './data.js';
import { $, ago, api, applyTheme, fill, fmtTime, guard, h, isDark, project, toast } from './dom.js';
import { diffPre, openDiff, openFile, themeSlot } from './editor.js';
import { panelLabel } from './panel.js';
import { md, showShortcuts, copyText, runInTerminal } from './reading.js';
import { goHome, openFolder, renderCenter, renderShell } from './shell.js';
import { renderSidebar } from './sidebar.js';
import { S } from './state.js';
import { term, termTheme } from './terminal.js';
import './events.js';

export const wb = createWorkbench({ S, h, fill, api, toast, guard, t, icon, md, diffPre, ago, fmtTime, actions: {
  draft: text => { if (S.view !== 'chat') { S.view = 'chat'; renderShell(); } S.draft = text; resetHistory(); renderComposer(); const i = $('prompt'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
  view: v => { S.view = v; renderShell(); },
  panel: k => { S.view = 'chat'; S.panel = k; renderShell(); },
  panelLabel: k => panelLabel(k),
  newChat: () => (S.projectId ? goHome(S.projectId) : openFolder()),
  openFolder: () => openFolder(),
  project: id => goHome(id),
  session: async id => { await openSession(id); renderShell(); },
  shortcuts: () => showShortcuts(),
  refreshGit: () => refreshGit(),
  openFile: async f => { S.view = 'chat'; S.panel = 'files'; renderShell(); await openFile(f); },
  showText: (title, text) => openDiff(title, text),
  reloadSessions: async () => { await loadSessions(); renderSidebar(); }
} });
export const finView = createFinanceView({ h, fill, api, toast, guard, t, icon, rerender: () => { if (S.view === 'bitcoin') renderCenter(); } });
export const bitcoinPage = () => finView.page();
export const nodeView = createNodesView({ h, api, guard, toast, copyText, runInTerminal, assist: async text => { S.agent = 'merkle'; if (S.sessionId) await api('session.update', { sessionId: S.sessionId, satId: 'merkle' }); S.view = 'chat'; S.draft = text; renderShell(); } });
// ---------- boot ----------
export function retheme() {
  for (const tab of S.tabs) tab.view?.dispatch({ effects: themeSlot.reconfigure(isDark() ? oneDark : []) });
  if (term) term.options.theme = termTheme();
}
(async function boot() {
  try {
    [S.info] = await Promise.all([api('app.info'), refreshStatus()]);
    setLang(S.settings.lang); applyTheme();
    S.models = await api('models.list').catch(() => []);
    S.worktrees = await api('worktree.list');
    await loadAll();
    const q = new URLSearchParams(location.search);
    if (q.get('mini') === '1') {
      S.mini = true; S.sideHidden = true; S.panel = null; document.documentElement.classList.add('mini');
      const pid = S.projects.some(p => p.projectId === q.get('project')) ? q.get('project') : S.projects[0]?.projectId;
      if (q.get('session') && S.sessions.some(x => x.sessionId === q.get('session'))) await openSession(q.get('session'));
      else if (pid) await selectProject(pid);
    } else {
      const latest = S.sessions[0];
      if (latest) await openSession(latest.sessionId); else if (S.projects[0]) await selectProject(S.projects[0].projectId);
    }
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); retheme(); });
    renderShell();
  } catch (e) { fill($('app'), h('div', { class: 'page' }, h('h1', {}, 'bitcode'), h('p', {}, errorText(e)))); }
})();
