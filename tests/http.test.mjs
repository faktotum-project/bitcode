import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { httpGet } from "../src/http.mjs";
import { withToolContext } from "../src/runtime.mjs";
import { managedDaemon } from "../src/daemon.mjs";

test("shared HTTP transport rejects oversized and interrupted bodies and honors tool cancellation", async t => {
  const server = http.createServer((req, res) => {
    if (req.url === "/large") return res.end("a".repeat(10000));
    res.writeHead(200); res.write("begin");
    if (req.url === "/broken") setImmediate(() => res.destroy());
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(httpGet(`${url}/large`, { maxBytes: 100 }), /size limit/);
  await assert.rejects(httpGet(`${url}/broken`));
  const controller = new AbortController();
  const pending = withToolContext({ signal: controller.signal }, () => httpGet(`${url}/hang`));
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending);
});
test("optional daemon startup failure is reported without an uncaught error", async () => {
  const daemon = managedDaemon({ command: "/nonexistent/bitcode-daemon", args: [] });
  await assert.rejects(daemon.start(), /ENOENT/);
  assert.equal(daemon.status().status, "stopped");
  assert.match(daemon.status().error, /ENOENT/);
});
test("optional daemon drains logs and stops on request", async t => {
  const daemon = managedDaemon({ command: process.execPath, args: ["-e", "console.log('ready'); setInterval(()=>{}, 1000)"] });
  t.after(() => daemon.stop());
  const start = await daemon.start();
  assert.equal(start.status, "started");
  assert.equal(daemon.status().status, "running");
  assert.equal((await daemon.stop()).status, "stopped");
  assert.equal(daemon.status().status, "stopped");
});
