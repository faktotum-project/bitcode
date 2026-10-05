// Files and folders the user shares in a chat. They are copied into the project's
// allegati/ folder (never overwriting anything), so the agent can reach them with its
// normal, approval-gated tools. Pure Node, no Electron: the callers decide where the
// bytes come from (a native picker in the main process, or a drag/paste in the UI).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const FOLDER = 'allegati';
const MiB = 1024 * 1024;
export const LIMITS = Object.freeze({ file: 50 * MiB, total: 200 * MiB, files: 1500 });
const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '__pycache__', '.DS_Store']);

// One safe path segment: no separators, no control characters, no dot-only names, bounded length.
export function safeSegment(name, fallback = 'file') {
  let s = String(name ?? '').replace(/[\u0000-\u001f\u007f<>:"|?*\\/]/g, '_').trim().replace(/^\.+$/, '');
  if (s.length > 120) { const ext = path.extname(s).slice(0, 12); s = s.slice(0, 120 - ext.length) + ext; }
  return s || fallback;
}
// A relative path inside a shared folder ("src/a/b.txt"): every segment sanitized, ".." refused.
export function safeRelative(rel) {
  const parts = String(rel ?? '').split(/[\\/]/).filter(p => p && p !== '.');
  if (!parts.length || parts.some(p => p === '..')) throw Object.assign(new Error('Invalid path'), { code: 'INVALID_PATH' });
  return parts.map(p => safeSegment(p));
}
const within = (root, target) => { const r = path.relative(root, target); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// "name.pdf" -> "name (2).pdf" when taken. Applies to the top-level item only.
export function uniqueTop(dir, name) {
  if (!existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 10_000; i++) { const candidate = `${base} (${i})${ext}`; if (!existsSync(path.join(dir, candidate))) return candidate; }
  throw Object.assign(new Error('Too many copies'), { code: 'INVALID_PATH' });
}
const KINDS = { text: /\.(txt|md|json|ya?ml|toml|ini|csv|tsv|log|xml|html?|css|m?[jt]sx?|py|rs|go|java|kt|c|h|cpp|hpp|sh|sql|conf|env|lock)$/i, image: /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic|avif)$/i,
  pdf: /\.pdf$/i, archive: /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, audio: /\.(mp3|wav|flac|ogg|m4a)$/i, video: /\.(mp4|mov|mkv|webm|avi)$/i };
export const kindOf = (name, isDir = false) => (isDir ? 'folder' : Object.entries(KINDS).find(([, re]) => re.test(name))?.[0] || 'file');

export function createAttachments(root, { limits = LIMITS } = {}) {
  const base = path.join(root, FOLDER), created = new Set(); // only what this app created can be removed again
  const groups = new Map(); // drag group id -> final top-level name
  let total = 0, files = 0;
  const reserve = size => {
    if (size > limits.file) throw Object.assign(new Error('File too large'), { code: 'TOO_LARGE' });
    if (total + size > limits.total) throw Object.assign(new Error('Attachments too large'), { code: 'TOO_LARGE' });
    if (files + 1 > limits.files) throw Object.assign(new Error('Too many files'), { code: 'TOO_MANY' });
    total += size; files++;
  };
  const ensureBase = () => { mkdirSync(base, { recursive: true }); if (!within(realpathSync(root), realpathSync(base))) throw Object.assign(new Error('Symlink escape'), { code: 'SYMLINK_ESCAPE' }); };

  return {
    // Bytes that came from a drag/paste in the UI. `group` ties files of one dropped folder together.
    put({ group, top, rel, bytes }) {
      ensureBase();
      const segments = safeRelative(rel), isDir = segments.length > 1;
      let finalTop = groups.get(group);
      if (!finalTop) { finalTop = uniqueTop(base, safeSegment(top ?? segments[0])); groups.set(group, finalTop); created.add(finalTop); }
      const inner = isDir ? segments.slice(1) : [];
      const target = path.join(base, finalTop, ...inner);
      if (!isDir) { /* a single file: the group top IS the file */ }
      const file = isDir ? target : path.join(base, finalTop);
      if (!within(base, file)) throw Object.assign(new Error('Invalid path'), { code: 'INVALID_PATH' });
      const size = bytes.byteLength ?? bytes.length; reserve(size);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(bytes), { flag: 'wx' });
      return { top: finalTop, rel: `${FOLDER}/${finalTop}${isDir ? '/' + inner.join('/') : ''}`, size };
    },
    // Paths chosen in a native dialog (main process only). Files and whole folders.
    importPaths(paths) {
      ensureBase(); const items = [], skipped = [];
      for (const source of paths) {
        let st; try { st = lstatSync(source); } catch { skipped.push({ name: path.basename(source), reason: 'unreadable' }); continue; }
        if (st.isSymbolicLink()) { skipped.push({ name: path.basename(source), reason: 'symlink' }); continue; }
        const name = uniqueTop(base, safeSegment(path.basename(source))); created.add(name);
        if (st.isFile()) {
          try { reserve(st.size); copyFileSync(source, path.join(base, name)); items.push({ name, rel: `${FOLDER}/${name}`, isDir: false, files: 1, size: st.size, kind: kindOf(name) }); }
          catch (e) { skipped.push({ name, reason: e.code || 'error' }); created.delete(name); }
        } else if (st.isDirectory()) {
          let count = 0, size = 0;
          const walk = (dir, out) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
              if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
              const from = path.join(dir, entry.name), to = path.join(out, safeSegment(entry.name));
              if (entry.isDirectory()) { mkdirSync(to, { recursive: true }); walk(from, to); }
              else if (entry.isFile()) {
                const s = statSync(from);
                try { reserve(s.size); } catch (e) { skipped.push({ name: path.relative(source, from), reason: e.code }); if (e.code === 'TOO_MANY') return; continue; }
                copyFileSync(from, to); count++; size += s.size;
              }
            }
          };
          mkdirSync(path.join(base, name), { recursive: true }); walk(source, path.join(base, name));
          items.push({ name, rel: `${FOLDER}/${name}`, isDir: true, files: count, size, kind: 'folder' });
        } else skipped.push({ name: path.basename(source), reason: 'special' });
      }
      return { items, skipped };
    },
    // Undo an attachment before it was sent. Only items created by this app, only inside allegati/.
    remove(top) {
      const name = safeSegment(top);
      if (!created.has(name)) throw Object.assign(new Error('Not an attachment of this app'), { code: 'PATH_DENIED' });
      const target = path.join(base, name); if (!within(base, target) || target === base) throw Object.assign(new Error('Invalid path'), { code: 'INVALID_PATH' });
      rmSync(target, { recursive: true, force: true }); created.delete(name);
      for (const [g, n] of groups) if (n === name) groups.delete(g);
      return true;
    }
  };
}
