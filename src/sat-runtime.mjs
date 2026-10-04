import { runAgent } from './agent.mjs';
import { createRunContext, createEventBus } from './runtime/events.mjs';
import { findSat, loadSats } from './sats.mjs';
import { satComputer } from './sat-computer.mjs';
import { satWorkspace, recordSatRun } from './sat-workspace.mjs';
import { satEvents } from './sat-events.mjs';

export async function runSat({ satId, registry = loadSats(), persistence = true, home, onSatEvent, guardedTools = false, ...options }) {
  const sat = findSat(satId, registry);
  const context = createRunContext({ ...options.context, agentId: sat.id });
  context.bus ||= createEventBus();
  if ((context.depth || 0) > 1) throw new Error('Sat Delegation depth exceeded');
  if (persistence) satWorkspace(sat.id, { home });
  const state = options.state || { totalToolCalls: 0 };
  const available = options.tools.filter(t => !['subagent', 'sat_delegate'].includes(t.name));
  if (sat.id === 'merkle' && !context.parentRunId) available.push({
    name: 'sat_delegate', serial: true, mutating: false, retryable: false,
    description: 'Delegate a focused task to NODE, SCRIPT or HASH. Each Sat retains its own permissions and approval gates. Return to Merkle to synthesize the result.',
    parameters: { type: 'object', properties: { agent: { type: 'string', enum: ['node', 'script', 'hash'] }, prompt: { type: 'string', minLength: 1 } }, required: ['agent', 'prompt'], additionalProperties: false },
    run: async ({ agent, prompt }) => {
      if (!['node', 'script', 'hash'].includes(agent) || !prompt.trim()) throw new Error('Invalid Sat Delegation');
      return runSat({ ...options, satId: agent, registry, persistence, home, state, guardedTools,
        target: options.targetForSat?.(agent) || options.target,
        messages: [{ role: 'user', content: prompt }],
        hooks: { approve: options.hooks?.approve, onMutation: options.hooks?.onMutation, askUser: options.hooks?.askUser, onUsage: options.hooks?.onUsage, onFallback: options.hooks?.onFallback },
        context: { ...context, runId: undefined, parentRunId: context.runId, depth: 1 },
      });
    },
  });
  const computer = satComputer(sat, available, { readOnly: options.readOnly });
  if (!guardedTools && !options.hooks?.approve) computer.tools = computer.tools.filter(t => !['write_file', 'edit_file', 'bash'].includes(t.name));
  let outcome = 'error';
  const unsubscribe = context.bus.subscribe(event => {
    if (event.runId === context.runId && event.type === 'run.finished') outcome = event.data.outcome === 'ok' ? 'success' : event.data.outcome === 'cancelled' ? 'idle' : 'error';
    if (onSatEvent) for (const projected of satEvents(event)) onSatEvent(projected);
  });
  try {
    return await runAgent({ ...options, context, state, tools: computer.tools,
      system: `${options.system || ''}\n\nSat Identity: ${sat.name}. Role: ${sat.role}.\n${sat.body}\nOnly the provided tools are available. Never claim unavailable capabilities. Wallet tools are denied.`,
    });
  } finally {
    unsubscribe();
    if (persistence) recordSatRun(sat.id, { state: outcome }, { home, cwd: context.cwd });
  }
}
