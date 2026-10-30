// Electron main process: windows, tray, notifications, secret store, PTYs and
// the trusted origin of every control message. The renderer has no Node.
import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, powerSaveBlocker, safeStorage, screen, shell, session as electronSession } from 'electron';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bitcodeHome } from '../src/paths.mjs';
import { THEME } from '../src/design-tokens.mjs';
import { loadAgents } from '../src/agents.mjs';
import { createController, fileVersion } from './core/controller.mjs';
import { probeSandbox, spawnWorker } from './core/sandbox.mjs';
import { atomicJSON, fail, loadJSON, workspacePath } from './core/primitives.mjs';
import { createAttachments } from './core/attachments.mjs';
import { ensureCertificate, hashPassword, startLanServer } from './core/lan.mjs';
import { LAN_PAGE, LAN_SCRIPT } from './core/lan-page.mjs';
import { HIDDEN_ARG, MIN_WINDOW, autostartEntry, autostartFile, createCrashPolicy, restoreBounds, trayModel, mainWords } from './core/shell.mjs';
import { watchTree } from './core/watcher.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url)); // dist/
const home = bitcodeHome();
const UI = path.join(appDir, 'ui', 'index.html');
let win = null, tray = null, quitting = false, controller, awakeBlocker = null;
const startHidden = process.argv.includes(HIDDEN_ARG);
const windowFile = path.join(home, 'desktop', 'window.json');

// Wayland grants global shortcuts only through the xdg-desktop-portal GlobalShortcuts interface.
if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
if (!app.requestSingleInstanceLock()) app.quit();
// A second launch is a command to this instance: --quake and --mini-chat let a desktop keyboard shortcut drive the app
// where global shortcuts are not granted (Wayland); plain launches just show the window.
app.on('second-instance', (_, argv) => { if (argv.includes('--quake')) toggleQuake(); else if (argv.includes('--mini-chat')) openMiniChat(); else show(); });

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
// Remote access goes over the user's own SSH: a terminal running `ssh -t <host> bitcode`. No server is exposed by bitcode.
const SSH_HOST = /^(?!-)[A-Za-z0-9._@-]{1,120}$/;
const sshHostsFile = path.join(home, 'desktop', 'ssh.json');
function sshConfigHosts() {
  let text = ''; try { text = readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8'); } catch { return []; }
  return [...new Set(text.split('\n').map(l => /^\s*Host\s+(.+)$/i.exec(l)?.[1]).filter(Boolean).flatMap(v => v.trim().split(/\s+/)).filter(h => SSH_HOST.test(h) && !/[*?!]/.test(h)))];
}
function remoteAccess() {
  let saved = []; try { saved = loadJSON(sshHostsFile, []); } catch {}
  const tcp = (() => { try { return readFileSync('/proc/net/tcp', 'utf8') + readFileSync('/proc/net/tcp6', 'utf8'); } catch { return ''; } })();
  const sshd = tcp.split('\n').some(l => { const [, local, , st] = l.trim().split(/\s+/); return st === '0A' && local?.endsWith(':0016'); });
  const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && !a.internal && a.family === 'IPv4').map(a => a.address);
  return { user: os.userInfo().username, sshd, addresses, hosts: [...new Set([...saved.filter(h => SSH_HOST.test(h)), ...sshConfigHosts()])], saved };
}
// ---- LAN access: runs only while the remote mode is "lan" and a password is set; bound to one chosen LAN address ----
const lanFile = path.join(home, 'desktop', 'lan.json');
let lan = { server: null, error: null, fingerprint: null };
const lanConfig = () => { try { return { port: 7341, host: null, passwordHash: null, ...loadJSON(lanFile, {}) }; } catch { return { port: 7341, host: null, passwordHash: null }; } };
const privateIPv4 = () => Object.values(os.networkInterfaces()).flat().filter(a => a && !a.internal && a.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a => a.address);
function lanStatus() {
  const c = lanConfig(), addresses = privateIPv4();
  return { mode: controller?.settings().remoteMode || 'off', running: !!lan.server, host: c.host || addresses[0] || null, port: c.port, addresses, passwordSet: !!c.passwordHash, fingerprint: lan.fingerprint, error: lan.error,
    url: lan.server ? `https://${c.host || addresses[0]}:${c.port}/` : null };
}
async function syncLan() {
  const c = lanConfig(), want = controller?.settings().remoteMode === 'lan' && !!c.passwordHash;
  if (lan.server) { await lan.server.close().catch(() => {}); lan.server = null; }
  lan.error = null;
  if (!want) return lanStatus();
  const host = c.host && privateIPv4().includes(c.host) ? c.host : privateIPv4()[0];
  if (!host) { lan.error = 'No private LAN address'; return lanStatus(); }
  try {
    const tls = ensureCertificate(path.join(home, 'desktop')); lan.fingerprint = tls.fingerprint;
    lan.server = await startLanServer({ host, port: c.port, tls, passwordHash: c.passwordHash, page: LAN_PAGE, script: LAN_SCRIPT, invoke: (m, p, origin) => controller.invoke(m, p, origin) });
  } catch (e) { lan.error = e.code === 'ENOENT' ? 'openssl is required for the LAN certificate' : e.message; }
  return lanStatus();
}
async function configureLan({ password, host, port }) {
  const c = lanConfig();
  if (password !== undefined) c.passwordHash = password ? hashPassword(password) : null;
  if (host !== undefined) { if (host !== null && !privateIPv4().includes(host)) throw fail('INVALID_PARAMS', 'Not a private LAN address of this computer'); c.host = host; }
  if (port !== undefined) { if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail('INVALID_PARAMS', 'Port must be 1024–65535'); c.port = port; }
  atomicJSON(lanFile, c); return syncLan();
}
async function openSsh({ host, command = 'bitcode' }) {
  if (typeof host !== 'string' || !SSH_HOST.test(host)) throw fail('INVALID_PARAMS', 'Invalid SSH host');
  if (!['bitcode', 'shell'].includes(command)) throw fail('INVALID_PARAMS');
  ptyModule ??= await import('node-pty').catch(e => { throw fail('PTY_UNAVAILABLE', e.message); });
  if (ptys.size >= 8) throw fail('BUSY', 'Too many terminals');
  const term = ptyModule.spawn('ssh', ['-t', '--', host, ...(command === 'bitcode' ? ['bitcode'] : [])], { name: 'xterm-256color', cols: 100, rows: 30, cwd: os.homedir(), env: { ...process.env, TERM: 'xterm-256color' } });
  const ptyId = crypto.randomUUID(); ptys.set(ptyId, term);
  term.onData(data => send('pty', { ptyId, data }));
  term.onExit(({ exitCode }) => { ptys.delete(ptyId); send('pty', { ptyId, exit: exitCode }); });
  return { ptyId, host };
}
// RGB node fixes (unlock, init, start) run in the user's shell in the home folder,
// typed visibly so the user enters the password and sees every line.
async function openRgbFix({ action, nodeUrl }) {
  const { command } = await controller.invoke('rgb.fix', { action, nodeUrl });
  ptyModule ??= await import('node-pty').catch(e => { throw fail('PTY_UNAVAILABLE', e.message); });
  if (ptys.size >= 8) throw fail('BUSY', 'Too many terminals');
  const term = ptyModule.spawn(process.env.SHELL || '/bin/bash', [], { name: 'xterm-256color', cols: 100, rows: 30, cwd: os.homedir(), env: { ...process.env, TERM: 'xterm-256color' } });
  const ptyId = crypto.randomUUID(); ptys.set(ptyId, term);
  // Typed once the shell has drawn its prompt: earlier input is echoed twice by the tty.
  let typed = false;
  term.onData(data => {
    send('pty', { ptyId, data });
    if (!typed) { typed = true; setTimeout(() => ptys.has(ptyId) && term.write(`${command}\r`), 150); }
  });
  term.onExit(({ exitCode }) => { ptys.delete(ptyId); send('pty', { ptyId, exit: exitCode }); });
  return { ptyId, command };
}
const ptyOf = id => ptys.get(id) || (() => { throw fail('NOT_FOUND', 'Unknown terminal'); })();

// ---- project watchers: external edits reach open buffers as file.changed ----
const watchers = new Map();
function watchProject({ projectId, root }) {
  if (watchers.has(projectId) || !existsSync(root)) return;
  const pending = new Map();
  watchers.set(projectId, watchTree(root, rel => {
    if (pending.has(rel)) return;
    pending.set(rel, setTimeout(() => {
      pending.delete(rel);
      try { send('file', { projectId, path: rel, version: fileVersion(workspacePath(root, rel)), by: 'disk' }); } catch {}
    }, 150));
  }));
}

// Every window created here is trusted: the main window and the mini chats. Events reach all of them.
const minis = new Set();
const trusted = () => [win, ...minis].filter(w => w && !w.isDestroyed());
function send(channel, payload) { for (const w of trusted()) w.webContents.send('bitcode:event', { channel, payload }); }
// A notification without a live reference can be collected before its click arrives.
const shownNotifications = new Set();
const words = () => mainWords(controller?.settings?.().lang);
function notify(title, body, target) {
  if (!Notification.isSupported() || (win?.isVisible() && win.isFocused())) return;
  const n = new Notification({ title, body, silent: false });
  shownNotifications.add(n);
  const release = () => shownNotifications.delete(n);
  n.on('click', () => { show(); if (target) send('navigate', target); release(); });
  n.on('close', release); n.on('failed', release);
  n.show();
}
function show() { if (!win) createWindow(); else { win.show(); win.focus(); } }
const toggle = () => (win?.isVisible() && win.isFocused() ? win.hide() : show());

let geometryTimer = null;
function saveGeometry() {
  clearTimeout(geometryTimer); geometryTimer = null;
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try { atomicJSON(windowFile, { ...(win.isMaximized() ? win.getNormalBounds() : win.getBounds()), maximized: win.isMaximized() }); } catch {}
}
const queueGeometry = () => { clearTimeout(geometryTimer); geometryTimer = setTimeout(saveGeometry, 400); };

function watchRenderer(w) {
  const policy = createCrashPolicy();
  w.webContents.on('render-process-gone', async (_, { reason }) => {
    const step = policy.next(reason);
    if (step === 'reload') return setTimeout(() => { if (!w.isDestroyed()) w.webContents.reload(); }, 100);
    if (step !== 'stop') return;
    const w = words();
    const { response } = await dialog.showMessageBox({ type: 'error', buttons: [w.reload, w.quit], defaultId: 0, cancelId: 1,
      message: w.crashTitle, detail: w.crashDetail(reason) });
    if (response === 0 && !w.isDestroyed()) { policy.reset(); w.webContents.reload(); } else quit();
  });
}

function createWindow({ visible = true } = {}) {
  let saved = null; try { saved = restoreBounds(loadJSON(windowFile, null), screen.getAllDisplays().map(d => d.workArea)); } catch {}
  win = new BrowserWindow({ width: saved?.width || 1440, height: saved?.height || 900, ...(saved ? { x: saved.x, y: saved.y } : {}), minWidth: MIN_WINDOW.width, minHeight: MIN_WINDOW.height, show: visible,
    title: 'bitcode', backgroundColor: THEME.light.canvas, icon: path.join(appDir, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(appDir, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
  if (saved?.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, queueGeometry);
  for (const event of ['show', 'hide']) win.on(event, updateTray);
  watchRenderer(win);
  win.on('close', e => { saveGeometry(); if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.loadFile(UI);
  // Smoke check for CI/dev: render, save a screenshot, exit.
  if (process.env.BITCODE_DESKTOP_SCREENSHOT) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    writeFileSync(process.env.BITCODE_DESKTOP_SCREENSHOT, (await win.capturePage()).toPNG());
    quitting = true; controller.shutdown(); app.exit(0);
  }, 2500));
}

// Suspension would stall running agents, so it is blocked only while any run is active.
function keepAwake(active) {
  if (active && awakeBlocker === null) awakeBlocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!active && awakeBlocker !== null) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
}

function updateTray() {
  const runs = controller.activeRuns(), w = words(), model = trayModel({ runs, pending: controller.pending(), lang: controller.settings().lang });
  keepAwake(runs.length > 0);
  if (!tray) return;
  const activity = () => { show(); send('navigate', { view: 'activity' }); };
  tray.setToolTip(model.tooltip);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win?.isVisible() ? w.hide : w.open, click: toggle },
    { label: w.mini, click: () => openMiniChat() },
    { type: 'separator' },
    ...(model.approvals.length ? [{ label: w.pending, enabled: false }, ...model.approvals.map(a => ({ label: a.label, click: activity })),
      ...(model.moreApprovals ? [{ label: w.more(model.moreApprovals), click: activity }] : []), { type: 'separator' }] : []),
    { label: runs.length ? w.running(runs.length) : w.idle, enabled: false },
    ...model.runs.map(r => ({ label: w.cancel(r.label), click: () => controller.invoke('run.cancel', { runId: r.runId }, 'tray') })),
    { type: 'separator' },
    { label: w.quit, click: quit }
  ]));
}

async function quit() {
  const active = controller.activeRuns().length;
  if (active) {
    const w = words();
    const { response } = await dialog.showMessageBox(win?.isVisible() ? win : undefined, { type: 'warning', buttons: [w.cancelBtn, w.quitRuns], defaultId: 0, cancelId: 0,
      message: w.running(active), detail: w.quitDetail });
    if (response !== 1) return;
  }
  shutdown(); app.quit();
}
function shutdown() { try { globalShortcut.unregisterAll(); } catch {} lan.server?.close().catch(() => {}); quitting = true; saveGeometry(); keepAwake(false); controller?.shutdown(); for (const t of ptys.values()) t.kill(); }

// Update check (plan 7A): one request to the public release feed, only on demand; installing stays a human apt step.
const RELEASES = 'https://api.github.com/repos/faktotum-project/bitcode/releases/latest';
const versionParts = v => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
const newerThan = (a, b) => { const x = versionParts(a), y = versionParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
async function checkForUpdate() {
  const res = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': `bitcode-desktop/${app.getVersion()}` }, signal: AbortSignal.timeout(8000) }).catch(e => { throw fail('NETWORK', e.message); });
  if (res.status === 404) return { current: app.getVersion(), latest: null, newer: false, url: null };
  if (!res.ok) throw fail('NETWORK', `GitHub HTTP ${res.status}`);
  const body = await res.json(), latest = String(body.tag_name || '').slice(0, 40);
  const url = typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/') ? body.html_url : null;
  return { current: app.getVersion(), latest, newer: !!latest && newerThan(latest, app.getVersion()), url };
}

// Local dev servers for the Preview panel: loopback or wildcard TCP listeners from /proc, probed over HTTP on 127.0.0.1 only.
const LISTEN = '0A', LOOPBACK_OR_ANY = new Set(['0100007F', '00000000', '00000000000000000000000001000000', '00000000000000000000000000000000']);
function listeningPorts() {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = ''; try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const [, local, , st] = line.trim().split(/\s+/); if (st !== LISTEN || !local) continue;
      const [addr, portHex] = local.split(':'); if (LOOPBACK_OR_ANY.has(addr)) ports.add(parseInt(portHex, 16));
    }
  }
  return [...ports].filter(p => p >= 1024 && p !== 9222).sort((a, b) => a - b).slice(0, 64);
}
async function localServers() {
  if (process.platform !== 'linux') return [];
  const probe = async port => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(800) });
      const type = res.headers.get('content-type') || '', html = type.includes('text/html') ? (await res.text()).slice(0, 20000) : '';
      return { port, url: `http://127.0.0.1:${port}/`, status: res.status, title: (html.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || '').trim(), html: !!html };
    } catch { return null; }
  };
  return (await Promise.all(listeningPorts().map(probe))).filter(Boolean);
}

// Autostart is offered only for packaged builds: a development Electron binary cannot start the app on its own.
// The package's /usr/bin link survives a change of install directory; the binary path does not.
const STABLE_COMMAND = '/usr/bin/bitcode-desktop';
const stableCommand = () => { try { return realpathSync(STABLE_COMMAND) === realpathSync(process.execPath) ? STABLE_COMMAND : null; } catch { return null; } };
const launcher = () => (process.env.APPIMAGE && path.isAbsolute(process.env.APPIMAGE) ? process.env.APPIMAGE : stableCommand() || process.execPath);
const autostart = {
  get: () => ({ supported: process.platform === 'linux' && app.isPackaged, enabled: existsSync(autostartFile({ home: app.getPath('home') })) }),
  set: enabled => {
    if (!autostart.get().supported) throw fail('UNSUPPORTED', 'Avvio automatico disponibile solo nel pacchetto installato');
    const file = autostartFile({ home: app.getPath('home') });
    if (enabled) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, autostartEntry({ executable: launcher() }), { mode: 0o644 }); } else rmSync(file, { force: true });
    return autostart.get();
  },
  // An entry written by an earlier install may name a path that no longer exists.
  heal: () => {
    if (!autostart.get().supported || !autostart.get().enabled) return;
    const file = autostartFile({ home: app.getPath('home') }), entry = autostartEntry({ executable: launcher() });
    try { if (readFileSync(file, 'utf8') !== entry) writeFileSync(file, entry, { mode: 0o644 }); } catch {}
  }
};

// ---- attachments: files and folders shared in a chat are copied into the project's allegati/ ----
const attachments = new Map();
async function attachmentsFor(projectId) {
  const project = (await controller.invoke('project.list')).find(p => p.projectId === projectId); if (!project) throw fail('NOT_FOUND');
  if (!attachments.has(projectId)) attachments.set(projectId, createAttachments(project.root));
  return attachments.get(projectId);
}
const asBytes = data => (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null);

// ---- trusted IPC: origin comes from the verified sender, never the payload ----
const mainMethods = {
  'app.info': () => ({ version: app.getVersion(), home, secretStore: secretStore(), secrets: secrets.names(), platform: process.platform }),
  'dialog.openFolder': async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  'secrets.put': ({ name, value }) => secrets.put(name, value),
  'secrets.delete': ({ name }) => secrets.delete(name),
  'pty.open': openPty,
  'remote.status': () => remoteAccess(),
  'remote.save': ({ hosts }) => { if (!Array.isArray(hosts) || hosts.length > 50 || !hosts.every(h => typeof h === 'string' && SSH_HOST.test(h))) throw fail('INVALID_PARAMS'); atomicJSON(sshHostsFile, [...new Set(hosts)]); return remoteAccess(); },
  'pty.openSsh': openSsh,
  'pty.openRgbFix': openRgbFix,
  'lan.status': () => lanStatus(),
  'lan.configure': params => configureLan(params),
  'pty.write': ({ ptyId, data }) => { if (typeof data !== 'string' || data.length > 65536) throw fail('INVALID_PARAMS'); ptyOf(ptyId).write(data); return true; },
  'pty.resize': ({ ptyId, cols, rows }) => { if (!(cols > 1 && rows > 1 && cols < 1000 && rows < 500)) throw fail('INVALID_PARAMS'); ptyOf(ptyId).resize(cols | 0, rows | 0); return true; },
  'pty.close': ({ ptyId }) => { ptyOf(ptyId).kill(); ptys.delete(ptyId); return true; },
  // Dropped or pasted bytes come from the UI; picked paths never do (they come from a native dialog owned by this process).
  'attach.put': async ({ projectId, group, top, rel, data }) => {
    const bytes = asBytes(data); if (!bytes || typeof group !== 'string' || group.length > 80 || typeof rel !== 'string') throw fail('INVALID_PARAMS');
    try { return (await attachmentsFor(projectId)).put({ group, top: typeof top === 'string' ? top : undefined, rel, bytes }); } catch (e) { throw fail(e.code || 'INVALID_PARAMS', e.message); }
  },
  'attach.pick': async ({ projectId, kind }) => {
    const store = await attachmentsFor(projectId);
    const r = await dialog.showOpenDialog(win, { properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
    return r.canceled ? { items: [], skipped: [] } : store.importPaths(r.filePaths);
  },
  'attach.remove': async ({ projectId, top }) => { try { return (await attachmentsFor(projectId)).remove(String(top)); } catch (e) { throw fail(e.code || 'INVALID_PARAMS', e.message); } },
  'clipboard.write': ({ text }) => { if (typeof text !== 'string' || text.length > 1_000_000) throw fail('INVALID_PARAMS'); clipboard.writeText(text); return true; },
  'clipboard.read': () => clipboard.readText().slice(0, 1_000_000),
  // Links in answers open in the system browser; only plain http(s) URLs, never file:, javascript: or custom schemes.
  'app.autostart.get': () => autostart.get(),
  'window.miniChat': ({ projectId, sessionId } = {}) => { openMiniChat({ projectId, sessionId }); return true; },
  'window.pin': ({ pinned }, w) => { if (!minis.has(w)) throw fail('INVALID_PARAMS', 'Only mini chats can stay on top'); w.setAlwaysOnTop(pinned === true); return w.isAlwaysOnTop(); },
  'window.isMini': (_, w) => minis.has(w),
  'shell.get': () => shellState(),
  'shell.set': ({ key, value }) => setShell(key, value),
  'app.update.check': () => checkForUpdate(),
  'preview.servers': () => localServers(),
  'app.autostart.set': ({ enabled }) => autostart.set(enabled === true),
  'app.openExternal': async ({ url }) => { const u = new URL(String(url)); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw fail('INVALID_PARAMS'); await shell.openExternal(u.href); return true; },
  'app.quit': quit
};

// ---- mini chats: small windows on the same trusted UI, optionally kept on top ----
function openMiniChat({ projectId, sessionId } = {}) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const w = new BrowserWindow({ width: 460, height: 660, x: area.x + area.width - 480, y: area.y + 40, minWidth: 360, minHeight: 420, title: 'bitcode · mini chat', backgroundColor: THEME.dark.canvas, icon: path.join(appDir, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(appDir, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
  w.setMenuBarVisibility(false);
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  watchRenderer(w);
  minis.add(w); w.on('closed', () => minis.delete(w));
  w.loadFile(UI, { query: { mini: '1', ...(typeof projectId === 'string' ? { project: projectId } : {}), ...(typeof sessionId === 'string' ? { session: sessionId } : {}) } });
  return w;
}

// ---- quake mode and the mini-chat shortcut (global shortcuts: not every Wayland session grants them) ----
const shellFile = path.join(home, 'desktop', 'shell.json');
const SHELL_DEFAULTS = { quake: false, quakeKey: 'Control+`', quakeHeight: 0.6, miniKey: false };
let shellSettings = { ...SHELL_DEFAULTS };
try { shellSettings = { ...SHELL_DEFAULTS, ...loadJSON(shellFile, {}) }; } catch {}
const registered = { quake: false, mini: false };
let quakeNormal = null;
function toggleQuake() {
  if (!win) createWindow();
  if (win.isVisible() && win.isFocused() && quakeNormal) { win.hide(); return; }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (!quakeNormal) quakeNormal = { bounds: win.getBounds(), onTop: win.isAlwaysOnTop() };
  win.setAlwaysOnTop(true); win.setBounds({ x: area.x, y: area.y, width: area.width, height: Math.round(area.height * shellSettings.quakeHeight) }); win.show(); win.focus();
}
function restoreFromQuake() { if (quakeNormal && win) { win.setAlwaysOnTop(quakeNormal.onTop); win.setBounds(quakeNormal.bounds); } quakeNormal = null; }
function applyShortcuts() {
  globalShortcut.unregisterAll(); registered.quake = registered.mini = false;
  if (!app.isReady()) return;
  if (shellSettings.quake) { try { registered.quake = globalShortcut.register(shellSettings.quakeKey, toggleQuake); } catch { registered.quake = false; } } else restoreFromQuake();
  if (shellSettings.miniKey) { try { registered.mini = globalShortcut.register('Control+Alt+Space', () => openMiniChat()); } catch { registered.mini = false; } }
}
const shellState = () => ({ ...shellSettings, registered: { ...registered }, wayland: !!process.env.WAYLAND_DISPLAY });
function setShell(key, value) {
  const checks = { quake: v => typeof v === 'boolean', miniKey: v => typeof v === 'boolean', quakeHeight: v => typeof v === 'number' && v >= 0.3 && v <= 1,
    quakeKey: v => typeof v === 'string' && /^(Control|Alt|Shift|Super)(\+(Control|Alt|Shift|Super))*\+[\w`]$|^F([1-9]|1[0-2])$/.test(v) };
  if (!checks[key]?.(value)) throw fail('INVALID_PARAMS', `Invalid setting ${key}`);
  shellSettings[key] = value; atomicJSON(shellFile, shellSettings); applyShortcuts(); return shellState();
}
ipcMain.handle('bitcode:invoke', async (event, message) => {
  try {
    const w = trusted().find(x => event.sender === x.webContents);
    if (!w || event.senderFrame !== w.webContents.mainFrame || !event.senderFrame.url.startsWith('file://')) throw fail('FORBIDDEN_ORIGIN');
    if (!message || typeof message.method !== 'string') throw fail('INVALID_PARAMS');
    const origin = `ui:${w.id}`, params = message.params ?? {};
    const result = mainMethods[message.method] ? await mainMethods[message.method](params, w) : await controller.invoke(message.method, params, origin);
    if (message.method === 'project.open') watchProject(result);
    if (message.method === 'settings.set' && params.key === 'remoteMode') await syncLan();
    return { ok: true, result: result === undefined ? null : result };
  } catch (e) { return { ok: false, error: { code: e.code || 'INTERNAL', message: e.message } }; }
});

app.whenReady().then(() => {
  // Only the microphone, only for bitcode's own windows (dictation); everything else stays denied.
  const micOnly = (wc, permission, details) => permission === 'media' && trusted().some(w => w.webContents === wc) && (details?.mediaTypes || []).every(t => t === 'audio') && (details?.mediaTypes || []).length > 0;
  electronSession.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(micOnly(wc, permission, details)));
  electronSession.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => permission === 'media' && trusted().some(w => w.webContents === wc) && details?.mediaType === 'audio');
  const sandbox = probeSandbox();
  controller = createController({ home, appDir, sandbox, secrets, agents: loadAgents({ bundledDir: path.join(appDir, 'agents') }),
    spawnWorker: opts => spawnWorker({ ...opts, runtime: process.execPath }),
    emit: (channel, payload) => {
      send(channel, payload);
      if (channel === 'approval' && payload.status === 'pending' && controller.settings().notifyApprovals) notify(words().approval, `${payload.subject?.project || ''} · ${payload.kind}`, { view: 'activity' });
      if (channel === 'run' && ['success', 'error', 'interrupted'].includes(payload.state) && controller.settings().notifyRuns) notify(words().runDone(payload.state === 'success'), payload.prompt.slice(0, 60), { view: 'chat', sessionId: payload.sessionId });
      if (channel === 'run' || channel === 'approval') updateTray();
    } });
  controller.invoke('project.list').then(list => list.forEach(watchProject));
  autostart.heal();
  try { tray = new Tray(nativeImage.createFromPath(path.join(appDir, 'ui', 'icon.png')).resize({ width: 22, height: 22 })); tray.on('click', toggle); updateTray(); } catch { tray = null; }
  // --hidden (used by autostart) starts in the tray; without a tray the window must stay reachable.
  createWindow({ visible: !(startHidden && tray) && !process.argv.includes('--quake') });
  if (process.argv.includes('--quake')) toggleQuake(); else if (process.argv.includes('--mini-chat')) openMiniChat();
  applyShortcuts();
  syncLan().catch(() => {});
});
app.on('window-all-closed', () => { /* stay alive in the tray; quit is explicit */ });
// Electron turns SIGTERM, SIGINT and SIGHUP into this event. A nested app.quit()
// during it is ignored, so without active runs the quit proceeds right here.
app.on('before-quit', e => {
  if (quitting) return;
  if (controller?.activeRuns().length) { e.preventDefault(); quit(); } else shutdown();
});
