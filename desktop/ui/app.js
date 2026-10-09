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
import { renderMarkdown, commandOf, isRisky } from './markdown.js';
import { satStateLabel, satStateTable, satEthics } from '../../src/sat-states.mjs';
import { workText, closingText, actionText, word } from '../../src/work-meter.mjs';

const SATS = ['node', 'script', 'hash', 'merkle'];
// Why 'Senza supervisione' cannot be chosen yet (it works in a Git worktree), or '' when it can.
const unattendedBlocked = () => (S.git && !S.git.repo ? t('E_WORKTREE_NO_REPO') : S.git && S.git.repo && !S.git.hasCommits ? t('E_WORKTREE_NO_COMMIT') : '');
const MODES = ['manual', 'assisted', 'unattended'];
const S = {
  view: 'chat', info: null, status: null, settings: null, projects: [], projectId: null, sessions: [], sessionId: null, session: null,
  work: new Map(), closing: new Map(), attachments: [], collapsed: new Set(), tree: new Map(), expanded: new Set(['.']), git: null, tabs: [], active: null, panel: null, runs: new Map(), pending: [],
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
const satLabel = (id, state) => satStateLabel(id, state, document.documentElement.lang);

// ---------- reading: markdown, copy, zoom ----------
const copyText = guard(async (text, button) => {
  await api('clipboard.write', { text });
  if (button) { const old = button.textContent; button.textContent = t('copiedText'); button.classList.add('done'); setTimeout(() => { button.textContent = old; button.classList.remove('done'); }, 1400); } else toast(t('copiedText'));
});
const openLink = guard(url => api('app.openExternal', { url }));
// Play on a shell block: runs it in the USER's terminal (the side panel), only from a real click of theirs.
// Risky commands (sudo, rm -rf, curl | sh ...) need a second click within a few seconds.
const runInTerminal = guard(async (text, button, event) => {
  if (!event?.isTrusted || !S.projectId) return;
  const command = commandOf(text);
  if (isRisky(command) && button.dataset.arm !== '1') {
    const old = button.innerHTML; button.dataset.arm = '1'; button.classList.add('arm'); button.textContent = `⚠ ${t('runConfirm')}`;
    setTimeout(() => { if (button.isConnected) { button.dataset.arm = ''; button.classList.remove('arm'); button.innerHTML = old; } }, 4000); return;
  }
  button.dataset.arm = ''; button.classList.remove('arm');
  S.panel = 'terminal'; renderShell();
  for (let i = 0; i < 40 && !(term && ptyId && ptyProject === S.projectId); i++) await new Promise(r => setTimeout(r, 75));
  if (!ptyId) return toast(t('E_PTY_UNAVAILABLE'), true);
  term.paste(command); term.focus();
  await api('pty.write', { ptyId, data: '\r' });
  toast(t('runSent'));
});
const md = text => renderMarkdown(text, { h, onCopy: copyText, onLink: openLink, onRun: S.projectId ? runInTerminal : null, labels: { copy: t('copyL'), code: t('codeL'), run: t('runL'), runTitle: t('runTitle') } });
// Reading scale: automatic with the window width (so a big monitor is not a narrow column), then the user's own zoom.
const READ_KEY = 'bitcode.readScale';
try { S.read = Math.min(2.2, Math.max(0.7, Number(localStorage.getItem(READ_KEY)) || 1)); } catch { S.read = 1; }
function applyRead() { document.documentElement.style.setProperty('--read', (Math.min(1.6, Math.max(1, innerWidth / 1500)) * S.read).toFixed(3)); }
function zoomRead(step) {
  S.read = step === 'reset' ? 1 : Math.min(2.2, Math.max(0.7, S.read * (step > 0 ? 1.08 : 1 / 1.08)));
  try { localStorage.setItem(READ_KEY, String(S.read)); } catch {}
  applyRead();
  let hint = $('zoomhint'); if (!hint) { hint = h('div', { id: 'zoomhint', class: 'zoomhint' }); document.body.append(hint); }
  hint.textContent = `${Math.round(S.read * 100)}%`; hint.classList.add('on'); clearTimeout(hint._t); hint._t = setTimeout(() => hint.classList.remove('on'), 900);
}
applyRead(); window.addEventListener('resize', applyRead);
document.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || S.view !== 'chat' || !e.target.closest?.('#thread, .composer-wrap')) return;
  e.preventDefault(); zoomRead(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
const lastAnswer = () => [...(S.session?.messages || [])].reverse().find(m => m.role === 'assistant' && m.content)?.content;
function jumpMessage(dir) {
  const th = $('thread'); if (!th) return;
  const msgs = [...th.querySelectorAll('.m-user, .m-bot')]; if (!msgs.length) return;
  const top = th.getBoundingClientRect().top, cur = msgs.reduce((c, m, i) => (m.getBoundingClientRect().top - top <= 8 ? i : c), -1);
  const target = dir > 0 ? msgs[Math.min(msgs.length - 1, cur + 1)] : (cur >= 0 && msgs[cur].getBoundingClientRect().top - top < -8 ? msgs[cur] : msgs[Math.max(0, cur - 1)]);
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
const SHORTCUTS = [
  ['mod+wheel · mod+= / mod+-', 'scRead'], ['mod+0', 'scReadReset'], ['alt+↑ / alt+↓', 'scJump'], ['End · Home', 'scEnds'], ['mod+L · /', 'scFocus'],
  ['mod+shift+C', 'scCopy'], ['mod+U', 'scAttach'], ['mod+1 … 4', 'scPanels'], ['mod+B', 'scSidebar'], ['mod+K', 'scSearch'], ['mod+N', 'scNew'], ['mod+/ · ?', 'scHelp'], ['Esc', 'scClose']
];
function showShortcuts() {
  if (document.querySelector('dialog.shortcuts')) return;
  const mac = /Mac/i.test(navigator.platform), key = k => k.replace(/mod/g, mac ? '⌘' : 'Ctrl').replace(/alt/g, mac ? '⌥' : 'Alt').replace(/shift/g, mac ? '⇧' : 'Shift');
  const dialog = h('dialog', { class: 'sat-info shortcuts', 'aria-label': t('scTitle') },
    h('div', { class: 'row' }, h('h2', {}, t('scTitle')), h('button', { class: 'iconbtn', autofocus: true, onClick: () => dialog.close(), 'aria-label': t('close') }, '×')),
    h('div', { class: 'sclist' }, SHORTCUTS.map(([k, label]) => [h('span', { class: 'keys' }, key(k).split(' ').map(x => /^[·/]$|^…$/.test(x) ? ` ${x} ` : h('kbd', {}, x))), h('span', {}, t(label))])));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
document.addEventListener('keydown', e => {
  const inEditor = e.target.closest?.('.cm-editor, .xterm'), typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || inEditor;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key) && S.view === 'chat' && !inEditor) { e.preventDefault(); zoomRead(e.key === '0' ? 'reset' : e.key === '-' || e.key === '_' ? -1 : 1); return; }
  if (mod && e.key === '/') { e.preventDefault(); showShortcuts(); return; }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'u' && S.view === 'chat' && S.projectId) { e.preventDefault(); pickAttachments('files'); return; }
  if (mod && !e.altKey && !e.shiftKey && /^[1-4]$/.test(e.key) && S.projectId && S.view === 'chat') { e.preventDefault(); const k = ['files', 'git', 'terminal', 'agent'][Number(e.key) - 1]; S.panel = S.panel === k ? null : k; renderShell(); return; }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); $('prompt')?.focus(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'c' && !inEditor) { const picked = String(window.getSelection() || ''), a = picked || lastAnswer(); if (a) { e.preventDefault(); copyText(a); } return; }
  if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.view === 'chat') { e.preventDefault(); jumpMessage(e.key === 'ArrowDown' ? 1 : -1); return; }
  if (typing || mod || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); showShortcuts(); }
  else if (e.key === '/' && S.view === 'chat') { e.preventDefault(); $('prompt')?.focus(); }
  else if ((e.key === 'End' || e.key === 'Home') && S.view === 'chat') { e.preventDefault(); const th = $('thread'); th?.scrollTo({ top: e.key === 'End' ? th.scrollHeight : 0, behavior: 'smooth' }); }
});

// ---------- context menu (right click): copy / paste / select in chat, terminal, editor and inputs ----------
let ctxMenu = null;
function closeMenu() { ctxMenu?.remove(); ctxMenu = null; }
function openMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'ctxmenu', role: 'menu' }, items.map(it => it === '-' ? h('div', { class: 'sep' }) : h('button', { type: 'button', role: 'menuitem', disabled: it.disabled, onClick: async () => { closeMenu(); await it.run(); } }, it.label, it.hint ? h('kbd', {}, it.hint) : null)));
  document.body.append(menu); ctxMenu = menu;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  menu.querySelector('button:not([disabled])')?.focus();
  menu.addEventListener('keydown', e => {
    const bs = [...menu.querySelectorAll('button:not([disabled])')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); } else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  });
}
for (const ev of ['mousedown', 'wheel', 'resize']) window.addEventListener(ev, e => { if (ctxMenu && !ctxMenu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', e => { if (e.target === window) closeMenu(); }); // only the window losing focus, not the element the menu itself takes focus from
const modKey = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
async function pasteInto(el) { const text = await api('clipboard.read').catch(() => ''); if (!text) return; el.focus(); document.execCommand('insertText', false, text); }
document.addEventListener('contextmenu', e => {
  const target = e.target, x = e.clientX, y = e.clientY;
  if (target.closest?.('.ctxmenu')) return e.preventDefault();
  e.preventDefault();
  if (target.closest?.('.xterm')) {
    const sel = term?.hasSelection();
    return openMenu(x, y, [{ label: t('copyL'), hint: 'Ctrl+Shift+C', disabled: !sel, run: () => termCopy() }, { label: t('pasteL'), hint: 'Ctrl+Shift+V', run: termPaste }, '-',
      { label: t('selectAllL'), run: () => { term?.selectAll(); term?.focus(); } }, { label: t('clearTermL'), run: () => { term?.clear(); term?.focus(); } }]);
  }
  const field = target.closest?.('input, textarea');
  if (field && !['checkbox', 'radio', 'button'].includes(field.type)) {
    const has = field.selectionStart !== field.selectionEnd, ro = field.readOnly || field.disabled;
    return openMenu(x, y, [{ label: t('cutL'), hint: `${modKey}+X`, disabled: !has || ro, run: async () => { await api('clipboard.write', { text: field.value.slice(field.selectionStart, field.selectionEnd) }); field.focus(); document.execCommand('delete'); } },
      { label: t('copyL'), hint: `${modKey}+C`, disabled: !has, run: () => api('clipboard.write', { text: field.value.slice(field.selectionStart, field.selectionEnd) }) },
      { label: t('pasteL'), hint: `${modKey}+V`, disabled: ro, run: () => pasteInto(field) }, '-', { label: t('selectAllL'), hint: `${modKey}+A`, run: () => { field.focus(); field.select(); } }]);
  }
  const cm = target.closest?.('.cm-editor');
  if (cm) {
    const tab = S.active?.view, sel = tab ? tab.state.sliceDoc(tab.state.selection.main.from, tab.state.selection.main.to) : '';
    return openMenu(x, y, [{ label: t('cutL'), hint: `${modKey}+X`, disabled: !sel, run: async () => { await api('clipboard.write', { text: sel }); tab.focus(); document.execCommand('delete'); } },
      { label: t('copyL'), hint: `${modKey}+C`, disabled: !sel, run: () => api('clipboard.write', { text: sel }) },
      { label: t('pasteL'), hint: `${modKey}+V`, run: () => pasteInto(cm.querySelector('.cm-content')) }, '-', { label: t('selectAllL'), hint: `${modKey}+A`, run: () => { tab?.focus(); document.execCommand('selectAll'); } }]);
  }
  const selection = String(window.getSelection() || ''), link = target.closest?.('a.mdlink'), message = target.closest?.('.m-bot');
  const items = [{ label: t('copyL'), hint: `${modKey}+C`, disabled: !selection, run: () => api('clipboard.write', { text: selection }) }];
  if (link) items.unshift({ label: t('openLinkL'), run: () => openLink(link.href) }, { label: t('copyLinkL'), run: () => api('clipboard.write', { text: link.href }) }, '-');
  if (message) { const raw = [...(S.session?.messages || [])].filter(m => m.role === 'assistant' && m.content).find(m => message.textContent.includes(m.content.slice(0, 20).replace(/[#*`>\-]/g, '').trim()))?.content; items.push({ label: t('copyMsgL'), run: () => api('clipboard.write', { text: raw || message.querySelector('.md')?.innerText || message.innerText }) }); }
  items.push('-', { label: t('selectAllL'), hint: `${modKey}+A`, run: () => { const th = $('thread'); if (th) { const r = document.createRange(); r.selectNodeContents(th); const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(r); } else document.execCommand('selectAll'); } });
  openMenu(x, y, items);
});

// ---------- attachments: drag & drop, paste, or pick files / folders ----------
const KIND_ICON = { folder: '📁', image: '🖼', pdf: '📕', text: '📄', archive: '🗜', audio: '🎵', video: '🎞', file: '📎' };
const fmtSize = n => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`).replace('.', wlang() === 'it' ? ',' : '.');
const kindFor = (name, isDir) => (isDir ? 'folder' : /\.(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/i.test(name) ? 'image' : /\.pdf$/i.test(name) ? 'pdf' : /\.(zip|tar|gz|tgz|7z|rar|xz|bz2)$/i.test(name) ? 'archive'
  : /\.(mp3|wav|flac|ogg|m4a)$/i.test(name) ? 'audio' : /\.(mp4|mov|mkv|webm|avi)$/i.test(name) ? 'video' : /\.(txt|md|json|ya?ml|toml|csv|log|xml|html?|css|m?[jt]sx?|py|rs|go|java|sh|sql|c|h|cpp)$/i.test(name) ? 'text' : 'file');
function addAttachments(items, skipped = []) {
  for (const it of items) S.attachments.push(it);
  if (skipped.length) toast(`${skipped.length} ${t('attachSkipped')}: ${skipped.slice(0, 3).map(x => x.name).join(', ')}`, true);
  renderComposer();
}
const pickAttachments = guard(async kind => {
  if (!S.projectId) return toast(t('noProject'), true);
  const r = await api('attach.pick', { projectId: S.projectId, kind }); addAttachments(r.items, r.skipped);
});
const attachMenu = button => { const r = button.getBoundingClientRect(); openMenu(r.left, r.top - 96, [{ label: t('attachFiles'), hint: `${modKey}+U`, run: () => pickAttachments('files') }, { label: t('attachFolder'), run: () => pickAttachments('folder') }]); };
// Folder drops are walked in the UI (webkitGetAsEntry) and sent file by file, so the main process never trusts a path from the page.
const readEntries = dir => new Promise((resolve, reject) => { const all = [], r = dir.createReader(); (function next() { r.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject); })(); });
const fileOf = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
async function* walkEntry(entry, prefix) {
  if (entry.isFile) yield { rel: `${prefix}${entry.name}`, file: await fileOf(entry) };
  else if (entry.isDirectory) for (const child of await readEntries(entry)) yield* walkEntry(child, `${prefix}${entry.name}/`);
}
const importDropped = guard(async dataTransfer => {
  if (!S.projectId) return toast(t('noProject'), true);
  const roots = [...(dataTransfer.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const plain = roots.length ? null : [...(dataTransfer.files || [])].map(f => ({ isFile: true, isDirectory: false, name: f.name, file: cb => cb(f) }));
  toast(t('attachBusy'));
  const items = [], skipped = [];
  for (const entry of plain || roots) {
    const group = crypto.randomUUID(); let top = null, count = 0, size = 0, finalTop = null;
    try {
      for await (const { rel, file } of walkEntry(entry, '')) {
        const res = await api('attach.put', { projectId: S.projectId, group, top: entry.name, rel, data: new Uint8Array(await file.arrayBuffer()) });
        finalTop = res.top; count++; size += res.size;
      }
    } catch (e) { skipped.push({ name: entry.name, reason: e.code }); if (['TOO_LARGE', 'TOO_MANY'].includes(e.code)) toast(errorText(e), true); }
    if (finalTop) items.push({ name: finalTop, rel: `allegati/${finalTop}`, isDir: !!entry.isDirectory, files: count, size, kind: kindFor(entry.name, entry.isDirectory) });
  }
  addAttachments(items, skipped.filter(x => !['TOO_LARGE', 'TOO_MANY'].includes(x.reason)));
});
const dropzone = h('div', { class: 'dropzone', hidden: true }, h('div', { class: 'dropcard' }, icon('paperclip', { size: 28 }), h('div', {}, t('dropHint'))));
document.body.append(dropzone);
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', e => { if (!hasFiles(e) || S.view !== 'chat' || !S.projectId) return; e.preventDefault(); dragDepth++; dropzone.querySelector('.dropcard div').textContent = t('dropHint'); dropzone.hidden = false; });
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.hidden = true; });
document.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; dropzone.hidden = true; if (S.view === 'chat' && S.projectId) importDropped(e.dataTransfer); });
const attachmentLines = () => S.attachments.map(a => `📎 ${a.rel}${a.isDir ? '/' : ''} · ${t(`kind_${a.kind}`)}${a.isDir ? ` · ${a.files} ${t('filesN')}` : ''} · ${fmtSize(a.size)}`).join('\n');
function attachmentChips() {
  if (!S.attachments.length) return null;
  return h('div', { class: 'attachments' }, S.attachments.map((a, i) => h('span', { class: 'achip', title: `${a.rel}${a.isDir ? '/' : ''}` },
    h('span', { class: 'aicon' }, KIND_ICON[a.kind] || '📎'), h('span', { class: 'aname' }, a.name), h('span', { class: 'asize num' }, a.isDir ? `${a.files} · ${fmtSize(a.size)}` : fmtSize(a.size)),
    h('button', { type: 'button', class: 'ax', 'aria-label': t('attachRemove'), title: t('attachRemove'), onClick: guard(async () => { await api('attach.remove', { projectId: S.projectId, top: a.name }).catch(() => {}); S.attachments.splice(i, 1); renderComposer(); }) }, '×'))));
}

// ---------- live work line: rotating phrase + one measured datum, like the CLI ----------
const wlang = () => (document.documentElement.lang === 'en' ? 'en' : 'it');
const workOf = id => { let w = S.work.get(id); if (!w) S.work.set(id, w = { memory: null, liveBase: 0, liveOff: 0, callStart: null, speed: null, action: null }); return w; };
const liveChars = () => [...S.live.values()].reduce((n, l) => n + l.text.length, 0);
function runSnapshot(run, at = Date.now()) {
  const w = workOf(run.runId), est = w.liveBase + Math.ceil(Math.max(0, liveChars() - w.liveOff) / 4);
  return { elapsed: Math.max(0, (run.endedAt || at) - run.startedAt), inTokens: run.usage.inputTokens, outTokens: Math.max(run.usage.outputTokens, est), speed: w.speed, action: w.action, memory: w.memory };
}
// Who is working: the Sat that is active now (delegation included), else the one chosen for the session.
const workingSat = sessionId => SATS.find(x => !['idle', 'happy', 'concerned'].includes(S.sats[x].st) && sessionId === S.sessionId) || S.sessions.find(x => x.sessionId === sessionId)?.satId || null;
function runLine(run) {
  const waiting = S.pending.some(a => a.sessionId === run.sessionId), id = workingSat(run.sessionId);
  const mark = id ? sat(id, { size: 18, state: waiting ? 'waiting' : 'thinking' }) : logo({ size: 14 });
  const el = h('div', { class: 'runline', 'data-run': run.runId, 'data-key': `${id}|${waiting}` }, mark, h('b', {}, id ? satName(id) : 'Bitcode'), h('span', { class: 'rl-phrase' }), h('span', { class: 'rl-datum num' }));
  fillRunLine(el, run, waiting);
  return el;
}
function fillRunLine(el, run, waiting) {
  const { phrase, datum } = workText({ id: workingSat(run.sessionId) || 'bitcode', snap: runSnapshot(run), ms: Date.now() - run.startedAt, lang: wlang() });
  el.querySelector('.rl-phrase').textContent = waiting ? word('waiting', wlang()) : `${phrase}…`;
  el.querySelector('.rl-datum').textContent = waiting ? '' : datum;
}
function closingLine(c) {
  const mark = c.id ? sat(c.id, { size: 16, state: c.ok ? 'happy' : 'concerned' }) : logo({ size: 14 });
  return h('div', { class: 'runline runend' }, mark, h('b', {}, c.id ? satName(c.id) : 'Bitcode'), h('span', { class: 'rl-datum num' }, c.text));
}
// Update texts in place: replacing the node would restart the avatar's animation every second.
function tickRunLines() {
  for (const el of document.querySelectorAll('.runline[data-run]')) {
    const run = S.runs.get(el.dataset.run); if (!run || run.endedAt) continue;
    const waiting = S.pending.some(a => a.sessionId === run.sessionId), key = `${workingSat(run.sessionId)}|${waiting}`;
    if (key !== el.dataset.key) el.replaceWith(runLine(run)); else fillRunLine(el, run, waiting);
  }
}
document.addEventListener('bitcode:tick', tickRunLines);
setInterval(() => document.dispatchEvent(new Event('bitcode:tick')), 1000);
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
    term.attachCustomKeyEventHandler(ev => {
      if (ev.type !== 'keydown') return true;
      const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.shiftKey && k === 'c') { termCopy(); return false; }
      if ((mod && ev.shiftKey && k === 'v') || (mod && !ev.shiftKey && k === 'v') || (ev.shiftKey && ev.key === 'Insert')) { termPaste(); return false; }
      if (mod && !ev.shiftKey && k === 'c' && term.hasSelection()) { termCopy(true); return false; } // with a selection Ctrl+C copies; otherwise it stays an interrupt
      return true;
    });
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

async function termCopy(clear = false) { const text = term?.getSelection(); if (!text) return; await api('clipboard.write', { text }).catch(() => {}); if (clear) term.clearSelection(); }
async function termPaste() { const text = await api('clipboard.read').catch(() => ''); if (text) term?.paste(text); term?.focus(); }

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
    { const w = workOf(payload.runId); w.liveBase = payload.usage.outputTokens; w.liveOff = liveChars(); }
    if (!payload.endedAt) S.closing.delete(payload.sessionId);
    if (payload.endedAt) {
      const sid = S.sessions.find(x => x.sessionId === payload.sessionId)?.satId || null;
      S.closing.set(payload.sessionId, { id: sid, ok: payload.state === 'success', text: closingText({ outcome: payload.state === 'success' ? 'ok' : payload.state === 'cancelled' ? 'cancelled' : 'error', snap: runSnapshot(payload), lang: wlang() }) });
      S.live.delete(payload.runId); refreshGit();
      if (payload.error && payload.sessionId === S.sessionId) toast(errorText({ code: payload.errorCode, message: payload.error }), true);
      if (payload.worktree) api('worktree.list').then(w => { S.worktrees = w; });
      if (payload.sessionId === S.sessionId) for (const s of SATS) S.sats[s] = { st: 'idle' };
    }
    renderSidebar(); if (S.view === 'chat') { renderThread(); renderComposer(); renderTopbar(); } else if (S.view === 'activity') renderCenter();
  } else if (channel === 'session' && payload.sessionId === S.sessionId) {
    const { type, data } = payload;
    if (type === 'plan.saved') note(t('planSaved'), [data.file, t('planBuildHint')]);
    if (type === 'messages') { S.session.messages = data.messages; S.live.clear(); for (const w of S.work.values()) { w.liveOff = 0; w.callStart = null; } renderThread(); }
    if (type === 'message.delta') {
      { // speed over a sliding ~4 s window; it keeps its last value while the model is silent (tools running)
        const w = workOf(data.runId), t0 = Date.now(); w.total = (w.total || 0) + data.text.length;
        (w.samples ||= []).push({ t: t0, c: w.total }); while (w.samples.length > 1 && t0 - w.samples[0].t > 4000) w.samples.shift();
        const first = w.samples[0], secs = (t0 - first.t) / 1000; if (secs >= 1) w.speed = Math.max(1, Math.round((w.total - first.c) / 4 / secs)); } S.live.set(data.runId, { agent: data.agentId, text: (S.live.get(data.runId)?.text || '') + data.text }); renderThread(); }
    if (type === 'tool.detail') { S.agentLog.push({ at: Date.now(), text: `${data.auto ? 'auto' : t('approved')} · ${data.tool} · ${data.summary}` }); if (S.panel === 'agent') renderPanel(); }
  } else if (channel === 'sat' && payload.sessionId === S.sessionId && SATS.includes(payload.satId)) {
    const visual = { writing: 'drafting', waiting_approval: 'waiting', success: 'happy', error: 'concerned', planning: 'thinking', delegating: 'running' };
    S.sats[payload.satId] = { st: visual[payload.state] || payload.state };
    renderTopbar();
  } else if (channel === 'metrics') {
    workOf(payload.runId).memory = payload.memory;
  } else if (channel === 'feed') {
    if (payload.type === 'tool.started') for (const r of S.runs.values()) if (r.sessionId === payload.sessionId && !r.endedAt) workOf(r.runId).action = actionText(payload.data, wlang());
    if (['tool.finished', 'model.started'].includes(payload.type)) for (const r of S.runs.values()) if (r.sessionId === payload.sessionId) workOf(r.runId).action = null;
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
    fill(el, h('header', { class: 'topbar', id: 'topbar' }), h('div', { class: 'scroll', id: 'thread' }), h('div', { class: 'composer-wrap', id: 'composer' }),
      h('button', { id: 'tobottom', class: 'tobottom', type: 'button', hidden: true, title: `${t('scBottom')} (End)`, 'aria-label': t('scBottom'), onClick: () => $('thread').scrollTo({ top: $('thread').scrollHeight, behavior: 'smooth' }) }, '↓'));
    $('thread').addEventListener('scroll', () => { const th = $('thread'); $('tobottom').hidden = th.scrollTop + th.clientHeight >= th.scrollHeight - 160; }, { passive: true });
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
    info.id ? [h('h3', {}, t('satStates')), h('div', { class: 'row' }, satStateTable(info.id, document.documentElement.lang).map(x => h('span', { class: 'chip', title: x.plain }, x.label)))] : null,
    info.permissions && satEthics(info.permissions, document.documentElement.lang).length ? h('p', { class: 'ethics' }, satEthics(info.permissions, document.documentElement.lang).join(' · ')) : null,
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
    }) }, sat(x, { size: 30, state: S.sats[x].st, title: `${satName(x)} · ${t(`role_${x}`)}${satLabel(x, S.sats[x].st).text ? ` — ${satLabel(x, S.sats[x].st).text}` : ''}` })))) : null,
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
      if (m.content) items.push(h('div', { class: 'm-bot' }, h('div', { class: 'who' }, logo({ size: 16 }), 'Bitcode', h('span', { class: 'num' }, `· ${model}`), h('span', { class: 'spacer' }), h('button', { class: 'copy ghost', type: 'button', title: `${t('copyL')} (${/Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}+Shift+C)`, onClick: e => copyText(m.content, e.currentTarget) }, t('copyL'))), md(m.content)));
      if (m.tools?.length) items.push(h('div', { class: 'm-tools mono' }, m.tools.map(x => h('div', {}, x))));
    }
  }
  for (const [, l] of S.live) items.push(h('div', { class: 'm-bot live' }, h('div', { class: 'who' }, SATS.includes(l.agent) ? sat(l.agent, { size: 20, state: S.sats[l.agent]?.st || 'drafting' }) : logo({ size: 16 }), SATS.includes(l.agent) ? satName(l.agent) : 'Bitcode', typing(SAT_META[l.agent]?.color)), md(l.text)));
  items.push(...S.pending.filter(a => a.sessionId === s.sessionId).map(approvalCard));
  items.push(...S.notes.map(n => h('div', { class: 'note' }, h('div', { class: 'ntitle' }, n.title), n.lines.length ? h('div', { class: 'nbody mono' }, n.lines.map(l => h('div', {}, l))) : null)));
  if (run) items.push(runLine(run)); else if (S.closing.has(s.sessionId)) items.push(closingLine(S.closing.get(s.sessionId)));
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
    onPaste: e => { const files = [...(e.clipboardData?.files || [])]; if (!files.length || !S.projectId) return; e.preventDefault(); const dt = new DataTransfer(); for (const f of files) dt.items.add(f.name === 'image.png' ? new File([f], `immagine-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`, { type: f.type }) : f); importDropped(dt); },
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
    let text = input.value.trim(); if (!text && !S.attachments.length) return; if (!text) text = t('attachDefault');
    const [cmdName] = text.slice(1).split(/\s+/);
    if (text.startsWith('/') && UI_COMMANDS[cmdName]) { S.draft = ''; input.value = ''; S.menu.items = []; drawMenu(); return UI_COMMANDS[cmdName](); }
    let session = S.session;
    if (!session) {
      const meta = await api('session.create', { projectId: S.projectId, name: text.replace(/^\/\S+\s*/, '').replace(/\s+/g, ' ').slice(0, 48) || text.slice(0, 48), mode: S.newMode || 'assisted', satId: S.agent, model: S.newModel || undefined });
      await loadSessions(); await openSession(meta.sessionId); session = S.session; renderShell();
    }
    const withFiles = S.attachments.length && !text.startsWith('/') ? `${text}\n\n${attachmentLines()}` : text;
    const res = await api('chat.submit', { sessionId: session.sessionId, text: withFiles, agent: S.agent });
    if (withFiles !== text) S.attachments = [];
    S.draft = ''; if ($('prompt')) $('prompt').value = '';
    if (res.command) showResult(res);
    else { S.notes = []; S.session = await api('session.open', { sessionId: session.sessionId }); renderThread(); renderComposer(); renderSidebar(); }
  });
  const modeSelect = h('select', { 'aria-label': t('mode'), onChange: guard(async e => {
    if (!s) { S.newMode = e.target.value; return; }
    const r = await api('mode.set', { sessionId: s.sessionId, mode: e.target.value }); S.session.mode = r.mode; await loadSessions();
  }) }, MODES.map(m => h('option', { value: m, selected: (s?.mode || S.newMode || 'assisted') === m, disabled: m === 'unattended' && !!unattendedBlocked() && (s?.mode || S.newMode) !== m }, t(m))));
  if (unattendedBlocked()) modeSelect.title = unattendedBlocked();
  const currentModel = s?.model || S.newModel || S.status?.defaultModel?.spec || '—';
  fill(el, h('div', { class: 'composer' }, menuEl, attachmentChips(), input,
    h('div', { class: 'bar' },
      h('button', { type: 'button', class: 'attachbtn', title: `${t('attachL')} (${modKey}+U)`, 'aria-label': t('attachL'), disabled: !!run, onClick: e => attachMenu(e.currentTarget) }, icon('paperclip', { size: 16 })),
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
  const g = S.git; if (!g) return h('div', { class: 'status' }, '…'); if (!g.repo) return h('div', { class: 'gitinit' }, h('div', { class: 'status' }, t('notRepo')), h('button', { class: 'btn', onClick: guard(async () => { if (!confirm(t('gitInitConfirm'))) return; await api('git.init', { projectId: S.projectId }); await refreshGit(); renderComposer(); toast(t('gitInitDone')); }) }, t('gitInit')));
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
const openRunError = guard(async runId => {
  const details = await api('run.diagnostics', { runId });
  const dialog = h('dialog', { class: 'sat-info run-error', 'aria-label': t('runErrorDetails') });
  const prompt = h('textarea', { class: 'fix-prompt num', readonly: true, rows: 16, 'aria-label': t('fixPrompt') }, details.fixPrompt);
  fill(dialog,
    h('div', { class: 'row' }, h('h2', {}, t('runErrorDetails')), h('button', { class: 'iconbtn', autofocus: true, onClick: () => dialog.close(), 'aria-label': t('close') }, '×')),
    h('div', { class: 'row' }, h('code', {}, details.errorCode), details.errorStatus ? h('span', { class: 'num' }, `HTTP ${details.errorStatus}`) : null),
    h('pre', { class: 'run-error-message' }, details.error),
    h('h3', {}, t('fixPrompt')), h('p', {}, t('fixPromptHelp')), prompt,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: e => copyText(details.fixPrompt, e.currentTarget) }, t('copyFixPrompt'))));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
});
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
    runs.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, t('state')), h('th', {}, t('project')), h('th', {}, t('prompt')), h('th', {}, t('model')), h('th', {}, t('tokens')), h('th', {}, t('errorCode')), h('th', {})),
      runs.map(r => h('tr', {}, h('td', {}, h('span', { class: `chip ${r.state === 'success' ? 'ok' : ['error', 'interrupted'].includes(r.state) ? 'err' : r.state === 'awaiting_approval' ? 'warn' : ''}` }, t(`run_${r.state}`))),
        h('td', {}, projectName(r.projectId)), h('td', { title: r.error || '' }, r.prompt), h('td', { class: 'num' }, r.model), h('td', { class: 'num' }, (r.usage.inputTokens + r.usage.outputTokens).toLocaleString()),
        h('td', { class: 'num', title: r.error || '' }, r.errorCode || '—'),
        h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => goto(r.sessionId) }, t('open')),
          ['error', 'interrupted'].includes(r.state) ? h('button', { class: 'btn sm', onClick: () => openRunError(r.runId) }, t('runErrorDetails')) : null,
          !r.endedAt ? h('button', { class: 'btn sm danger', onClick: guard(() => api('run.cancel', { runId: r.runId })) }, t('cancel')) : null))))) : h('p', { class: 'status' }, t('none')),
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
