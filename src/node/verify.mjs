import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execute } from './process.mjs';
import { nodeError } from './model.mjs';
export async function hashFile(file) { const h = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex'); }
export function signatures(status, allowed, minimum = 3) {
  if (!Number.isInteger(minimum) || minimum < 3) throw nodeError('INVALID_SIGNATURE_THRESHOLD');
  if (/\[GNUPG:\] (BADSIG|REVKEYSIG)/.test(status)) throw nodeError('INVALID_RELEASE_SIGNATURE');
  const invalid = new Set([...status.matchAll(/\[GNUPG:\] (?:EXPKEYSIG|EXPSIG) ([A-F0-9]+)/g)].map(x => x[1]));
  const unique = new Set();
  for (const line of status.split('\n')) {
    if (!line.startsWith('[GNUPG:] VALIDSIG ')) continue;
    const fields = line.slice(18).trim().split(/\s+/);
    const signer = fields[0]; const primary = fields[9] || signer;
    const expiry = Number(fields[3]);
    if (expiry && expiry < Date.now() / 1000) continue;
    if ([...invalid].some(x => signer.endsWith(x) || primary.endsWith(x))) continue;
    if (allowed.includes(primary)) unique.add(primary);
  }
  if (unique.size < minimum) throw nodeError('INSUFFICIENT_SIGNATURES', `${unique.size} valid independent signatures; ${minimum} required`);
  return [...unique];
}
export async function verifyRelease({ archive, sums, signature, keys, keyHome, minimum = 3 }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(keys, 'fingerprints.json'), 'utf8'));
  fs.mkdirSync(keyHome, { recursive: true, mode: 0o700 });
  for (const entry of manifest.keys) {
    const file = path.join(keys, entry.file);
    if (await hashFile(file) !== entry.sha256) throw nodeError('BUILDER_KEY_CHANGED');
    await execute('gpg', ['--batch', '--no-options', '--no-autostart', '--homedir', keyHome, '--import', file]);
  }
  // Missing keys or expired secondary signatures can make gpg return nonzero.
  let result;
  try { result = await execute('gpg', ['--batch', '--no-options', '--no-autostart', '--homedir', keyHome, '--status-fd', '1', '--verify', signature, sums]); }
  catch (e) { if (!e.stdout) throw e; result = e; }
  const valid = signatures(result.stdout, manifest.keys.flatMap(k => k.fingerprints), minimum);
  const filename = path.basename(archive);
  const matches = fs.readFileSync(sums, 'utf8').split('\n').map(l => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(l)).filter(x => x?.[2] === filename);
  if (matches.length !== 1 || await hashFile(archive) !== matches[0][1]) throw nodeError('ARCHIVE_HASH_MISMATCH');
  return { sha256: matches[0][1], fingerprints: valid, verifiedAt: new Date().toISOString() };
}
export function archiveEntries(listing, version) {
  const prefix = `bitcoin-${version}/`;
  for (const row of listing.trim().split('\n')) {
    const entry = row.trim().split(/\s+/).slice(5).join(' ');
    if (!/^[d-]/.test(row) || !entry.startsWith(prefix) || entry.split('/').some(x => x === '..') || /[\x00-\x1f]/.test(entry)) throw nodeError('UNSAFE_ARCHIVE');
  }
}
