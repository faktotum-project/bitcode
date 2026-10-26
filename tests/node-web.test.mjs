import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createExplorerServer } from '../src/node/web.mjs';

test('loopback explorer serves SPA/assets, proxies API and denies symlink escapes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-explorer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'it')); fs.writeFileSync(path.join(root, 'it/index.html'), '<html>bitcode explorer</html>');
  fs.writeFileSync(path.join(root, 'it/main.js'), 'console.log("asset")');
  fs.symlinkSync('/etc/passwd', path.join(root, 'it/escape'));
  const backend = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: req.url })); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening'); t.after(() => backend.close());
  const server = createExplorerServer({ publicRoot: root, port: 8080, backendPort: backend.address().port });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/', { redirect: 'manual' })).status, 302);
  assert.match(await (await fetch(base + '/it/blocks')).text(), /bitcode explorer/);
  assert.equal((await fetch(base + '/it/main.js')).headers.get('content-type'), 'application/javascript');
  assert.equal((await fetch(base + '/it/escape')).status, 404);
  assert.deepEqual(await (await fetch(base + '/api/v1/blocks/tip/height')).json(), { path: '/api/v1/blocks/tip/height' });
  assert.deepEqual(await (await fetch(base + '/api/block/example')).json(), { path: '/api/v1/block/example' });
  assert.equal((await fetch(base + '/it/', { method: 'POST' })).status, 405);
});

test('experimental explorer splits native Esplora routes from versioned mempool API', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-native-explorer-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backend = http.createServer((req, res) => res.end(JSON.stringify({ kind: 'mempool', path: req.url, host: req.headers.host })));
  const esplora = http.createServer((req, res) => res.end(JSON.stringify({ kind: 'esplora', path: req.url, host: req.headers.host })));
  for (const upstream of [backend, esplora]) { upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(() => upstream.close()); }
  const server = createExplorerServer({ publicRoot: root, port: 8083, backendPort: backend.address().port, esploraPort: esplora.address().port });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close()); const base = `http://127.0.0.1:${server.address().port}`;
  const legacy = await (await fetch(base + '/api/address/example?after=123')).json();
  assert.equal(legacy.kind, 'esplora'); assert.equal(legacy.path, '/address/example?after=123'); assert.equal(legacy.host, `127.0.0.1:${esplora.address().port}`);
  const versioned = await (await fetch(base + '/api/v1/fees/recommended')).json();
  assert.equal(versioned.kind, 'mempool'); assert.equal(versioned.path, '/api/v1/fees/recommended');
});

test('local explorer transports a real WebSocket upgrade and server frame', async t => {
  const { createHash } = await import('node:crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcode-ws-explorer-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backend = http.createServer(); const sockets = new Set(); let requestPath;
  backend.on('upgrade', (req, socket) => {
    requestPath = req.url; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.concat([Buffer.from([0x81, 4]), Buffer.from('live')]));
    socket.on('data', chunk => { if ((chunk[0] & 0xf) === 8) socket.end(Buffer.from([0x88, 0])); });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening'); t.after(() => { for (const socket of sockets) socket.destroy(); backend.close(); });
  const server = createExplorerServer({ publicRoot: root, port: 8080, backendPort: backend.address().port });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const websocket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/v1/ws`);
  const data = await new Promise((resolve, reject) => { websocket.addEventListener('message', event => resolve(event.data), { once: true }); websocket.addEventListener('error', reject, { once: true }); });
  assert.equal(data, 'live'); assert.equal(requestPath, '/api/v1/ws');
  const closed = once(websocket, 'close'); websocket.close(); await closed;
});
