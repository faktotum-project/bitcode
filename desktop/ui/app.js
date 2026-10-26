import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { gotoLine } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { Terminal } from '@xterm/xterm';
import { BRAND, THEME } from '../../src/design-tokens.mjs';
import { FitAddon } from '@xterm/addon-fit';
import { t, setLang, errorText } from './i18n.js';
import { logo, sat, typing, SAT_META } from './marks.js';
import { icon } from './icons.js';
import { createFinanceView } from './finance.js';
import { createWorkbench, promptHistory } from './workbench.js';
import { renderMarkdown, commandOf, isRisky } from './markdown.js';
import { satStateLabel, satStateTable, satEthics } from '../../src/sat-states.mjs';
import { satForTool, toolLabel } from '../../src/sats/roles.mjs';
import { workText, closingText, actionText, word } from '../../src/work-meter.mjs';

const SATS = ['node', 'script', 'hash', 'merkle'];
// Why 'Senza supervisione' cannot be chosen yet (it works in a Git worktree), or '' when it can.
const unattendedBlocked = () => (S.git && !S.git.repo ? t('E_WORKTREE_NO_REPO') : S.git && S.git.repo && !S.git.hasCommits ? t('E_WORKTREE_NO_COMMIT') : '');
const MODES = ['manual', 'assisted', 'unattended'];
const S = {
  selecting: null, selected: new Set(),
  queue: new Map(), files: null, filesProject: null, reasoning: new Map(), reasoningOpen: false,
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
  ['mod+shift+C', 'scCopy'], ['mod+U', 'scAttach'], ['mod+1 … 7', 'scPanels'], ['mod+P', 'wb_palette'], ['↑ / ↓', 'wb_scHistory'], ['mod+B', 'scSidebar'], ['mod+K', 'scSearch'], ['mod+N', 'scNew'], ['mod+/ · ?', 'scHelp'], ['Esc', 'scClose']
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
  if (mod && !e.altKey && !e.shiftKey && /^[1-7]$/.test(e.key) && S.projectId && S.view === 'chat') { e.preventDefault(); const k = PANELS[Number(e.key) - 1]; S.panel = S.panel === k ? null : k; renderShell(); return; }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); wb.openPalette(); return; }
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
  const el = h('div', { class: 'runline', 'data-run': run.runId, 'data-key': `${id}|${waiting}` }, mark, h('b', {}, id ? satName(id) : 'bitcode'), h('span', { class: 'rl-phrase' }), h('span', { class: 'rl-datum num' }));
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
  return h('div', { class: 'runline runend' }, mark, h('b', {}, c.id ? satName(c.id) : 'bitcode'), h('span', { class: 'rl-datum num' }, c.text));
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
    keymap.of([{ key: 'Mod-s', run: () => { save(tab); return true; } }, { key: 'Mod-g', run: gotoLine }]),
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
// SSH terminals for Remote access: one xterm per connection, inside its own dialog.
const remoteTerms = new Map();
const openRemoteTerminal = guard(async (host, command = 'bitcode') => {
  const hostEl = h('div', { class: 'rterm' });
  const dialog = h('dialog', { class: 'sat-info plan rdialog', 'aria-label': host },
    h('div', { class: 'row' }, h('h2', {}, `ssh ${host}${command === 'bitcode' ? ' · bitcode' : ''}`), h('span', { class: 'spacer' }), h('button', { class: 'iconbtn', onClick: () => dialog.close(), 'aria-label': t('close') }, '×')), hostEl);
  document.body.append(dialog); dialog.showModal();
  const rt = new Terminal({ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, cursorBlink: true, theme: termTheme() }), rfit = new FitAddon(); rt.loadAddon(rfit); rt.open(hostEl);
  const { ptyId: id } = await api('pty.openSsh', { host, command });
  remoteTerms.set(id, rt);
  rt.onData(data => api('pty.write', { ptyId: id, data }).catch(() => {}));
  rt.onResize(({ cols, rows }) => api('pty.resize', { ptyId: id, cols, rows }).catch(() => {}));
  requestAnimationFrame(() => { try { rfit.fit(); } catch {} }); rt.focus();
  dialog.addEventListener('close', () => { if (remoteTerms.has(id)) api('pty.close', { ptyId: id }).catch(() => {}); remoteTerms.delete(id); rt.dispose(); dialog.remove(); });
});
function lanSection() {
  if (S.lan === undefined) { S.lan = null; api('lan.status').then(x => { S.lan = x; if (S.view === 'remote') renderCenter(); }).catch(() => {}); }
  const l = S.lan; if (!l) return h('p', { class: 'status' }, '…');
  const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('wb_lanPasswordPh') });
  return [h('div', { class: 'section' }, t('wb_modeLan')),
    h('div', { class: 'form' },
      h('label', {}, t('wb_lanState')), h('span', {}, l.running ? h('span', { class: 'chip ok' }, t('wb_lanRunning')) : h('span', { class: 'chip warn' }, l.error || (l.passwordSet ? t('wb_lanStopped') : t('wb_lanNeedsPassword')))),
      l.url ? [h('label', {}, t('wb_lanUrl')), h('span', { class: 'mono' }, l.url)] : null,
      l.fingerprint ? [h('label', { title: t('wb_lanFingerprintHint') }, t('wb_lanFingerprint')), h('span', { class: 'mono', style: 'font-size:11px;word-break:break-all' }, l.fingerprint)] : null,
      h('label', {}, t('wb_lanAddress')), h('select', { onChange: guard(async e => { S.lan = await api('lan.configure', { host: e.target.value }); renderCenter(); }) }, l.addresses.map(a => h('option', { value: a, selected: a === l.host }, a))),
      h('label', {}, t('wb_lanPort')), h('input', { type: 'number', min: 1024, max: 65535, value: l.port, onChange: guard(async e => { S.lan = await api('lan.configure', { port: Number(e.target.value) }); renderCenter(); }) }),
      h('label', {}, t('wb_lanPassword')), h('span', { class: 'row' }, pass, h('button', { class: 'btn sm', onClick: guard(async () => { S.lan = await api('lan.configure', { password: pass.value }); pass.value = ''; renderCenter(); toast(t('wb_saved')); }) }, t('save')))),
    h('p', { class: 'status' }, t('wb_lanHint'))];
}
function remotePage() {
  if (S.remote === undefined) { S.remote = null; api('remote.status').then(r => { S.remote = r; if (S.view === 'remote') renderCenter(); }).catch(e => toast(e.message, true)); }
  const r = S.remote, input = h('input', { type: 'text', placeholder: 'utente@server · alias di ~/.ssh/config' });
  return h('div', { class: 'page' }, h('h1', {}, t('wb_remote')), h('p', { class: 'lead' }, t('wb_remoteLead')),
    !r ? h('p', { class: 'status' }, '…') : [
      h('div', { class: 'section' }, t('wb_remoteMode')),
      h('div', { class: 'row' }, h('div', { class: 'seg' }, [['off', 'wb_modeOff'], ['ssh', 'wb_modeSsh'], ['lan', 'wb_modeLan']].map(([m, key]) => h('button', { class: (S.settings?.remoteMode || 'off') === m ? 'on' : '',
          onClick: guard(async () => { S.settings = await api('settings.set', { key: 'remoteMode', value: m }); S.lan = await api('lan.status'); renderCenter(); }) }, t(key)))),
        h('button', { class: 'btn sm', onClick: guard(async e => {
          e.currentTarget.disabled = true; toast(t('wb_askingHash'));
          S.hashAdvice = await api('remote.advice', { facts: { lang: document.documentElement.lang, sshdListening: r.sshd, lanAddresses: r.addresses.length, savedSshHosts: r.hosts.length, localOnly: !!S.settings?.localOnly, lanServerAvailable: true, lanPasswordSet: !!S.lan?.passwordSet, desktopApprovesPayments: true } });
          renderCenter();
        }) }, sat('hash', { size: 18 }), ` ${t('wb_askHash')}`)),
      S.hashAdvice ? h('div', { class: 'card', style: 'margin-top:12px' }, h('div', { class: 'row' }, sat('hash', { size: 28 }), h('b', {}, `Hash: ${t({ off: 'wb_modeOff', ssh: 'wb_modeSsh', lan: 'wb_modeLan' }[S.hashAdvice.mode])}`), h('span', { class: 'spacer' }), h('span', { class: 'status num' }, S.hashAdvice.model)),
        h('ul', {}, S.hashAdvice.reasons.map(x => h('li', {}, x))), S.hashAdvice.risks.length ? [h('p', { class: 'status' }, t('wb_risks')), h('ul', {}, S.hashAdvice.risks.map(x => h('li', {}, x)))] : null,
        h('button', { class: 'btn sm primary', disabled: S.settings?.remoteMode === S.hashAdvice.mode, onClick: guard(async () => { S.settings = await api('settings.set', { key: 'remoteMode', value: S.hashAdvice.mode }); S.lan = await api('lan.status'); renderCenter(); toast(t('wb_saved')); }) }, t('wb_applyHash'))) : null,
      S.settings?.remoteMode === 'lan' ? lanSection() : null,
      S.settings?.remoteMode === 'off' ? h('p', { class: 'status', style: 'margin-top:12px' }, t('wb_modeOffHint')) : null,
      S.settings?.remoteMode !== 'off' ? [
      h('div', { class: 'section' }, t('wb_remoteThis')),
      h('div', { class: 'form' },
        h('label', {}, 'SSH'), h('span', {}, h('span', { class: `chip ${r.sshd ? 'ok' : 'warn'}` }, r.sshd ? t('wb_sshdOn') : t('wb_sshdOff'))),
        h('label', {}, t('wb_remoteCmd')), h('span', { class: 'mono' }, r.addresses.length ? r.addresses.map(a => h('div', {}, `ssh ${r.user}@${a}  →  bitcode`)) : '—')),
      h('p', { class: 'status' }, r.sshd ? t('wb_remoteThisHint') : t('wb_sshdHint')),
      h('div', { class: 'section' }, t('wb_remoteOthers')),
      r.hosts.length ? h('table', { class: 'list' }, r.hosts.map(x => h('tr', {}, h('td', { class: 'mono' }, x), h('td', { class: 'status' }, r.saved.includes(x) ? t('wb_saved') : '~/.ssh/config'),
        h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onClick: () => openRemoteTerminal(x, 'bitcode') }, t('wb_openRemoteBitcode')), h('button', { class: 'btn sm', onClick: () => openRemoteTerminal(x, 'shell') }, t('wb_openRemoteShell')),
          r.saved.includes(x) ? h('button', { class: 'btn sm danger', onClick: guard(async () => { S.remote = await api('remote.save', { hosts: r.saved.filter(y => y !== x) }); renderCenter(); }) }, t('delete')) : null))))) : h('p', { class: 'status' }, t('none')),
      h('div', { class: 'row', style: 'margin-top:12px' }, input, h('button', { class: 'btn sm', onClick: guard(async () => { const v = input.value.trim(); if (!v) return; S.remote = await api('remote.save', { hosts: [...r.saved, v] }); renderCenter(); }) }, t('wb_add'))),
      h('p', { class: 'status' }, t('wb_remoteSafety'))] : null]);
}
const termTheme = () => isDark()
  ? { background: THEME.dark.canvas, foreground: THEME.dark.text, cursor: BRAND.accent, selectionBackground: THEME.dark.elevated }
  : { background: THEME.light.canvas, foreground: THEME.light.ink, cursor: BRAND.accent, selectionBackground: THEME.light.hairline };
window.addEventListener('resize', () => { try { fit?.fit(); } catch {} });

async function termCopy(clear = false) { const text = term?.getSelection(); if (!text) return; await api('clipboard.write', { text }).catch(() => {}); if (clear) term.clearSelection(); }
async function termPaste() { const text = await api('clipboard.read').catch(() => ''); if (text) term?.paste(text); term?.focus(); }

// ---------- data ----------
async function loadAll() {
  S.projects = await api('project.list');
  S.sessions = await api('session.list');
}
async function selectProject(id, { openLatest = false } = {}) {
  if (S.projectId !== id) { wb.invalidateGit(); S.files = null; S.projectId = id; S.tree.clear(); S.expanded = new Set(['.']); for (const tab of S.tabs) tab.view?.destroy(); S.tabs = []; S.active = null; }
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
async function refreshGit() { if (S.projectId) { try { S.git = await api('git.status', { projectId: S.projectId }); } catch { S.git = null; } wb.invalidateDiffs(); if (['git', 'files', 'changes'].includes(S.panel)) renderPanel(); } }
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
      S.live.delete(payload.runId); S.reasoning.delete(payload.runId); refreshGit();
      if (payload.error && payload.sessionId === S.sessionId) toast(errorText({ code: payload.errorCode, message: payload.error }), true);
      if (payload.worktree) api('worktree.list').then(w => { S.worktrees = w; });
      if (payload.sessionId === S.sessionId) for (const s of SATS) S.sats[s] = { st: 'idle' };
      if (payload.state === 'success') sendQueued(payload.sessionId);
      if (wb.multirunChanged(payload.sessionId) && S.view === 'multirun') renderCenter();
    }
    renderSidebar(); if (S.view === 'chat') { renderThread(); renderComposer(); renderTopbar(); } else if (S.view === 'activity') renderCenter();
  } else if (channel === 'session' && payload.type === 'created') { loadSessions().then(renderSidebar);
  } else if (channel === 'session' && payload.sessionId === S.sessionId) {
    const { type, data } = payload;
    if (type === 'plan.saved') note(t('planSaved'), [data.file, t('planBuildHint')]);
    if (type === 'messages') { S.session.messages = data.messages; S.live.clear(); for (const w of S.work.values()) { w.liveOff = 0; w.callStart = null; } renderThread(); }
    if (type === 'message.delta') {
      { // speed over a sliding ~4 s window; it keeps its last value while the model is silent (tools running)
        const w = workOf(data.runId), t0 = Date.now(); w.total = (w.total || 0) + data.text.length;
        (w.samples ||= []).push({ t: t0, c: w.total }); while (w.samples.length > 1 && t0 - w.samples[0].t > 4000) w.samples.shift();
        const first = w.samples[0], secs = (t0 - first.t) / 1000; if (secs >= 1) w.speed = Math.max(1, Math.round((w.total - first.c) / 4 / secs)); } S.live.set(data.runId, { agent: data.agentId, text: (S.live.get(data.runId)?.text || '') + data.text }); renderThread(); }
    if (type === 'reasoning.delta') { S.reasoning.set(data.runId, ((S.reasoning.get(data.runId) || '') + data.text).slice(-20000)); renderThread(); }
    if (type === 'todo' && S.session) { S.session.todo = data.items; renderThread(); }
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
  } else if (channel === 'pty' && remoteTerms.has(payload.ptyId)) {
    const rt = remoteTerms.get(payload.ptyId); if (payload.data) rt.write(payload.data); if (payload.exit !== undefined) { rt.write('\r\n[ssh chiuso]\r\n'); remoteTerms.delete(payload.ptyId); }
  } else if (channel === 'pty' && payload.ptyId === ptyId) {
    if (payload.data) term?.write(payload.data); if (payload.exit !== undefined) { term?.write('\r\n[exit]\r\n'); ptyId = null; ptyProject = null; }
  } else if (channel === 'finance') { finView.onEvent(payload);
  } else if (channel === 'navigate') { if (payload.sessionId && S.sessions.some(x => x.sessionId === payload.sessionId)) openSession(payload.sessionId).then(renderShell, e => toast(errorText(e), true)); else { S.view = payload.view; renderShell(); } }
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
// ---------- deleting chats: one, a selection, or all of them behind a typed word ----------
const BURN_WORD = 'burnall';
const fmt = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(key));
function exitSelect() { S.selecting = null; S.selected.clear(); }
// Kept and running chats are never bulk-deleted; the controller enforces the same rule.
const skipCounts = list => ({ keep: list.filter(s => s.keep).length, active: list.filter(s => !s.keep && activeRun(s.sessionId)).length });
const skipText = ({ keep, active }) => keep || active ? fmt('burnSkips', { list: [keep && fmt('skipKeep', { k: keep }), active && fmt('skipActive', { a: active })].filter(Boolean).join(' · ') }) : '';
async function afterDelete(r) {
  exitSelect(); await loadSessions();
  if (S.sessionId && r.deleted.includes(S.sessionId)) { S.sessionId = null; S.session = null; }
  toast([fmt('chatsDeleted', { n: r.deleted.length }), skipText(r.skipped)].filter(Boolean).join(' '));
  renderShell();
}
async function deleteSelected(p) {
  const all = S.sessions.filter(s => s.projectId === p.projectId), picked = all.filter(s => S.selected.has(s.sessionId));
  if (!picked.length) return;
  if (picked.length === all.length) return burnDialog({ projectId: p.projectId });
  const skip = skipCounts(picked);
  if (!confirm([fmt('deleteSelectedConfirm', { n: picked.length - skip.keep - skip.active }), skipText(skip)].filter(Boolean).join('\n'))) return;
  await afterDelete(await api('session.deleteMany', { sessionIds: picked.map(s => s.sessionId) }));
}
function burnDialog({ projectId = null } = {}) {
  const list = S.sessions.filter(s => !projectId || s.projectId === projectId), skip = skipCounts(list), n = list.length - skip.keep - skip.active;
  const name = projectId && S.projects.find(p => p.projectId === projectId)?.name;
  const dialog = h('dialog', { class: 'sat-info burn', 'aria-labelledby': 'burn-title' });
  const go = h('button', { class: 'btn danger', disabled: true, onClick: guard(async () => {
    const r = await api('session.deleteMany', { all: true, projectId, confirm: input.value }); dialog.close(); await afterDelete(r);
  }) }, fmt('burnBtn', { n }));
  const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, 'aria-label': fmt('burnType', { w: BURN_WORD }),
    onInput: e => { go.disabled = e.target.value !== BURN_WORD || !n; },
    onKeydown: e => { if (e.key === 'Enter' && !go.disabled) go.click(); } });
  fill(dialog,
    h('h2', { id: 'burn-title' }, name ? fmt('burnTitleProject', { p: name }) : t('burnTitleAll')),
    h('p', {}, fmt('burnBody', { n })),
    skipText(skip) ? h('p', { class: 'status' }, skipText(skip)) : null,
    h('p', { class: 'burnlabel' }, t('burnTypeBefore'), h('code', {}, BURN_WORD), t('burnTypeAfter')),
    input,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onClick: () => dialog.close() }, t('cancel')), go));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); input.focus();
}

const MORE_VIEWS = ['stats', 'archive', 'issues', 'remote', 'schedules', 'integrations'];
const MORE_KEY = 'bitcode.sideMore';
function toggleMore() { try { localStorage.setItem(MORE_KEY, localStorage.getItem(MORE_KEY) === '1' ? '' : '1'); } catch {} renderSidebar(); }
function renderSidebar() {
  const el = $('sidebar'); if (!el) return;
  let moreOpen = false; try { moreOpen = localStorage.getItem(MORE_KEY) === '1'; } catch {}
  const q = S.search.trim().toLowerCase();
  const action = (ic, label, onClick, { on = false, badge = null, kbd = null } = {}) => h('button', { class: `sact${on ? ' on' : ''}`, onClick },
    icon(ic), h('span', { class: 'label' }, label), badge ? h('span', { class: 'badge num' }, badge) : kbd ? h('kbd', {}, kbd) : null);
  const threadRow = s => {
    const run = activeRun(s.sessionId), waiting = S.pending.some(a => a.sessionId === s.sessionId), on = s.sessionId === S.sessionId && S.view === 'chat';
    if (S.selecting === s.projectId) {
      const picked = S.selected.has(s.sessionId);
      return h('label', { class: `trow sel${picked ? ' on' : ''}`, title: s.keep ? `${s.name} · ${t('kept')}` : s.name },
        h('input', { type: 'checkbox', checked: picked, onChange: e => { e.target.checked ? S.selected.add(s.sessionId) : S.selected.delete(s.sessionId); renderSidebar(); } }),
        h('span', { class: 'tname' }, s.name),
        s.keep ? h('span', { class: 'tkeep', title: t('kept') }, icon('star', { size: 12 })) : null,
        run ? h('span', { class: 'tstate run', title: t(`run_${run.state}`) }) : null,
        h('span', { class: 'ttime num' }, ago(s.updatedAt)));
    }
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
        h('button', { title: t('wb_more'), 'aria-label': t('wb_more'), onClick: e => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); sessionMenu(s, b.left, b.bottom + 4); } }, icon('more', { size: 14 })),
        h('button', { title: t('wb_archiveOne'), 'aria-label': t('wb_archiveOne'), onClick: guard(async e => { e.stopPropagation(); await api('session.update', { sessionId: s.sessionId, archived: true }); await loadSessions(); if (S.sessionId === s.sessionId) { S.sessionId = null; S.session = null; } renderShell(); toast(t('wb_archived')); }) }, icon('archive', { size: 14 })),
        h('button', { title: t('delete'), 'aria-label': t('delete'), disabled: !!run, onClick: guard(async e => { e.stopPropagation(); if (!confirm(`${t('delete')} «${s.name}»?`)) return; await api('session.delete', { sessionId: s.sessionId }); await loadSessions(); if (S.sessionId === s.sessionId) { S.sessionId = null; S.session = null; } renderShell(); }) }, icon('trash', { size: 14 }))));
  };
  const groups = S.projects.map(p => {
    const all = S.sessions.filter(s => s.projectId === p.projectId && !s.archived && (!q || s.name.toLowerCase().includes(q)));
    if (q && !all.length && !p.name.toLowerCase().includes(q)) return null;
    const open = q || !S.collapsed.has(p.projectId), expanded = S.expandedProjects.has(p.projectId);
    const selecting = S.selecting === p.projectId;
    const shown = expanded || q || selecting ? all : all.slice(0, 6);
    const count = all.filter(s => S.selected.has(s.sessionId)).length;
    const selBar = selecting ? h('div', { class: 'selbar' },
      h('label', { class: 'selall' }, h('input', { type: 'checkbox', checked: !!all.length && count === all.length,
        onChange: e => { for (const s of all) e.target.checked ? S.selected.add(s.sessionId) : S.selected.delete(s.sessionId); renderSidebar(); } }), t('selectAll')),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm danger', disabled: !count, onClick: guard(() => deleteSelected(p)) }, `${t('delete')} (${count})`),
      h('button', { class: 'ibtn', title: t('cancel'), 'aria-label': t('cancel'), onClick: () => { exitSelect(); renderSidebar(); } }, icon('close', { size: 14 }))) : null;
    const live = all.filter(x => activeRun(x.sessionId)).length;
    return h('div', { class: 'pgroup' },
      h('div', { class: `prow${p.projectId === S.projectId ? ' cur' : ''}`, role: 'button', tabindex: 0, title: p.root, onClick: () => { open ? S.collapsed.add(p.projectId) : S.collapsed.delete(p.projectId); renderSidebar(); } },
        icon(open ? 'chevronDown' : 'chevronRight', { size: 12, cls: 'chev' }), icon('folder', { size: 15 }), h('span', { class: 'pname' }, p.name),
        live ? h('span', { class: 'tstate run', title: `${live} ${t('runsActive').toLowerCase()}` }) : null,
        all.length && !selecting ? h('button', { class: 'padd', title: `${t('selectChats')} · ${p.name}`, 'aria-label': t('selectChats'), onClick: e => { e.stopPropagation(); S.selecting = p.projectId; S.selected.clear(); S.collapsed.delete(p.projectId); renderSidebar(); } }, icon('check', { size: 14 })) : null,
        h('button', { class: 'padd', title: `${t('newChat')} · ${p.name}`, 'aria-label': t('newChat'), onClick: guard(async e => { e.stopPropagation(); await goHome(p.projectId); }) }, icon('compose', { size: 14 }))),
      open ? h('div', { class: 'threads' }, selBar, shown.map(threadRow),
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
      action('activity', t('activity'), () => { S.view = 'activity'; renderShell(); }, { on: S.view === 'activity', badge: S.pending.length || null }),
      // Less frequent pages stay one click away under "More" (and in the Ctrl+P palette), so the sidebar leads with chats.
      action(moreOpen ? 'chevronDown' : 'chevronRight', t('moreL'), toggleMore, { on: !moreOpen && MORE_VIEWS.includes(S.view) }),
      moreOpen ? h('div', { class: 'smore' },
        action('chart', t('wb_stats'), () => { wb.invalidateStats(); S.view = 'stats'; renderShell(); }, { on: S.view === 'stats' }),
        action('archive', t('wb_archive'), () => { S.view = 'archive'; renderShell(); }, { on: S.view === 'archive', badge: S.sessions.filter(x => x.archived).length || null }),
        action('issue', t('wb_issues'), () => { S.view = 'issues'; renderShell(); }, { on: S.view === 'issues' }),
        action('remote', t('wb_remote'), () => { S.remote = undefined; S.view = 'remote'; renderShell(); }, { on: S.view === 'remote' }),
        action('clock', t('wb_schedules'), () => { S.view = 'schedules'; renderShell(); }, { on: S.view === 'schedules' }),
        action('plug', t('wb_integrations'), () => { S.view = 'integrations'; renderShell(); }, { on: S.view === 'integrations' })) : null),
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
    const view = S.view, rerender = () => { if (S.view === view) renderCenter(); };
    const pages = { activity: activityPage, bitcoin: bitcoinPage, stats: () => wb.statsPage(rerender), archive: () => wb.archivePage(rerender), multirun: () => wb.multirunPage(rerender),
      schedules: () => wb.schedulesPage(rerender), integrations: () => wb.integrationsPage(rerender), issues: () => wb.issuesPage(rerender), remote: remotePage };
    fill(el, (pages[S.view] || settingsPage)());
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
  const satMenu = (x, e) => {
    const b = e.currentTarget.getBoundingClientRect(), name = satName(x);
    openMenu(b.left, b.bottom + 4, [
      { label: fmt('useSat', { sat: name }), disabled: S.agent === x || !!activeRun(s.sessionId), run: () => chooseAgent(x) },
      ...(S.agent ? [{ label: t('useBitcode'), disabled: !!activeRun(s.sessionId), run: () => chooseAgent('') }] : []),
      '-', { label: fmt('aboutSat', { sat: name }), run: guard(async () => showSatInfo((await api('chat.submit', { sessionId: s.sessionId, text: `/sat info ${x}` })).result)) }]);
  };
  fill(el,
    S.sideHidden ? h('button', { class: 'ibtn', title: `${t('showSidebar')} (Ctrl+B)`, 'aria-label': t('showSidebar'), onClick: toggleSidebar }, icon('sidebar')) : null,
    h('span', { class: 'title', title: s?.name || '' }, s ? s.name : p ? p.name : 'bitcode'),
    p ? h('span', { class: 'chip opt' }, p.name) : null,
    S.git?.repo ? h('span', { class: 'chip opt mono' }, `⎇ ${S.git.branch || 'HEAD'}${S.git.files.length ? ` · ${S.git.files.length}` : ''}`) : null,
    s?.keep ? h('span', { class: 'kept', title: t('kept') }, icon('star', { size: 13 })) : null,
    // Chat actions live in one menu, so the bar keeps room for the title and the Sats.
    s ? h('button', { class: 'ibtn', title: t('wb_more'), 'aria-label': t('wb_more'), onClick: e => {
      const b = e.currentTarget.getBoundingClientRect();
      openMenu(b.left, b.bottom + 4, [
        { label: `↶ ${t('wb_timeline')}`, run: () => wb.openTimeline(s).catch(err => toast(err.message, true)) },
        { label: s.keep ? `★ ${t('kept')}` : `☆ ${t('keep')} · ${t('expiresIn')} ${fmtTime(s.expiresAt)}`,
          run: guard(async () => { const r = await api('session.update', { sessionId: s.sessionId, keep: !s.keep }); Object.assign(S.session, { keep: r.keep, expiresAt: r.expiresAt }); renderTopbar(); renderSidebar(); }) },
        { label: t('export'), run: guard(async () => openDiff(`export · ${s.name}`, await api('session.export', { sessionId: s.sessionId }))) }]);
    } }, icon('more')) : null,
    h('span', { class: 'spacer' }),
    s ? h('div', { class: 'satrow' }, SATS.map(x => h('button', { class: `iconbtn satbtn${S.agent === x ? ' on' : ''}`, 'aria-label': `${satName(x)} · ${t(`role_${x}`)}`, onClick: e => satMenu(x, e) },
      sat(x, { size: 26, state: S.sats[x].st, title: `${satName(x)} · ${t(`role_${x}`)}${satLabel(x, S.sats[x].st).text ? ` — ${satLabel(x, S.sats[x].st).text}` : ''}` })))) : null,
    S.mini ? h('button', { class: `iconbtn${S.pinned ? ' on' : ''}`, title: t('wb_pin'), 'aria-label': t('wb_pin'), onClick: guard(async () => { S.pinned = await api('window.pin', { pinned: !S.pinned }); renderTopbar(); }) }, '📌')
      : h('button', { class: 'iconbtn', title: t('wb_miniChat'), 'aria-label': t('wb_miniChat'), onClick: guard(() => api('window.miniChat', { projectId: S.projectId || undefined, sessionId: S.sessionId || undefined })) }, '◳'),
    p && !S.mini ? h('button', { class: `btn sm panelbtn${S.panel ? ' on' : ''}`, title: `${t('panelL')} (Ctrl+1…7)`, 'aria-expanded': S.panel ? 'true' : 'false',
      onClick: () => { S.panel = S.panel ? null : (S.lastPanel || 'changes'); renderShell(); } }, icon('panel', { size: 15 }), S.panel ? panelLabel(S.panel) : t('panelL')) : null);
}

function renderThread() {
  const el = $('thread'); if (!el) return;
  const p = project();
  if (!p) return fill(el, home(null));
  if (!S.session) return fill(el, home(p));
  const s = S.session, run = activeRun(s.sessionId), model = s.model || S.status?.defaultModel?.spec || '';
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  const items = [];
  // Tool-only assistant turns follow each other one call at a time: they share a single compact block.
  let toolGroup = null;
  const flushTools = () => { if (toolGroup) items.push(toolsBlock(toolGroup)); toolGroup = null; };
  s.messages.forEach((m, i) => {
    if (m.role === 'tool') return;
    if (m.role === 'user') { flushTools(); items.push(h('div', { class: 'm-user' }, m.content)); return; }
    if (m.content) { flushTools(); items.push(h('div', { class: 'm-bot' }, h('div', { class: 'who' }, logo({ size: 16 }), 'bitcode', h('span', { class: 'num' }, `· ${model}`), h('span', { class: 'spacer' }), h('button', { class: 'copy ghost', type: 'button', title: `${t('copyL')} (${/Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}+Shift+C)`, onClick: e => copyText(m.content, e.currentTarget) }, t('copyL'))), md(m.content))); }
    if (!m.tools?.length) return;
    toolGroup ??= { names: [], outputs: [] };
    toolGroup.names.push(...m.tools);
    for (let j = i + 1; j < s.messages.length && s.messages[j].role === 'tool'; j++) toolGroup.outputs.push(s.messages[j]);
  });
  flushTools();
  for (const [runId, thought] of S.reasoning) if (S.runs.get(runId)?.sessionId === s.sessionId && !S.runs.get(runId)?.endedAt) items.push(h('details', { class: 'reasoning', open: S.reasoningOpen }, h('summary', { onClick: e => { S.reasoningOpen = !e.currentTarget.parentElement.open; } }, t('wb_reasoning')), h('pre', { class: 'toolpre' }, thought)));
  for (const [, l] of S.live) items.push(h('div', { class: 'm-bot live' }, h('div', { class: 'who' }, SATS.includes(l.agent) ? sat(l.agent, { size: 20, state: S.sats[l.agent]?.st || 'drafting' }) : logo({ size: 16 }), SATS.includes(l.agent) ? satName(l.agent) : 'bitcode', typing(SAT_META[l.agent]?.color)), md(l.text)));
  items.push(...S.pending.filter(a => a.sessionId === s.sessionId).map(approvalCard));
  items.push(...S.notes.map(n => h('div', { class: 'note' }, h('div', { class: 'ntitle' }, n.title), n.lines.length ? h('div', { class: 'nbody mono' }, n.lines.map(l => h('div', {}, l))) : null)));
  if (run) items.push(runLine(run)); else if (S.closing.has(s.sessionId)) items.push(closingLine(S.closing.get(s.sessionId)));
  if (s.todo?.length) items.push(h('div', { class: 'todocard card' }, h('div', { class: 'row' }, h('b', {}, t('wb_agentTodo')), h('span', { class: 'spacer' }), h('span', { class: 'num status' }, `${s.todo.filter(x => x.done).length}/${s.todo.length}`)),
    s.todo.map(x => h('div', { class: `todo${x.done ? ' done' : ''}` }, h('span', {}, x.done ? '☑' : '☐'), h('span', { class: 'ttext' }, x.text)))));
  if (s.goal) items.unshift(h('div', { class: 'goalrow' }, h('span', { class: 'chip warn' }, `◎ ${t('wb_goal')}`), h('span', {}, s.goal)));
  if (!items.length) return fill(el, home(p));
  fill(el, h('div', { class: 'col' }, items));
  if (stick) el.scrollTop = el.scrollHeight;
}

function toolsBlock({ names, outputs }) {
  const rows = [];
  for (const name of names) {
    const last = rows.at(-1);
    if (last?.name === name) last.count++; else rows.push({ name, count: 1 });
  }
  // Each call carries the dot of the Sat whose role it serves, as in the terminal.
  const owner = name => satForTool(name, { activeSatId: S.session?.satId });
  return h('div', { class: 'm-tools mono' },
    h('div', { class: 'toolnames' }, rows.map(r => h('span', { class: 'toolname', style: `--dot: var(--sat-${owner(r.name)})`, title: `${satName(owner(r.name))} · ${r.name}` }, toolLabel(r.name), r.count > 1 ? h('span', { class: 'num' }, ` ×${r.count}`) : null))),
    outputs.length ? h('button', { class: 'toolout', type: 'button', onClick: () => showToolOutputs(names, outputs) }, `${t('wb_toolOutput')} (${outputs.length})`) : null);
}
function showToolOutputs(names, outputs) {
  const dialog = h('dialog', { class: 'sat-info plan', 'aria-label': t('wb_toolOutput') },
    h('div', { class: 'row' }, h('h2', {}, t('wb_toolOutput')), h('span', { class: 'spacer' }), h('button', { class: 'iconbtn', autofocus: true, onClick: () => dialog.close(), 'aria-label': t('close') }, '×')),
    h('div', { class: 'planbody' }, outputs.map((o, i) => h('details', { open: outputs.length === 1 }, h('summary', { class: 'mono' }, o.name || names[i] || `#${i + 1}`), h('pre', { class: 'toolpre' }, o.content)))));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
// First steps until a model, a project and the sandbox are ready; each row is the action itself.
function modelReady() {
  const m = S.status?.defaultModel; if (!m?.spec || m.error) return false;
  const provider = S.models.find(x => m.spec.startsWith(`${x.name}/`));
  return m.locality === 'local' || !!provider?.hasKey;
}
function setupSteps() {
  const sandboxOk = !!S.status?.sandbox.available, model = modelReady(), folder = S.projects.length > 0;
  if (model && folder && sandboxOk) return null;
  const step = (done, label, action) => h('li', { class: done ? 'done' : '' }, h('span', { class: 'mark' }, done ? '✓' : '○'),
    done || !action ? h('span', {}, label) : h('button', { class: 'linkbtn', onClick: action }, label));
  const chooseModel = () => openModelDialog({ title: t('defaultModel'), current: S.settings?.model,
    onPick: async spec => { S.settings = await api('settings.set', { key: 'model', value: spec }); await refreshStatus(); S.models = await api('models.list').catch(() => S.models); renderShell(); } });
  return h('ol', { class: 'setup', 'aria-label': t('setupTitle') },
    step(model, model ? fmt('setupModelDone', { m: S.status.defaultModel.spec }) : t('setupModel'), chooseModel),
    step(folder, t('setupFolder'), openFolder),
    step(sandboxOk, sandboxOk ? t('setupSandbox') : t('setupSandboxMissing')));
}
function home(p) {
  return h('div', { class: 'home' }, h('div', { class: 'inner' },
    h('div', { class: 'lockup' }, logo({ size: 60, build: true }), h('span', { class: 'word' }, 'bitcode')),
    h('div', { class: 'sats4' }, SATS.map(x => sat(x, { size: 52, state: 'idle', title: `${satName(x)} · ${t(`role_${x}`)}` }))),
    p ? h('h1', {}, t('homeTitle'), ' ', h('em', {}, p.name), '?') : h('h1', {}, t('welcome')),
    h('p', {}, p ? t('homeSub') : t('homeNoProject')),
    setupSteps(),
    p ? wb.starters() : h('div', { class: 'row', style: 'justify-content:center' }, S.projects.length ? h('button', { class: 'btn primary pill', onClick: openFolder }, t('openFolder')) : null, h('button', { class: 'btn pill', onClick: () => { S.view = 'settings'; renderShell(); } }, t('settings')))));
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
  if (r?.profile) {
    if (r.session) { S.session.profile = r.session.profile; S.session.rgbNetwork = r.session.rgbNetwork; S.agent = r.session.satId || ''; renderComposer(); }
    return note(t('profileTitle'), r.profile === 'rgb'
      ? [t('rgbProfileOn'), `${t('network')}: ${r.network || '—'}`, `${t('nodeL')}: ${r.node || '—'}`, r.height ? `${t('height')}: ${r.height}` : null].filter(Boolean)
      : [r.session ? t('codeProfileOn') : `${t('profileTitle')}: ${r.profile}`]);
  }
  if (r?.run) { S.notes = []; api('session.open', { sessionId: S.session.sessionId }).then(x => { S.session = x; renderThread(); renderSidebar(); }); }
}

function renderComposer() {
  const el = $('composer'); if (!el) return;
  if (!project()) return fill(el);
  const s = S.session, run = s && activeRun(s.sessionId);
  const menuEl = h('div', { class: 'cmdmenu', role: 'listbox', hidden: true });
  const input = h('textarea', { id: 'prompt', rows: 2, placeholder: S.planMode ? t('modeHintPlan') : s ? t('placeholder') : t('placeholderNew'), 'aria-label': t('placeholder'), 'aria-autocomplete': 'list',
    onPaste: e => { const files = [...(e.clipboardData?.files || [])]; if (!files.length || !S.projectId) return; e.preventDefault(); const dt = new DataTransfer(); for (const f of files) dt.items.add(f.name === 'image.png' ? new File([f], `immagine-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`, { type: f.type }) : f); importDropped(dt); },
    onInput: e => { S.draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = `${Math.min(240, e.target.scrollHeight)}px`; updateMenu(); },
    onKeydown: e => {
      if (S.menu.items.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.menu.index = (S.menu.index + (e.key === 'ArrowDown' ? 1 : -1) + S.menu.items.length) % S.menu.items.length; drawMenu(); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); return pick(S.menu.items[S.menu.index], e.key === 'Enter'); }
        if (e.key === 'Escape') { e.preventDefault(); S.menu.items = []; drawMenu(); return; }
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && recallPrompt(input, e.key === 'ArrowUp' ? 1 : -1)) { e.preventDefault(); return; }
      if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); S.planMode = !S.planMode; renderComposer(); $('prompt')?.focus(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    } });
  input.value = S.draft;
  function updateMenu() {
    const v = input.value, at = /(^|\s)@([^\s@]*)$/.exec(v.slice(0, input.selectionStart ?? v.length));
    if (at && S.projectId) {
      if (!S.files || S.filesProject !== S.projectId) { S.filesProject = S.projectId; S.files = []; api('fs.files', { projectId: S.projectId }).then(f => { S.files = f; if ($('prompt') === input) updateMenu(); }).catch(() => {}); }
      const q = at[2].toLowerCase();
      S.menu.items = S.files.filter(f => f.toLowerCase().includes(q)).sort((a, b) => a.length - b.length).slice(0, 40).map(f => ({ name: f, file: true, at: at[2] }));
      S.menu.index = 0; drawMenu(); return;
    }
    const dollar = /(^|\s)\$([\w-]*)$/.exec(v.slice(0, input.selectionStart ?? v.length));
    if (dollar && S.projectId) { S.menu.items = wb.skillItems(dollar[2]).map(x => ({ name: x.name, skill: x.description, at: dollar[2] })); S.menu.index = 0; drawMenu(); return; }
    const hash = /(^|\s)#([\w-]*)$/.exec(v.slice(0, input.selectionStart ?? v.length));
    if (hash && (S.settings?.snippets || []).length) { S.menu.items = wb.snippetItems(hash[2]).map(x => ({ name: x.name, snippet: x.text, at: hash[2] })); S.menu.index = 0; drawMenu(); return; }
    S.menu.items = v.startsWith('/') && !/\s/.test(v) ? S.commands.filter(c => c.name.toLowerCase().startsWith(v.slice(1).toLowerCase())).slice(0, 60) : [];
    S.menu.index = Math.min(S.menu.index, Math.max(0, S.menu.items.length - 1)); drawMenu();
  }
  function drawMenu() {
    menuEl.hidden = !S.menu.items.length;
    fill(menuEl, S.menu.items.map((c, i) => h('div', { class: `cmditem${i === S.menu.index ? ' on' : ''}${c.scope === 'cli' ? ' off' : ''}`, role: 'option', 'aria-selected': i === S.menu.index ? 'true' : 'false',
      onMousedown: e => { e.preventDefault(); pick(c, !c.args); } },
      h('span', { class: 'cname mono' }, c.file ? `@${c.name}` : c.snippet ? `#${c.name}` : c.skill !== undefined ? `$${c.name}` : `/${c.name}`), h('span', { class: 'chint' }, c.file ? t('wb_mentionHint') : c.snippet ? c.snippet.slice(0, 80) : c.skill !== undefined ? c.skill : cmdHint(c)),
      c.scope === 'cli' ? h('span', { class: 'chip' }, t('cliOnly')) : c.custom ? h('span', { class: 'chip' }, t('customL')) : null)));
    menuEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function pick(c, submitNow) {
    if (c.file || c.snippet || c.skill !== undefined) {
      const end = input.selectionStart ?? input.value.length, start = end - c.at.length - 1, insert = c.file ? `@${c.name} ` : c.snippet ?? `$${c.name} `;
      input.value = `${input.value.slice(0, start)}${insert}${input.value.slice(end)}`; S.draft = input.value; S.menu.items = []; drawMenu(); input.focus();
      const pos = start + insert.length; input.setSelectionRange(pos, pos); return;
    }
    if (c.scope === 'cli') { toast(`/${c.name}: ${t('cliOnlyLong')}`, true); return; }
    input.value = c.args ? `/${c.name} ` : `/${c.name}`; S.draft = input.value; S.menu.items = []; drawMenu(); input.focus();
    if (submitNow && !c.args) submit();
  }
  const submit = guard(async () => {
    let text = input.value.trim(); if (!text && !S.attachments.length) return; if (!text) text = t('attachDefault');
    const [cmdName] = text.slice(1).split(/\s+/);
    if (text.startsWith('/') && UI_COMMANDS[cmdName]) { S.draft = ''; input.value = ''; S.menu.items = []; drawMenu(); return UI_COMMANDS[cmdName](); }
    if (!text.startsWith('/')) text = await wb.expandSkills(text);
    if (S.planMode && !text.startsWith('/')) text = `/plan ${text}`;
    if (S.session && activeRun(S.session.sessionId) && !text.startsWith('/')) {
      const q = S.queue.get(S.session.sessionId) || []; q.push({ id: crypto.randomUUID(), text: S.attachments.length ? `${text}\n\n${attachmentLines()}` : text }); S.queue.set(S.session.sessionId, q);
      S.attachments = []; S.draft = ''; historyAt = -1; input.value = ''; renderComposer(); setTimeout(() => $('prompt')?.focus(), 0); return;
    }
    let session = S.session;
    if (!session) {
      const meta = await api('session.create', { projectId: S.projectId, name: text.replace(/^\/\S+\s*/, '').replace(/\s+/g, ' ').slice(0, 48) || text.slice(0, 48), mode: S.newMode || 'assisted', satId: S.agent, model: S.newModel || undefined });
      await loadSessions(); await openSession(meta.sessionId); session = S.session; renderShell();
    }
    const withFiles = S.attachments.length && !text.startsWith('/') ? `${text}\n\n${attachmentLines()}` : text;
    const res = await api('chat.submit', { sessionId: session.sessionId, text: withFiles, agent: S.agent });
    if (withFiles !== text) S.attachments = [];
    S.draft = ''; historyAt = -1; if ($('prompt')) $('prompt').value = '';
    if (res.command) showResult(res);
    else { S.notes = []; S.session = await api('session.open', { sessionId: session.sessionId }); renderThread(); renderComposer(); renderSidebar(); }
  });
  const mode = s?.mode || S.newMode || 'assisted';
  const setMode = guard(async m => {
    if (!s) { S.newMode = m; return renderComposer(); }
    const r = await api('mode.set', { sessionId: s.sessionId, mode: m }); S.session.mode = r.mode; await loadSessions(); renderComposer();
  });
  const menuAt = (e, items) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.top - 8 - items.length * 34, items); };
  const modeChip = h('button', { type: 'button', class: 'cchip', title: unattendedBlocked() || t('permissionsL'), disabled: !!run,
    onClick: e => menuAt(e, MODES.map(m => ({ label: `${m === mode ? '✓ ' : ''}${t(m)}`, disabled: m === 'unattended' && !!unattendedBlocked() && mode !== m, run: () => setMode(m) }))) },
    h('span', { class: 'clabel' }, t(mode)), h('span', { class: 'caret' }, '▾'));
  const agentChip = s?.profile === 'rgb' ? null : h('button', { type: 'button', class: 'cchip agent', title: t('agentL'), disabled: !!run,
    onClick: e => menuAt(e, [{ label: `${!S.agent ? '✓ ' : ''}bitcode`, run: () => chooseAgent('') }, ...SATS.map(x => ({ label: `${S.agent === x ? '✓ ' : ''}${satName(x)} · ${t(`role_${x}`)}`, run: () => chooseAgent(x) }))]) },
    S.agent ? sat(S.agent, { size: 18, state: S.sats[S.agent]?.st || 'idle' }) : logo({ size: 14 }), h('span', { class: 'clabel' }, S.agent ? satName(S.agent) : 'bitcode'), h('span', { class: 'caret' }, '▾'));
  const planToggle = h('div', { class: `seg modeseg${S.planMode ? ' plan' : ''}`, role: 'group', 'aria-label': t('mode') },
    h('button', { type: 'button', class: S.planMode ? '' : 'on', title: t('modeHintBuild'), onClick: () => { S.planMode = false; renderComposer(); $('prompt')?.focus(); } }, t('buildModeL')),
    h('button', { type: 'button', class: S.planMode ? 'on' : '', title: t('modeHintPlan'), onClick: () => { S.planMode = true; renderComposer(); $('prompt')?.focus(); } }, t('planModeL')));
  const plusMenu = e => menuAt(e, [
    { label: t('attachFiles'), hint: `${modKey}+U`, run: () => pickAttachments('files') }, { label: t('attachFolder'), run: () => pickAttachments('folder') }, '-',
    ...(s ? [{ label: `◎ ${t('wb_goal')}${s.goal ? ' ✓' : ''}`, run: () => wb.editGoal(s, meta => { S.session.goal = meta.goal; renderComposer(); renderThread(); }) }] : []),
    { label: `🎙 ${t('wb_dictate')}`, run: () => toggleDictation(input) },
    { label: `⚖ ${t('wb_multirun')}`, run: () => wb.openMultirun().catch(err => toast(err.message, true)) }]);
  const currentModel = s?.model || S.newModel || S.status?.defaultModel?.spec || '—';
  const queued = s ? S.queue.get(s.sessionId) || [] : [];
  const queueStrip = queued.length ? h('div', { class: 'qstrip' }, h('span', { class: 'qlabel' }, `${t('wb_queued')} · ${queued.length}`),
    queued.map(q => h('span', { class: 'chip qitem', title: q.text }, q.text.slice(0, 60), h('button', { class: 'x', 'aria-label': t('delete'), onClick: () => { S.queue.set(s.sessionId, queued.filter(x => x !== q)); renderComposer(); } }, '×')))) : null;
  const ctxTokens = s ? Math.ceil(JSON.stringify(s.messages || []).length / 4) : 0;
  const ctxChip = s && s.messages?.length ? h('button', { class: 'chip ctxchip num', title: t('wb_contextHint'), disabled: !!run, onClick: guard(async () => {
    if (!confirm(t('wb_compactConfirm'))) return;
    const r = await api('session.compact', { sessionId: s.sessionId }); if (!r.compacted) return toast(t('wb_compactNothing'));
    S.session = await api('session.open', { sessionId: s.sessionId }); renderThread(); renderComposer(); toast(t('wb_compacted'));
  }) }, `≈ ${ctxTokens.toLocaleString()} ${t('tokens')}`) : null;
  fill(el, h('div', { class: 'composer' }, menuEl, queueStrip, attachmentChips(), input,
    h('div', { class: 'bar' },
      h('button', { type: 'button', class: 'attachbtn', title: `${t('attachL')} · ${t('wb_goal')} · ${t('wb_multirun')}`, 'aria-label': t('attachL'), disabled: !!run, onClick: plusMenu }, icon('plus', { size: 16 })),
      planToggle, agentChip, modeChip,
      s?.profile === 'rgb' ? h('span', { class: 'chip rgb', title: t('rgbProfileHint') }, `RGB · ${s.rgbNetwork || t('testNet')}`) : null,
      h('div', { class: 'modelpick' },
        h('button', { class: 'modelbtn num', title: t('chooseModel'), 'aria-haspopup': 'listbox', 'aria-expanded': S.picker.open ? 'true' : 'false', disabled: !!run, onClick: () => S.picker.open ? closeModelPicker() : openModelPicker() },
          h('span', { class: `loc ${modelLocality(currentModel)}` }), currentModel, h('span', { class: 'caret' }, '▾')),
        S.picker.open ? modelPopover() : null),
      s?.goal ? h('button', { type: 'button', class: 'cchip on', title: `${t('wb_goal')}: ${s.goal}`, onClick: () => wb.editGoal(s, meta => { S.session.goal = meta.goal; renderComposer(); renderThread(); }) }, `◎ ${t('wb_goal')}`) : null,
      S.recording ? h('button', { type: 'button', class: 'attachbtn rec', title: t('wb_dictate'), 'aria-label': t('wb_dictate'), onClick: () => toggleDictation(input) }, '■') : null,
      h('span', { style: 'flex:1' }), ctxChip,
      run ? h('button', { class: 'send stop', title: t('stop'), 'aria-label': t('stop'), onClick: guard(() => api('run.cancel', { runId: run.runId })) }, '■')
        : h('button', { class: 'send', title: t('send'), 'aria-label': t('send'), onClick: submit }, '↑'))),
    h('div', { class: 'hint' }, t('hint')));
  if (S.draft) updateMenu();
}

const chooseAgent = guard(async id => {
  if (S.session) { await api('session.update', { sessionId: S.session.sessionId, satId: id }); S.session.satId = id; }
  S.agent = id; renderComposer(); renderTopbar();
});

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

const shortId = id => id.length > 24 ? `${id.slice(0, 16)}…${id.slice(-6)}` : id;
const rgbSendLine = ({ send, network }) => t('rgbSendLine').replace('{amount}', send.amount).replace('{unit}', send.unit || t('units'))
  .replace('{asset}', shortId(send.assetId)).replace('{recipient}', shortId(send.recipientId)).replace('{network}', network)
  + (send.endpoints.length ? ` ${t('via')} ${send.endpoints.join(', ')}` : '');
function approvalCard(a) {
  const sub = a.subject || {};
  const resolve = decision => guard(async () => { await api('approval.resolve', { requestId: a.id, digest: a.digest, sessionId: a.sessionId, decision }); });
  const body = a.kind === 'command' ? h('pre', { class: 'cmd mono' }, sub.shell)
    : a.kind === 'patch' ? h('pre', { class: 'cmd mono' }, (sub.unifiedDiff || '').split('\n').map(l => h('span', { class: lineClass(l) }, l || ' ')))
    : a.kind === 'network' ? h('pre', { class: 'cmd mono' }, sub.url)
    : a.kind === 'payment' ? h('div', {}, h('p', { class: 'readback mono' }, sub.send ? rgbSendLine(sub) : sub.readback), h('details', {}, h('summary', {}, t('rawArgs')), h('pre', { class: 'cmd mono' }, JSON.stringify(sub.args, null, 2))))
    : h('pre', { class: 'cmd mono' }, sub.model || JSON.stringify(sub));
  const kv = [[t('agentL'), `${sub.agentId || ''} · ${sub.model || ''}`], [t('mode'), t(sub.mode)],
    a.kind === 'command' ? [t('sandbox'), t('sandboxNoNet')] : null, a.kind === 'payment' ? [t('network'), `${sub.network} · ${sub.node}`] : null, [t('reason'), a.kind === 'payment' ? t('rgbReason') : sub.reason], [t('id'), `${a.id.slice(0, 12)} · ${t('expires')} ${new Date(a.expiresAt).toLocaleTimeString()}`]].filter(x => x && x[1]);
  return h('div', { class: 'approval', role: 'group', 'aria-label': t(`kind_${a.kind}`) },
    h('h4', {}, SATS.includes(sub.agentId) ? sat(sub.agentId, { size: 24, state: 'waiting' }) : logo({ size: 18 }), `${sub.agentId === 'bitcode' || !sub.agentId ? 'bitcode' : satName(sub.agentId)} ${t(`kind_${a.kind}`)}`), body,
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
  S.lastPanel = S.panel;
  const tabs = h('div', { class: 'ptabs', role: 'tablist' }, PANELS.map(k => h('button', { class: `ptab${S.panel === k ? ' on' : ''}`, onClick: () => { S.panel = k; renderPanel(); renderTopbar(); } }, panelLabel(k))),
    h('span', { class: 'spacer' }), h('button', { class: 'ptab', 'aria-label': 'close', onClick: () => { S.panel = null; renderShell(); } }, '×'));
  let body;
  if (S.panel === 'files') body = h('div', { class: 'files' }, h('div', { class: 'tree', id: 'tree' }, treeView('.')), h('div', { class: 'editorcol' }, h('div', { class: 'etabs', id: 'etabs' }), h('div', { class: 'editor', id: 'editor' })));
  else if (S.panel === 'git') {
    const extra = wb.gitTools(() => { if (S.panel === 'git') renderPanel(); });
    body = h('div', { class: 'gitpane' }, extra?.head, extra && extra.tab !== 'changes' ? extra.body : gitView());
  }
  else if (S.panel === 'changes') body = h('div', { class: 'gitpane' }, wb.changesPane(() => { if (S.panel === 'changes') renderPanel(); }));
  else if (S.panel === 'preview') body = h('div', { class: 'gitpane' }, wb.previewPane(() => { if (S.panel === 'preview') renderPanel(); }));
  else if (S.panel === 'knowledge') body = h('div', { class: 'gitpane' }, wb.knowledgePane(() => { if (S.panel === 'knowledge') { const a = document.activeElement?.classList.contains('knotes'); renderPanel(); if (a) document.querySelector('.knotes')?.focus(); } }));
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
  const isMd = /\.(md|markdown)$/i.test(tab.path);
  const bar = h('div', { class: 'edbar' }, h('span', { class: 'status mono' }, tab.path), h('span', { style: 'flex:1' }),
    h('button', { class: 'btn sm ghost', title: `${t('wb_gotoLine')} (Ctrl+G)`, onClick: () => { tab.preview = false; renderEditor(); gotoLine(tab.view); } }, t('wb_gotoLine')),
    isMd ? h('button', { class: `btn sm${tab.preview ? ' primary' : ''}`, onClick: () => { tab.preview = !tab.preview; renderEditor(); } }, t('wb_preview')) : null);
  if (isMd && tab.preview) return fill(ed, banner, bar, h('div', { class: 'mdpreview' }, md(tab.view.state.doc.toString())));
  const host = h('div', { class: 'host' }); host.append(tab.view.dom);
  fill(ed, banner, bar, host); tab.view.requestMeasure();
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
// Queued prompts go out one at a time, only after the previous run succeeded.
const sendQueued = guard(async sessionId => {
  const q = S.queue.get(sessionId); if (!q?.length) return;
  const next = q.shift(); if (!q.length) S.queue.delete(sessionId);
  await api('chat.submit', { sessionId, text: next.text, agent: S.sessionId === sessionId ? S.agent : undefined });
  if (S.sessionId === sessionId) { S.session = await api('session.open', { sessionId }); renderThread(); renderComposer(); }
});
function sessionMenu(s, x, y) {
  const after = async (meta, msg) => { await loadSessions(); if (S.sessionId === s.sessionId && meta.sessionId === s.sessionId) Object.assign(S.session, meta); renderShell(); if (msg) toast(msg); };
  const others = S.projects.filter(p => p.projectId !== s.projectId);
  openMenu(x, y, [
    { label: t('wb_aiRename'), run: guard(async () => { toast(t('wb_aiRenaming')); await after(await api('session.rename.ai', { sessionId: s.sessionId })); }) },
    { label: t('wb_fork'), run: guard(async () => { const f = await api('session.fork', { sessionId: s.sessionId }); await loadSessions(); await openSession(f.sessionId); renderShell(); toast(t('wb_forked')); }) },
    ...others.map(p => ({ label: `${t('wb_moveTo')} ${p.name}`, disabled: !!activeRun(s.sessionId), run: guard(async () => { await after(await api('session.move', { sessionId: s.sessionId, projectId: p.projectId }), `${t('wb_moved')} ${p.name}`); }) })),
    '-',
    { label: t('export'), run: guard(async () => { openDiff(`export · ${s.name}`, await api('session.export', { sessionId: s.sessionId })); }) }
  ]);
}
// Dictation: record with the microphone, transcribe with the model chosen in Settings, insert at the cursor.
let recorder = null;
const toggleDictation = guard(async input => {
  if (recorder) { recorder.stop(); return; }
  if (!S.settings?.transcriptionModel) { toast(t('wb_dictateOff'), true); S.view = 'settings'; renderShell(); return; }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [], rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = guard(async () => {
    recorder = null; S.recording = false; for (const tr of stream.getTracks()) tr.stop(); renderComposer();
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    toast(t('wb_transcribing'));
    const r = await api('audio.transcribe', { audio: btoa(bin), mime: 'audio/webm', lang: document.documentElement.lang });
    const el = $('prompt'); if (!el || !r.text) return;
    const at = el.selectionStart ?? el.value.length; el.value = `${el.value.slice(0, at)}${at && !/\s$/.test(el.value.slice(0, at)) ? ' ' : ''}${r.text}${el.value.slice(at)}`; S.draft = el.value; el.focus(); el.dispatchEvent(new Event('input'));
  });
  rec.start(); recorder = rec; S.recording = true; renderComposer();
  setTimeout(() => { if (recorder === rec) rec.stop(); }, 120_000);
});
const PANELS = ['files', 'git', 'changes', 'knowledge', 'preview', 'terminal', 'agent'];
function panelLabel(k) { return t({ terminal: 'terminalShort', changes: 'wb_changesTab', preview: 'wb_previewTab' }[k] || k); }
// Composer history: ↑ on the first line walks back through this chat's prompts, ↓ forward to the draft.
let historyAt = -1, historyDraft = '';
function recallPrompt(input, dir) {
  const before = input.value.slice(0, input.selectionStart);
  if (dir > 0 ? before.includes('\n') : input.value.slice(input.selectionEnd).includes('\n')) return false;
  const list = promptHistory(S.session?.messages);
  if (dir > 0 && historyAt === -1 && input.value.trim()) return false;
  const next = historyAt + dir;
  if (next < -1 || next >= list.length) return false;
  if (historyAt === -1) historyDraft = input.value;
  historyAt = next; input.value = next === -1 ? historyDraft : list[next]; S.draft = input.value;
  input.setSelectionRange(input.value.length, input.value.length); input.dispatchEvent(new Event('input'));
  return true;
}
const wb = createWorkbench({ S, h, fill, api, toast, guard, t, icon, md, diffPre, ago, fmtTime, actions: {
  draft: text => { if (S.view !== 'chat') { S.view = 'chat'; renderShell(); } S.draft = text; historyAt = -1; renderComposer(); const i = $('prompt'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
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
  if (S.shell === undefined) { S.shell = null; api('shell.get').then(x => { S.shell = x; if (S.view === 'settings') renderCenter(); }).catch(() => {}); }
  if (S.autostart === undefined) { S.autostart = null; api('app.autostart.get').then(a => { S.autostart = a; if (S.view === 'settings') renderCenter(); }).catch(() => {}); }
  const keyInputs = new Map();
  if (S.library === undefined) { S.library = null; api('library.list', { projectId: S.projectId || undefined }).then(l => { S.library = l; if (S.view === 'settings') renderCenter(); }).catch(() => {}); }
  const lib = S.library;
  const libList = (rows, empty) => rows?.length ? h('table', { class: 'list' }, rows.map(r => h('tr', {}, h('td', { class: 'num' }, r[0]), h('td', {}, r[1]), h('td', { class: 'num status' }, r[2] || '')))) : h('p', { class: 'status' }, empty);
  const page = h('div', { class: 'page settings' }, h('h1', {}, t('settings')),
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
    h('div', { class: 'section' }, t('systemL')),
    h('div', { class: 'form' },
      S.autostart?.supported ? [h('label', { title: t('autostartHint') }, t('autostartL')), h('input', { type: 'checkbox', checked: S.autostart.enabled, onChange: guard(async e => { S.autostart = await api('app.autostart.set', { enabled: e.target.checked }); renderCenter(); }) })] : null,
      S.shell ? [
        h('label', { title: t('wb_quakeHint') }, `${t('wb_quake')} (${S.shell.quakeKey})`), h('span', { class: 'row' }, h('input', { type: 'checkbox', checked: S.shell.quake, onChange: guard(async e => { S.shell = await api('shell.set', { key: 'quake', value: e.target.checked }); renderCenter(); }) }),
          S.shell.quake ? h('span', { class: `chip ${S.shell.registered.quake ? 'ok' : 'warn'}` }, S.shell.registered.quake ? t('wb_shortcutOn') : t('wb_shortcutRefused')) : null),
        h('label', {}, t('wb_systemShortcut')), h('span', { class: 'status' }, t('wb_systemShortcutHint'), ' ', h('code', {}, 'bitcode-desktop --quake'), ' · ', h('code', {}, 'bitcode-desktop --mini-chat')),
        h('label', {}, `${t('wb_miniKey')} (Ctrl+Alt+Space)`), h('span', { class: 'row' }, h('input', { type: 'checkbox', checked: S.shell.miniKey, onChange: guard(async e => { S.shell = await api('shell.set', { key: 'miniKey', value: e.target.checked }); renderCenter(); }) }),
          S.shell.miniKey ? h('span', { class: `chip ${S.shell.registered.mini ? 'ok' : 'warn'}` }, S.shell.registered.mini ? t('wb_shortcutOn') : t('wb_shortcutRefused')) : null)] : null,
      h('label', { title: t('wb_updateHint') }, t('wb_checkUpdates')), h('span', { class: 'row' },
        h('button', { class: 'btn sm', onClick: guard(async e => { e.currentTarget.disabled = true; S.update = await api('app.update.check'); renderCenter(); }) }, t('wb_checkUpdates')),
        S.update ? (S.update.newer ? [h('span', { class: 'chip warn' }, `${t('wb_updateAvailable')} ${S.update.latest}`), S.update.url ? h('button', { class: 'btn sm ghost', onClick: guard(() => api('app.openExternal', { url: S.update.url })) }, t('wb_updateOpen')) : null]
          : S.update.latest ? h('span', { class: 'chip ok' }, `${t('wb_upToDate')} (${S.update.current})`) : h('span', { class: 'chip' }, t('wb_noRelease'))) : null)),
    h('div', { class: 'section' }, t('wb_dictation')),
    h('div', { class: 'form' },
      h('label', { title: t('wb_dictationHint') }, t('wb_transcriptionModel')), h('input', { type: 'text', placeholder: 'openai/whisper-1 · local/whisper', value: st.transcriptionModel || '', onChange: guard(async e => { S.settings = await api('settings.set', { key: 'transcriptionModel', value: e.target.value.trim() || null }); renderCenter(); }) })),
    h('p', { class: 'status' }, t('wb_dictationHint')),
    h('div', { class: 'section' }, t('wb_notifications')),
    h('div', { class: 'form' },
      h('label', {}, t('wb_notifyRuns')), h('input', { type: 'checkbox', checked: st.notifyRuns !== false, onChange: set('notifyRuns') }),
      h('label', {}, t('wb_notifyApprovals')), h('input', { type: 'checkbox', checked: st.notifyApprovals !== false, onChange: set('notifyApprovals') })),
    h('div', { class: 'section' }, t('wb_snippets')),
    h('p', { class: 'status' }, t('wb_snippetsHint')),
    (st.snippets || []).length ? h('table', { class: 'list' }, st.snippets.map(x => h('tr', {}, h('td', { class: 'num' }, `#${x.name}`), h('td', {}, x.text.slice(0, 120)),
      h('td', {}, h('button', { class: 'btn sm danger', onClick: guard(async () => { S.settings = await api('settings.set', { key: 'snippets', value: st.snippets.filter(y => y !== x) }); renderCenter(); }) }, t('delete')))))) : null,
    h('div', { class: 'form', style: 'margin-top:10px' },
      h('label', {}, t('wb_name')), h('input', { type: 'text', id: 'snipname', placeholder: 'fee-policy' }),
      h('label', {}, t('wb_text')), h('textarea', { id: 'sniptext', class: 'knotes', rows: 3 }),
      h('label', {}), h('button', { class: 'btn sm', onClick: guard(async () => {
        const name = $('snipname').value.trim(), text = $('sniptext').value; if (!name || !text.trim()) return;
        S.settings = await api('settings.set', { key: 'snippets', value: [...(st.snippets || []).filter(y => y.name !== name), { name, text }] }); renderCenter();
      }) }, t('wb_add'))),
    h('div', { class: 'section' }, t('wb_library')),
    h('p', { class: 'status' }, t('wb_libraryHint')),
    h('h3', { class: 'libh' }, t('wb_agents')), libList(lib?.agents.map(a => [a.name, a.description, a.source]), lib ? t('none') : '…'),
    h('h3', { class: 'libh' }, t('wb_commands')), libList(S.commands.filter(c => c.custom).map(c => [`/${c.name}`, c.hint]), t('wb_noCustomCommands')),
    h('h3', { class: 'libh' }, 'Skill'), libList(lib?.skills.map(x => [x.name, x.description, x.file]), S.projectId ? t('none') : t('wb_openProjectFirst')),
    h('h3', { class: 'libh' }, 'MCP'), libList(lib?.mcp.map(x => [x.name, x.command, x.enabled ? '' : 'off']), t('none')),
    h('div', { class: 'section' }, t('historyL')),
    h('div', { class: 'form' },
      h('label', {}, t('deleteAllHistory')), h('span', {}, h('button', { class: 'btn sm danger', disabled: !S.sessions.length, onClick: () => burnDialog() }, t('deleteAllBtn')))),
    h('div', { class: 'section' }, t('diagnostics')),
    h('div', { class: 'form' },
      h('label', {}, 'Sandbox'), h('span', {}, h('span', { class: `chip ${S.status?.sandbox.available ? 'ok' : 'err'}` }, S.status?.sandbox.available ? t('sandboxOk') : `${t('sandboxMissing')} ${S.status?.sandbox.detail || ''}`)),
      h('label', {}, t('dataDir')), h('span', { class: 'num' }, info?.home || ''),
      h('label', {}, 'Version'), h('span', { class: 'num' }, info?.version || '')));
  return settingsShell(page);
}
// Settings navigation and search work on the rendered page: every section heading becomes a link, and the
// filter hides form rows, tables and sections whose text does not match.
function settingsShell(page) {
  const sections = [...page.querySelectorAll('.section')];
  sections.forEach((el, i) => { el.id = `set-${i}`; });
  const apply = q => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean), match = el => words.every(w => el.textContent.toLowerCase().includes(w));
    let section = null, visible = false;
    const close = () => { if (section) section.hidden = !!words.length && !visible && !match(section); };
    for (const el of [...page.children].slice(1)) {
      if (el.classList.contains('section')) { close(); section = el; visible = false; continue; }
      if (el.classList.contains('form')) {
        const kids = [...el.children];
        for (let i = 0; i < kids.length; i += 2) { const show = !words.length || match(kids[i]) || (section && match(section)); kids[i].hidden = !show; if (kids[i + 1]) kids[i + 1].hidden = !show; visible ||= show; }
        el.hidden = !kids.some(k => !k.hidden);
      } else { const show = !words.length || match(el) || (section && match(section)); el.hidden = !show; visible ||= show; }
    }
    close();
  };
  const search = h('input', { type: 'text', class: 'setsearch', placeholder: t('wb_searchSettings'), value: S.settingsQuery || '', onInput: e => { S.settingsQuery = e.target.value; apply(e.target.value); } });
  const nav = h('nav', { class: 'setnav' }, search, sections.map(el => h('button', { class: 'setlink', onClick: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, el.textContent)));
  if (S.settingsQuery) apply(S.settingsQuery);
  return h('div', { class: 'setwrap' }, nav, page);
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
