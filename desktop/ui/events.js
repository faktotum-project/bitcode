// Events pushed by the main process.
import { t, errorText } from './i18n.js';
import { sat } from './marks.js';
import { closingText, actionText } from '../../src/work-meter.mjs';
import { finView, wb, nodeView } from './app.js';
import { note, renderComposer, sendQueued } from './composer.js';
import { loadSessions, openSession, refreshGit } from './data.js';
import { $, api, toast, wlang } from './dom.js';
import { reload } from './editor.js';
import { renderPanel } from './panel.js';
import { liveChars, runSnapshot, workOf } from './runline.js';
import { renderCenter, renderShell, renderTopbar } from './shell.js';
import { renderSidebar } from './sidebar.js';
import { S, SATS } from './state.js';
import { earlyPty, ptyExited, ptyId, remoteTerms, term } from './terminal.js';
import { renderThread } from './thread.js';

// ---------- events from main ----------
window.bitcode.subscribe(({ channel, payload }) => {
  if (channel === 'approval') {
    S.pending = S.pending.filter(a => a.id !== payload.id); if (payload.status === 'pending') S.pending.push(payload);
    renderSidebar(); if (S.view === 'chat') renderThread(); else if (S.view === 'activity') renderCenter();
  } else if (channel === 'run') {
    S.runs.set(payload.runId, payload);
    { const w = workOf(payload.runId); w.liveBase = payload.usage.outputTokens; w.liveOff = liveChars(); }
    if (!payload.endedAt) S.closing.delete(payload.sessionId);
    if (payload.endedAt) {
      const sid = S.sessions.find(x => x.sessionId === payload.sessionId)?.satId || null;
      S.closing.set(payload.sessionId, { id: sid, ok: payload.state === 'success', text: closingText({ outcome: payload.state === 'success' ? 'ok' : payload.state === 'cancelled' ? 'cancelled' : 'error', snap: runSnapshot(payload), lang: wlang() }) });
      S.live.delete(payload.runId); S.reasoning.delete(payload.runId); refreshGit();
      if (payload.error && payload.sessionId === S.sessionId) toast(errorText({ code: payload.errorCode, message: payload.error }), true);
      if (payload.worktree) api('worktree.list').then(w => { S.worktrees = w; });
      if (payload.sessionId === S.sessionId) for (const s of SATS) S.sats[s] = { st: 'idle' };
      if (payload.state === 'success') sendQueued(payload.sessionId);
      if (wb.multirunChanged(payload.sessionId) && S.view === 'multirun') renderCenter();
    }
    renderSidebar(); if (S.view === 'chat') { renderThread(); renderComposer(); renderTopbar(); } else if (S.view === 'activity') renderCenter();
  } else if (channel === 'session' && payload.type === 'created') { loadSessions().then(renderSidebar);
  } else if (channel === 'session' && payload.sessionId === S.sessionId) {
    const { type, data } = payload;
    if (type === 'plan.saved') note(t('planSaved'), [data.file, t('planBuildHint')]);
    if (type === 'messages') { S.session.messages = data.messages; S.live.clear(); for (const w of S.work.values()) { w.liveOff = 0; w.callStart = null; } renderThread(); }
    if (type === 'message.delta') {
      { // speed over a sliding ~4 s window; it keeps its last value while the model is silent (tools running)
        const w = workOf(data.runId), t0 = Date.now(); w.total = (w.total || 0) + data.text.length;
        (w.samples ||= []).push({ t: t0, c: w.total }); while (w.samples.length > 1 && t0 - w.samples[0].t > 4000) w.samples.shift();
        const first = w.samples[0], secs = (t0 - first.t) / 1000; if (secs >= 1) w.speed = Math.max(1, Math.round((w.total - first.c) / 4 / secs)); } S.live.set(data.runId, { agent: data.agentId, text: (S.live.get(data.runId)?.text || '') + data.text }); renderThread(); }
    if (type === 'reasoning.delta') { S.reasoning.set(data.runId, ((S.reasoning.get(data.runId) || '') + data.text).slice(-20000)); renderThread(); }
    if (type === 'todo' && S.session) { S.session.todo = data.items; renderThread(); }
    if (type === 'tool.detail') { S.agentLog.push({ at: Date.now(), text: `${data.auto ? 'auto' : t('approved')} · ${data.tool} · ${data.summary}` }); if (S.panel === 'agent') renderPanel(); }
  } else if (channel === 'sat' && payload.sessionId === S.sessionId && SATS.includes(payload.satId)) {
    const visual = { writing: 'drafting', waiting_approval: 'waiting', success: 'happy', error: 'concerned', planning: 'thinking', delegating: 'running' };
    S.sats[payload.satId] = { st: visual[payload.state] || payload.state };
    renderTopbar();
  } else if (channel === 'metrics') {
    workOf(payload.runId).memory = payload.memory;
  } else if (channel === 'feed') {
    if (payload.type === 'tool.started') for (const r of S.runs.values()) if (r.sessionId === payload.sessionId && !r.endedAt) workOf(r.runId).action = actionText(payload.data, wlang());
    if (['tool.finished', 'model.started'].includes(payload.type)) for (const r of S.runs.values()) if (r.sessionId === payload.sessionId) workOf(r.runId).action = null;
    const line = `${payload.agentId} · ${payload.type}${payload.data.summary ? ' · ' + payload.data.summary : ''}${payload.data.outcome ? ' · ' + payload.data.outcome : ''}`;
    S.agentLog.push({ at: Date.now(), text: line }); if (S.agentLog.length > 500) S.agentLog.shift();
    if (SATS.includes(payload.agentId) && payload.sessionId === S.sessionId) {
      const id = payload.agentId, ty = payload.type, out = payload.data.outcome;
      const st = ty === 'approval.requested' ? 'waiting' : ty === 'run.finished' ? (out === 'ok' ? 'happy' : out === 'cancelled' ? 'idle' : 'concerned')
        : ty === 'model.started' || ty === 'run.started' ? 'thinking' : ty === 'tool.started' || ty === 'tool.requested' ? (payload.data.stage || 'running') : ty === 'tool.finished' && out && out !== 'ok' ? 'concerned' : S.sats[id].st;
      S.sats[id] = { st, summary: payload.data.summary };
      if (st === 'happy' || st === 'concerned') setTimeout(() => { if (S.sats[id].st === st) { S.sats[id] = { st: 'idle' }; renderTopbar(); } }, 2400);
      renderTopbar();
    }
    if (S.panel === 'agent') renderPanel();
  } else if (channel === 'file') {
    for (const tab of S.tabs) if (tab.kind === 'file' && tab.projectId === payload.projectId && tab.path === payload.path && payload.version !== tab.baseVersion && payload.by !== 'user') {
      if (!tab.dirty) reload(tab).catch(() => {}); else { tab.disk = payload; renderPanel(); }
    }
    clearTimeout(S.gitTimer); S.gitTimer = setTimeout(refreshGit, 400);
  } else if (channel === 'pty' && remoteTerms.has(payload.ptyId)) {
    const rt = remoteTerms.get(payload.ptyId); if (payload.data) rt.write(payload.data); if (payload.exit !== undefined) { rt.write(`\r\n[${rt.closedNote}]\r\n`); remoteTerms.delete(payload.ptyId); }
  } else if (channel === 'pty' && payload.ptyId === ptyId) {
    if (payload.data) term?.write(payload.data); if (payload.exit !== undefined) { term?.write('\r\n[exit]\r\n'); ptyExited(); }
  } else if (channel === 'pty') { earlyPty(payload);
  } else if (channel === 'node') { nodeView.invalidate(); if (S.view === 'node') renderCenter();
  } else if (channel === 'finance') { finView.onEvent(payload);
  } else if (channel === 'navigate') { if (payload.sessionId && S.sessions.some(x => x.sessionId === payload.sessionId)) openSession(payload.sessionId).then(renderShell, e => toast(errorText(e), true)); else { S.view = payload.view; renderShell(); } }
});
