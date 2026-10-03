// The only bridge between the sandboxed renderer and the main process. It
// exposes two functions and never forwards an origin: main derives it.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('bitcode:event', (_, message) => { for (const fn of listeners) { try { fn(message); } catch {} } });

contextBridge.exposeInMainWorld('bitcode', {
  invoke: (method, params) => ipcRenderer.invoke('bitcode:invoke', { method: String(method), params }),
  subscribe: fn => { if (typeof fn !== 'function') return () => {}; listeners.add(fn); return () => listeners.delete(fn); }
});
