import { createNodeService } from './service.mjs';
import { nodeError } from './model.mjs';
export const nodeToolSchemas = [
  { name: 'node_discover', mutating: false, description: 'Find same-user Bitcoin processes and default data directories. Candidates are not proof of RPC readiness; credentials and raw process arguments are excluded.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'node_status', mutating: false, description: 'Read local Bitcoin node instances, readiness and verification evidence. Never returns RPC cookies or database passwords.', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
  { name: 'node_plan', mutating: false, description: 'Inspect resources and preview a node installation. Does not install or modify services.', parameters: { type: 'object', properties: { id: { type: 'string' }, network: { type: 'string', enum: ['mainnet', 'signet', 'testnet4', 'mutinynet', 'testnet'] }, datadir: { type: 'string' }, profile: { type: 'string', enum: ['full', 'pruned'] }, explorer: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'node_action', mutating: true, serial: true, retryable: false, description: 'Request an approved node operation. Never self-approve. Dependencies need separate administrative authentication. Data is preserved.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['install', 'connect', 'adopt', 'start', 'stop', 'restart', 'update', 'uninstall'] }, id: { type: 'string' }, network: { type: 'string', enum: ['mainnet', 'signet', 'testnet4', 'mutinynet', 'testnet'] }, datadir: { type: 'string' }, profile: { type: 'string', enum: ['full', 'pruned'] }, explorer: { type: 'boolean' } }, required: ['action', 'id'], additionalProperties: false } },
];
export async function nodeToolCall(service, name, args, { approved = false } = {}) {
  if (name === 'node_discover') return service.discover();
  if (name === 'node_status') return args.id ? service.status(args.id) : service.list();
  if (name === 'node_plan') return service.plan(args);
  if (name !== 'node_action' || !approved) throw nodeError('NODE_APPROVAL_REQUIRED');
  const { action, ...input } = args;
  if (action === 'install') return service.install(input, { confirmed: true });
  if (action === 'connect' || action === 'adopt') return service.connect(input, { confirmed: true, adopt: action === 'adopt' });
  if (action === 'update') return service.update(input.id, { confirmed: true });
  return service.control(input.id, action, { confirmed: true });
}
export function nodeTools(service = createNodeService()) {
  return nodeToolSchemas.map(schema => ({ ...schema, run: (args, execution = {}) => { if (schema.mutating && typeof execution.approve !== 'function') throw nodeError('NODE_APPROVAL_REQUIRED'); return nodeToolCall(service, schema.name, args, { approved: schema.mutating === true }); } }));
}
