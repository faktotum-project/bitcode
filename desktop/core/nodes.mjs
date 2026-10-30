import { createNodeService } from '../../src/node/service.mjs';
import { loadConfig, saveConfig } from '../../src/config.mjs';
import { randomUUID } from 'node:crypto';
export function createNodes({ home, emit = () => {}, service = createNodeService({ home, emit }) } = {}) {
  const jobs = new Map();
  const start = (action, input = {}) => {
    const jobId = randomUUID(); const job = { jobId, action, id: input.id || input.network || 'mainnet', status: 'running', startedAt: Date.now() }; jobs.set(jobId, job);
    Promise.resolve().then(() => {
      if (action === 'install') return service.install(input, { confirmed: true });
      if (action === 'connect' || action === 'adopt') return service.connect(input, { confirmed: true, adopt: action === 'adopt' });
      if (action === 'dependencies') return service.dependencies(input);
      if (action === 'use') return service.connection(input.id).then(connection => { const config = loadConfig(); config.bitcoin = { ...config.bitcoin, ...connection }; if (!connection.esploraUrl) delete config.bitcoin.esploraUrl; saveConfig(config); return { selected: input.id, ...connection }; });
      if (action === 'recover') return service.recover(input.id, { confirmed: true });
      if (action === 'update') return service.update(input.id, { confirmed: true });
      return service.control(input.id, action, { confirmed: true });
    }).then(result => { job.status = 'complete'; job.result = result; }, error => { job.status = 'error'; job.error = { code: error.code || 'NODE_FAILED', message: error.message }; }).finally(() => { job.finishedAt = Date.now(); emit('node', { ...job }); });
    return { ...job };
  };
  return { service, start, methods: {
    'node.discover': () => service.discover(),
    'node.list': () => service.list(),
    'node.environment': args => service.environment(args.datadir),
    'node.plan': args => service.plan(args),
    'node.status': ({ id }) => service.status(id),
    'node.doctor': ({ id }) => service.doctor(id),
    'node.commands': args => service.commands(args),
    'node.jobs': () => [...jobs.values()].slice(-100).map(j => ({ ...j })),
    'node.execute': ({ action, input, confirmed }) => {
      if (confirmed !== true) throw new Error('Explicit user confirmation required');
      if (!['install', 'connect', 'adopt', 'dependencies', 'start', 'stop', 'restart', 'update', 'uninstall', 'use', 'recover'].includes(action)) throw new Error('Invalid node action');
      return start(action, input);
    },
  } };
}
