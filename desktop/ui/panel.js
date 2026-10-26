// Right panel: files, git and the other tabs.
import { gotoLine } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { t } from './i18n.js';
import { wb } from './app.js';
import { renderComposer } from './composer.js';
import { loadTree, refreshGit } from './data.js';
import { $, api, fill, guard, h, toast } from './dom.js';
import { closeTab, compare, diffPre, openDiff, openFile, reload, save } from './editor.js';
import { md } from './reading.js';
import { renderShell, renderTopbar } from './shell.js';
import { S } from './state.js';
import { ensureTerminal, termHost } from './terminal.js';

// ---------- right panel ----------
export function renderPanel() {
  const el = $('panel'); if (!el) return;
  $('app').classList.toggle('panel-open', !!S.panel && ['chat', 'node'].includes(S.view) && !!S.projectId);
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
export function treeView(dir) {
  return (S.tree.get(dir) || []).map(e => {
    const depth = e.path.split('/').length - 1, open = S.expanded.has(e.path);
    const f = S.git?.files.find(x => x.path === e.path);
    return [h('button', { class: `titem${S.active?.path === e.path ? ' on' : ''}`, style: `padding-left:${6 + depth * 12}px`, title: e.path,
      onClick: guard(async () => { if (e.dir) { if (open) S.expanded.delete(e.path); else { S.expanded.add(e.path); await loadTree(e.path); } fill($('tree'), treeView('.')); } else await openFile(e.path); }) },
      h('span', { class: 'name' }, `${e.dir ? (open ? '▾ ' : '▸ ') : ''}${e.name}`), f ? h('span', { class: 'g' }, (f.worktree.trim() || f.index.trim())) : null),
    e.dir && open ? treeView(e.path) : null];
  });
}
export function renderEditorTabs() {
  fill($('etabs'), S.tabs.map(tab => h('div', { class: `etab${tab === S.active ? ' on' : ''}`, role: 'tab', tabindex: 0, onClick: () => { S.active = tab; renderEditorTabs(); renderEditor(); } },
    tab.kind === 'diff' ? '⇄' : null, tab.path.split('/').pop(), tab.dirty ? h('span', { class: 'mod' }, '●') : null,
    h('button', { class: 'x', 'aria-label': 'close', onClick: e => { e.stopPropagation(); closeTab(tab); } }, '×'))));
}
export function renderEditor() {
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
export function gitView() {
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

export const PANELS = ['files', 'git', 'changes', 'knowledge', 'preview', 'terminal', 'agent'];
export function panelLabel(k) { return t({ terminal: 'terminalShort', changes: 'wb_changesTab', preview: 'wb_previewTab' }[k] || k); }
