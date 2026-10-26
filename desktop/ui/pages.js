// Full pages: activity and settings.
import { t, setLang } from './i18n.js';
import { sat } from './marks.js';
import { retheme } from './app.js';
import { loadModels, modelLocality, openModelDialog } from './composer.js';
import { openSession, refreshGit, refreshStatus, selectProject } from './data.js';
import { $, api, applyTheme, fill, guard, h, project, satName, toast } from './dom.js';
import { openDiff } from './editor.js';
import { copyText } from './reading.js';
import { renderCenter, renderShell } from './shell.js';
import { burnDialog } from './sidebar.js';
import { S, SATS } from './state.js';

// ---------- pages ----------
export const openRunError = guard(async runId => {
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
export function activityPage() {
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
export function settingsPage() {
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
export function settingsShell(page) {
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
