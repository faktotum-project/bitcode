import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig, saveConfig } from '../config.mjs';
import { createNodeService } from './service.mjs';
import { nodeError } from './model.mjs';
export function parseNodeArgs(args) {
  const action = args[0] || 'status';
  if (!['install', 'connect', 'adopt', 'status', 'doctor', 'list', 'commands', 'environment', 'discover', 'plan', 'dependencies', 'start', 'stop', 'restart', 'update', 'uninstall', 'use', 'recover'].includes(action)) throw nodeError('INVALID_NODE_ACTION', action);
  const input = {}; let json = false; let yes = false;
  for (let n = 1; n < args.length; n++) {
    const key = args[n];
    if (key === '--json') json = true;
    else if (key === '--yes') yes = true;
    else if (key === '--explorer') input.explorer = true;
    else if (['--id', '--network', '--profile', '--datadir', '--rpc-port'].includes(key)) {
      if (!args[n + 1] || args[n + 1].startsWith('--')) throw nodeError('MISSING_ARGUMENT', key);
      input[{ '--rpc-port': 'rpcPort' }[key] || key.slice(2)] = args[++n];
    } else if (key === '--services') input.services = (args[++n] || '').split(',');
    else throw nodeError('INVALID_ARGUMENT', key);
  }
  return { action, input, json, yes };
}
export async function nodeCLI(args, { service, print = console.log, progress = event => process.stderr.write(JSON.stringify(event) + '\n') } = {}) {
  service ??= createNodeService({ emit: (_, event) => progress({ type: 'node.progress', ...event }) });
  if (args.includes('--help') || args[0] === 'help') { print('bitcode node install|connect|adopt|status|doctor|list|discover|plan|commands|dependencies|start|stop|restart|update|uninstall|use|recover [--id NAME] [--network mainnet|signet|testnet4|mutinynet|testnet] [--datadir DIR] [--profile full|pruned] [--explorer] [--json] [--yes]'); return; }
  let { action, input, json, yes } = parseNodeArgs(args);
  let rl;
  const ask = async (prompt, fallback = '') => {
    if (!stdin.isTTY) throw nodeError('INTERACTIVE_INPUT_REQUIRED', 'Use explicit options and --yes after reviewing node plan.');
    rl ??= createInterface({ input: stdin, output: stdout }); const value = (await rl.question(`${prompt}${fallback ? ` [${fallback}]` : ''}: `)).trim(); return value || fallback;
  };
  try {
    if (['install', 'connect', 'adopt'].includes(action) && !input.network && !yes) {
      input.network = await ask('Network: mainnet, signet, testnet4, mutinynet (experimental)', 'mainnet');
      input.id = await ask('Instance ID', input.network);
      input.datadir = await ask('Absolute data directory (empty = default)') || undefined;
      if (action === 'install') {
        input.profile = await ask('Storage: full or pruned', 'full');
        input.explorer = input.profile === 'full' && (await ask('Install bitcode explorer? yes/no', 'no')) === 'yes';
      }
    }
    const id = input.id || input.network || 'mainnet';
    let result;
    if (action === 'plan') result = await service.plan(input);
    else if (action === 'discover') result = service.discover();
    else if (action === 'environment') result = await service.environment(input.datadir);
    else if (action === 'commands') result = service.commands(input);
    else if (action === 'list') result = service.list();
    else if (['status', 'doctor'].includes(action)) result = await service[action](id);
    else {
      if (action === 'install' && yes) { const preview = await service.plan(input); for (const warning of preview.warnings || []) progress({ type: 'node.warning', id, warning }); }
      if (!yes) {
        const review = action === 'install' ? await service.plan(input) : { action, id, input, dataPreserved: true };
        print(JSON.stringify(review, null, 2));
        if (review.errors?.length) throw nodeError('PREFLIGHT_FAILED', review.errors.join(', '));
        yes = (await ask('Approve these changes? yes/no', 'no')) === 'yes';
      }
      if (!yes) throw nodeError('CONFIRMATION_REQUIRED');
      if (action === 'install') result = await service.install(input, { confirmed: true });
      else if (action === 'connect' || action === 'adopt') result = await service.connect(input, { confirmed: true, adopt: action === 'adopt' });
      else if (action === 'use') { const connection = await service.connection(id); const config = loadConfig(); config.bitcoin = { ...config.bitcoin, ...connection }; if (!connection.esploraUrl) delete config.bitcoin.esploraUrl; saveConfig(config); result = { selected: id, ...connection, scope: connection.esploraUrl ? 'Local RPC and local explorer' : 'Local RPC; explorer-based lookups use the selected network default' }; }
      else if (action === 'recover') result = await service.recover(id, { confirmed: true });
      else if (action === 'dependencies') result = await service.dependencies(input);
      else if (action === 'update') result = await service.update(id, { confirmed: true });
      else result = await service.control(id, action, { confirmed: true });
    }
    print(JSON.stringify(result, null, json ? 0 : 2)); return result;
  } finally { rl?.close(); }
}
