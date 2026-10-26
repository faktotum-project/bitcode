// User-owned, loopback-only static frontend and API/WebSocket proxy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' };
export function createExplorerServer({ publicRoot, port, backendPort, esploraPort }) {
  if (esploraPort != null && (!Number.isInteger(esploraPort) || esploraPort < 1024 || esploraPort > 65535)) throw new Error('Invalid Esplora port');
  if (![port, backendPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)) throw new Error('Invalid local port');
  const root = fs.realpathSync(publicRoot);
  const inside = file => file.startsWith(root + path.sep);
  const server = http.createServer((req, res) => {
    let url; try { url = new URL(req.url, `http://127.0.0.1:${port}`); } catch { res.writeHead(400).end(); return; }
    if (url.pathname.startsWith('/api/')) {
      const legacy = !url.pathname.startsWith('/api/v1/');
      const upstreamPort = legacy && esploraPort ? esploraPort : backendPort;
      const upstreamPath = legacy && esploraPort ? req.url.replace(/^\/api/, '') : req.url.replace(/^\/api\/(?!v1\/)/, '/api/v1/');
      const proxy = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: upstreamPath, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` }, timeout: 30_000 }, response => { res.writeHead(response.statusCode, response.headers); pipeline(response, res, () => {}); });
      proxy.on('timeout', () => proxy.destroy()); proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local backend unavailable'); });
      pipeline(req, proxy, () => {}); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/it/' }).end(); return; }
    let file;
    try {
      const decoded = decodeURIComponent(url.pathname);
      file = path.resolve(root, '.' + decoded);
      if (!inside(file)) throw new Error('outside');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) && /^\/[a-z]{2}(?:-[A-Z]{2})?\//.test(decoded) && !path.extname(decoded)) file = path.join(root, decoded.split('/')[1], 'index.html');
      file = fs.realpathSync(file); if (!inside(file) || !fs.statSync(file).isFile()) throw new Error('outside');
    } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') res.end(); else pipeline(fs.createReadStream(file), res, () => {});
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/api/')) { socket.destroy(); return; }
    const target = net.connect({ host: '127.0.0.1', port: backendPort }, () => {
      target.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head.length) target.write(head); socket.pipe(target).pipe(socket);
    });
    target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy()); socket.on('close', () => target.destroy());
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  createExplorerServer(config).listen(config.port, '127.0.0.1');
}
