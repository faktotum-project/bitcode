// The composer: commands, model picker, agent, mode, dictation and history.
import { t } from './i18n.js';
import { logo, sat, typing } from './marks.js';
import { icon } from './icons.js';
import { promptHistory } from './workbench.js';
import { wb } from './app.js';
import { attachmentChips, attachmentLines, importDropped, pickAttachments } from './attachments.js';
import { loadSessions, openSession, refreshStatus } from './data.js';
import { $, activeRun, api, fill, guard, h, modKey, project, satName, toast } from './dom.js';
import { openDiff } from './editor.js';
import { openMenu } from './menu.js';
import { goHome, renderShell, renderTopbar } from './shell.js';
import { renderSidebar } from './sidebar.js';
import { MODES, S, SATS, unattendedBlocked } from './state.js';
import { fit } from './terminal.js';
import { renderThread, showSatInfo } from './thread.js';

// ---------- composer: slash menu, model picker, command results ----------
export const UI_COMMANDS = {
  models: () => openModelPicker(), diff: () => { S.panel = 'git'; renderShell(); },
  new: () => goHome(S.projectId), reset: () => goHome(S.projectId),
  export: guard(async () => { if (!S.session) return; openDiff(`export · ${S.session.name}`, await api('session.export', { sessionId: S.session.sessionId })); }),
  settings: () => { S.view = 'settings'; renderShell(); }
};
for (const k of ['setting', 'config', 'login', 'provider', 'doctor']) UI_COMMANDS[k] = UI_COMMANDS.settings;
export const cmdHint = c => { const k = `cmd_${c.name}`, v = t(k); return v === k ? c.hint : v; };
export function note(title, lines = []) { S.notes.push({ title, lines: [].concat(lines) }); renderThread(); }
export function showResult(res) {
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

export function renderComposer() {
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

export const chooseAgent = guard(async id => {
  if (S.session) { await api('session.update', { sessionId: S.session.sessionId, satId: id }); S.session.satId = id; }
  S.agent = id; renderComposer(); renderTopbar();
});

// Model picker: everything runnable on this machine first (any runtime, probed
// live, with a memory-fit badge), downloaded-but-not-served models with the
// command to serve them, then cloud providers. Shared by the composer popover
// and the settings dialog.
export const modelLocality = spec => {
  const a = S.picker.data; if (!a || !spec) return 'unknown';
  if (a.local.some(p => spec.startsWith(`${p.provider}/`))) return 'local';
  return a.cloud.some(c => spec.startsWith(`${c.provider}/`)) ? 'cloud' : 'unknown';
};
export async function loadModels(refresh = false) { S.picker.loading = true; try { S.picker.data = await api('models.available', { refresh }); } finally { S.picker.loading = false; } }
export const openModelPicker = guard(async () => { S.picker.open = true; S.picker.filter = ''; renderComposer(); await loadModels(); if (S.picker.open) renderComposer(); setTimeout(() => $('modelfilter')?.focus(), 0); });
export function closeModelPicker() { S.picker.open = false; renderComposer(); }
document.addEventListener('mousedown', e => { if (S.picker.open && !e.target.closest('.modelpick')) closeModelPicker(); });
export const chooseModel = guard(async spec => {
  S.picker.open = false;
  if (S.session) { const r = await api('chat.submit', { sessionId: S.session.sessionId, text: `/model ${spec}` }); showResult({ command: true, result: r.result }); }
  else { S.newModel = spec; renderComposer(); }
});
export const gb = n => n ? `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB` : '';
export const fitBadge = fit => fit && fit !== 'unknown' ? h('span', { class: `fit ${fit}`, title: t(`fitHint_${fit}`) }, t(`fit_${fit}`)) : null;
export function machineLine(m) {
  if (!m) return null;
  const gpu = m.gpus.map(g => `${g.name}${g.vram ? ` ${gb(g.vram)}` : ''}${g.unified ? ` · ${t('sharedMem')}` : ''}`).join(', ');
  return h('div', { class: 'machine num' }, h('span', {}, `RAM ${gb(m.ram.total)} · ${gb(m.ram.available)} ${t('free')}`), gpu ? h('span', {}, `GPU ${gpu}`) : null, h('span', {}, `${m.cpus} core`));
}
const CLOUD_SHOWN = 60;
export function modelList({ current, filter = '', onPick, onRefresh, redraw = () => {}, inherit = null, fitsOnly = false }) {
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
    // Each cloud provider is a group that opens on click (the current model's provider starts open);
    // typing filters across every provider's full catalog.
    S.picker.expanded ??= new Set([String(current || '').split('/')[0]]);
    const groups = d.cloud.map(c => ({ c, models: (c.models?.length ? c.models : c.spec ? [{ spec: c.spec, model: c.model, detail: '' }] : []).filter(m => match(m.spec)) }))
      .filter(({ c, models }) => !q || models.length || match(c.provider));
    if (groups.length) body.push(h('div', { class: 'mgroup' }, t('cloudModels')));
    for (const { c, models } of groups) {
      const open = !!q || S.picker.expanded.has(c.provider);
      body.push(h('button', { class: 'mprov mprovbtn', 'aria-expanded': open ? 'true' : 'false', onClick: () => { S.picker.expanded.has(c.provider) ? S.picker.expanded.delete(c.provider) : S.picker.expanded.add(c.provider); redraw(); } },
        h('span', { class: 'caret' }, open ? '▾' : '▸'), h('span', { class: `loc ${c.hasKey ? 'cloud' : 'off'}` }), c.provider,
        h('span', { class: `chip ${c.hasKey ? 'ok' : 'warn'}` }, c.hasKey ? t('hasKey') : t('noKey')),
        h('span', { class: 'mdetail' }, c.models?.length ? `${c.models.length} ${t(c.models.length === 1 ? 'modelN' : 'modelsN')}` : '')));
      if (!open) continue;
      body.push(...models.slice(0, q ? 200 : CLOUD_SHOWN).map(m => item(m.spec, m.model, m.detail)));
      if (!q && models.length > CLOUD_SHOWN) body.push(h('div', { class: 'mnote' }, `${models.length - CLOUD_SHOWN} ${t('moreModelsHint')}`));
      if (c.error && !c.hasKey) body.push(h('div', { class: 'mnote' }, t('cloudKeyHint')));
      else if (c.error) body.push(h('div', { class: 'mnote mono' }, c.error));
    }
  }
  if (q.includes('/') && ![...d.local.flatMap(p => p.models.map(m => m.spec)), ...d.cloud.flatMap(c => [c.spec, ...(c.models || []).map(m => m.spec)])].includes(filter.trim()))
    body.push(h('div', { class: 'mgroup' }, t('customModel')), item(filter.trim(), filter.trim(), t('typed')));
  return body;
}
export function modelPopover() {
  const current = S.session?.model || S.newModel || S.status?.defaultModel?.spec;
  const refresh = guard(async () => { await loadModels(true); renderComposer(); });
  const custom = h('input', { id: 'modelfilter', type: 'text', class: 'mono', placeholder: t('modelFilter'), value: S.picker.filter,
    onInput: e => { S.picker.filter = e.target.value; const pos = e.target.selectionStart; renderComposer(); const i = $('modelfilter'); i?.focus(); i?.setSelectionRange(pos, pos); },
    onKeydown: e => { if (e.key === 'Enter' && e.target.value.includes('/')) chooseModel(e.target.value.trim()); if (e.key === 'Escape') closeModelPicker(); } });
  return h('div', { class: 'modelpop', role: 'listbox' }, custom, h('div', { class: 'mlist' }, modelList({ current, filter: S.picker.filter, onPick: chooseModel, onRefresh: refresh, redraw: renderComposer })),
    h('div', { class: 'mfoot' }, h('span', { class: 'status' }, t('modelFoot')),
      h('button', { class: 'btn sm ghost', disabled: !current, onClick: guard(async () => { S.settings = await api('settings.set', { key: 'model', value: current }); await refreshStatus(); toast(`${t('defaultModel')}: ${current}`); closeModelPicker(); }) }, t('setDefault'))));
}
// opencode-style dialog: search, machine summary, "fits in memory" filter.
export function openModelDialog({ title, current, inherit = null, onPick }) {
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
      h('div', { class: 'mlist dlist' }, modelList({ current, filter: state.filter, fitsOnly: state.fitsOnly, inherit, onPick: pick, redraw: () => draw(), onRefresh: guard(async () => { S.picker.data = null; draw(); await loadModels(true); draw(); }) }))));
    if (!state.filter) setTimeout(() => overlay.querySelector('input')?.focus(), 0);
  };
  document.body.append(overlay); draw();
  if (!S.picker.data) loadModels().then(draw);
}

// Queued prompts go out one at a time, only after the previous run succeeded.
export const sendQueued = guard(async sessionId => {
  const q = S.queue.get(sessionId); if (!q?.length) return;
  const next = q.shift(); if (!q.length) S.queue.delete(sessionId);
  await api('chat.submit', { sessionId, text: next.text, agent: S.sessionId === sessionId ? S.agent : undefined });
  if (S.sessionId === sessionId) { S.session = await api('session.open', { sessionId }); renderThread(); renderComposer(); }
});
// Dictation: record with the microphone, transcribe with the model chosen in Settings, insert at the cursor.
export let recorder = null;
export const toggleDictation = guard(async input => {
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
// Composer history: ↑ on the first line walks back through this chat's prompts, ↓ forward to the draft.
export let historyAt = -1, historyDraft = '';
export function resetHistory() { historyAt = -1; }
export function recallPrompt(input, dir) {
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
