import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { t, setLang, errorText } from './i18n.js';
import { logo, sat, typing, SAT_META } from './marks.js';
import { icon } from './icons.js';
import { createFinanceView } from './finance.js';

const SATS = ['node', 'script', 'hash', 'merkle'];
const MODES = ['manual', 'assisted', 'unattended'];
const S = {
  view: 'chat', info: null, status: null, settings: null, projects: [], projectId: null, sessions: [], sessionId: null, session: null,
  collapsed: new Set(), tree: new Map(), expanded: new Set(['.']), git: null, tabs: [], active: null, panel: null, runs: new Map(), pending: [],
  sats: Object.fromEntries(SATS.map(s => [s, { st: 'idle' }])), live: new Map(), agentLog: [], worktrees: [], models: [], agent: '', commitMsg: '', draft: '', commands: [], menu: { items: [], index: 0 }, picker: { open: false, data: null, filter: '', loading: false }, notes: [], newModel: null, search: '', searching: false, renaming: null, expandedProjects: new Set(), sideHidden: (() => { try { return localStorage.getItem('bitcode.sideHidden') === '1'; } catch { return false; } })()
};

// ---------- helpers ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const fill = (el, ...c) => el && el.replaceChildren(...c.flat(Infinity).filter(x => x != null && x !== false));
const $ = id => document.getElementById(id);
async function api(method, params = {}) {
  const r = await window.bitcode.invoke(method, params);
  if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.result;
}
function toast(text, err = false) {
  const el = h('div', { class: `toast${err ? ' err' : ''}` }, text);
  $('toasts').append(el); setTimeout(() => el.remove(), err ? 7000 : 3000);
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(errorText(e), true); } };
const fmtTime = ms => new Date(ms).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'it-IT', { dateStyle: 'short', timeStyle: 'short' });
const project = () => S.projects.find(p => p.projectId === S.projectId);
const satName = s => s[0].toUpperCase() + s.slice(1);
function applyTheme() { document.documentElement.dataset.theme = S.settings?.theme || 'dark'; }
const isDark = () => (S.settings?.theme || 'dark') === 'dark' || (S.settings?.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
const activeRun = sessionId => [...S.runs.values()].find(r => r.sessionId === sessionId && !r.endedAt);

// ---------- editor ----------
const themeSlot = new Compartment();
const langFor = p => /\.(m?[jt]sx?|cjs)$/.test(p) ? javascript({ typescript: /\.tsx?$/.test(p), jsx: /x$/.test(p) }) : /\.json$/.test(p) ? json() : /\.md$/.test(p) ? markdown() : /\.py$/.test(p) ? python() : [];
async function openFile(path) {
  S.panel = 'files';
  const existing = S.tabs.find(x => x.path === path && x.kind === 'file');
  if (existing) { S.active = existing; return renderShell(); }
  const { text, version } = await api('buffer.open', { projectId: S.projectId, path });
  const tab = { kind: 'file', path, projectId: S.projectId, baseVersion: version, saved: text, dirty: false, disk: null };
  tab.view = new EditorView({ parent: h('div'), state: EditorState.create({ doc: text, extensions: [basicSetup, langFor(path), themeSlot.of(isDark() ? oneDark : []),
    keymap.of([{ key: 'Mod-s', run: () => { save(tab); return true; } }]),
    EditorView.updateListener.of(u => { if (u.docChanged) { const d = u.state.doc.toString() !== tab.saved; if (d !== tab.dirty) { tab.dirty = d; renderEditorTabs(); } } })] }) });
  S.tabs.push(tab); S.active = tab; renderShell();
}
async function save(tab, force = false) {
  try {
    const text = tab.view.state.doc.toString();
    const base = force ? tab.disk?.version ?? tab.baseVersion : tab.baseVersion;
    const { version } = await api('buffer.save', { projectId: tab.projectId, path: tab.path, text, baseVersion: base });
    Object.assign(tab, { baseVersion: version, saved: text, dirty: false, disk: null, stale: false }); toast(`${t('saved')} · ${tab.path}`); renderPanel(); refreshGit();
  } catch (e) {
    if (e.code === 'STALE_VERSION') { tab.stale = true; renderPanel(); } else toast(errorText(e), true);
  }
}
async function reload(tab) {
  const { text, version } = await api('buffer.open', { projectId: tab.projectId, path: tab.path });
  tab.view.dispatch({ changes: { from: 0, to: tab.view.state.doc.length, insert: text } });
  Object.assign(tab, { baseVersion: version, saved: text, dirty: false, disk: null, stale: false }); renderPanel();
}
async function compare(tab) {
  const { text } = await api('buffer.open', { projectId: tab.projectId, path: tab.path });
  openDiff(`${tab.path} · disco ↔ buffer`, simpleDiff(text, tab.view.state.doc.toString(), tab.path));
}
function simpleDiff(a, b, file) {
  const A = a.split('\n'), B = b.split('\n'), out = [`--- disk/${file}`, `+++ buffer/${file}`];
  let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let ea = A.length, eb = B.length; while (ea > i && eb > i && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  out.push(`@@ -${i + 1} +${i + 1} @@`, ...A.slice(i, ea).map(l => `-${l}`), ...B.slice(i, eb).map(l => `+${l}`));
  return out.join('\n');
}
function openDiff(title, text) {
  const tab = { kind: 'diff', path: title, text };
  S.tabs = S.tabs.filter(x => !(x.kind === 'diff' && x.path === title)); S.tabs.push(tab); S.active = tab; S.panel = 'files'; renderShell();
}
function closeTab(tab) {
  if (tab.dirty && !confirm(`${tab.path}: ${t('unsaved')}`)) return;
  tab.view?.destroy(); S.tabs = S.tabs.filter(x => x !== tab); if (S.active === tab) S.active = S.tabs.at(-1) || null; renderPanel();
}
const lineClass = l => l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : '';
const diffPre = text => h('pre', { class: 'diff mono' }, text.split('\n').map(l => h('span', { class: lineClass(l) }, l || ' ')));

// ---------- terminal ----------
let term = null, fit = null, ptyId = null, ptyProject = null;
const termHost = h('div', { class: 'term' });
async function ensureTerminal() {
  if (!S.projectId) return;
  if (!term) {
    term = new Terminal({ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, cursorBlink: true, theme: termTheme() });
    fit = new FitAddon(); term.loadAddon(fit);
    term.onData(data => ptyId && api('pty.write', { ptyId, data }).catch(() => {}));
    term.onResize(({ cols, rows }) => ptyId && api('pty.resize', { ptyId, cols, rows }).catch(() => {}));
    term.open(termHost);
  }
  if (ptyProject !== S.projectId) {
    if (ptyId) await api('pty.close', { ptyId }).catch(() => {});
    term.reset(); ptyProject = S.projectId;
    try { ptyId = (await api('pty.open', { projectId: S.projectId })).ptyId; } catch (e) { ptyId = null; term.write(`\r\n${errorText(e)}\r\n`); }
  }
  requestAnimationFrame(() => { try { fit.fit(); } catch {} });
}
const termTheme = () => isDark() ? { background: '#0b0e11', foreground: '#eaecef', cursor: '#f7931a', selectionBackground: '#2b3139' } : { background: '#f7f7f4', foreground: '#26251e', cursor: '#f7931a', selectionBackground: '#e6e5e0' };
window.addEventListener('resize', () => { try { fit?.fit(); } catch {} });

// ---------- data ----------
async function loadAll() {
  S.projects = await api('project.list');
  S.sessions = await api('session.list');
}
async function selectProject(id, { openLatest = false } = {}) {
  if (S.projectId !== id) { S.projectId = id; S.tree.clear(); S.expanded = new Set(['.']); for (const tab of S.tabs) tab.view?.destroy(); S.tabs = []; S.active = null; }
  await Promise.all([loadTree('.').catch(() => {}), refreshGit(), loadCommandList()]);
  if (openLatest) { const s = S.sessions.find(x => x.projectId === id); if (s) await openSession(s.sessionId); else { S.sessionId = null; S.session = null; } }
}
async function loadCommandList() { try { S.commands = await api('commands.list', { projectId: S.projectId }); } catch { S.commands = []; } }
async function loadTree(path) { S.tree.set(path, await api('fs.tree', { projectId: S.projectId, path })); }
async function loadSessions() { S.sessions = await api('session.list'); }
async function openSession(id) {
  S.notes = [];
  const meta = S.sessions.find(s => s.sessionId === id);
  if (meta && meta.projectId !== S.projectId) await selectProject(meta.projectId);
  S.sessionId = id; S.session = await api('session.open', { sessionId: id }); S.live.clear(); S.view = 'chat';
  S.agent = S.session.satId || '';
  for (const s of SATS) S.sats[s] = { st: 'idle' };
}
async function refreshGit() { if (S.projectId) { try { S.git = await api('git.status', { projectId: S.projectId }); } catch { S.git = null; } if (S.panel === 'git' || S.panel === 'files') renderPanel(); } }
async function refreshStatus() {
  S.status = await api('app.status'); S.pending = S.status.pending; S.settings = S.status.settings;
  for (const r of S.status.runs) S.runs.set(r.runId, r);
}

// ---------- events from main ----------
window.bitcode.subscribe(({ channel, payload }) => {
  if (channel === 'approval') {
    S.pending = S.pending.filter(a => a.id !== payload.id); if (payload.status === 'pending') S.pending.push(payload);
    renderSidebar(); if (S.view === 'chat') renderThread(); else if (S.view === 'activity') renderCenter();
  } else if (channel === 'run') {
    S.runs.set(payload.runId, payload);
    if (payload.endedAt) {
      S.live.delete(payload.runId); refreshGit();
      if (payload.error && payload.sessionId === S.sessionId) toast(payload.error, true);
      if (payload.worktree) api('worktree.list').then(w => { S.worktrees = w; });
      if (payload.sessionId === S.sessionId) for (const s of SATS) S.sats[s] = { st: 'idle' };
    }
    renderSidebar(); if (S.view === 'chat') { renderThread(); renderComposer(); renderTopbar(); } else if (S.view === 'activity') renderCenter();
  } else if (channel === 'session' && payload.sessionId === S.sessionId) {
    const { type, data } = payload;
    if (type === 'plan.saved') note(t('planSaved'), [data.file, t('planBuildHint')]);
    if (type === 'messages') { S.session.messages = data.messages; S.live.clear(); renderThread(); }
    if (type === 'message.delta') { S.live.set(data.runId, { agent: data.agentId, text: (S.live.get(data.runId)?.text || '') + data.text }); renderThread(); }
    if (type === 'tool.detail') { S.agentLog.push({ at: Date.now(), text: `${data.auto ? 'auto' : t('approved')} · ${data.tool} · ${data.summary}` }); if (S.panel === 'agent') renderPanel(); }
  } else if (channel === 'sat' && payload.sessionId === S.sessionId && SATS.includes(payload.satId)) {
    const visual = { writing: 'drafting', waiting_approval: 'waiting', success: 'happy', error: 'concerned', planning: 'thinking', delegating: 'running' };
    S.sats[payload.satId] = { st: visual[payload.state] || payload.state };
    renderTopbar();
  } else if (channel === 'feed') {
    const line = `${payload.agentId} · ${payload.type}${payload.data.summary ? ' · ' + payload.data.summary : ''}${payload.data.outcome ? ' · ' + payload.data.outcome : ''}`;
    S.agentLog.push({ at: Date.now(), text: line }); if (S.agentLog.length > 500) S.agentLog.shift();
    if (SATS.includes(payload.agentId) && payload.sessionId === S.sessionId) {
      const id = payload.agentId, ty = payload.type, out = payload.data.outcome;
      const st = ty === 'approval.requested' ? 'waiting' : ty === 'run.finished' ? (out === 'ok' ? 'happy' : out === 'cancelled' ? 'idle' : 'concerned')
        : ty === 'model.started' || ty === 'run.started' ? 'thinking' : ty === 'tool.started' || ty === 'tool.requested' ? (payload.data.stage || 'running') : ty === 'tool.finished' && out && out !== 'ok' ? 'concerned' : S.sats[id].st;
      S.sats[id] = { st, summary: payload.data.summary };
      if (st === 'happy' || st === 'concerned') setTimeout(() => { if (S.sats[id].st === st) { S.sats[id] = { st: 'idle' }; renderTopbar(); } }, 2400);
      renderTopbar();
    }
    if (S.panel === 'agent') renderPanel();
  } else if (channel === 'file') {
    for (const tab of S.tabs) if (tab.kind === 'file' && tab.projectId === payload.projectId && tab.path === payload.path && payload.version !== tab.baseVersion && payload.by !== 'user') {
      if (!tab.dirty) reload(tab).catch(() => {}); else { tab.disk = payload; renderPanel(); }
    }
    clearTimeout(S.gitTimer); S.gitTimer = setTimeout(refreshGit, 400);
  } else if (channel === 'pty' && payload.ptyId === ptyId) {
    if (payload.data) term?.write(payload.data); if (payload.exit !== undefined) { term?.write('\r\n[exit]\r\n'); ptyId = null; ptyProject = null; }
  } else if (channel === 'finance') { finView.onEvent(payload);
  } else if (channel === 'navigate') { S.view = payload.view; renderShell(); }
});

// ---------- shell ----------
function renderShell() {
  applyTheme();
  const app = $('app');
  if (!app.dataset.ready) {
    app.dataset.ready = '1'; app.className = 'shell';
    fill(app, h('aside', { class: 'sidebar', id: 'sidebar' }), h('main', { class: 'center', id: 'center' }), h('aside', { class: 'panel', id: 'panel' }));
  }
  app.classList.toggle('panel-open', !!S.panel && S.view === 'chat' && !!S.projectId);
  app.classList.toggle('side-hidden', !!S.sideHidden);
  renderSidebar(); renderCenter(); renderPanel();
}

const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return t('now'); if (m < 60) return `${m} min`; const hh = Math.round(m / 60); if (hh < 24) return `${hh} h`;
  const d = Math.round(hh / 24); return d === 1 ? t('yesterday') : d < 7 ? `${d} ${t('daysShort')}` : new Date(ms).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'short' });
};
function renderSidebar() {
  const el = $('sidebar'); if (!el) return;
  const q = S.search.trim().toLowerCase();
  const action = (ic, label, onClick, { on = false, badge = null, kbd = null } = {}) => h('button', { class: `sact${on ? ' on' : ''}`, onClick },
    icon(ic), h('span', { class: 'label' }, label), badge ? h('span', { class: 'badge num' }, badge) : kbd ? h('kbd', {}, kbd) : null);
  const threadRow = s => {
    const run = activeRun(s.sessionId), waiting = S.pending.some(a => a.sessionId === s.sessionId), on = s.sessionId === S.sessionId && S.view === 'chat';
    if (S.renaming === s.sessionId) return h('div', { class: 'trow editing' }, h('input', { type: 'text', value: s.name, class: 'rename', 'aria-label': t('rename'),
      onKeydown: guard(async e => { if (e.key === 'Escape') { S.renaming = null; renderSidebar(); } if (e.key === 'Enter') { await api('session.update', { sessionId: s.sessionId, name: e.target.value.trim() || s.name }); S.renaming = null; await loadSessions(); if (S.session?.sessionId === s.sessionId) S.session.name = e.target.value.trim() || s.name; renderSidebar(); renderTopbar(); } }),
      onBlur: () => { S.renaming = null; renderSidebar(); } }));
    return h('div', { class: `trow${on ? ' on' : ''}`, role: 'button', tabindex: 0, title: s.name, onClick: guard(async e => { if (e.target.closest('.tmenu')) return; await openSession(s.sessionId); renderShell(); }),
      onKeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); } },
      waiting ? h('span', { class: 'tstate wait', title: t('waiting') }) : run ? h('span', { class: 'tstate run', title: t(`run_${run.state}`) }) : null,
      h('span', { class: 'tname' }, s.name),
      s.keep ? h('span', { class: 'tkeep', title: t('kept') }, icon('star', { size: 12 })) : null,
      h('span', { class: 'ttime num' }, ago(s.updatedAt)),
      h('span', { class: 'tmenu' },
        h('button', { title: t('rename'), 'aria-label': t('rename'), onClick: e => { e.stopPropagation(); S.renaming = s.sessionId; renderSidebar(); setTimeout(() => { const i = el.querySelector('.rename'); i?.focus(); i?.select(); }, 0); } }, icon('pencil', { size: 14 })),
        h('button', { title: s.keep ? t('kept') : t('keep'), 'aria-label': t('keep'), onClick: guard(async e => { e.stopPropagation(); await api('session.update', { sessionId: s.sessionId, keep: !s.keep }); await loadSessions(); if (S.session?.sessionId === s.sessionId) Object.assign(S.session, { keep: !s.keep }); renderSidebar(); }) }, icon('star', { size: 14 })),
        h('button', { title: t('delete'), 'aria-label': t('delete'), disabled: !!run, onClick: guard(async e => { e.stopPropagation(); if (!confirm(`${t('delete')} «${s.name}»?`)) return; await api('session.delete', { sessionId: s.sessionId }); await loadSessions(); if (S.sessionId === s.sessionId) { S.sessionId = null; S.session = null; } renderShell(); }) }, icon('trash', { size: 14 }))));
  };
  const groups = S.projects.map(p => {
    const all = S.sessions.filter(s => s.projectId === p.projectId && (!q || s.name.toLowerCase().includes(q)));
    if (q && !all.length && !p.name.toLowerCase().includes(q)) return null;
    const open = q || !S.collapsed.has(p.projectId), expanded = S.expandedProjects.has(p.projectId);
    const shown = expanded || q ? all : all.slice(0, 6);
    const live = all.filter(x => activeRun(x.sessionId)).length;
    return h('div', { class: 'pgroup' },
      h('div', { class: `prow${p.projectId === S.projectId ? ' cur' : ''}`, role: 'button', tabindex: 0, title: p.root, onClick: () => { open ? S.collapsed.add(p.projectId) : S.collapsed.delete(p.projectId); renderSidebar(); } },
        icon(open ? 'chevronDown' : 'chevronRight', { size: 12, cls: 'chev' }), icon('folder', { size: 15 }), h('span', { class: 'pname' }, p.name),
        live ? h('span', { class: 'tstate run', title: `${live} ${t('runsActive').toLowerCase()}` }) : null,
        h('button', { class: 'padd', title: `${t('newChat')} · ${p.name}`, 'aria-label': t('newChat'), onClick: guard(async e => { e.stopPropagation(); await goHome(p.projectId); }) }, icon('compose', { size: 14 }))),
      open ? h('div', { class: 'threads' }, shown.map(threadRow),
        !all.length ? h('div', { class: 'tempty' }, t('noChats')) : null,
        all.length > shown.length ? h('button', { class: 'tmore', onClick: () => { S.expandedProjects.add(p.projectId); renderSidebar(); } }, `${t('showMore')} (${all.length - shown.length})`) : null) : null);
  });
  const searchBox = S.searching ? h('div', { class: 'ssearch' }, icon('search'), h('input', { id: 'sidesearch', type: 'text', placeholder: t('searchChats'), value: S.search,
    onInput: e => { S.search = e.target.value; const pos = e.target.selectionStart; renderSidebar(); const i = $('sidesearch'); i?.focus(); i?.setSelectionRange(pos, pos); },
    onKeydown: e => { if (e.key === 'Escape') { S.searching = false; S.search = ''; renderSidebar(); } } }),
    h('button', { class: 'sclose', 'aria-label': t('close'), onClick: () => { S.searching = false; S.search = ''; renderSidebar(); } }, icon('close', { size: 14 }))) : null;
  fill(el,
    h('div', { class: 'shead' }, logo({ size: 22 }), h('span', { class: 'word' }, 'bitcode'), h('span', { class: 'spacer' }),
      h('button', { class: 'ibtn', title: `${t('hideSidebar')} (Ctrl+B)`, 'aria-label': t('hideSidebar'), onClick: toggleSidebar }, icon('sidebar'))),
    h('div', { class: 'sactions' },
      action('compose', t('newChat'), guard(() => S.projectId ? goHome(S.projectId) : openFolder()), { kbd: 'Ctrl N' }),
      searchBox || action('search', t('search'), openSearch, { kbd: 'Ctrl K' }),
      action('bitcoin', t('bitcoin'), () => { S.view = 'bitcoin'; renderShell(); }, { on: S.view === 'bitcoin' }),
      action('activity', t('activity'), () => { S.view = 'activity'; renderShell(); }, { on: S.view === 'activity', badge: S.pending.length || null })),
    h('div', { class: 'sscroll' },
      h('div', { class: 'ssec' }, h('span', {}, t('projects')), h('button', { class: 'ibtn sm', title: t('openFolder'), 'aria-label': t('openFolder'), onClick: openFolder }, icon('folderPlus', { size: 15 }))),
      S.projects.length ? groups : h('button', { class: 'sact', onClick: openFolder }, icon('folderPlus'), h('span', { class: 'label' }, t('openFolder')))),
    h('div', { class: 'sfoot' },
      action('settings', t('settings'), () => { S.view = 'settings'; renderShell(); }, { on: S.view === 'settings' }),
      h('div', { class: 'sstatus', title: S.status?.sandbox.available ? t('sandboxOk') : t('sandboxMissing') },
        h('span', { class: `sdot ${S.status?.sandbox.available ? 'ok' : 'err'}` }), h('span', {}, S.status?.sandbox.available ? 'sandbox' : t('sandboxShort')), h('span', { class: 'num' }, `v${S.info?.version || ''}`))));
}
function toggleSidebar() { S.sideHidden = !S.sideHidden; try { localStorage.setItem('bitcode.sideHidden', S.sideHidden ? '1' : ''); } catch {} renderShell(); }
function openSearch() { S.searching = true; renderSidebar(); setTimeout(() => $('sidesearch')?.focus(), 0); }
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); toggleSidebar(); }
  else if (k === 'k') { e.preventDefault(); if (S.sideHidden) toggleSidebar(); openSearch(); }
  else if (k === 'n') { e.preventDefault(); if (S.projectId) goHome(S.projectId); }
});
const goHome = async projectId => { await selectProject(projectId); S.sessionId = null; S.session = null; S.view = 'chat'; renderShell(); setTimeout(() => $('prompt')?.focus(), 0); };
const openFolder = guard(async () => {
  const p = await api('dialog.openFolder'); if (!p) return;
  const proj = await api('project.open', { path: p }); S.projects = await api('project.list'); await goHome(proj.projectId);
});

function renderCenter() {
  const el = $('center'); if (!el) return;
  if (S.view === 'chat') {
    el.style.display = '';
    fill(el, h('header', { class: 'topbar', id: 'topbar' }), h('div', { class: 'scroll', id: 'thread' }), h('div', { class: 'composer-wrap', id: 'composer' }));
    renderTopbar(); renderThread(); renderComposer();
  } else {
    el.style.display = 'block';
    fill(el, S.view === 'activity' ? activityPage() : S.view === 'bitcoin' ? bitcoinPage() : settingsPage());
  }
}

function showSatInfo(info) {
  const dialog = h('dialog', { class: 'sat-info', 'aria-labelledby': 'sat-info-title' });
  fill(dialog,
    h('div', { class: 'row' }, info.id ? sat(info.id, { size: 36 }) : null,
      h('h2', { id: 'sat-info-title' }, info.name ? `${info.name} · ${t(`role_${info.id}`)}` : 'Sat Workspace'),
      h('button', { class: 'iconbtn', autofocus: true, onClick: () => dialog.close(), 'aria-label': t('satClose') }, '×')),
    info.identity ? h('p', { class: 'mono' }, 'Sat Identity · ', info.identity) : null,
    h('h3', {}, 'Sat Workspace'), h('p', { class: 'mono' }, info.workspace),
    info.permissions ? [h('h3', {}, t('satPermissions')), h('div', { class: 'row' }, Object.entries(info.permissions).map(([key, value]) => h('span', { class: 'chip mono' }, `${key}: ${value}`)))] : null,
    info.tools ? [h('h3', {}, t('satDeclaredTools')), h('p', { class: 'mono' }, info.tools.join(' · '))] : null,
    info.history ? [h('h3', {}, t('satHistory')), info.history.length ? h('ul', {}, info.history.slice(-5).reverse().map(e => h('li', {}, `${fmtTime(e.at)} · ${e.state}`))) : h('p', {}, t('satHistoryEmpty'))] : null,
    info.id ? h('details', {}, h('summary', {}, 'Sat Manifest'), h('pre', {}, JSON.stringify(info, null, 2))) : null);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}

function renderTopbar() {
  const el = $('topbar'); if (!el) return;
  const s = S.session, p = project();
  const toggle = (key, label) => h('button', { class: `iconbtn${S.panel === key ? ' on' : ''}`, title: key === 'terminal' ? t('terminalShort') : t(key), 'aria-label': key === 'terminal' ? t('terminalShort') : t(key), onClick: () => { S.panel = S.panel === key ? null : key; renderShell(); } }, label);
  fill(el,
    S.sideHidden ? h('button', { class: 'ibtn', title: `${t('showSidebar')} (Ctrl+B)`, 'aria-label': t('showSidebar'), onClick: toggleSidebar }, icon('sidebar')) : null,
    h('span', { class: 'title', title: s?.name || '' }, s ? s.name : p ? p.name : 'bitcode'),
    p ? h('span', { class: 'chip opt' }, p.name) : null,
    S.git?.repo ? h('span', { class: 'chip opt mono' }, `⎇ ${S.git.branch || 'HEAD'}${S.git.files.length ? ` · ${S.git.files.length}` : ''}`) : null,
    s ? h('button', { class: 'chip', style: 'cursor:pointer', title: s.keep ? t('kept') : `${t('expiresIn')} ${fmtTime(s.expiresAt)}`,
      onClick: guard(async () => { const r = await api('session.update', { sessionId: s.sessionId, keep: !s.keep }); Object.assign(S.session, { keep: r.keep, expiresAt: r.expiresAt }); renderTopbar(); }) }, s.keep ? `★ ${t('kept')}` : `☆ ${t('keep')}`) : null,
    h('span', { class: 'spacer' }),
    s ? h('div', { class: 'satrow' }, SATS.map(x => h('button', { class: 'iconbtn', 'aria-label': `Sat info ${satName(x)}`, onClick: guard(async () => {
      const res = await api('chat.submit', { sessionId: s.sessionId, text: `/sat info ${x}` }); showSatInfo(res.result);
    }) }, sat(x, { size: 30, state: S.sats[x].st, title: `${satName(x)} · ${t(`role_${x}`)}` })))) : null,
    p ? h('div', { class: 'tools' }, toggle('files', '▤'), toggle('git', '⎇'), toggle('terminal', '>_'), toggle('agent', '◉')) : null);
}

function renderThread() {
  const el = $('thread'); if (!el) return;
  const p = project();
  if (!p) return fill(el, home(null));
  if (!S.session) return fill(el, home(p));
  const s = S.session, run = activeRun(s.sessionId), model = s.model || S.status?.defaultModel?.spec || '';
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  const items = [];
  for (const m of s.messages) {
    if (m.role === 'tool') continue;
    if (m.role === 'user') items.push(h('div', { class: 'm-user' }, m.content));
    else {
      if (m.content) items.push(h('div', { class: 'm-bot' }, h('div', { class: 'who' }, logo({ size: 16 }), 'Bitcode', h('span', { class: 'num' }, `· ${model}`)), m.content));
      if (m.tools?.length) items.push(h('div', { class: 'm-tools mono' }, m.tools.map(x => h('div', {}, x))));
    }
  }
  for (const [, l] of S.live) items.push(h('div', { class: 'm-bot live' }, h('div', { class: 'who' }, SATS.includes(l.agent) ? sat(l.agent, { size: 20, state: 'drafting' }) : logo({ size: 16 }), SATS.includes(l.agent) ? satName(l.agent) : 'Bitcode', typing(SAT_META[l.agent]?.color)), l.text));
  items.push(...S.pending.filter(a => a.sessionId === s.sessionId).map(approvalCard));
  items.push(...S.notes.map(n => h('div', { class: 'note' }, h('div', { class: 'ntitle' }, n.title), n.lines.length ? h('div', { class: 'nbody mono' }, n.lines.map(l => h('div', {}, l))) : null)));
  if (run) items.push(h('div', { class: 'runline' }, typing(), t(`run_${run.state}`), h('span', { class: 'num' }, `${run.usage.inputTokens + run.usage.outputTokens} ${t('tokens')}`)));
  if (!items.length) return fill(el, home(p));
  fill(el, h('div', { class: 'col' }, items));
  if (stick) el.scrollTop = el.scrollHeight;
}

function home(p) {
  return h('div', { class: 'home' }, h('div', { class: 'inner' },
    h('div', { class: 'lockup' }, logo({ size: 60, build: true }), h('span', { class: 'word' }, 'bitcode')),
    h('div', { class: 'sats4' }, SATS.map(x => sat(x, { size: 52, state: 'idle', title: `${satName(x)} · ${t(`role_${x}`)}` }))),
    p ? h('h1', {}, t('homeTitle'), ' ', h('em', {}, p.name), '?') : h('h1', {}, t('welcome')),
    h('p', {}, p ? t('homeSub') : t('homeNoProject')),
    !S.status?.sandbox.available ? h('p', { class: 'chip err' }, t('sandboxMissing')) : null,
    p ? null : h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn primary pill', onClick: openFolder }, t('openFolder')), h('button', { class: 'btn pill', onClick: () => { S.view = 'settings'; renderShell(); } }, t('settings')))));
}

// ---------- composer: slash menu, model picker, command results ----------
const UI_COMMANDS = {
  models: () => openModelPicker(), diff: () => { S.panel = 'git'; renderShell(); },
  new: () => goHome(S.projectId), reset: () => goHome(S.projectId),
  export: guard(async () => { if (!S.session) return; openDiff(`export · ${S.session.name}`, await api('session.export', { sessionId: S.session.sessionId })); }),
  settings: () => { S.view = 'settings'; renderShell(); }
};
for (const k of ['setting', 'config', 'login', 'provider', 'doctor']) UI_COMMANDS[k] = UI_COMMANDS.settings;
const cmdHint = c => { const k = `cmd_${c.name}`, v = t(k); return v === k ? c.hint : v; };
function note(title, lines = []) { S.notes.push({ title, lines: [].concat(lines) }); renderThread(); }
function showResult(res) {
  const r = res.result;
  if (Array.isArray(r)) return note(t('pendingReq'), r.length ? r.map(a => `${a.id.slice(0, 12)} · ${a.role || a.kind}`) : [t('none')]);
  if (r?.commands) return note(t('commandsTitle'), r.commands.map(c => `/${c.name}${c.args ? ' …' : ''} — ${cmdHint(c)}${c.scope === 'cli' ? ` (${t('cliOnly')})` : ''}`));
  if (r?.tools) return note(t('toolsTitle'), r.tools);
  if (r?.status) { const st = r.status; return note(t('statusTitle'), [`${t('model')}: ${st.model}`, `${t('mode')}: ${t(st.mode)}`, `Sat: ${st.sat || '—'}`, `${t('messages')}: ${st.messages}`, `${t('tokens')}: ${st.usage.inputTokens + st.usage.outputTokens}`, `${t('planL')}: ${st.plan || '—'}`]); }
  if (r?.model && !r.session) return note(t('model'), [`${r.model.spec} · ${t(r.model.locality) || r.model.locality}`]);
  if (r?.model && r.session) { S.session.model = r.session.model; toast(`${t('model')}: ${r.model.spec}`); renderComposer(); return; }
  if (r?.satId) { S.agent = r.satId; S.session.satId = S.agent; renderComposer(); return toast(`${satName(S.agent)} · ${r.role}`); }
  if (r?.workspace) return showSatInfo(r);
  if (r?.mode) { S.session.mode = r.mode; loadSessions(); renderComposer(); return; }
  if (r?.run) { S.notes = []; api('session.open', { sessionId: S.session.sessionId }).then(x => { S.session = x; renderThread(); renderSidebar(); }); }
}

function renderComposer() {
  const el = $('composer'); if (!el) return;
  if (!project()) return fill(el);
  const s = S.session, run = s && activeRun(s.sessionId);
  const menuEl = h('div', { class: 'cmdmenu', role: 'listbox', hidden: true });
  const input = h('textarea', { id: 'prompt', rows: 2, placeholder: s ? t('placeholder') : t('placeholderNew'), 'aria-label': t('placeholder'), 'aria-autocomplete': 'list',
    onInput: e => { S.draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = `${Math.min(240, e.target.scrollHeight)}px`; updateMenu(); },
    onKeydown: e => {
      if (S.menu.items.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.menu.index = (S.menu.index + (e.key === 'ArrowDown' ? 1 : -1) + S.menu.items.length) % S.menu.items.length; drawMenu(); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); return pick(S.menu.items[S.menu.index], e.key === 'Enter'); }
        if (e.key === 'Escape') { e.preventDefault(); S.menu.items = []; drawMenu(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    } });
  input.value = S.draft;
  function updateMenu() {
    const v = input.value;
    S.menu.items = v.startsWith('/') && !/\s/.test(v) ? S.commands.filter(c => c.name.toLowerCase().startsWith(v.slice(1).toLowerCase())).slice(0, 60) : [];
    S.menu.index = Math.min(S.menu.index, Math.max(0, S.menu.items.length - 1)); drawMenu();
  }
  function drawMenu() {
    menuEl.hidden = !S.menu.items.length;
    fill(menuEl, S.menu.items.map((c, i) => h('div', { class: `cmditem${i === S.menu.index ? ' on' : ''}${c.scope === 'cli' ? ' off' : ''}`, role: 'option', 'aria-selected': i === S.menu.index ? 'true' : 'false',
      onMousedown: e => { e.preventDefault(); pick(c, !c.args); } },
      h('span', { class: 'cname mono' }, `/${c.name}`), h('span', { class: 'chint' }, cmdHint(c)),
      c.scope === 'cli' ? h('span', { class: 'chip' }, t('cliOnly')) : c.custom ? h('span', { class: 'chip' }, t('customL')) : null)));
    menuEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function pick(c, submitNow) {
    if (c.scope === 'cli') { toast(`/${c.name}: ${t('cliOnlyLong')}`, true); return; }
    input.value = c.args ? `/${c.name} ` : `/${c.name}`; S.draft = input.value; S.menu.items = []; drawMenu(); input.focus();
    if (submitNow && !c.args) submit();
  }
  const submit = guard(async () => {
    const text = input.value.trim(); if (!text) return;
    const [cmdName] = text.slice(1).split(/\s+/);
    if (text.startsWith('/') && UI_COMMANDS[cmdName]) { S.draft = ''; input.value = ''; S.menu.items = []; drawMenu(); return UI_COMMANDS[cmdName](); }
    let session = S.session;
    if (!session) {
      const meta = await api('session.create', { projectId: S.projectId, name: text.replace(/^\/\S+\s*/, '').replace(/\s+/g, ' ').slice(0, 48) || text.slice(0, 48), mode: S.newMode || 'assisted', satId: S.agent, model: S.newModel || undefined });
      await loadSessions(); await openSession(meta.sessionId); session = S.session; renderShell();
    }
    const res = await api('chat.submit', { sessionId: session.sessionId, text, agent: S.agent });
    S.draft = ''; if ($('prompt')) $('prompt').value = '';
    if (res.command) showResult(res);
    else { S.notes = []; S.session = await api('session.open', { sessionId: session.sessionId }); renderThread(); renderComposer(); renderSidebar(); }
  });
  const modeSelect = h('select', { 'aria-label': t('mode'), onChange: guard(async e => {
    if (!s) { S.newMode = e.target.value; return; }
    const r = await api('mode.set', { sessionId: s.sessionId, mode: e.target.value }); S.session.mode = r.mode; await loadSessions();
  }) }, MODES.map(m => h('option', { value: m, selected: (s?.mode || S.newMode || 'assisted') === m }, t(m))));
  const currentModel = s?.model || S.newModel || S.status?.defaultModel?.spec || '—';
  fill(el, h('div', { class: 'composer' }, menuEl, input,
    h('div', { class: 'bar' },
      h('select', { 'aria-label': t('agentL'), disabled: !!run, onChange: guard(async e => {
        const id = e.target.value;
        if (s) await api('session.update', { sessionId: s.sessionId, satId: id });
        S.agent = id;
      }) }, h('option', { value: '', selected: !S.agent }, 'Bitcode'), SATS.map(a => h('option', { value: a, selected: S.agent === a }, satName(a)))),
      modeSelect,
      h('div', { class: 'modelpick' },
        h('button', { class: 'modelbtn num', title: t('chooseModel'), 'aria-haspopup': 'listbox', 'aria-expanded': S.picker.open ? 'true' : 'false', disabled: !!run, onClick: () => S.picker.open ? closeModelPicker() : openModelPicker() },
          h('span', { class: `loc ${modelLocality(currentModel)}` }), currentModel, h('span', { class: 'caret' }, '▾')),
        S.picker.open ? modelPopover() : null),
      h('span', { style: 'flex:1' }),
      run ? h('button', { class: 'send stop', title: t('stop'), 'aria-label': t('stop'), onClick: guard(() => api('run.cancel', { runId: run.runId })) }, '■')
        : h('button', { class: 'send', title: t('send'), 'aria-label': t('send'), onClick: submit }, '↑'))),
    h('div', { class: 'hint' }, t('hint')));
  if (S.draft) updateMenu();
}

// Model picker: everything runnable on this machine first (any runtime, probed
// live, with a memory-fit badge), downloaded-but-not-served models with the
// command to serve them, then cloud providers. Shared by the composer popover
// and the settings dialog.
const modelLocality = spec => {
  const a = S.picker.data; if (!a || !spec) return 'unknown';
  if (a.local.some(p => spec.startsWith(`${p.provider}/`))) return 'local';
  return a.cloud.some(c => spec.startsWith(`${c.provider}/`)) ? 'cloud' : 'unknown';
};
async function loadModels() { S.picker.loading = true; try { S.picker.data = await api('models.available'); } finally { S.picker.loading = false; } }
const openModelPicker = guard(async () => { S.picker.open = true; S.picker.filter = ''; renderComposer(); await loadModels(); if (S.picker.open) renderComposer(); setTimeout(() => $('modelfilter')?.focus(), 0); });
function closeModelPicker() { S.picker.open = false; renderComposer(); }
document.addEventListener('mousedown', e => { if (S.picker.open && !e.target.closest('.modelpick')) closeModelPicker(); });
const chooseModel = guard(async spec => {
  S.picker.open = false;
  if (S.session) { const r = await api('chat.submit', { sessionId: S.session.sessionId, text: `/model ${spec}` }); showResult({ command: true, result: r.result }); }
  else { S.newModel = spec; renderComposer(); }
});
const gb = n => n ? `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB` : '';
const fitBadge = fit => fit && fit !== 'unknown' ? h('span', { class: `fit ${fit}`, title: t(`fitHint_${fit}`) }, t(`fit_${fit}`)) : null;
function machineLine(m) {
  if (!m) return null;
  const gpu = m.gpus.map(g => `${g.name}${g.vram ? ` ${gb(g.vram)}` : ''}${g.unified ? ` · ${t('sharedMem')}` : ''}`).join(', ');
  return h('div', { class: 'machine num' }, h('span', {}, `RAM ${gb(m.ram.total)} · ${gb(m.ram.available)} ${t('free')}`), gpu ? h('span', {}, `GPU ${gpu}`) : null, h('span', {}, `${m.cpus} core`));
}
function modelList({ current, filter = '', onPick, onRefresh, inherit = null, fitsOnly = false }) {
  const d = S.picker.data, q = filter.toLowerCase(), match = x => !q || x.toLowerCase().includes(q);
  const item = (spec, label, detail, extra = {}) => h('button', { class: `mitem${spec === current ? ' on' : ''}`, role: 'option', 'aria-selected': spec === current ? 'true' : 'false', onClick: () => onPick(spec) },
    h('span', { class: 'mname num' }, label), extra.fit ? fitBadge(extra.fit) : null, detail ? h('span', { class: 'mdetail num' }, detail) : null, spec === current ? h('span', { class: 'check' }, '✓') : null);
  const body = [];
  if (inherit) body.push(h('button', { class: `mitem${!current ? ' on' : ''}`, onClick: () => onPick(null) }, h('span', { class: 'mname' }, inherit), !current ? h('span', { class: 'check' }, '✓') : null));
  if (!d) { body.push(h('div', { class: 'mnote' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')), ' ', t('probing'))); return body; }
  body.push(h('div', { class: 'mgroup' }, t('localModels'), onRefresh ? h('button', { class: 'mrefresh', title: t('refresh'), onClick: onRefresh }, '↻') : null));
  let anyLocal = false;
  for (const p of d.local) {
    const models = p.models.filter(m => match(m.spec) && (!fitsOnly || ['gpu', 'ram'].includes(m.fit)));
    if (q && !models.length) continue;
    anyLocal ||= models.length > 0;
    body.push(h('div', { class: 'mprov' }, h('span', { class: `loc ${p.running ? 'local' : 'off'}` }), p.label || p.provider,
      !p.configured ? h('span', { class: 'chip warn' }, t('detected')) : null,
      h('span', { class: 'mdetail' }, p.running ? `${p.models.length} ${t('installed')}` : t('notRunning')),
      !p.configured ? h('button', { class: 'btn sm', onClick: guard(async () => { await api('models.addLocalProvider', { name: p.provider, baseURL: p.baseURL }); toast(`${p.label} ${t('added')}`); await onRefresh?.(); }) }, t('addRuntime')) : null));
    body.push(...models.map(m => p.configured ? item(m.spec, m.model, [gb(m.size), m.detail.replace(/ · [\d.]+ GB$/, '')].filter(Boolean).join(' · '), { fit: m.fit })
      : h('div', { class: 'mitem disabled' }, h('span', { class: 'mname num' }, m.model), fitBadge(m.fit), h('span', { class: 'mdetail num' }, gb(m.size)))));
    if (p.hint && !q) body.push(h('div', { class: 'mnote mono' }, p.hint));
  }
  if (!anyLocal && !q) body.push(h('div', { class: 'mnote' }, t('noLocalModels')));
  const idle = (d.idle || []).filter(x => match(x.name));
  if (idle.length) {
    body.push(h('div', { class: 'mgroup' }, t('idleModels')));
    for (const x of idle) body.push(h('div', { class: 'midle' }, h('div', { class: 'mrow' }, h('span', { class: 'mname num' }, x.name), fitBadge(x.fit), h('span', { class: 'mdetail num' }, `${x.runtime} · ${gb(x.size)}`)),
      x.hint ? h('code', { class: 'mhint', title: t('copy'), onClick: () => { navigator.clipboard?.writeText(x.hint); toast(t('copied')); } }, x.hint) : null));
  }
  if (!d.localOnly) {
    const cloud = d.cloud.filter(c => c.spec && match(c.spec));
    if (cloud.length) body.push(h('div', { class: 'mgroup' }, t('cloudModels')), ...cloud.map(c => item(c.spec, c.spec, c.hasKey ? t('hasKey') : t('noKey'))));
  }
  if (q.includes('/') && ![...d.local.flatMap(p => p.models.map(m => m.spec)), ...d.cloud.map(c => c.spec)].includes(filter.trim()))
    body.push(h('div', { class: 'mgroup' }, t('customModel')), item(filter.trim(), filter.trim(), t('typed')));
  return body;
}
function modelPopover() {
  const current = S.session?.model || S.newModel || S.status?.defaultModel?.spec;
  const refresh = guard(async () => { await loadModels(); renderComposer(); });
  const custom = h('input', { id: 'modelfilter', type: 'text', class: 'mono', placeholder: t('modelFilter'), value: S.picker.filter,
    onInput: e => { S.picker.filter = e.target.value; const pos = e.target.selectionStart; renderComposer(); const i = $('modelfilter'); i?.focus(); i?.setSelectionRange(pos, pos); },
    onKeydown: e => { if (e.key === 'Enter' && e.target.value.includes('/')) chooseModel(e.target.value.trim()); if (e.key === 'Escape') closeModelPicker(); } });
  return h('div', { class: 'modelpop', role: 'listbox' }, custom, h('div', { class: 'mlist' }, modelList({ current, filter: S.picker.filter, onPick: chooseModel, onRefresh: refresh })),
    h('div', { class: 'mfoot' }, h('span', { class: 'status' }, t('modelFoot')),
      h('button', { class: 'btn sm ghost', disabled: !current, onClick: guard(async () => { S.settings = await api('settings.set', { key: 'model', value: current }); await refreshStatus(); toast(`${t('defaultModel')}: ${current}`); closeModelPicker(); }) }, t('setDefault'))));
}
// opencode-style dialog: search, machine summary, "fits in memory" filter.
function openModelDialog({ title, current, inherit = null, onPick }) {
  const state = { filter: '', fitsOnly: false };
  const overlay = h('div', { class: 'overlay', onMousedown: e => { if (e.target === overlay) close(); } });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const pick = guard(async spec => { await onPick(spec); close(); });
  const draw = () => {
    const search = h('input', { type: 'text', class: 'mono', placeholder: t('modelFilter'), value: state.filter, 'aria-label': t('modelFilter'),
      onInput: e => { state.filter = e.target.value; const pos = e.target.selectionStart; draw(); const i = overlay.querySelector('input'); i.focus(); i.setSelectionRange(pos, pos); },
      onKeydown: e => { if (e.key === 'Enter' && state.filter.includes('/')) pick(state.filter.trim()); } });
    fill(overlay, h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'dhead' }, h('span', { class: 'dtitle' }, title), h('button', { class: 'ibtn', 'aria-label': t('close'), onClick: close }, icon('close'))),
      h('div', { class: 'dsearch' }, icon('search'), search),
      h('div', { class: 'dbar' }, machineLine(S.picker.data?.machine),
        h('label', { class: 'dtoggle' }, h('input', { type: 'checkbox', checked: state.fitsOnly, onChange: e => { state.fitsOnly = e.target.checked; draw(); } }), t('fitsOnly'))),
      h('div', { class: 'mlist dlist' }, modelList({ current, filter: state.filter, fitsOnly: state.fitsOnly, inherit, onPick: pick, onRefresh: guard(async () => { S.picker.data = null; draw(); await loadModels(); draw(); }) }))));
    if (!state.filter) setTimeout(() => overlay.querySelector('input')?.focus(), 0);
  };
  document.body.append(overlay); draw();
  if (!S.picker.data) loadModels().then(draw);
}

function approvalCard(a) {
  const sub = a.subject || {};
  const resolve = decision => guard(async () => { await api('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision }); });
  const body = a.kind === 'command' ? h('pre', { class: 'cmd mono' }, sub.shell)
    : a.kind === 'patch' ? h('pre', { class: 'cmd mono' }, (sub.unifiedDiff || '').split('\n').map(l => h('span', { class: lineClass(l) }, l || ' ')))
    : a.kind === 'network' ? h('pre', { class: 'cmd mono' }, sub.url) : h('pre', { class: 'cmd mono' }, sub.model || JSON.stringify(sub));
  const kv = [[t('agentL'), `${sub.agentId || ''} · ${sub.model || ''}`], [t('mode'), t(sub.mode)],
    a.kind === 'command' ? [t('sandbox'), t('sandboxNoNet')] : null, [t('reason'), sub.reason], [t('id'), `${a.id.slice(0, 12)} · ${t('expires')} ${new Date(a.expiresAt).toLocaleTimeString()}`]].filter(x => x && x[1]);
  return h('div', { class: 'approval', role: 'group', 'aria-label': t(`kind_${a.kind}`) },
    h('h4', {}, SATS.includes(sub.agentId) ? sat(sub.agentId, { size: 24, state: 'waiting' }) : logo({ size: 18 }), `${sub.agentId === 'bitcode' || !sub.agentId ? 'Bitcode' : satName(sub.agentId)} ${t(`kind_${a.kind}`)}`), body,
    h('dl', { class: 'kv' }, kv.map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, v)])),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: resolve('approve') }, t('approveOnce')), h('button', { class: 'btn', onClick: resolve('deny') }, t('deny')),
      a.kind === 'command' && sub.argv ? h('button', { class: 'btn ghost', onClick: guard(async () => { if (confirm(`${t('addPolicy')}: ${sub.argv.join(' ')}`)) { await api('policy.propose', { projectId: sub.projectId, add: { command: sub.shell } }); toast(t('addPolicy')); } }) }, `${t('addPolicy')}…`) : null,
      a.kind === 'network' ? h('button', { class: 'btn ghost', onClick: guard(async () => { if (confirm(`${t('addDestination')}: ${sub.destination.scheme}://${sub.destination.host}:${sub.destination.port}`)) { await api('policy.propose', { projectId: sub.projectId, add: { destination: sub.destination } }); toast(t('addDestination')); } }) }, `${t('addDestination')}…`) : null));
}

// ---------- right panel ----------
function renderPanel() {
  const el = $('panel'); if (!el) return;
  $('app').classList.toggle('panel-open', !!S.panel && S.view === 'chat' && !!S.projectId);
  if (!S.panel || !S.projectId) return fill(el);
  const tabs = h('div', { class: 'ptabs', role: 'tablist' }, ['files', 'git', 'terminal', 'agent'].map(k => h('button', { class: `ptab${S.panel === k ? ' on' : ''}`, onClick: () => { S.panel = k; renderPanel(); renderTopbar(); } }, k === 'terminal' ? t('terminalShort') : t(k))),
    h('span', { class: 'spacer' }), h('button', { class: 'ptab', 'aria-label': 'close', onClick: () => { S.panel = null; renderShell(); } }, '×'));
  let body;
  if (S.panel === 'files') body = h('div', { class: 'files' }, h('div', { class: 'tree', id: 'tree' }, treeView('.')), h('div', { class: 'editorcol' }, h('div', { class: 'etabs', id: 'etabs' }), h('div', { class: 'editor', id: 'editor' })));
  else if (S.panel === 'git') body = h('div', { class: 'gitpane' }, gitView());
  else if (S.panel === 'terminal') body = termHost;
  else body = h('div', { class: 'logpane mono', id: 'log' }, S.agentLog.length ? S.agentLog.slice(-300).map(e => h('div', { class: 'ev' }, h('span', { class: 't' }, new Date(e.at).toLocaleTimeString()), h('span', {}, e.text))) : h('div', { class: 'status' }, t('none')));
  fill(el, tabs, h('div', { class: 'pbody' }, body));
  if (S.panel === 'files') { renderEditorTabs(); renderEditor(); }
  if (S.panel === 'terminal') ensureTerminal();
  if (S.panel === 'agent') body.scrollTop = body.scrollHeight;
}
function treeView(dir) {
  return (S.tree.get(dir) || []).map(e => {
    const depth = e.path.split('/').length - 1, open = S.expanded.has(e.path);
    const f = S.git?.files.find(x => x.path === e.path);
    return [h('button', { class: `titem${S.active?.path === e.path ? ' on' : ''}`, style: `padding-left:${6 + depth * 12}px`, title: e.path,
      onClick: guard(async () => { if (e.dir) { if (open) S.expanded.delete(e.path); else { S.expanded.add(e.path); await loadTree(e.path); } fill($('tree'), treeView('.')); } else await openFile(e.path); }) },
      h('span', { class: 'name' }, `${e.dir ? (open ? '▾ ' : '▸ ') : ''}${e.name}`), f ? h('span', { class: 'g' }, (f.worktree.trim() || f.index.trim())) : null),
    e.dir && open ? treeView(e.path) : null];
  });
}
function renderEditorTabs() {
  fill($('etabs'), S.tabs.map(tab => h('div', { class: `etab${tab === S.active ? ' on' : ''}`, role: 'tab', tabindex: 0, onClick: () => { S.active = tab; renderEditorTabs(); renderEditor(); } },
    tab.kind === 'diff' ? '⇄' : null, tab.path.split('/').pop(), tab.dirty ? h('span', { class: 'mod' }, '●') : null,
    h('button', { class: 'x', 'aria-label': 'close', onClick: e => { e.stopPropagation(); closeTab(tab); } }, '×'))));
}
function renderEditor() {
  const ed = $('editor'), tab = S.active; if (!ed) return;
  if (!tab) return fill(ed, h('div', { class: 'empty' }, t('noFile')));
  if (tab.kind === 'diff') return fill(ed, diffPre(tab.text));
  const banner = tab.disk ? h('div', { class: 'banner' }, '⚠ ', h('b', {}, tab.path), ' ', t('diskChanged'), h('span', { class: 'act' },
      h('button', { class: 'btn sm', onClick: guard(() => compare(tab)) }, t('compare')), h('button', { class: 'btn sm', onClick: guard(() => reload(tab)) }, t('reload')),
      h('button', { class: 'btn sm ghost', onClick: () => { tab.disk = null; tab.stale = true; renderEditor(); } }, t('keepMine'))))
    : tab.stale ? h('div', { class: 'banner err' }, t('stale'), h('span', { class: 'act' }, h('button', { class: 'btn sm', onClick: guard(() => compare(tab)) }, t('compare')),
      h('button', { class: 'btn sm', onClick: guard(() => reload(tab)) }, t('reload')),
      h('button', { class: 'btn sm danger', onClick: guard(async () => { const cur = await api('buffer.open', { projectId: tab.projectId, path: tab.path }); tab.disk = { version: cur.version }; await save(tab, true); }) }, t('overwrite')))) : null;
  const host = h('div', { class: 'host' }); host.append(tab.view.dom);
  fill(ed, banner, host); tab.view.requestMeasure();
}
function gitView() {
  const g = S.git; if (!g) return h('div', { class: 'status' }, '…'); if (!g.repo) return h('div', { class: 'status' }, t('notRepo'));
  const isStaged = f => f.index !== ' ' && f.index !== '?';
  const staged = g.files.filter(isStaged);
  return [h('div', { class: 'row', style: 'margin-bottom:12px' }, h('span', { class: 'chip mono' }, `⎇ ${g.branch || 'HEAD'}`), h('span', { class: 'status' }, `${g.files.length} ${t('changes')}`),
      h('span', { style: 'flex:1' }), h('button', { class: 'btn sm ghost', onClick: refreshGit }, '↻')),
    g.files.slice(0, 300).map(f => h('div', { class: 'gitrow' },
      h('span', { class: 'st mono' }, `${f.index}${f.worktree}`.trim()),
      h('button', { class: 'p mono', title: f.path, onClick: guard(async () => openDiff(`diff · ${f.path}`, (await api('git.diff', { projectId: S.projectId, path: f.path, staged: isStaged(f) })) || `(${f.index}${f.worktree}) ${f.path}`)) }, f.path),
      h('button', { class: 'btn sm', onClick: guard(async () => { await api(isStaged(f) ? 'git.unstage' : 'git.stage', { projectId: S.projectId, paths: [f.path] }); refreshGit(); }) }, isStaged(f) ? t('unstage') : t('stage')))),
    staged.length ? h('div', { style: 'display:grid;gap:8px;margin-top:16px' },
      h('input', { type: 'text', placeholder: t('commitMsg'), value: S.commitMsg, onInput: e => { S.commitMsg = e.target.value; } }),
      h('button', { class: 'btn primary', onClick: guard(async () => { await api('git.commit', { projectId: S.projectId, message: S.commitMsg }); S.commitMsg = ''; toast(t('commit')); refreshGit(); }) }, `${t('commit')} · ${staged.length}`)) : null];
}

// ---------- pages ----------
function activityPage() {
  const runs = [...S.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  const projectName = id => S.projects.find(p => p.projectId === id)?.name || id;
  const goto = guard(async sessionId => { await openSession(sessionId); renderShell(); });
  const live = runs.filter(r => !r.endedAt).length, tokens = runs.reduce((n, r) => n + r.usage.inputTokens + r.usage.outputTokens, 0);
  return h('div', { class: 'page' }, h('h1', {}, t('activity')), h('p', { class: 'lead' }, t('activityLead')),
    h('div', { class: 'stats' },
      h('div', { class: 'card stat' }, h('div', { class: 'n num' }, live), h('div', { class: 'l' }, t('runsActive'))),
      h('div', { class: 'card stat' }, h('div', { class: 'n num' }, S.pending.length), h('div', { class: 'l' }, t('pendingReq'))),
      h('div', { class: 'card stat' }, h('div', { class: 'n num' }, tokens.toLocaleString()), h('div', { class: 'l' }, t('tokens')))),
    h('div', { class: 'section' }, t('pendingReq')),
    S.pending.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, 'kind'), h('th', {}, t('project')), h('th', {}, t('agentL')), h('th', {}, t('expires')), h('th', {})),
      S.pending.map(a => h('tr', {}, h('td', {}, h('span', { class: 'chip warn' }, a.kind)), h('td', {}, a.subject?.project), h('td', {}, a.subject?.agentId), h('td', { class: 'num' }, new Date(a.expiresAt).toLocaleTimeString()),
        h('td', {}, h('button', { class: 'btn sm', onClick: () => goto(a.sessionId) }, t('open')))))) : h('p', { class: 'status' }, t('none')),
    h('div', { class: 'section' }, t('runs')),
    runs.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, t('state')), h('th', {}, t('project')), h('th', {}, t('prompt')), h('th', {}, t('model')), h('th', {}, t('tokens')), h('th', {})),
      runs.map(r => h('tr', {}, h('td', {}, h('span', { class: `chip ${r.state === 'success' ? 'ok' : ['error', 'interrupted'].includes(r.state) ? 'err' : r.state === 'awaiting_approval' ? 'warn' : ''}` }, t(`run_${r.state}`))),
        h('td', {}, projectName(r.projectId)), h('td', { title: r.error || '' }, r.prompt), h('td', { class: 'num' }, r.model), h('td', { class: 'num' }, (r.usage.inputTokens + r.usage.outputTokens).toLocaleString()),
        h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => goto(r.sessionId) }, t('open')), !r.endedAt ? h('button', { class: 'btn sm danger', onClick: guard(() => api('run.cancel', { runId: r.runId })) }, t('cancel')) : null))))) : h('p', { class: 'status' }, t('none')),
    h('div', { class: 'section' }, t('worktrees')),
    S.worktrees.length ? h('table', { class: 'list' }, S.worktrees.map(w => h('tr', {}, h('td', {}, projectName(w.projectId)), h('td', { class: 'num' }, w.dir), h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn sm', onClick: guard(async () => { if (S.projectId !== w.projectId) await selectProject(w.projectId); S.view = 'chat'; openDiff(`worktree · ${w.runId.slice(0, 8)}`, await api('worktree.diff', { runId: w.runId }) || t('none')); }) }, t('diff')),
      h('button', { class: 'btn sm primary', onClick: guard(async () => { if (!confirm(t('integrate') + '?')) return; await api('worktree.integrate', { runId: w.runId }); S.worktrees = await api('worktree.list'); refreshGit(); renderCenter(); }) }, t('integrate')),
      h('button', { class: 'btn sm danger', onClick: guard(async () => { if (!confirm(t('discard') + '?')) return; await api('worktree.discard', { runId: w.runId }); S.worktrees = await api('worktree.list'); renderCenter(); }) }, t('discard'))))))) : h('p', { class: 'status' }, t('none')));
}
const finView = createFinanceView({ h, fill, api, toast, guard, t, icon, rerender: () => { if (S.view === 'bitcoin') renderCenter(); } });
const bitcoinPage = () => finView.page();
function settingsPage() {
  const st = S.settings, info = S.info;
  const set = (key, parse = v => v) => guard(async e => {
    S.settings = await api('settings.set', { key, value: parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value) });
    if (key === 'model') await refreshStatus(); if (key === 'lang') setLang(S.settings.lang); if (key === 'theme') { applyTheme(); retheme(); } renderShell();
  });
  const modelField = (spec, auto, onClick, empty) => h('button', { class: 'modelfield num', onClick }, h('span', { class: `loc ${spec ? modelLocality(spec) : 'unknown'}` }),
    h('span', { class: 'mf' }, spec || empty), auto ? h('span', { class: 'chip' }, t('auto')) : null, h('span', { class: 'caret' }, '▾'));
  if (!S.picker.data && !S.picker.loading) loadModels().then(() => { if (S.view === 'settings') renderCenter(); }).catch(() => {});
  const keyInputs = new Map();
  return h('div', { class: 'page' }, h('h1', {}, t('settings')),
    h('datalist', { id: 'models' }, S.models.map(m => h('option', { value: `${m.name}/${m.defaultModel || ''}` }))),
    h('div', { class: 'section' }, t('appearance')),
    h('div', { class: 'form' },
      h('label', {}, t('language')), h('select', { onChange: set('lang') }, ['it', 'en'].map(l => h('option', { value: l, selected: st.lang === l }, l === 'it' ? 'Italiano' : 'English'))),
      h('label', {}, t('theme')), h('select', { onChange: set('theme') }, ['dark', 'light', 'system'].map(l => h('option', { value: l, selected: (st.theme || 'dark') === l }, t(l))))),
    h('div', { class: 'section' }, t('model')),
    h('div', { class: 'form' },
      h('label', {}, t('defaultModel')), modelField(st.model || S.status?.defaultModel?.spec, !st.model, () => openModelDialog({ title: t('defaultModel'), current: st.model,
        onPick: async spec => { S.settings = await api('settings.set', { key: 'model', value: spec }); await refreshStatus(); renderCenter(); } })),
      SATS.map(x => [h('label', {}, `${t('satModel')} ${satName(x)}`), modelField(st.satModels?.[x], false, () => openModelDialog({ title: `${t('satModel')} ${satName(x)}`, current: st.satModels?.[x] || null, inherit: t('inherit'),
        onPick: async spec => { S.settings = await api('settings.set', { key: 'satModels', value: { ...S.settings.satModels, [x]: spec } }); renderCenter(); } }), t('inherit'))]),
      h('label', {}, t('localOnly')), h('input', { type: 'checkbox', checked: st.localOnly, onChange: set('localOnly') }),
      h('label', {}, t('maxActive')), h('input', { type: 'number', min: 1, max: 8, value: st.maxActive, onChange: set('maxActive', Number) }),
      h('label', {}, t('maxLocal')), h('input', { type: 'number', min: 1, max: 4, value: st.maxLocal, onChange: set('maxLocal', Number) })),
    h('div', { class: 'section' }, t('credentials')),
    h('p', { class: 'status' }, info?.secretStore.secure ? `${t('secretSecure')} (${info.secretStore.backend})` : t('secretInsecure')),
    h('table', { class: 'list' }, S.models.map(m => h('tr', {}, h('td', { class: 'num' }, m.name), h('td', {}, h('span', { class: 'chip' }, t(m.locality))),
      h('td', {}, h('span', { class: `chip ${m.hasKey ? 'ok' : 'warn'}` }, m.hasKey ? t('hasKey') : t('noKey'))),
      h('td', {}, m.locality === 'cloud' ? h('div', { class: 'row' }, (() => { const i = h('input', { type: 'password', autocomplete: 'off', placeholder: 'API key' }); keyInputs.set(m.name, i); return i; })(),
        h('button', { class: 'btn sm', onClick: guard(async () => { const v = keyInputs.get(m.name).value; if (!v) return; const r = await api('secrets.put', { name: m.name, value: v }); keyInputs.get(m.name).value = ''; toast(r.persisted ? t('secretSecure') : t('secretInsecure')); S.models = await api('models.list'); renderCenter(); }) }, t('saveKey'))) : null)))),
    h('div', { class: 'section' }, t('diagnostics')),
    h('div', { class: 'form' },
      h('label', {}, 'Sandbox'), h('span', {}, h('span', { class: `chip ${S.status?.sandbox.available ? 'ok' : 'err'}` }, S.status?.sandbox.available ? t('sandboxOk') : `${t('sandboxMissing')} ${S.status?.sandbox.detail || ''}`)),
      h('label', {}, t('dataDir')), h('span', { class: 'num' }, info?.home || ''),
      h('label', {}, 'Version'), h('span', { class: 'num' }, info?.version || '')));
}

// ---------- boot ----------
function retheme() {
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
    const latest = S.sessions[0];
    if (latest) await openSession(latest.sessionId); else if (S.projects[0]) await selectProject(S.projects[0].projectId);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); retheme(); });
    renderShell();
  } catch (e) { fill($('app'), h('div', { class: 'page' }, h('h1', {}, 'Bitcode'), h('p', {}, errorText(e)))); }
})();
