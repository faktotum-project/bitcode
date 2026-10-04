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

const SATS = ['node', 'script', 'hash', 'merkle'];
const MODES = ['manual', 'assisted', 'unattended'];
const S = {
  view: 'chat', info: null, status: null, settings: null, projects: [], projectId: null, sessions: [], sessionId: null, session: null,
  collapsed: new Set(), tree: new Map(), expanded: new Set(['.']), git: null, tabs: [], active: null, panel: null, runs: new Map(), pending: [],
  sats: Object.fromEntries(SATS.map(s => [s, { st: 'idle' }])), live: new Map(), agentLog: [], worktrees: [], models: [], agent: '', commitMsg: '', draft: ''
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
  await Promise.all([loadTree('.').catch(() => {}), refreshGit()]);
  if (openLatest) { const s = S.sessions.find(x => x.projectId === id); if (s) await openSession(s.sessionId); else { S.sessionId = null; S.session = null; } }
}
async function loadTree(path) { S.tree.set(path, await api('fs.tree', { projectId: S.projectId, path })); }
async function loadSessions() { S.sessions = await api('session.list'); }
async function openSession(id) {
  const meta = S.sessions.find(s => s.sessionId === id);
  if (meta && meta.projectId !== S.projectId) await selectProject(meta.projectId);
  S.sessionId = id; S.session = await api('session.open', { sessionId: id }); S.live.clear(); S.view = 'chat';
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
    if (type === 'messages') { S.session.messages = data.messages; S.live.clear(); renderThread(); }
    if (type === 'message.delta') { S.live.set(data.runId, { agent: data.agentId, text: (S.live.get(data.runId)?.text || '') + data.text }); renderThread(); }
    if (type === 'tool.detail') { S.agentLog.push({ at: Date.now(), text: `${data.auto ? 'auto' : t('approved')} · ${data.tool} · ${data.summary}` }); if (S.panel === 'agent') renderPanel(); }
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
  renderSidebar(); renderCenter(); renderPanel();
}

function renderSidebar() {
  const el = $('sidebar'); if (!el) return;
  const nav = (view, icon, label, badge) => h('button', { class: `navbtn${S.view === view ? ' on' : ''}`, onClick: () => { S.view = view; renderShell(); } },
    h('span', { class: 'ic' }, icon), label, badge ? h('span', { class: 'badge num' }, badge) : null);
  const groups = S.projects.map(p => {
    const sessions = S.sessions.filter(s => s.projectId === p.projectId), open = !S.collapsed.has(p.projectId);
    return h('div', { class: 'group' },
      h('button', { class: 'ghead', title: p.root, onClick: () => { open ? S.collapsed.add(p.projectId) : S.collapsed.delete(p.projectId); renderSidebar(); } },
        h('span', { class: 'chev' }, open ? '▾' : '▸'), p.name,
        h('span', { class: 'act', title: t('newChat'), role: 'button', onClick: guard(async e => { e.stopPropagation(); await goHome(p.projectId); }) }, '+')),
      open ? sessions.map(s => {
        const run = activeRun(s.sessionId), waiting = S.pending.some(a => a.sessionId === s.sessionId);
        return h('button', { class: `thread${s.sessionId === S.sessionId && S.view === 'chat' ? ' on' : ''}`, onClick: guard(async () => { await openSession(s.sessionId); renderShell(); }) },
          h('span', { class: 'name' }, s.name), waiting ? h('span', { class: 'pulse wait', title: t('waiting') }) : run ? h('span', { class: 'pulse', title: t(`run_${run.state}`) }) : null);
      }) : null,
      open && !sessions.length ? h('div', { class: 'thread', style: 'color:var(--muted);cursor:default' }, t('noChats')) : null);
  });
  fill(el,
    h('div', { class: 'brand' }, logo({ size: 26 }), h('span', { class: 'word' }, 'bitcode'), h('span', { class: 'ver num' }, S.info?.version || '')),
    h('div', { class: 'newchat' }, h('button', { class: 'btn primary pill block', onClick: guard(() => S.projectId ? goHome(S.projectId) : openFolder()) }, `+ ${t('newChat')}`)),
    h('div', { class: 'nav' }, groups, h('button', { class: 'ghead', style: 'margin-top:10px', onClick: openFolder }, h('span', { class: 'chev' }, '+'), t('openFolder'))),
    h('div', { class: 'sidefoot' }, nav('bitcoin', '₿', t('bitcoin')), nav('activity', '≡', t('activity'), S.pending.length || null), nav('settings', '⚙', t('settings'))));
}
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

function renderTopbar() {
  const el = $('topbar'); if (!el) return;
  const s = S.session, p = project();
  const toggle = (key, label) => h('button', { class: `iconbtn${S.panel === key ? ' on' : ''}`, title: key === 'terminal' ? t('terminalShort') : t(key), 'aria-label': key === 'terminal' ? t('terminalShort') : t(key), onClick: () => { S.panel = S.panel === key ? null : key; renderShell(); } }, label);
  fill(el,
    h('span', { class: 'title', title: s?.name || '' }, s ? s.name : p ? p.name : 'bitcode'),
    p ? h('span', { class: 'chip opt' }, p.name) : null,
    S.git?.repo ? h('span', { class: 'chip opt mono' }, `⎇ ${S.git.branch || 'HEAD'}${S.git.files.length ? ` · ${S.git.files.length}` : ''}`) : null,
    s ? h('button', { class: 'chip', style: 'cursor:pointer', title: s.keep ? t('kept') : `${t('expiresIn')} ${fmtTime(s.expiresAt)}`,
      onClick: guard(async () => { const r = await api('session.update', { sessionId: s.sessionId, keep: !s.keep }); Object.assign(S.session, { keep: r.keep, expiresAt: r.expiresAt }); renderTopbar(); }) }, s.keep ? `★ ${t('kept')}` : `☆ ${t('keep')}`) : null,
    h('span', { class: 'spacer' }),
    s ? h('div', { class: 'satrow' }, SATS.map(x => sat(x, { size: 30, state: S.sats[x].st, title: `${satName(x)} · ${t(`sat_${S.sats[x].st}`)}${S.sats[x].summary ? ' · ' + S.sats[x].summary : ''}` }))) : null,
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

function renderComposer() {
  const el = $('composer'); if (!el) return;
  if (!project()) return fill(el);
  const s = S.session, run = s && activeRun(s.sessionId);
  const input = h('textarea', { id: 'prompt', rows: 2, placeholder: s ? t('placeholder') : t('placeholderNew'), 'aria-label': t('placeholder'),
    onInput: e => { S.draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = `${Math.min(240, e.target.scrollHeight)}px`; },
    onKeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } } });
  input.value = S.draft;
  const submit = guard(async () => {
    const text = input.value; if (!text.trim()) return;
    let session = S.session;
    if (!session) {
      if (text.trim().startsWith('/')) throw Object.assign(new Error(t('noSession')), { code: 'X' });
      const meta = await api('session.create', { projectId: S.projectId, name: text.trim().replace(/\s+/g, ' ').slice(0, 48), mode: S.newMode || 'assisted' });
      await loadSessions(); await openSession(meta.sessionId); session = S.session; renderShell();
    }
    const res = await api('chat.submit', { sessionId: session.sessionId, text, ...(S.agent ? { agent: S.agent } : {}) });
    S.draft = ''; if ($('prompt')) $('prompt').value = '';
    if (res.command && Array.isArray(res.result)) toast(res.result.length ? res.result.map(a => `${a.id.slice(0, 10)} · ${a.kind}`).join('\n') : t('none'));
    if (res.command && res.result?.mode) { S.session.mode = res.result.mode; await loadSessions(); renderComposer(); }
    if (!res.command) { S.session = await api('session.open', { sessionId: session.sessionId }); renderThread(); renderComposer(); renderSidebar(); }
  });
  const modeSelect = h('select', { 'aria-label': t('mode'), onChange: guard(async e => {
    if (!s) { S.newMode = e.target.value; return; }
    const r = await api('mode.set', { sessionId: s.sessionId, mode: e.target.value }); S.session.mode = r.mode; await loadSessions();
  }) }, MODES.map(m => h('option', { value: m, selected: (s?.mode || S.newMode || 'assisted') === m }, t(m))));
  fill(el, h('div', { class: 'composer' }, input,
    h('div', { class: 'bar' },
      h('select', { 'aria-label': t('agentL'), onChange: e => { S.agent = e.target.value; } }, h('option', { value: '' }, 'Bitcode'), SATS.map(a => h('option', { value: a, selected: S.agent === a }, satName(a)))),
      modeSelect,
      h('span', { class: 'chip num', title: t('model') }, s?.model || S.status?.defaultModel?.spec || '—'),
      h('span', { style: 'flex:1' }),
      run ? h('button', { class: 'send stop', title: t('stop'), 'aria-label': t('stop'), onClick: guard(() => api('run.cancel', { runId: run.runId })) }, '■')
        : h('button', { class: 'send', title: t('send'), 'aria-label': t('send'), onClick: submit }, '↑'))),
    h('div', { class: 'hint' }, t('hint')));
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
function bitcoinPage() {
  const protos = [['Bitcoin', 'signet · testnet4 · regtest'], ['Lightning', 'LND · signet / testnet / regtest'], ['Cashu', t('cashuEnv')], ['Liquid', 'liquidtestnet · elementsregtest'], ['Taproot Assets', 'tapd · LND test']];
  return h('div', { class: 'page' }, h('h1', {}, t('bitcoin')), h('p', { class: 'lead' }, t('bitcoinLead')),
    h('div', { class: 'stats' },
      h('div', { class: 'card stat' }, h('div', { class: 'n num' }, '0 / 5'), h('div', { class: 'l' }, t('connected'))),
      h('div', { class: 'card stat' }, h('div', { class: 'n num', style: 'color:var(--muted)' }, '—'), h('div', { class: 'l' }, t('balanceTest')))),
    h('div', { class: 'section' }, t('protocols')),
    h('div', { class: 'cards' }, protos.map(([name, envs]) => h('div', { class: 'card' }, h('h3', {}, name), h('div', { class: 'status num' }, envs),
      h('div', { style: 'margin-top:12px' }, h('span', { class: 'chip' }, t('unavailable'))), h('p', {}, t('adapterMissing'))))));
}
function settingsPage() {
  const st = S.settings, info = S.info;
  const set = (key, parse = v => v) => guard(async e => {
    S.settings = await api('settings.set', { key, value: parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value) });
    if (key === 'model') await refreshStatus(); if (key === 'lang') setLang(S.settings.lang); if (key === 'theme') { applyTheme(); retheme(); } renderShell();
  });
  const modelInput = (value, onChange, placeholder) => h('input', { type: 'text', class: 'mono', list: 'models', value: value || '', placeholder, onChange });
  const keyInputs = new Map();
  return h('div', { class: 'page' }, h('h1', {}, t('settings')),
    h('datalist', { id: 'models' }, S.models.map(m => h('option', { value: `${m.name}/${m.defaultModel || ''}` }))),
    h('div', { class: 'section' }, t('appearance')),
    h('div', { class: 'form' },
      h('label', {}, t('language')), h('select', { onChange: set('lang') }, ['it', 'en'].map(l => h('option', { value: l, selected: st.lang === l }, l === 'it' ? 'Italiano' : 'English'))),
      h('label', {}, t('theme')), h('select', { onChange: set('theme') }, ['dark', 'light', 'system'].map(l => h('option', { value: l, selected: (st.theme || 'dark') === l }, t(l))))),
    h('div', { class: 'section' }, t('model')),
    h('div', { class: 'form' },
      h('label', {}, t('defaultModel')), modelInput(st.model, set('model', v => v.trim() || null), 'ollama/qwen3-coder'),
      SATS.map(s => [h('label', {}, `${t('satModel')} ${satName(s)}`), modelInput(st.satModels?.[s], guard(async e => { S.settings = await api('settings.set', { key: 'satModels', value: { ...st.satModels, [s]: e.target.value.trim() || null } }); }), t('inherit'))]),
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
