// Attachments: drag and drop, paste, or pick files and folders.
import { json } from '@codemirror/lang-json';
import { t, errorText } from './i18n.js';
import { icon } from './icons.js';
import { renderComposer } from './composer.js';
import { $, api, guard, h, toast, wlang } from './dom.js';
import { md } from './reading.js';
import { S } from './state.js';

// ---------- attachments: drag & drop, paste, or pick files / folders ----------
export const KIND_ICON = { folder: '📁', image: '🖼', pdf: '📕', text: '📄', archive: '🗜', audio: '🎵', video: '🎞', file: '📎' };
export const fmtSize = n => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`).replace('.', wlang() === 'it' ? ',' : '.');
export const kindFor = (name, isDir) => (isDir ? 'folder' : /\.(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/i.test(name) ? 'image' : /\.pdf$/i.test(name) ? 'pdf' : /\.(zip|tar|gz|tgz|7z|rar|xz|bz2)$/i.test(name) ? 'archive'
  : /\.(mp3|wav|flac|ogg|m4a)$/i.test(name) ? 'audio' : /\.(mp4|mov|mkv|webm|avi)$/i.test(name) ? 'video' : /\.(txt|md|json|ya?ml|toml|csv|log|xml|html?|css|m?[jt]sx?|py|rs|go|java|sh|sql|c|h|cpp)$/i.test(name) ? 'text' : 'file');
export function addAttachments(items, skipped = []) {
  for (const it of items) S.attachments.push(it);
  if (skipped.length) toast(`${skipped.length} ${t('attachSkipped')}: ${skipped.slice(0, 3).map(x => x.name).join(', ')}`, true);
  renderComposer();
}
export const pickAttachments = guard(async kind => {
  if (!S.projectId) return toast(t('noProject'), true);
  const r = await api('attach.pick', { projectId: S.projectId, kind }); addAttachments(r.items, r.skipped);
});
// Folder drops are walked in the UI (webkitGetAsEntry) and sent file by file, so the main process never trusts a path from the page.
export const readEntries = dir => new Promise((resolve, reject) => { const all = [], r = dir.createReader(); (function next() { r.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject); })(); });
export const fileOf = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
async function* walkEntry(entry, prefix) {
  if (entry.isFile) yield { rel: `${prefix}${entry.name}`, file: await fileOf(entry) };
  else if (entry.isDirectory) for (const child of await readEntries(entry)) yield* walkEntry(child, `${prefix}${entry.name}/`);
}
export const importDropped = guard(async dataTransfer => {
  if (!S.projectId) return toast(t('noProject'), true);
  const roots = [...(dataTransfer.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const plain = roots.length ? null : [...(dataTransfer.files || [])].map(f => ({ isFile: true, isDirectory: false, name: f.name, file: cb => cb(f) }));
  toast(t('attachBusy'));
  const items = [], skipped = [];
  for (const entry of plain || roots) {
    const group = crypto.randomUUID(); let top = null, count = 0, size = 0, finalTop = null;
    try {
      for await (const { rel, file } of walkEntry(entry, '')) {
        const res = await api('attach.put', { projectId: S.projectId, group, top: entry.name, rel, data: new Uint8Array(await file.arrayBuffer()) });
        finalTop = res.top; count++; size += res.size;
      }
    } catch (e) { skipped.push({ name: entry.name, reason: e.code }); if (['TOO_LARGE', 'TOO_MANY'].includes(e.code)) toast(errorText(e), true); }
    if (finalTop) items.push({ name: finalTop, rel: `allegati/${finalTop}`, isDir: !!entry.isDirectory, files: count, size, kind: kindFor(entry.name, entry.isDirectory) });
  }
  addAttachments(items, skipped.filter(x => !['TOO_LARGE', 'TOO_MANY'].includes(x.reason)));
});
export const dropzone = h('div', { class: 'dropzone', hidden: true }, h('div', { class: 'dropcard' }, icon('paperclip', { size: 28 }), h('div', {}, t('dropHint'))));
document.body.append(dropzone);
export let dragDepth = 0;
export const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', e => { if (!hasFiles(e) || S.view !== 'chat' || !S.projectId) return; e.preventDefault(); dragDepth++; dropzone.querySelector('.dropcard div').textContent = t('dropHint'); dropzone.hidden = false; });
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.hidden = true; });
document.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; dropzone.hidden = true; if (S.view === 'chat' && S.projectId) importDropped(e.dataTransfer); });
export const attachmentLines = () => S.attachments.map(a => `📎 ${a.rel}${a.isDir ? '/' : ''} · ${t(`kind_${a.kind}`)}${a.isDir ? ` · ${a.files} ${t('filesN')}` : ''} · ${fmtSize(a.size)}`).join('\n');
export function attachmentChips() {
  if (!S.attachments.length) return null;
  return h('div', { class: 'attachments' }, S.attachments.map((a, i) => h('span', { class: 'achip', title: `${a.rel}${a.isDir ? '/' : ''}` },
    h('span', { class: 'aicon' }, KIND_ICON[a.kind] || '📎'), h('span', { class: 'aname' }, a.name), h('span', { class: 'asize num' }, a.isDir ? `${a.files} · ${fmtSize(a.size)}` : fmtSize(a.size)),
    h('button', { type: 'button', class: 'ax', 'aria-label': t('attachRemove'), title: t('attachRemove'), onClick: guard(async () => { await api('attach.remove', { projectId: S.projectId, top: a.name }).catch(() => {}); S.attachments.splice(i, 1); renderComposer(); }) }, '×'))));
}
