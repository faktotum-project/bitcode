import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SAT_IDS } from './sats/policy.mjs';

export { SAT_IDS };
// Deliberately small YAML subset: scalars, string lists and one-level maps.
// No aliases, tags, interpolation, executable configuration or dependencies.
export function parseSatManifest(source) {
  if (typeof source !== 'string' || source.length > 65536) throw new Error('Invalid Sat Manifest size');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Sat Manifest requires frontmatter');
  const meta = Object.create(null); let section;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^([a-z]+):(?: (.+))?$/))) {
      if (Object.hasOwn(meta, m[1])) throw new Error('Duplicate Sat Manifest field');
      section = m[1]; meta[section] = m[2] ?? (['tools', 'capabilities'].includes(section) ? [] : Object.create(null));
    } else if ((m = line.match(/^  - ([a-z][a-z0-9_-]*)$/)) && Array.isArray(meta[section])) meta[section].push(m[1]);
    else if ((m = line.match(/^  ([a-z]+): ([a-z]+)$/)) && meta[section] && typeof meta[section] === 'object' && !Array.isArray(meta[section])) {
      if (Object.hasOwn(meta[section], m[1])) throw new Error('Duplicate Sat Manifest permission');
      meta[section][m[1]] = m[2];
    } else throw new Error(`Unsupported Sat Manifest syntax: ${line}`);
  }
  const fields = ['id', 'name', 'version', 'role', 'capabilities', 'tools', 'permissions', 'workspace', 'ui'];
  if (Object.keys(meta).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(meta, k))) throw new Error('Invalid Sat Manifest fields');
  if (!SAT_IDS.includes(meta.id) || meta.version !== '1' || typeof meta.name !== 'string' || typeof meta.role !== 'string' || !Array.isArray(meta.tools) || !Array.isArray(meta.capabilities)) throw new Error('Invalid Sat Identity');
  const choices = { filesystem: ['deny', 'read', 'write'], shell: ['deny', 'approval'], network: ['deny', 'allow'], wallet: ['deny'], delegation: ['deny', 'allow'] };
  if (Object.keys(meta.permissions).some(k => !Object.hasOwn(choices, k)) || Object.entries(choices).some(([k, v]) => !v.includes(meta.permissions[k]))) throw new Error('Invalid Sat Permissions');
  if (meta.workspace.persistent !== 'true' || Object.keys(meta.workspace).length !== 1 || meta.ui.avatar !== meta.id || Object.keys(meta.ui).length !== 1) throw new Error('Invalid Sat Workspace or avatar');
  return { ...meta, version: 1, body: match[2].trim() };
}

export function loadSats({ directory = fileURLToPath(new URL('../sats/', import.meta.url)) } = {}) {
  return SAT_IDS.map(id => {
    const sat = parseSatManifest(readFileSync(path.join(directory, id, 'SAT.md'), 'utf8'));
    if (sat.id !== id) throw new Error('Sat Manifest identity mismatch');
    return sat;
  });
}
export function findSat(id, registry = loadSats()) {
  const sat = registry.find(s => s.id === id);
  if (!sat) throw new Error(`Unknown Sat: ${id}`);
  return sat;
}
