// Reading the chat: markdown, copy, links, zoom, shortcuts and global keys.
import { markdown } from '@codemirror/lang-markdown';
import { t } from './i18n.js';
import { sat, typing } from './marks.js';
import { renderMarkdown, commandOf, isRisky } from './markdown.js';
import { wb } from './app.js';
import { pickAttachments } from './attachments.js';
import { $, api, guard, h, toast } from './dom.js';
import { PANELS } from './panel.js';
import { renderShell } from './shell.js';
import { S } from './state.js';
import { ptyId, ptyProject, term } from './terminal.js';

// ---------- reading: markdown, copy, zoom ----------
export const copyText = guard(async (text, button) => {
  await api('clipboard.write', { text });
  if (button) { const old = button.textContent; button.textContent = t('copiedText'); button.classList.add('done'); setTimeout(() => { button.textContent = old; button.classList.remove('done'); }, 1400); } else toast(t('copiedText'));
});
export const openLink = guard(url => api('app.openExternal', { url }));
// Play on a shell block: runs it in the USER's terminal (the side panel), only from a real click of theirs.
// Risky commands (sudo, rm -rf, curl | sh ...) need a second click within a few seconds.
export const runInTerminal = guard(async (text, button, event) => {
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
export const md = text => renderMarkdown(text, { h, onCopy: copyText, onLink: openLink, onRun: S.projectId ? runInTerminal : null, labels: { copy: t('copyL'), code: t('codeL'), run: t('runL'), runTitle: t('runTitle') } });
// Reading scale: automatic with the window width (so a big monitor is not a narrow column), then the user's own zoom.
export const READ_KEY = 'bitcode.readScale';
try { S.read = Math.min(2.2, Math.max(0.7, Number(localStorage.getItem(READ_KEY)) || 1)); } catch { S.read = 1; }
export function applyRead() { document.documentElement.style.setProperty('--read', (Math.min(1.6, Math.max(1, innerWidth / 1500)) * S.read).toFixed(3)); }
export function zoomRead(step) {
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
export const lastAnswer = () => [...(S.session?.messages || [])].reverse().find(m => m.role === 'assistant' && m.content)?.content;
export function jumpMessage(dir) {
  const th = $('thread'); if (!th) return;
  const msgs = [...th.querySelectorAll('.m-user, .m-bot')]; if (!msgs.length) return;
  const top = th.getBoundingClientRect().top, cur = msgs.reduce((c, m, i) => (m.getBoundingClientRect().top - top <= 8 ? i : c), -1);
  const target = dir > 0 ? msgs[Math.min(msgs.length - 1, cur + 1)] : (cur >= 0 && msgs[cur].getBoundingClientRect().top - top < -8 ? msgs[cur] : msgs[Math.max(0, cur - 1)]);
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
export const SHORTCUTS = [
  ['mod+wheel · mod+= / mod+-', 'scRead'], ['mod+0', 'scReadReset'], ['alt+↑ / alt+↓', 'scJump'], ['End · Home', 'scEnds'], ['mod+L · /', 'scFocus'],
  ['mod+shift+C', 'scCopy'], ['mod+U', 'scAttach'], ['mod+1 … 7', 'scPanels'], ['mod+P', 'wb_palette'], ['↑ / ↓', 'wb_scHistory'], ['mod+B', 'scSidebar'], ['mod+K', 'scSearch'], ['mod+N', 'scNew'], ['mod+/ · ?', 'scHelp'], ['Esc', 'scClose']
];
export function showShortcuts() {
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
