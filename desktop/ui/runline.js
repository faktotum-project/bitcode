// The live work line under a running chat.
import { logo, sat } from './marks.js';
import { workText, word } from '../../src/work-meter.mjs';
import { $, h, satName, wlang } from './dom.js';
import { S, SATS } from './state.js';

export const workOf = id => { let w = S.work.get(id); if (!w) S.work.set(id, w = { memory: null, liveBase: 0, liveOff: 0, callStart: null, speed: null, action: null }); return w; };
export const liveChars = () => [...S.live.values()].reduce((n, l) => n + l.text.length, 0);
export function runSnapshot(run, at = Date.now()) {
  const w = workOf(run.runId), est = w.liveBase + Math.ceil(Math.max(0, liveChars() - w.liveOff) / 4);
  return { elapsed: Math.max(0, (run.endedAt || at) - run.startedAt), inTokens: run.usage.inputTokens, outTokens: Math.max(run.usage.outputTokens, est), speed: w.speed, action: w.action, memory: w.memory };
}
// Who is working: the Sat that is active now (delegation included), else the one chosen for the session.
export const workingSat = sessionId => SATS.find(x => !['idle', 'happy', 'concerned'].includes(S.sats[x].st) && sessionId === S.sessionId) || S.sessions.find(x => x.sessionId === sessionId)?.satId || null;
export function runLine(run) {
  const waiting = S.pending.some(a => a.sessionId === run.sessionId), id = workingSat(run.sessionId);
  const mark = id ? sat(id, { size: 18, state: waiting ? 'waiting' : 'thinking' }) : logo({ size: 14 });
  const el = h('div', { class: 'runline', 'data-run': run.runId, 'data-key': `${id}|${waiting}` }, mark, h('b', {}, id ? satName(id) : 'bitcode'), h('span', { class: 'rl-phrase' }), h('span', { class: 'rl-datum num' }));
  fillRunLine(el, run, waiting);
  return el;
}
export function fillRunLine(el, run, waiting) {
  const { phrase, datum } = workText({ id: workingSat(run.sessionId) || 'bitcode', snap: runSnapshot(run), ms: Date.now() - run.startedAt, lang: wlang() });
  el.querySelector('.rl-phrase').textContent = waiting ? word('waiting', wlang()) : `${phrase}…`;
  el.querySelector('.rl-datum').textContent = waiting ? '' : datum;
}
export function closingLine(c) {
  const mark = c.id ? sat(c.id, { size: 16, state: c.ok ? 'happy' : 'concerned' }) : logo({ size: 14 });
  return h('div', { class: 'runline runend' }, mark, h('b', {}, c.id ? satName(c.id) : 'bitcode'), h('span', { class: 'rl-datum num' }, c.text));
}
// Update texts in place: replacing the node would restart the avatar's animation every second.
export function tickRunLines() {
  for (const el of document.querySelectorAll('.runline[data-run]')) {
    const run = S.runs.get(el.dataset.run); if (!run || run.endedAt) continue;
    const waiting = S.pending.some(a => a.sessionId === run.sessionId), key = `${workingSat(run.sessionId)}|${waiting}`;
    if (key !== el.dataset.key) el.replaceWith(runLine(run)); else fillRunLine(el, run, waiting);
  }
}
document.addEventListener('bitcode:tick', tickRunLines);
setInterval(() => document.dispatchEvent(new Event('bitcode:tick')), 1000);
