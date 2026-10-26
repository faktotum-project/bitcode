// Right-click menus for chat, terminal, editor and inputs.
import { t } from './i18n.js';
import { $, api, h, modKey } from './dom.js';
import { openLink } from './reading.js';
import { S } from './state.js';
import { term, termCopy, termPaste } from './terminal.js';

// ---------- context menu (right click): copy / paste / select in chat, terminal, editor and inputs ----------
export let ctxMenu = null;
export function closeMenu() { ctxMenu?.remove(); ctxMenu = null; }
export function openMenu(x, y, items) {
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
export async function pasteInto(el) { const text = await api('clipboard.read').catch(() => ''); if (!text) return; el.focus(); document.execCommand('insertText', false, text); }
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
