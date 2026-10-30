// The project terminal and SSH terminals.
import { Terminal } from '@xterm/xterm';
import { BRAND, THEME } from '../../src/design-tokens.mjs';
import { FitAddon } from '@xterm/addon-fit';
import { t, errorText } from './i18n.js';
import { sat } from './marks.js';
import { $, api, guard, h, isDark } from './dom.js';
import { S } from './state.js';

// ---------- terminal ----------
export let term = null, fit = null, ptyId = null, ptyProject = null;
export const termHost = h('div', { class: 'term' });
export async function ensureTerminal() {
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
// Dialog terminals: SSH for Remote access and RGB node fixes. One xterm per
// connection, inside its own dialog; onClose runs after the terminal is gone.
export const remoteTerms = new Map();
// Output that arrives before open() resolves (the shell prompt, the typed fix
// command) is held briefly and replayed once the dialog knows its ptyId.
const early = new Map();
export function earlyPty({ ptyId: id, data }) {
  if (!data) return;
  if (!early.has(id)) { early.set(id, []); setTimeout(() => early.delete(id), 5000); }
  early.get(id).push(data);
}
async function openDialogTerminal(title, open, { closedNote, onClose } = {}) {
  const hostEl = h('div', { class: 'rterm' });
  const dialog = h('dialog', { class: 'sat-info plan rdialog', 'aria-label': title },
    h('div', { class: 'row' }, h('h2', {}, title), h('span', { class: 'spacer' }), h('button', { class: 'iconbtn', onClick: () => dialog.close(), 'aria-label': t('close') }, '×')), hostEl);
  document.body.append(dialog); dialog.showModal();
  const rt = new Terminal({ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, cursorBlink: true, theme: termTheme() }), rfit = new FitAddon(); rt.loadAddon(rfit); rt.open(hostEl);
  rt.closedNote = closedNote;
  let id;
  try { ({ ptyId: id } = await open()); } catch (e) { dialog.close(); throw e; }
  remoteTerms.set(id, rt);
  for (const data of early.get(id) || []) rt.write(data);
  early.delete(id);
  rt.onData(data => api('pty.write', { ptyId: id, data }).catch(() => {}));
  rt.onResize(({ cols, rows }) => api('pty.resize', { ptyId: id, cols, rows }).catch(() => {}));
  requestAnimationFrame(() => { try { rfit.fit(); } catch {} }); rt.focus();
  dialog.addEventListener('close', () => { if (id && remoteTerms.has(id)) api('pty.close', { ptyId: id }).catch(() => {}); remoteTerms.delete(id); rt.dispose(); dialog.remove(); onClose?.(); });
}
export const openRemoteTerminal = guard((host, command = 'bitcode') =>
  openDialogTerminal(`ssh ${host}${command === 'bitcode' ? ' · bitcode' : ''}`, () => api('pty.openSsh', { host, command }), { closedNote: t('termSshClosed') }));
export const openRgbFixTerminal = guard((action, nodeUrl, onClose) =>
  openDialogTerminal(`${t(`fin_rgbFix_${action}`)} · ${nodeUrl}`, () => api('pty.openRgbFix', { action, nodeUrl }), { closedNote: t('termClosed'), onClose }));
export const termTheme = () => isDark()
  ? { background: THEME.dark.canvas, foreground: THEME.dark.text, cursor: BRAND.accent, selectionBackground: THEME.dark.elevated }
  : { background: THEME.light.canvas, foreground: THEME.light.ink, cursor: BRAND.accent, selectionBackground: THEME.light.hairline };
window.addEventListener('resize', () => { try { fit?.fit(); } catch {} });

export function ptyExited() { ptyId = null; ptyProject = null; }
export async function termCopy(clear = false) { const text = term?.getSelection(); if (!text) return; await api('clipboard.write', { text }).catch(() => {}); if (clear) term.clearSelection(); }
export async function termPaste() { const text = await api('clipboard.read').catch(() => ''); if (text) term?.paste(text); term?.focus(); }
