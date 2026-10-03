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

const SATS = ['node', 'script', 'hash', 'merkle'];
const MODES = ['manual', 'assisted', 'unattended'];
const S = {
  view: 'coding', info: null, status: null, settings: null, projects: [], projectId: null, sessions: [], sessionId: null, session: null,
  tree: new Map(), expanded: new Set(['.']), git: null, tabs: [], active: null, bottomTab: 'terminal', runs: new Map(), pending: [],
  sats: Object.fromEntries(SATS.map(s => [s, { st: 'idle' }])), live: new Map(), agentLog: [], worktrees: [], models: [], agent: '', commitMsg: ''
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
const fill = (el, ...c) => el.replaceChildren(...c.flat(Infinity).filter(x => x != null && x !== false));
async function api(method, params = {}) {
  const r = await window.bitcode.invoke(method, params);
  if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.result;
}
function toast(text, err = false) {
  const el = h('div', { class: `toast${err ? ' err' : ''}` }, text);
  document.getElementById('toasts').append(el); setTimeout(() => el.remove(), err ? 7000 : 3000);
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(errorText(e), true); } };
const fmtTime = ms => new Date(ms).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'it-IT', { dateStyle: 'short', timeStyle: 'short' });
const project = () => S.projects.find(p => p.projectId === S.projectId);
function applyTheme() { document.documentElement.dataset.theme = S.settings?.theme || 'light'; }
const isDark = () => S.settings?.theme === 'dark' || (S.settings?.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

// ---------- editor ----------
const themeSlot = new Compartment();
const langFor = p => /\.(m?[jt]sx?|cjs)$/.test(p) ? javascript({ typescript: /\.tsx?$/.test(p), jsx: /x$/.test(p) }) : /\.json$/.test(p) ? json() : /\.md$/.test(p) ? markdown() : /\.py$/.test(p) ? python() : [];
async function openFile(path) {
  const existing = S.tabs.find(x => x.path === path && x.kind === 'file');
  if (existing) { S.active = existing; return renderMain(); }
  const { text, version } = await api('buffer.open', { projectId: S.projectId, path });
  const tab = { kind: 'file', path, projectId: S.projectId, baseVersion: version, saved: text, dirty: false, disk: null };
  tab.view = new EditorView({ parent: h('div'), state: EditorState.create({ doc: text, extensions: [basicSetup, langFor(path), themeSlot.of(isDark() ? oneDark : []),
    keymap.of([{ key: 'Mod-s', run: () => { save(tab); return true; } }]),
    EditorView.updateListener.of(u => { if (u.docChanged) { const d = u.state.doc.toString() !== tab.saved; if (d !== tab.dirty) { tab.dirty = d; renderTabs(); } } })] }) });
  S.tabs.push(tab); S.active = tab; renderMain();
}
async function save(tab, force = false) {
  try {
    const text = tab.view.state.doc.toString();
    const base = force ? tab.disk?.version ?? tab.baseVersion : tab.baseVersion;
    const { version } = await api('buffer.save', { projectId: tab.projectId, path: tab.path, text, baseVersion: base });
    Object.assign(tab, { baseVersion: version, saved: text, dirty: false, disk: null, stale: false }); toast(`${t('saved')} · ${tab.path}`); renderMain(); refreshGit();
  } catch (e) {
    if (e.code === 'STALE_VERSION') { tab.stale = true; renderMain(); } else toast(errorText(e), true);
  }
}
async function reload(tab) {
  const { text, version } = await api('buffer.open', { projectId: tab.projectId, path: tab.path });
  tab.view.dispatch({ changes: { from: 0, to: tab.view.state.doc.length, insert: text } });
  Object.assign(tab, { baseVersion: version, saved: text, dirty: false, disk: null, stale: false }); renderMain();
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
  S.tabs = S.tabs.filter(x => !(x.kind === 'diff' && x.path === title)); S.tabs.push(tab); S.active = tab; renderMain();
}
function closeTab(tab) {
  if (tab.dirty && !confirm(`${tab.path}: ${t('diskChanged').split('.')[1] || 'unsaved'}?`)) return;
  tab.view?.destroy(); S.tabs = S.tabs.filter(x => x !== tab); if (S.active === tab) S.active = S.tabs.at(-1) || null; renderMain();
}
function diffPre(text) {
  return h('pre', { class: 'diff mono' }, text.split('\n').map(l => h('span', { class: l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : '' }, l || ' ')));
}

// ---------- terminal ----------
let term = null, fit = null, ptyId = null, ptyProject = null;
async function ensureTerminal(host) {
  if (!S.projectId) return;
  if (!term) {
    term = new Terminal({ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, cursorBlink: true, allowProposedApi: false, theme: termTheme() });
    fit = new FitAddon(); term.loadAddon(fit);
    term.onData(data => ptyId && api('pty.write', { ptyId, data }).catch(() => {}));
    term.onResize(({ cols, rows }) => ptyId && api('pty.resize', { ptyId, cols, rows }).catch(() => {}));
  }
  if (!term.element) term.open(host); else if (term.element.parentElement !== host) host.append(term.element);
  if (ptyProject !== S.projectId) {
    if (ptyId) await api('pty.close', { ptyId }).catch(() => {});
    term.reset(); ptyProject = S.projectId;
    try { ptyId = (await api('pty.open', { projectId: S.projectId })).ptyId; } catch (e) { ptyId = null; term.write(`\r\n${errorText(e)}\r\n`); }
  }
  requestAnimationFrame(() => { try { fit.fit(); } catch {} });
}
const termTheme = () => isDark() ? { background: '#26251e', foreground: '#f2f1ec', cursor: '#f7931a' } : { background: '#ffffff', foreground: '#26251e', cursor: '#f7931a', selectionBackground: '#e6e5e0' };
window.addEventListener('resize', () => { try { fit?.fit(); } catch {} });

// ---------- data loading ----------
async function loadProjects() { S.projects = await api('project.list'); if (!S.projectId && S.projects[0]) await selectProject(S.projects[0].projectId); }
async function selectProject(id) {
  S.projectId = id; S.tree.clear(); S.expanded = new Set(['.']); S.sessionId = null; S.session = null;
  await Promise.all([loadTree('.'), loadSessions(), refreshGit()]);
  if (S.sessions[0]) await openSession(S.sessions[0].sessionId);
  render();
}
async function loadTree(path) { S.tree.set(path, await api('fs.tree', { projectId: S.projectId, path })); }
async function loadSessions() { S.sessions = await api('session.list', { projectId: S.projectId }); }
async function openSession(id) { S.sessionId = id; S.session = await api('session.open', { sessionId: id }); S.live.clear(); }
async function refreshGit() { if (S.projectId) { try { S.git = await api('git.status', { projectId: S.projectId }); } catch { S.git = null; } if (S.view === 'coding') renderSide(); } }
async function refreshStatus() {
  S.status = await api('app.status'); S.pending = S.status.pending; S.settings = S.status.settings;
  for (const r of S.status.runs) S.runs.set(r.runId, r);
}

// ---------- events from main ----------
window.bitcode.subscribe(({ channel, payload }) => {
  if (channel === 'approval') {
    S.pending = S.pending.filter(a => a.id !== payload.id); if (payload.status === 'pending') S.pending.push(payload);
    if (payload.sessionId === S.sessionId && S.session) S.session.pending = S.pending.filter(a => a.sessionId === S.sessionId);
    renderRail(); if (S.view === 'coding') renderChat(); if (S.view === 'activity') render();
  } else if (channel === 'run') {
    S.runs.set(payload.runId, payload);
    if (['success', 'error', 'cancelled', 'interrupted'].includes(payload.state)) { S.live.delete(payload.runId); refreshGit(); if (payload.error && payload.sessionId === S.sessionId) toast(payload.error, true); if (payload.worktree) api('worktree.list').then(w => { S.worktrees = w; }); }
    if (payload.state === 'success' || payload.state === 'error') for (const s of SATS) S.sats[s] = { st: 'idle' };
    if (S.view === 'coding') renderChat(); if (S.view === 'activity') render();
  } else if (channel === 'session' && payload.sessionId === S.sessionId) {
    const { type, data } = payload;
    if (type === 'messages') { S.session.messages = data.messages; S.live.clear(); renderChat(); }
    if (type === 'message.delta') { S.live.set(data.runId, { agent: data.agentId, text: (S.live.get(data.runId)?.text || '') + data.text }); renderChat(true); }
    if (type === 'tool.detail') { S.agentLog.push({ at: Date.now(), text: `${data.auto ? 'auto' : 'approvato'} · ${data.tool} · ${data.summary}` }); if (S.bottomTab === 'agent') renderBottom(); }
  } else if (channel === 'feed') {
    const sat = SATS.includes(payload.agentId) ? payload.agentId : null;
    {
      const line = `${payload.agentId} · ${payload.type}${payload.data.summary ? ' · ' + payload.data.summary : ''}${payload.data.outcome ? ' · ' + payload.data.outcome : ''}`;
      S.agentLog.push({ at: Date.now(), text: line }); if (S.agentLog.length > 500) S.agentLog.shift();
      if (sat && payload.sessionId === S.sessionId) S.sats[sat] = { st: payload.type === 'approval.requested' ? 'waiting' : payload.type === 'run.finished' ? 'idle' : payload.data.stage || 'thinking', summary: payload.data.summary };
      if (S.view === 'coding') { renderSats(); if (S.bottomTab === 'agent') renderBottom(); }
    }
  } else if (channel === 'file') {
    for (const tab of S.tabs) if (tab.kind === 'file' && tab.projectId === payload.projectId && tab.path === payload.path && payload.version !== tab.baseVersion && payload.by !== 'user') {
      if (!tab.dirty) reload(tab).catch(() => {}); else { tab.disk = payload; renderMain(); }
    }
    clearTimeout(S.gitTimer); S.gitTimer = setTimeout(refreshGit, 400);
  } else if (channel === 'pty' && payload.ptyId === ptyId) {
    if (payload.data) term?.write(payload.data); if (payload.exit !== undefined) { term?.write('\r\n[exit]\r\n'); ptyId = null; ptyProject = null; }
  } else if (channel === 'navigate') { S.view = payload.view; render(); }
});

// ---------- rendering ----------
const root = () => document.getElementById('view');
function renderRail() {
  const rail = document.getElementById('rail'); fill(rail, );
  const b = (view, icon) => h('button', { class: S.view === view ? 'on' : '', title: t(view), 'aria-label': t(view), onClick: () => { S.view = view; render(); } }, icon,
    view === 'activity' && S.pending.length ? h('span', { class: 'badge' }, S.pending.length) : null);
  rail.append(b('coding', '⌨'), b('bitcoin', '₿'), b('activity', '≡'), h('span', { class: 'grow' }), b('settings', '⚙'));
}
let codingEl = null;
function render() {
  applyTheme(); renderRail();
  const v = root();
  if (S.view === 'coding') {
    if (!S.projects.length) return fill(v, onboarding());
    if (!codingEl) codingEl = h('div', { class: 'coding' }, h('aside', { class: 'side', id: 'side' }), h('main', { class: 'main', id: 'main' }), h('aside', { class: 'chat', id: 'chat' }));
    if (codingEl.parentElement !== v) fill(v, codingEl);
    renderSide(); renderMain(); renderChat();
  } else fill(v, S.view === 'activity' ? activityPage() : S.view === 'bitcoin' ? bitcoinPage() : settingsPage());
}
function onboarding() {
  return h('div', { class: 'page' }, h('div', { class: 'onboard card' }, h('h1', {}, t('welcome')),
    h('ol', {}, h('li', {}, t('step1')), h('li', {}, t('step2')), h('li', {}, t('step3'))),
    !S.status?.sandbox.available ? h('div', { class: 'banner err' }, t('sandboxMissing'), ' ', S.status?.sandbox.detail || '') : null,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: openFolder }, t('openFolder')), h('button', { class: 'btn', onClick: () => { S.view = 'settings'; render(); } }, t('settings')))));
}
const openFolder = guard(async () => {
  const p = await api('dialog.openFolder'); if (!p) return;
  const proj = await api('project.open', { path: p }); S.projects = await api('project.list'); await selectProject(proj.projectId);
});

function renderSide() {
  const el = document.getElementById('side'); if (!el) return;
  const runsFor = id => [...S.runs.values()].filter(r => r.projectId === id && !r.endedAt).length;
  const tree = dir => (S.tree.get(dir) || []).map(e => {
    const depth = e.path.split('/').length - 1, open = S.expanded.has(e.path);
    const row = h('button', { class: `item${S.active?.path === e.path ? ' on' : ''}`, style: `padding-left:${8 + depth * 14}px`, title: e.path,
      onClick: guard(async () => { if (e.dir) { if (open) S.expanded.delete(e.path); else { S.expanded.add(e.path); await loadTree(e.path); } renderSide(); } else await openFile(e.path); }) },
      h('span', { class: 'name' }, `${e.dir ? (open ? '▾ ' : '▸ ') : ''}${e.name}`), gitMark(e.path));
    return [row, e.dir && open ? tree(e.path) : null];
  });
  fill(el, 
    h('h3', {}, t('projects'), h('button', { title: t('openFolder'), onClick: openFolder }, '+')),
    S.projects.map(p => h('button', { class: `item${p.projectId === S.projectId ? ' on' : ''}`, title: p.root, onClick: guard(() => selectProject(p.projectId)) },
      h('span', { class: 'dot', style: runsFor(p.projectId) ? 'background:var(--relayed)' : '' }), h('span', { class: 'name' }, p.name), runsFor(p.projectId) ? h('span', { class: 'm' }, `${runsFor(p.projectId)} run`) : null)),
    h('h3', {}, t('sessions'), h('button', { title: t('newSession'), onClick: newSession }, '+')),
    S.sessions.map(s => h('button', { class: `item${s.sessionId === S.sessionId ? ' on' : ''}`, onClick: guard(async () => { await openSession(s.sessionId); renderSide(); renderChat(); }) },
      h('span', { class: 'name' }, s.name), h('span', { class: 'm' }, t(s.mode)))),
    h('h3', {}, t('files'), h('button', { title: 'refresh', onClick: guard(async () => { for (const d of S.expanded) await loadTree(d); renderSide(); }) }, '↻')),
    tree('.'),
    h('h3', {}, t('git'), h('button', { title: 'refresh', onClick: refreshGit }, '↻')),
    gitPanel());
}
function gitMark(path) {
  const f = S.git?.files.find(x => x.path === path); if (!f) return null;
  return h('span', { class: 'm', style: 'color:var(--orange)' }, (f.worktree.trim() || f.index.trim()));
}
function gitPanel() {
  const g = S.git; if (!g) return null; if (!g.repo) return h('div', { class: 'status', style: 'padding:0 8px' }, t('notRepo'));
  const staged = g.files.filter(f => f.index !== ' ' && f.index !== '?');
  return [h('div', { class: 'item' }, `⎇ ${g.branch || 'HEAD'}`, h('span', { class: 'm' }, `${g.files.length} ${t('changes')}`)),
    g.files.slice(0, 200).map(f => h('div', { class: 'item', title: f.path },
      h('button', { class: 'btn ghost', style: 'min-height:20px;padding:0 4px', title: f.index !== ' ' && f.index !== '?' ? t('unstage') : t('stage'),
        onClick: guard(async () => { await api(f.index !== ' ' && f.index !== '?' ? 'git.unstage' : 'git.stage', { projectId: S.projectId, paths: [f.path] }); refreshGit(); }) }, f.index !== ' ' && f.index !== '?' ? '−' : '+'),
      h('button', { class: 'item', style: 'padding:0', onClick: guard(async () => openDiff(`diff · ${f.path}`, (await api('git.diff', { projectId: S.projectId, path: f.path, staged: f.index !== ' ' && f.index !== '?' })) || `(${f.index}${f.worktree}) ${f.path}`)) },
        h('span', { class: 'name' }, f.path), h('span', { class: 'm' }, `${f.index}${f.worktree}`)))),
    staged.length ? h('div', { style: 'display:grid;gap:6px;padding:6px 8px' },
      h('input', { type: 'text', placeholder: t('commitMsg'), value: S.commitMsg, onInput: e => { S.commitMsg = e.target.value; } }),
      h('button', { class: 'btn primary', onClick: guard(async () => { await api('git.commit', { projectId: S.projectId, message: S.commitMsg }); S.commitMsg = ''; toast(t('commit')); refreshGit(); }) }, `${t('commit')} (${staged.length})`)) : null];
}
const newSession = guard(async () => {
  const s = await api('session.create', { projectId: S.projectId, name: `${t('session')} ${new Date().toLocaleTimeString().slice(0, 5)}`, mode: 'assisted' });
  await loadSessions(); await openSession(s.sessionId); renderSide(); renderChat();
});

function renderTabs() {
  const bar = document.getElementById('etabs'); if (!bar) return;
  fill(bar, ...S.tabs.map(tab => h('div', { class: `etab${tab === S.active ? ' on' : ''}`, role: 'tab', tabindex: 0, onClick: () => { S.active = tab; renderMain(); } },
    tab.kind === 'diff' ? '⇄ ' : '', tab.path.split('/').pop(), tab.dirty ? h('span', { class: 'mod' }, '●') : null,
    h('button', { class: 'x', 'aria-label': 'close', onClick: e => { e.stopPropagation(); closeTab(tab); } }, '×'))));
}
function renderMain() {
  const el = document.getElementById('main'); if (!el) return;
  if (!el.firstChild) {
    el.append(h('div', { class: 'etabs', id: 'etabs', role: 'tablist' }), h('div', { class: 'editor', id: 'editor' }),
      h('div', { class: 'splitter', id: 'splitter', onMousedown: startResize }), h('div', { class: 'bottom', id: 'bottom' }));
  }
  renderTabs();
  const ed = document.getElementById('editor'), tab = S.active;
  if (!tab) fill(ed, h('div', { class: 'empty' }, t('noFile')));
  else if (tab.kind === 'diff') fill(ed, diffPre(tab.text));
  else {
    const banner = tab.disk ? h('div', { class: 'banner' }, '⚠ ', h('b', {}, tab.path), ' ', t('diskChanged'), h('span', { class: 'act' },
      h('button', { class: 'btn', onClick: guard(() => compare(tab)) }, t('compare')), h('button', { class: 'btn', onClick: guard(() => reload(tab)) }, t('reload')),
      h('button', { class: 'btn ghost', onClick: () => { tab.disk = null; tab.stale = true; renderMain(); } }, t('keepMine'))))
      : tab.stale ? h('div', { class: 'banner err' }, t('stale'), h('span', { class: 'act' }, h('button', { class: 'btn', onClick: guard(() => compare(tab)) }, t('compare')),
        h('button', { class: 'btn', onClick: guard(() => reload(tab)) }, t('reload')), h('button', { class: 'btn danger', onClick: guard(async () => { const cur = await api('buffer.open', { projectId: tab.projectId, path: tab.path }); tab.disk = { version: cur.version }; await save(tab, true); }) }, t('overwrite')))) : null;
    const host = h('div', { class: 'host' }); host.append(tab.view.dom);
    fill(ed, ...[banner, host].filter(Boolean)); tab.view.requestMeasure();
  }
  renderBottom();
}
function startResize(e) {
  const main = document.getElementById('main'), start = e.clientY, startH = document.getElementById('bottom').getBoundingClientRect().height;
  const move = ev => { main.style.setProperty('--bottom', `${Math.min(main.clientHeight - 120, Math.max(90, startH - (ev.clientY - start)))}px`); try { fit?.fit(); } catch {} };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}
let termHost = null;
function renderBottom() {
  const el = document.getElementById('bottom'); if (!el) return;
  const tabs = h('div', { class: 'btabs', role: 'tablist' }, ['terminal', 'agent'].map(k => h('button', { class: `btab${S.bottomTab === k ? ' on' : ''}`, onClick: () => { S.bottomTab = k; renderBottom(); } }, t(k))));
  let panel;
  if (S.bottomTab === 'terminal') { termHost ??= h('div', { class: 'panel term' }); panel = termHost; }
  else panel = h('div', { class: 'panel log mono' }, S.agentLog.slice(-300).map(e => h('div', { class: 'ev' }, h('span', { class: 't' }, new Date(e.at).toLocaleTimeString()), h('span', {}, e.text))));
  fill(el, tabs, panel);
  if (S.bottomTab === 'terminal') ensureTerminal(termHost); else panel.scrollTop = panel.scrollHeight;
}

function renderSats() {
  const el = document.getElementById('sats'); if (!el) return;
  fill(el, ...SATS.map(s => { const st = S.sats[s].st; return h('div', { class: `sat${st === 'waiting' ? ' waiting' : st !== 'idle' ? ' active' : ''}`, title: S.sats[s].summary || '' },
    h('img', { src: `sats/${s}/avatar-96.png`, alt: '' }), s[0].toUpperCase() + s.slice(1), h('div', { class: 'st' }, st === 'idle' ? t('idle') : st === 'waiting' ? t('waiting') : st)); }));
}
function renderChat(onlyMessages = false) {
  const el = document.getElementById('chat'); if (!el) return;
  if (!S.session) return fill(el, h('div', { class: 'empty' }, h('div', {}, t('noSession'), h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn primary', onClick: newSession }, t('newSession'))))));
  const s = S.session, active = [...S.runs.values()].find(r => r.sessionId === s.sessionId && !r.endedAt);
  const msgs = h('div', { class: 'msgs', id: 'msgs' },
    s.messages.filter(m => m.role !== 'tool').map(m => m.role === 'user' ? h('div', { class: 'msg user' }, m.content)
      : [m.content ? h('div', { class: 'msg' }, h('div', { class: 'who' }, `Bitcode · ${s.model || S.status?.defaultModel?.spec || ''}`), m.content) : null,
        m.tools?.length ? h('div', { class: 'tool mono' }, m.tools.map(x => `→ ${x}`).join('\n')) : null]),
    [...S.live.entries()].map(([, l]) => h('div', { class: 'msg live' }, h('div', { class: 'who' }, l.agent), l.text)),
    S.pending.filter(a => a.sessionId === s.sessionId).map(approvalCard),
    active ? h('div', { class: 'status' }, `${t(`run_${active.state}`)} · ${active.model} · ${active.usage.inputTokens + active.usage.outputTokens} ${t('tokens')}`) : null);
  if (onlyMessages && document.getElementById('msgs')) { const old = document.getElementById('msgs'); const stick = old.scrollTop + old.clientHeight >= old.scrollHeight - 30; old.replaceWith(msgs); if (stick) msgs.scrollTop = msgs.scrollHeight; return; }
  const input = h('textarea', { class: 'mono', placeholder: t('placeholder'), 'aria-label': t('placeholder'), onKeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } } });
  const submit = guard(async () => {
    const text = input.value; if (!text.trim()) return;
    const res = await api('chat.submit', { sessionId: s.sessionId, text, ...(S.agent ? { agent: S.agent } : {}) });
    input.value = '';
    if (res.command && Array.isArray(res.result)) toast(res.result.length ? res.result.map(a => `${a.id.slice(0, 10)} · ${a.kind}`).join('\n') : t('none'));
    if (res.command && res.result?.mode) { S.session.mode = res.result.mode; await loadSessions(); renderSide(); renderChat(); }
  });
  const head = h('div', { class: 'chathead' },
    h('span', { class: 'title', title: s.name }, s.name),
    h('select', { 'aria-label': t('mode'), onChange: guard(async e => { const r = await api('mode.set', { sessionId: s.sessionId, mode: e.target.value }); S.session.mode = r.mode; await loadSessions(); renderSide(); }) },
      MODES.map(m => h('option', { value: m, selected: s.mode === m }, t(m)))),
    h('button', { class: `btn ghost${s.keep ? '' : ''}`, title: s.keep ? t('kept') : `${t('expiresIn')} ${fmtTime(s.expiresAt)}`, onClick: guard(async () => { const r = await api('session.update', { sessionId: s.sessionId, keep: !s.keep }); S.session.keep = r.keep; S.session.expiresAt = r.expiresAt; renderChat(); }) }, s.keep ? '★' : '☆'));
  fill(el, head, h('div', { class: 'sats', id: 'sats' }), msgs,
    h('div', { class: 'composer' }, input, h('div', { class: 'row' },
      h('select', { 'aria-label': t('agentL'), onChange: e => { S.agent = e.target.value; } }, h('option', { value: '' }, 'Bitcode'), SATS.map(a => h('option', { value: a, selected: S.agent === a }, a))),
      h('span', { class: 'chip ro' }, s.model || S.status?.defaultModel?.spec || '—'),
      h('span', { style: 'flex:1' }),
      active ? h('button', { class: 'btn', onClick: guard(() => api('run.cancel', { runId: active.runId })) }, t('stop')) : null,
      h('button', { class: 'btn primary', onClick: submit, disabled: !!active }, t('send')))));
  renderSats(); msgs.scrollTop = msgs.scrollHeight;
}
function approvalCard(a) {
  const sub = a.subject || {};
  const resolve = decision => guard(async () => { await api('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision }); });
  const body = a.kind === 'command' ? h('pre', { class: 'cmd mono' }, sub.shell) : a.kind === 'patch' ? h('pre', { class: 'cmd mono' }, [...diffPre(sub.unifiedDiff || '').childNodes]) : a.kind === 'network' ? h('pre', { class: 'cmd mono' }, sub.url) : h('pre', { class: 'cmd mono' }, sub.model || JSON.stringify(sub));
  const kv = [[t('project'), sub.project], [t('session'), sub.session], [t('agentL'), `${sub.agentId || ''} · ${sub.model || ''}`], [t('mode'), t(sub.mode)],
    a.kind === 'command' ? [t('sandbox'), 'bwrap · rete negata'] : null, [t('reason'), sub.reason], [t('id'), `${a.id.slice(0, 12)} · ${t('expires')} ${new Date(a.expiresAt).toLocaleTimeString()}`]].filter(x => x && x[1]);
  return h('div', { class: 'approval', role: 'group', 'aria-label': t(`kind_${a.kind}`) },
    h('h4', {}, `✋ ${sub.agentId || 'Bitcode'} ${t(`kind_${a.kind}`)}`), body,
    h('dl', { class: 'kv mono' }, kv.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: resolve('approve') }, t('approveOnce')), h('button', { class: 'btn', onClick: resolve('deny') }, t('deny')),
      a.kind === 'command' && sub.argv ? h('button', { class: 'btn ghost', onClick: guard(async () => { if (confirm(`${t('addPolicy')}: ${sub.argv.join(' ')}`)) { await api('policy.propose', { projectId: sub.projectId, add: { command: sub.shell } }); toast(t('addPolicy')); } }) }, `${t('addPolicy')}…`) : null,
      a.kind === 'network' ? h('button', { class: 'btn ghost', onClick: guard(async () => { if (confirm(`${t('addDestination')}: ${sub.destination.scheme}://${sub.destination.host}:${sub.destination.port}`)) { await api('policy.propose', { projectId: sub.projectId, add: { destination: sub.destination } }); toast(t('addDestination')); } }) }, `${t('addDestination')}…`) : null));
}

// ---------- other pages ----------
function activityPage() {
  const runs = [...S.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  const projectName = id => S.projects.find(p => p.projectId === id)?.name || id;
  const goto = guard(async (projectId, sessionId) => { if (S.projectId !== projectId) await selectProject(projectId); await openSession(sessionId); S.view = 'coding'; render(); });
  return h('div', { class: 'page' }, h('h1', {}, t('activity')),
    h('div', { class: 'section' }, t('pendingReq')),
    S.pending.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, 'kind'), h('th', {}, t('project')), h('th', {}, t('agentL')), h('th', {}, t('expires')), h('th', {})),
      S.pending.map(a => h('tr', {}, h('td', {}, a.kind), h('td', {}, a.subject?.project), h('td', {}, a.subject?.agentId), h('td', {}, new Date(a.expiresAt).toLocaleTimeString()),
        h('td', {}, h('button', { class: 'btn', onClick: () => goto(a.subject.projectId, a.sessionId) }, t('open')))))) : h('p', { class: 'status' }, t('none')),
    h('div', { class: 'section' }, t('runs')),
    runs.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, t('state')), h('th', {}, t('project')), h('th', {}, t('prompt')), h('th', {}, t('model')), h('th', {}, t('tokens')), h('th', {})),
      runs.map(r => h('tr', {}, h('td', {}, h('span', { class: `chip ${r.state === 'success' ? 'ok' : ['error', 'interrupted'].includes(r.state) ? 'err' : r.state === 'awaiting_approval' ? 'warn' : ''}` }, t(`run_${r.state}`))),
        h('td', {}, projectName(r.projectId)), h('td', { title: r.error || '' }, r.prompt), h('td', { class: 'mono' }, r.model), h('td', {}, r.usage.inputTokens + r.usage.outputTokens),
        h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => goto(r.projectId, r.sessionId) }, t('open')), !r.endedAt ? h('button', { class: 'btn danger', onClick: guard(() => api('run.cancel', { runId: r.runId })) }, t('cancel')) : null))))) : h('p', { class: 'status' }, t('none')),
    h('div', { class: 'section' }, t('worktrees')),
    S.worktrees.length ? h('table', { class: 'list' }, S.worktrees.map(w => h('tr', {}, h('td', {}, projectName(w.projectId)), h('td', { class: 'mono' }, w.dir), h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn', onClick: guard(async () => { if (S.projectId !== w.projectId) await selectProject(w.projectId); S.view = 'coding'; render(); openDiff(`worktree · ${w.runId.slice(0, 8)}`, await api('worktree.diff', { runId: w.runId }) || '(nessuna modifica)'); }) }, t('diff')),
      h('button', { class: 'btn primary', onClick: guard(async () => { if (!confirm(t('integrate') + '?')) return; await api('worktree.integrate', { runId: w.runId }); S.worktrees = await api('worktree.list'); refreshGit(); render(); }) }, t('integrate')),
      h('button', { class: 'btn danger', onClick: guard(async () => { if (!confirm(t('discard') + '?')) return; await api('worktree.discard', { runId: w.runId }); S.worktrees = await api('worktree.list'); render(); }) }, t('discard'))))))) : h('p', { class: 'status' }, t('none')));
}
function bitcoinPage() {
  const protos = [['Bitcoin', 'signet · testnet4 · regtest'], ['Lightning', 'LND · signet/testnet/regtest'], ['Cashu', 'mint ammessi esplicitamente'], ['Liquid', 'liquidtestnet · elementsregtest'], ['Taproot Assets', 'tapd su LND di test']];
  return h('div', { class: 'page' }, h('h1', {}, t('bitcoin')), h('p', { class: 'lead' }, t('bitcoinLead')),
    h('div', { class: 'cards' }, protos.map(([name, envs]) => h('div', { class: 'card' }, h('h3', {}, name, h('span', { class: 'chip ro' }, 'non disponibile')), h('p', { class: 'status' }, envs), h('p', {}, t('adapterMissing'))))));
}
function settingsPage() {
  const st = S.settings, info = S.info;
  const set = (key, parse = v => v) => guard(async e => { S.settings = await api('settings.set', { key, value: parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value) }); if (key === 'model') await refreshStatus(); if (key === 'lang') setLang(S.settings.lang); if (key === 'theme') { applyTheme(); retheme(); } render(); });
  const modelOptions = S.models.map(m => `${m.name}/${m.defaultModel || ''}`);
  const modelInput = (value, onChange, placeholder) => h('input', { type: 'text', class: 'mono', list: 'models', value: value || '', placeholder, onChange });
  const keyInputs = new Map();
  return h('div', { class: 'page' }, h('h1', {}, t('settings')),
    h('datalist', { id: 'models' }, modelOptions.map(m => h('option', { value: m }))),
    h('div', { class: 'section' }, 'UI'),
    h('div', { class: 'form' },
      h('label', {}, t('language')), h('select', { onChange: set('lang') }, ['it', 'en'].map(l => h('option', { value: l, selected: st.lang === l }, l === 'it' ? 'Italiano' : 'English'))),
      h('label', {}, t('theme')), h('select', { onChange: set('theme') }, ['light', 'dark', 'system'].map(l => h('option', { value: l, selected: st.theme === l }, t(l))))),
    h('div', { class: 'section' }, t('model')),
    h('div', { class: 'form' },
      h('label', {}, t('defaultModel')), modelInput(st.model, set('model', v => v.trim() || null), 'ollama/qwen3-coder'),
      SATS.map(s => [h('label', {}, `${t('satModel')} ${s}`), modelInput(st.satModels?.[s], guard(async e => { S.settings = await api('settings.set', { key: 'satModels', value: { ...st.satModels, [s]: e.target.value.trim() || null } }); }), t('inherit'))]),
      h('label', {}, t('localOnly')), h('input', { type: 'checkbox', checked: st.localOnly, onChange: set('localOnly') }),
      h('label', {}, t('maxActive')), h('input', { type: 'number', min: 1, max: 8, value: st.maxActive, onChange: set('maxActive', Number) }),
      h('label', {}, t('maxLocal')), h('input', { type: 'number', min: 1, max: 4, value: st.maxLocal, onChange: set('maxLocal', Number) })),
    h('div', { class: 'section' }, t('credentials')),
    h('p', { class: 'status' }, info?.secretStore.secure ? `${t('secretSecure')} (${info.secretStore.backend})` : t('secretInsecure')),
    h('table', { class: 'list' }, S.models.map(m => h('tr', {}, h('td', { class: 'mono' }, m.name), h('td', {}, h('span', { class: `chip ${m.locality === 'local' ? 'ro' : ''}` }, t(m.locality))),
      h('td', {}, h('span', { class: `chip ${m.hasKey ? 'ok' : 'warn'}` }, m.hasKey ? t('hasKey') : t('noKey'))),
      h('td', {}, m.locality === 'cloud' ? h('div', { class: 'row' }, (() => { const i = h('input', { type: 'password', autocomplete: 'off', placeholder: 'API key' }); keyInputs.set(m.name, i); return i; })(),
        h('button', { class: 'btn', onClick: guard(async () => { const v = keyInputs.get(m.name).value; if (!v) return; const r = await api('secrets.put', { name: m.name, value: v }); keyInputs.get(m.name).value = ''; toast(r.persisted ? t('secretSecure') : t('secretInsecure')); S.models = await api('models.list'); render(); }) }, t('saveKey'))) : null)))),
    h('div', { class: 'section' }, t('diagnostics')),
    h('div', { class: 'form' },
      h('label', {}, 'Sandbox'), h('span', { class: `chip ${S.status?.sandbox.available ? 'ok' : 'err'}` }, S.status?.sandbox.available ? t('sandboxOk') : `${t('sandboxMissing')} ${S.status?.sandbox.detail || ''}`),
      h('label', {}, t('dataDir')), h('span', { class: 'mono' }, info?.home || ''),
      h('label', {}, 'Version'), h('span', { class: 'mono' }, info?.version || '')));
}

// ---------- boot ----------
(async function boot() {
  try {
    [S.info] = await Promise.all([api('app.info'), refreshStatus()]);
    setLang(S.settings.lang); applyTheme();
    S.models = await api('models.list').catch(() => []);
    S.worktrees = await api('worktree.list');
    await loadProjects();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); retheme(); });
    render();
  } catch (e) { fill(document.getElementById('view'), h('div', { class: 'page' }, h('h1', {}, 'Bitcode'), h('p', {}, errorText(e)))); }
})();
function retheme() {
  for (const tab of S.tabs) tab.view?.dispatch({ effects: themeSlot.reconfigure(isDark() ? oneDark : []) });
  if (term) term.options.theme = termTheme();
}
