// Electron main process: windows, tray, notifications, secret store, PTYs and
// the trusted origin of every control message. The renderer has no Node.
import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, safeStorage, session as electronSession } from 'electron';
import { existsSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bitcodeHome } from '../src/paths.mjs';
import { loadAgents } from '../src/agents.mjs';
import { createController, fileVersion } from './core/controller.mjs';
import { probeSandbox, spawnWorker } from './core/sandbox.mjs';
import { atomicJSON, fail, loadJSON, workspacePath } from './core/primitives.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url)); // dist/
const home = bitcodeHome();
const UI = path.join(appDir, 'ui', 'index.html');
let win = null, tray = null, quitting = false, controller;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => show()); // re-opening path when the tray icon is not visible

// ---- secret store (§11, 5A): libsecret via safeStorage, else memory only ----
const secretFile = path.join(home, 'desktop', 'secrets.json');
const memory = new Map();
const secretStore = () => {
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : 'os';
  return { secure: safeStorage.isEncryptionAvailable() && !['basic_text', 'unknown'].includes(backend), backend };
};
const secrets = {
  get(name) {
    if (memory.has(name)) return memory.get(name);
    const stored = loadJSON(secretFile, {})[name];
    if (!stored || !secretStore().secure) return undefined;
    try { const v = safeStorage.decryptString(Buffer.from(stored, 'base64')); memory.set(name, v); return v; } catch { return undefined; }
  },
  put(name, value) {
    if (!/^[a-z0-9_-]{1,64}$/i.test(name) || typeof value !== 'string' || !value) throw fail('INVALID_PARAMS');
    memory.set(name, value); controller?.redactor.add(value);
    const { secure } = secretStore();
    if (secure) { const all = loadJSON(secretFile, {}); all[name] = safeStorage.encryptString(value).toString('base64'); atomicJSON(secretFile, all); }
    return { persisted: secure };
  },
  delete(name) { memory.delete(name); const all = loadJSON(secretFile, {}); delete all[name]; atomicJSON(secretFile, all); return true; },
  names() { return [...new Set([...memory.keys(), ...Object.keys(loadJSON(secretFile, {}))])]; }
};

// ---- PTYs (§10): owned by the user, never connected to agent input ----
const ptys = new Map();
let ptyModule;
async function openPty({ projectId }) {
  ptyModule ??= await import('node-pty').catch(e => { throw fail('PTY_UNAVAILABLE', e.message); });
  if (ptys.size >= 8) throw fail('BUSY', 'Too many terminals');
  const project = (await controller.invoke('project.list')).find(p => p.projectId === projectId); if (!project) throw fail('NOT_FOUND');
  const shell = process.env.SHELL || '/bin/bash';
  const term = ptyModule.spawn(shell, [], { name: 'xterm-256color', cols: 100, rows: 24, cwd: project.root, env: { ...process.env, TERM: 'xterm-256color', BITCODE_DESKTOP: '1' } });
  const ptyId = crypto.randomUUID();
  ptys.set(ptyId, term);
  term.onData(data => send('pty', { ptyId, data }));
  term.onExit(({ exitCode }) => { ptys.delete(ptyId); send('pty', { ptyId, exit: exitCode }); });
  return { ptyId, shell };
}
const ptyOf = id => ptys.get(id) || (() => { throw fail('NOT_FOUND', 'Unknown terminal'); })();

// ---- project watchers: external edits reach open buffers as file.changed ----
const watchers = new Map();
function watchProject({ projectId, root }) {
  if (watchers.has(projectId) || !existsSync(root)) return;
  const pending = new Map();
  try {
    const w = watch(root, { recursive: true }, (_, rel) => {
      if (!rel || /(^|\/)(\.git|node_modules)(\/|$)/.test(rel) || pending.has(rel)) return;
      pending.set(rel, setTimeout(() => {
        pending.delete(rel);
        try { send('file', { projectId, path: rel, version: fileVersion(workspacePath(root, rel)), by: 'disk' }); } catch {}
      }, 150));
    });
    watchers.set(projectId, w);
  } catch {}
}

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send('bitcode:event', { channel, payload }); }
function notify(title, body) { if (Notification.isSupported() && (!win?.isVisible() || !win.isFocused())) new Notification({ title, body, silent: false }).show(); }
function show() { if (!win) createWindow(); else { win.show(); win.focus(); } }

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 980, minHeight: 620, title: 'Bitcode', backgroundColor: '#f7f7f4', icon: path.join(appDir, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(appDir, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); updateTray(); } });
  win.on('closed', () => { win = null; });
  win.loadFile(UI);
  // Smoke check for CI/dev: render, save a screenshot, exit.
  if (process.env.BITCODE_DESKTOP_SCREENSHOT) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    writeFileSync(process.env.BITCODE_DESKTOP_SCREENSHOT, (await win.capturePage()).toPNG());
    quitting = true; controller.shutdown(); app.exit(0);
  }, 2500));
}

function updateTray() {
  if (!tray) return;
  const runs = controller.activeRuns(), pending = controller.pending();
  tray.setToolTip(`Bitcode · ${runs.length} attività · ${pending.length} richieste`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Bitcode', click: show },
    { label: `${runs.length} attività in corso`, enabled: false },
    { label: `${pending.length} richieste in attesa`, enabled: !!pending.length, click: () => { show(); send('navigate', { view: 'activity' }); } },
    ...runs.slice(0, 5).map(r => ({ label: `Annulla: ${r.prompt.slice(0, 40)}`, click: () => controller.invoke('run.cancel', { runId: r.runId }, 'tray') })),
    { type: 'separator' },
    { label: 'Esci', click: quit }
  ]));
}

async function quit() {
  const active = controller.activeRuns().length;
  if (active) {
    const { response } = await dialog.showMessageBox(win?.isVisible() ? win : undefined, { type: 'warning', buttons: ['Annulla', 'Termina attività ed esci'], defaultId: 0, cancelId: 0,
      message: `${active} attività in corso`, detail: 'Uscendo le attività vengono interrotte e non riprendono automaticamente.' });
    if (response !== 1) return;
  }
  quitting = true; controller.shutdown(); for (const t of ptys.values()) t.kill(); app.quit();
}

// ---- trusted IPC: origin comes from the verified sender, never the payload ----
const mainMethods = {
  'app.info': () => ({ version: app.getVersion(), home, secretStore: secretStore(), secrets: secrets.names(), platform: process.platform }),
  'dialog.openFolder': async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  'secrets.put': ({ name, value }) => secrets.put(name, value),
  'secrets.delete': ({ name }) => secrets.delete(name),
  'pty.open': openPty,
  'pty.write': ({ ptyId, data }) => { if (typeof data !== 'string' || data.length > 65536) throw fail('INVALID_PARAMS'); ptyOf(ptyId).write(data); return true; },
  'pty.resize': ({ ptyId, cols, rows }) => { if (!(cols > 1 && rows > 1 && cols < 1000 && rows < 500)) throw fail('INVALID_PARAMS'); ptyOf(ptyId).resize(cols | 0, rows | 0); return true; },
  'pty.close': ({ ptyId }) => { ptyOf(ptyId).kill(); ptys.delete(ptyId); return true; },
  'app.quit': quit
};
ipcMain.handle('bitcode:invoke', async (event, message) => {
  try {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('file://')) throw fail('FORBIDDEN_ORIGIN');
    if (!message || typeof message.method !== 'string') throw fail('INVALID_PARAMS');
    const origin = `ui:${win.id}`, params = message.params ?? {};
    const result = mainMethods[message.method] ? await mainMethods[message.method](params) : await controller.invoke(message.method, params, origin);
    if (message.method === 'project.open') watchProject(result);
    return { ok: true, result: result === undefined ? null : result };
  } catch (e) { return { ok: false, error: { code: e.code || 'INTERNAL', message: e.message } }; }
});

app.whenReady().then(() => {
  electronSession.defaultSession.setPermissionRequestHandler((_, __, cb) => cb(false));
  const sandbox = probeSandbox();
  controller = createController({ home, appDir, sandbox, secrets, agents: loadAgents({ bundledDir: path.join(appDir, 'agents') }),
    spawnWorker: opts => spawnWorker({ ...opts, runtime: process.execPath }),
    emit: (channel, payload) => {
      send(channel, payload);
      if (channel === 'approval' && payload.status === 'pending') notify('Bitcode · approvazione richiesta', `${payload.subject?.project || ''} · ${payload.kind}`);
      if (channel === 'run' && ['success', 'error', 'interrupted'].includes(payload.state)) notify(`Bitcode · attività ${payload.state === 'success' ? 'completata' : 'terminata con errore'}`, payload.prompt.slice(0, 60));
      if (channel === 'run' || channel === 'approval') updateTray();
    } });
  controller.invoke('project.list').then(list => list.forEach(watchProject));
  try { tray = new Tray(nativeImage.createFromPath(path.join(appDir, 'ui', 'icon.png')).resize({ width: 22, height: 22 })); tray.on('click', show); updateTray(); } catch { tray = null; }
  createWindow();
});
app.on('window-all-closed', () => { /* stay alive in the tray; quit is explicit */ });
app.on('before-quit', e => { if (!quitting) { e.preventDefault(); quit(); } });
