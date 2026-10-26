// Electron-free desktop shell policy: crash recovery, window geometry, tray
// summary and XDG autostart. main.mjs wires these to Electron objects.
import path from 'node:path';

export const HIDDEN_ARG = '--hidden';
export const MIN_WINDOW = { width: 980, height: 620 };

// Renderer crashes: reload twice within the window, then stop and ask, so a
// page that crashes on load cannot loop forever.
const RECOVERABLE = new Set(['abnormal-exit', 'crashed', 'oom', 'memory-eviction']);
export function createCrashPolicy({ now = Date.now, windowMs = 120_000, reloads = 2 } = {}) {
  let last = -Infinity, streak = 0;
  return {
    next(reason) {
      if (!RECOVERABLE.has(reason)) return 'ignore';
      const t = now(); streak = t - last < windowMs ? streak + 1 : 1; last = t;
      return streak <= reloads ? 'reload' : 'stop';
    },
    reset() { last = -Infinity; streak = 0; }
  };
}

// Saved bounds are reused only when the window still intersects a display's
// work area by a usable amount; otherwise the window manager places it.
export function restoreBounds(saved, workAreas) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
  const width = Math.max(MIN_WINDOW.width, Math.round(saved.width)), height = Math.max(MIN_WINDOW.height, Math.round(saved.height));
  const bounds = { x: Math.round(saved.x), y: Math.round(saved.y), width, height };
  const visible = (workAreas || []).some(a => {
    const w = Math.min(bounds.x + width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + height, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= 200 && h >= 100;
  });
  return visible ? { ...bounds, maximized: saved.maximized === true } : null;
}

const clip = (text, max) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

// Tray content. Approvals only navigate: the decision always happens in the
// window, where the full subject and digest are shown.
// Words of the main process (tray, dialogs, notifications): English unless the app language is Italian.
const MAIN_WORDS = {
  en: { runs: n => `${n} ${n === 1 ? 'run' : 'runs'}`, requests: n => `${n} ${n === 1 ? 'request' : 'requests'}`, hide: 'Hide bitcode', open: 'Open bitcode', mini: 'New mini chat',
    pending: 'Pending requests', more: n => `${n} more…`, running: n => `${n} running`, idle: 'Nothing running', cancel: label => `Cancel: ${label}`, quit: 'Quit',
    reload: 'Reload', crashTitle: 'The bitcode window keeps closing', crashDetail: reason => `Reason: ${reason}. Running work continues in the main process.`,
    cancelBtn: 'Cancel', quitRuns: 'Stop running work and quit', quitDetail: 'Quitting stops running work; it does not resume automatically.',
    approval: 'bitcode · approval requested', runDone: ok => `bitcode · run ${ok ? 'finished' : 'failed'}` },
  it: { runs: n => `${n} attività`, requests: n => `${n} richieste`, hide: 'Nascondi bitcode', open: 'Apri bitcode', mini: 'Nuova mini chat',
    pending: 'Richieste in attesa', more: n => `Altre ${n}…`, running: n => `${n} attività in corso`, idle: 'Nessuna attività in corso', cancel: label => `Annulla: ${label}`, quit: 'Esci',
    reload: 'Ricarica', crashTitle: 'La finestra di bitcode continua a chiudersi', crashDetail: reason => `Motivo: ${reason}. Le attività in corso proseguono nel processo principale.`,
    cancelBtn: 'Annulla', quitRuns: 'Termina attività ed esci', quitDetail: 'Uscendo le attività vengono interrotte e non riprendono automaticamente.',
    approval: 'bitcode · approvazione richiesta', runDone: ok => `bitcode · attività ${ok ? 'completata' : 'terminata con errore'}` },
};
export const mainWords = lang => MAIN_WORDS[lang === 'it' ? 'it' : 'en'];

export function trayModel({ runs = [], pending = [], lang = 'en' }) {
  const w = mainWords(lang), parts = [w.runs(runs.length), w.requests(pending.length)];
  return {
    tooltip: `bitcode · ${parts.join(' · ')}`,
    state: pending.length ? 'attention' : runs.length ? 'busy' : 'idle',
    approvals: pending.slice(0, 8).map(a => ({ id: a.id, label: `${clip(a.subject?.project || 'bitcode', 24)} · ${clip(a.kind, 30)}` })),
    moreApprovals: Math.max(0, pending.length - 8),
    runs: runs.slice(0, 5).map(r => ({ runId: r.runId, label: clip(r.prompt, 40) }))
  };
}

// XDG autostart (freedesktop Desktop Application Autostart Specification).
export const autostartFile = ({ env = process.env, home }) => {
  const config = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  return path.join(config, 'autostart', 'bitcode-desktop.desktop');
};
// Desktop Entry Exec quoting: reserved characters need a quoted argument with
// ", `, $ and \ escaped, then every backslash doubled by the string escaping.
const execArg = value => /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value.replace(/%/g, '%%')
  : `"${value.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`.replace(/\\/g, '\\\\');
export function autostartEntry({ executable }) {
  if (!path.isAbsolute(executable) || /[\r\n]/.test(executable)) throw new Error('autostart needs an absolute executable path');
  return ['[Desktop Entry]', 'Type=Application', 'Name=bitcode', 'Comment=bitcode desktop workspace for coding and Bitcoin',
    `Exec=${execArg(executable)} ${HIDDEN_ARG}`, 'Icon=bitcode-desktop', 'Terminal=false', 'StartupWMClass=bitcode-desktop', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}
