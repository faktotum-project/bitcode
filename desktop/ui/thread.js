// The chat thread: messages, tool calls, approvals and the home screen.
import { t } from './i18n.js';
import { logo, sat, typing, SAT_META } from './marks.js';
import { satStateTable, satEthics } from '../../src/sat-states.mjs';
import { satForTool, toolLabel } from '../../src/sats/roles.mjs';
import { word } from '../../src/work-meter.mjs';
import { wb } from './app.js';
import { chooseModel, note, openModelDialog } from './composer.js';
import { refreshStatus } from './data.js';
import { $, activeRun, api, fill, fmt, fmtTime, guard, h, project, satName, toast } from './dom.js';
import { lineClass } from './editor.js';
import { copyText, md } from './reading.js';
import { closingLine, runLine } from './runline.js';
import { openFolder, renderShell } from './shell.js';
import { S, SATS } from './state.js';

export function showSatInfo(info) {
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

export function renderThread() {
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

export function toolsBlock({ names, outputs }) {
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
export function showToolOutputs(names, outputs) {
  const dialog = h('dialog', { class: 'sat-info plan', 'aria-label': t('wb_toolOutput') },
    h('div', { class: 'row' }, h('h2', {}, t('wb_toolOutput')), h('span', { class: 'spacer' }), h('button', { class: 'iconbtn', autofocus: true, onClick: () => dialog.close(), 'aria-label': t('close') }, '×')),
    h('div', { class: 'planbody' }, outputs.map((o, i) => h('details', { open: outputs.length === 1 }, h('summary', { class: 'mono' }, o.name || names[i] || `#${i + 1}`), h('pre', { class: 'toolpre' }, o.content)))));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
// First steps until a model, a project and the sandbox are ready; each row is the action itself.
export function modelReady() {
  const m = S.status?.defaultModel; if (!m?.spec || m.error) return false;
  const provider = S.models.find(x => m.spec.startsWith(`${x.name}/`));
  return m.locality === 'local' || !!provider?.hasKey;
}
export function setupSteps() {
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
export function home(p) {
  return h('div', { class: 'home' }, h('div', { class: 'inner' },
    h('div', { class: 'lockup' }, logo({ size: 60, build: true }), h('span', { class: 'word' }, 'bitcode')),
    h('div', { class: 'sats4' }, SATS.map(x => sat(x, { size: 52, state: 'idle', title: `${satName(x)} · ${t(`role_${x}`)}` }))),
    p ? h('h1', {}, t('homeTitle'), ' ', h('em', {}, p.name), '?') : h('h1', {}, t('welcome')),
    h('p', {}, p ? t('homeSub') : t('homeNoProject')),
    setupSteps(),
    p ? wb.starters() : h('div', { class: 'row', style: 'justify-content:center' }, S.projects.length ? h('button', { class: 'btn primary pill', onClick: openFolder }, t('openFolder')) : null, h('button', { class: 'btn pill', onClick: () => { S.view = 'settings'; renderShell(); } }, t('settings')))));
}

export const shortId = id => id.length > 24 ? `${id.slice(0, 16)}…${id.slice(-6)}` : id;
export const rgbSendLine = ({ send, network }) => t('rgbSendLine').replace('{amount}', send.amount).replace('{unit}', send.unit || t('units'))
  .replace('{asset}', shortId(send.assetId)).replace('{recipient}', shortId(send.recipientId)).replace('{network}', network)
  + (send.endpoints.length ? ` ${t('via')} ${send.endpoints.join(', ')}` : '');
export function approvalCard(a) {
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
