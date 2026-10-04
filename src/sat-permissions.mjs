import { POLICIES } from './sats/policy.mjs';

export function satTools(sat, tools, { readOnly = false } = {}) {
  if (!Object.hasOwn(POLICIES, sat.id)) throw new Error('Unknown Sat policy');
  const ceiling = [...POLICIES[sat.id], ...(sat.id === 'merkle' ? ['sat_delegate'] : [])];
  return tools.filter(tool => {
    if (!ceiling.includes(tool.name) || !sat.tools.includes(tool.name) || tool.financial) return false;
    const p = sat.permissions;
    if (['read_file', 'list_dir'].includes(tool.name) && p.filesystem === 'deny') return false;
    if (['write_file', 'edit_file'].includes(tool.name) && (p.filesystem !== 'write' || readOnly)) return false;
    if (tool.name === 'bash' && (p.shell !== 'approval' || readOnly)) return false;
    if (tool.name === 'sat_delegate') return p.delegation === 'allow';
    if (/^(btc_|liquid_|ln_|taproot_)/.test(tool.name) && tool.name !== 'ln_decode_invoice' && p.network !== 'allow') return false;
    return true;
  });
}
