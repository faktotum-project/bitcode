import { satTools } from './sat-permissions.mjs';

export function satComputer(sat, tools, options = {}) {
  return {
    tools: satTools(sat, tools, options),
    wallet: 'deny',
    isolation: options.isolation === 'desktop' ? 'project sandbox' : 'CLI project permissions (not an OS sandbox)',
    workspaceAccess: 'metadata only; project tools retain their existing scope',
  };
}
