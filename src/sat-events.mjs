export const SAT_STATES = Object.freeze(['idle', 'thinking', 'planning', 'reading', 'running', 'writing', 'delegating', 'waiting_approval', 'success', 'error']);
export function satEvents(event) {
  const map = { 'run.started': 'sat:start', 'tool.started': 'tool:start', 'tool.finished': 'tool:end', 'approval.requested': 'approval:required', 'approval.resolved': 'approval:resolved', 'run.finished': 'sat:end' };
  const state = event.type === 'run.finished' ? (event.data.outcome === 'ok' ? 'success' : event.data.outcome === 'cancelled' ? 'idle' : 'error')
    : event.type === 'approval.requested' ? 'waiting_approval'
    : event.type === 'tool.started' ? (event.data.tool === 'sat_delegate' ? 'delegating' : event.data.stage === 'drafting' ? 'writing' : event.data.stage || 'running')
    : 'thinking';
  // Never forward arbitrary payloads from providers, tools or manifests.
  const base = { v: 1, at: event.at, runId: event.runId, sessionId: event.sessionId, satId: event.agentId, parentRunId: event.parentRunId, state };
  const result = map[event.type] ? [{ ...base, type: map[event.type] }] : [];
  if (event.parentRunId && ['run.started', 'run.finished'].includes(event.type)) result.push({ ...base, type: event.type === 'run.started' ? 'delegation:start' : 'delegation:end' });
  if (state === 'error' && event.type === 'run.finished') result.push({ ...base, type: 'sat:error' });
  if (['run.started', 'run.finished', 'model.started', 'tool.started', 'tool.finished', 'approval.requested', 'approval.resolved'].includes(event.type)) result.push({ ...base, type: 'sat:state' });
  return result;
}
