// Sidebar: navigation, projects and chats, deleting chats.
import { t } from './i18n.js';
import { logo, sat } from './marks.js';
import { icon } from './icons.js';
import { word } from '../../src/work-meter.mjs';
import { wb, nodeView } from './app.js';
import { loadSessions, openSession } from './data.js';
import { $, activeRun, ago, api, fill, fmt, guard, h, toast } from './dom.js';
import { openDiff } from './editor.js';
import { openMenu } from './menu.js';
import { goHome, openFolder, renderShell, renderTopbar } from './shell.js';
import { S } from './state.js';

// ---------- deleting chats: one, a selection, or all of them behind a typed word ----------
export const BURN_WORD = 'burnall';
// Removing a project only takes it out of bitcode: the folder and its files stay on disk.
// Its chats stay too, unless the user also asks to delete them (kept chats are never deleted).
export function removeProjectDialog(p) {
  const chats = S.sessions.filter(s => s.projectId === p.projectId), deletable = chats.filter(s => !s.keep);
  const dialog = h('dialog', { class: 'sat-info burn', 'aria-labelledby': 'remove-title' });
  const also = h('input', { type: 'checkbox', id: 'remove-chats', disabled: !deletable.length });
  const go = h('button', { class: 'btn danger', onClick: guard(async () => {
    if (also.checked && deletable.length) await api('session.deleteMany', { sessionIds: deletable.map(s => s.sessionId) });
    await api('project.close', { projectId: p.projectId });
    dialog.close();
    S.projects = await api('project.list'); await loadSessions();
    if (S.projectId === p.projectId) { S.projectId = null; S.sessionId = null; S.session = null; S.panel = null; S.git = null; }
    toast(fmt('projectRemoved', { p: p.name })); renderShell();
  }) }, t('removeProject'));
  fill(dialog,
    h('h2', { id: 'remove-title' }, fmt('removeProjectTitle', { p: p.name })),
    h('p', {}, t('removeProjectBody')), h('p', { class: 'mono status' }, p.root),
    h('label', { class: 'row', for: 'remove-chats' }, also, ` ${fmt(deletable.length === 1 ? 'removeProjectChat' : 'removeProjectChats', { n: deletable.length })}`),
    chats.length > deletable.length ? h('p', { class: 'status' }, fmt('removeProjectKept', { n: chats.length - deletable.length })) : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onClick: () => dialog.close() }, t('cancel')), go));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
export function exitSelect() { S.selecting = null; S.selected.clear(); }
// Kept and running chats are never bulk-deleted; the controller enforces the same rule.
export const skipCounts = list => ({ keep: list.filter(s => s.keep).length, active: list.filter(s => !s.keep && activeRun(s.sessionId)).length });
export const skipText = ({ keep, active }) => keep || active ? fmt('burnSkips', { list: [keep && fmt('skipKeep', { k: keep }), active && fmt('skipActive', { a: active })].filter(Boolean).join(' · ') }) : '';
export async function afterDelete(r) {
  exitSelect(); await loadSessions();
  if (S.sessionId && r.deleted.includes(S.sessionId)) { S.sessionId = null; S.session = null; }
  toast([fmt('chatsDeleted', { n: r.deleted.length }), skipText(r.skipped)].filter(Boolean).join(' '));
  renderShell();
}
export async function deleteSelected(p) {
  const all = S.sessions.filter(s => s.projectId === p.projectId), picked = all.filter(s => S.selected.has(s.sessionId));
  if (!picked.length) return;
  if (picked.length === all.length) return burnDialog({ projectId: p.projectId });
  const skip = skipCounts(picked);
  if (!confirm([fmt('deleteSelectedConfirm', { n: picked.length - skip.keep - skip.active }), skipText(skip)].filter(Boolean).join('\n'))) return;
  await afterDelete(await api('session.deleteMany', { sessionIds: picked.map(s => s.sessionId) }));
}
export function burnDialog({ projectId = null } = {}) {
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

export const MORE_VIEWS = ['stats', 'archive', 'issues', 'remote', 'schedules', 'integrations'];
export const MORE_KEY = 'bitcode.sideMore';
export function toggleMore() { try { localStorage.setItem(MORE_KEY, localStorage.getItem(MORE_KEY) === '1' ? '' : '1'); } catch {} renderSidebar(); }
export function renderSidebar() {
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
        !selecting ? h('button', { class: 'padd', title: `${t('wb_more')} · ${p.name}`, 'aria-label': `${t('wb_more')} · ${p.name}`, onClick: e => {
          e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect();
          openMenu(b.left, b.bottom + 4, [
            { label: t('newChat'), run: guard(() => goHome(p.projectId)) },
            { label: t('selectChats'), disabled: !all.length, run: () => { S.selecting = p.projectId; S.selected.clear(); S.collapsed.delete(p.projectId); renderSidebar(); } },
            '-', { label: `${t('removeProject')}…`, run: () => removeProjectDialog(p) }]);
        } }, icon('more', { size: 14 })) : null,
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
      action('bitcoin', document.documentElement.lang === 'en' ? 'Node' : 'Nodo', () => { nodeView.invalidate(); S.view = 'node'; renderShell(); }, { on: S.view === 'node' }),
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
export function toggleSidebar() { S.sideHidden = !S.sideHidden; try { localStorage.setItem('bitcode.sideHidden', S.sideHidden ? '1' : ''); } catch {} renderShell(); }
export function openSearch() { S.searching = true; renderSidebar(); setTimeout(() => $('sidesearch')?.focus(), 0); }
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); toggleSidebar(); }
  else if (k === 'k') { e.preventDefault(); if (S.sideHidden) toggleSidebar(); openSearch(); }
  else if (k === 'n') { e.preventDefault(); if (S.projectId) goHome(S.projectId); }
});
export function sessionMenu(s, x, y) {
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
