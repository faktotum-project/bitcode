// Window layout: shell, center views and the top bar.
import { t } from './i18n.js';
import { sat } from './marks.js';
import { icon } from './icons.js';
import { bitcoinPage, wb, nodeView } from './app.js';
import { chooseAgent, renderComposer } from './composer.js';
import { selectProject } from './data.js';
import { $, activeRun, api, applyTheme, fill, fmt, fmtTime, guard, h, project, satLabel, satName, toast } from './dom.js';
import { openDiff } from './editor.js';
import { openMenu } from './menu.js';
import { activityPage, settingsPage } from './pages.js';
import { panelLabel, renderPanel } from './panel.js';
import { remotePage } from './remote.js';
import { renderSidebar, toggleSidebar } from './sidebar.js';
import { S, SATS } from './state.js';
import { renderThread, showSatInfo } from './thread.js';

// ---------- shell ----------
export function renderShell() {
  applyTheme();
  const app = $('app');
  if (!app.dataset.ready) {
    app.dataset.ready = '1'; app.className = 'shell';
    fill(app, h('aside', { class: 'sidebar', id: 'sidebar' }), h('main', { class: 'center', id: 'center' }), h('aside', { class: 'panel', id: 'panel' }));
  }
  app.classList.toggle('panel-open', !!S.panel && ['chat', 'node'].includes(S.view) && !!S.projectId);
  app.classList.toggle('side-hidden', !!S.sideHidden);
  renderSidebar(); renderCenter(); renderPanel();
}
export const goHome = async projectId => { await selectProject(projectId); S.sessionId = null; S.session = null; S.view = 'chat'; renderShell(); setTimeout(() => $('prompt')?.focus(), 0); };
export const openFolder = guard(async () => {
  const p = await api('dialog.openFolder'); if (!p) return;
  const proj = await api('project.open', { path: p }); S.projects = await api('project.list'); await goHome(proj.projectId);
});

export function renderCenter() {
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
    const pages = { node: () => nodeView.page(rerender), activity: activityPage, bitcoin: bitcoinPage, stats: () => wb.statsPage(rerender), archive: () => wb.archivePage(rerender), multirun: () => wb.multirunPage(rerender),
      schedules: () => wb.schedulesPage(rerender), integrations: () => wb.integrationsPage(rerender), issues: () => wb.issuesPage(rerender), remote: remotePage };
    fill(el, (pages[S.view] || settingsPage)());
  }
}

export function renderTopbar() {
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
