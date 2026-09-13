// Run real bitcode model/tool loops and retain timestamped evidence outside the site.
// Usage: node scripts/demos/record.mjs /absolute/output-dir [provider/model]
import { readFile, writeFile, mkdir, cp, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runAgent } from '../../src/agent.mjs';
import { buildTools } from '../../src/tools.mjs';
import { mcpTools } from '../../src/mcp.mjs';
import { resolveModel, loadConfig } from '../../src/config.mjs';
import { closeProcesses } from '../../src/processes.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'bitcode-demo-recordings'));
if (output === repo || output.startsWith(repo + path.sep)) throw new Error('Keep raw captures outside the public static site.');
const spec = process.argv[3] || 'ollama/qwen3.8:27b';
const only = process.argv[4];
const target = resolveModel({ config: loadConfig(), cliModel: spec });
const fixture = await mkdtemp(path.join(os.tmpdir(), 'bitcode-demo-fixture-'));
await cp(path.join(repo, 'scripts/demos/fixtures'), fixture, { recursive: true });
await mkdir(output, { recursive: true });
process.env.BITCODE_HOME = path.join(fixture, '.state');
process.chdir(fixture);
execFileSync('git', ['init', '-q']);
execFileSync('git', ['add', '.']);
const clean = value => JSON.parse(JSON.stringify(value).replaceAll(fixture, '[demo-project]').replaceAll(repo, '[bitcode-source]'));
const skills = [{ name: 'fee-review', file: path.join(fixture, 'skills/fee-review/SKILL.md'), description: 'Review the demo fee estimator against MCP release requirements.' }];
const config = { bitcoin: { network: 'mainnet' } };
const catalog = buildTools(config, { skills });
const selected = names => catalog.filter(t => names.includes(t.name)).map(t => ({ ...t, run: async (args, context) => {
  if (args.path && !path.resolve(args.path).startsWith(fixture + path.sep)) throw new Error('Demo paths must stay in the fixture.');
  if (t.name === 'bash' && args.command !== 'node --test fee.test.mjs') throw new Error('Only the fixture test command is allowed.');
  if (args.cwd && path.resolve(args.cwd) !== fixture) throw new Error('Demo cwd must stay in the fixture.');
  return t.run(args, context);
} }));
const base = { version: JSON.parse(await readFile(path.join(repo, 'package.json'))).version, requestedModel: spec, model: target.spec, providerHost: new URL(target.provider.baseURL).hostname, gitBase: execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeModified: true, recordingMethod: 'Real bitcode runAgent hooks; output replay with edited timing', fixture: 'Public demo fixture; initial rounding bug is intentional', source: 'scripts/demos/fixtures', modelAttestation: 'Configured model ID; independent backend identity attestation unavailable' };
async function record(id, prompt, tools, readOnly = false) {
  const started = Date.now(); const events = [];
  const event = (type, data) => { const e = clean({ time: (Date.now() - started) / 1000, type, ...data }); events.push(e); writeFileSync(path.join(output, `${id}.partial.json`), JSON.stringify({ ...base, id, status: 'running', recordedAt: new Date(started).toISOString(), events }, null, 2)); console.log(id, type, data.name || ''); };
  event('request', { text: prompt });
  let status = 'complete'; let error;
  const messages = [{ role: 'user', content: prompt }];
  try {
    await runAgent({ target, messages, system: 'You are bitcode, a coding and Bitcoin agent. This is a recorded real demonstration in a public disposable fixture. Use the available tools to complete the requested task. Follow the requested sequence once, avoid repeated reads, and keep the final answer under 80 words. Do not use external paths. Never invent tool results. Stop after comparing the requirements with the evidence.', tools, readOnly, limits: { maxSteps: 12, maxTotalToolCalls: 18, maxParallelTools: 2 }, signal: AbortSignal.timeout(600000), hooks: {
      approve: async tc => { event('approval', { name: tc.name, text: 'Authorized in this disposable demo fixture' }); return true; },
      onToolStart: tc => event('tool_start', { name: tc.name, args: tc.args }),
      onToolEnd: (tc, result) => event('tool_end', { name: tc.name, result }),
      onAssistantEnd: text => { if (text) event('assistant', { text }); },
    } });
    if (messages.at(-1)?.content?.startsWith('[stopped:')) status = 'incomplete';
  } catch (e) { status = 'error'; error = e.message; event('error', { text: error }); }
  const capture = { ...base, id, status, error, recordedAt: new Date(started).toISOString(), elapsedSeconds: (Date.now() - started) / 1000, events, messages: clean(messages) };
  await writeFile(path.join(output, `${id}.json`), JSON.stringify(capture, null, 2));
  if (status !== 'complete') throw new Error(`${id}: ${status}; evidence saved.`);
  return capture;
}
try {
  if (!only || only === 'code-review') {
  const code = await record('code-review', 'This public fixture contains an intentional rounding bug. Read fee.mjs and fee.test.mjs. Run exactly `node --test fee.test.mjs` to observe the failure. Fix only fee.mjs using edit_file, then run the same tests to verify the correction. Summarize the result.', selected(['read_file', 'edit_file', 'bash']));
  if (!code.events.some(e => e.type === 'tool_end' && e.name === 'edit_file')) throw new Error('No actual edit captured.');
  const finalTest = code.events.filter(e => e.type === 'tool_end' && e.name === 'bash').at(-1);
  if (!finalTest || !/pass 2/.test(finalTest.result) || !/fail 0/.test(finalTest.result)) throw new Error('Final passing tests missing.');
  }
  if (!only || only === 'bitcoin-fees') await record('bitcoin-fees', 'Call btc_fees and btc_mempool once each for mainnet. Report the observed fee rates and mempool count in a short summary. These are a recorded snapshot, not a live dashboard. Do not initiate transactions.', selected(['btc_fees', 'btc_mempool']), true);
  if (!only || only === 'mcp-skills') {
  const mcp = await mcpTools({ mcp: { project: { command: process.execPath, args: [path.join(repo, 'scripts/demos/project-mcp.mjs'), fixture], negotiation: 'legacy', trustReadOnlyAnnotations: true, allowedTools: ['release_requirements'] } } });
  try {
    if (!mcp.servers[0]?.ok) throw new Error('MCP connection failed');
    const capture = await record('mcp-skills', 'Load the fee-review skill with read_skill. Follow it: call mcp_project_release_requirements, read fee.mjs and fee.test.mjs, then compare both rounding requirements to the actual code and tests. Do not edit or run commands. Give a short evidence-based review.', [...selected(['read_file', 'read_skill']), ...mcp.tools.filter(t => t.name === 'mcp_project_release_requirements')], true);
    if (!capture.events.some(e => e.type === 'tool_end' && e.name === 'mcp_project_release_requirements') || !capture.events.some(e => e.type === 'tool_end' && e.name === 'read_skill')) throw new Error('MCP/skill evidence missing.');
  } finally { await mcp.close(); }
  }
} finally { await closeProcesses(); }
console.log('Captures complete:', output);
