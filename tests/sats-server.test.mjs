import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startSatsServer } from "../src/sats/server.mjs";
import { createEventBus, createRunContext } from "../src/runtime/events.mjs";
import { runAgent } from "../src/agent.mjs";

async function until(fn) {
  const end = Date.now() + 3000;
  while (!fn()) { if (Date.now() > end) throw new Error("Condition timed out"); await delay(5); }
  return fn();
}
async function fixture(t, options = {}) {
  const bus = createEventBus({ bufferSize: 5 });
  const panel = await startSatsServer({ bus, network: "signet", heartbeatMs: 20, ...options });
  t.after(() => panel.close());
  const request = (route, { method = "GET", body, headers = {}, cookie = "" } = {}) => new Promise((resolve, reject) => {
    const req = http.request(panel.origin + route, { method, headers: {
      Origin: panel.origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers,
    } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", chunk => text += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject); req.end(body);
  });
  const attach = await request("/api/attach", { method: "POST", body: JSON.stringify({ token: new URL(panel.url).hash.slice(7) }) });
  assert.equal(attach.status, 200);
  const cookie = attach.headers["set-cookie"][0].split(";")[0];
  return { panel, bus, cookie, request, api: (route, opts = {}) => request(route, { cookie, ...opts }) };
}

test("Sats HTTP: fragment attach, private bootstrap, exact Host/Origin, JSON limits and observer-only endpoints", async t => {
  const { panel, request, api } = await fixture(t);
  assert.equal((await request("/api/bootstrap")).status, 401);
  assert.equal((await request("/api/bootstrap?token=anything")).status, 401);
  for (const headers of [{ Host: "evil.example" }, { Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await api("/api/bootstrap", { headers })).status, 403);
  }
  for (const [body, headers, status] of [
    ["{}", { Origin: "" }, 403], ["{}", { "Content-Type": "text/plain" }, 415],
    ["[]", {}, 400], ["invalid", {}, 400], ["{}", {}, 401], [JSON.stringify({ token: "x".repeat(5000) }), {}, 413],
  ]) assert.equal((await request("/api/attach", { method: "POST", body, headers })).status, status);
  for (const route of ["/assets/sats/%2e%2e/package.json", "/src/config.mjs", "/assets/sats/sources/node-original.png", "/api/runs", "/api/approvals/anything", "/api/runs/anything/cancel"]) {
    assert.equal((await api(route)).status, 404, route);
    assert.equal((await api(route, { method: "POST", body: "{}" })).status, 404, route);
  }
  const bootstrap = await api("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  assert.equal(JSON.parse(bootstrap.text).mode, "observer");
  assert.match(bootstrap.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(bootstrap.headers["cache-control"], "no-store");
  const attached = await request("/api/attach", { method: "POST", body: JSON.stringify({ token: new URL(panel.url).hash.slice(7) }) });
  assert.match(attached.headers["set-cookie"][0], /HttpOnly; SameSite=Strict; Path=\//);
  assert.equal((await request("/assets/sats/node/idle-256.webp")).status, 200);
  assert.equal((await request("/ui/fonts/InterVariable.woff2")).status, 200);
  assert.ok(panel.origin.startsWith("http://127.0.0.1:"));
});

function stream(panel, cookie, after) {
  let text = "", response;
  const request = http.get(panel.origin + "/api/events", { headers: { Cookie: cookie, ...(after == null ? {} : { "Last-Event-ID": String(after) }) } }, res => {
    response = res; res.setEncoding("utf8"); res.on("data", chunk => text += chunk);
  });
  request.on("error", () => {});
  return { text: () => text, close: () => { response?.destroy(); request.destroy(); } };
}
test("Sats SSE: live events, safe projection, replay, old-buffer snapshot, heartbeat and client limit", async t => {
  const { bus, panel, api, cookie } = await fixture(t);
  const c = createRunContext({ bus });
  bus.emit(c, "run.started");
  const first = stream(panel, cookie); t.after(first.close);
  await until(() => first.text().includes("event: snapshot"));
  bus.emit(c, "model.started", { args: { key: "SECRET" }, result: "PRIVATE" });
  await until(() => first.text().includes("event: activity") && first.text().includes(": heartbeat"));
  assert.doesNotMatch(first.text(), /SECRET|PRIVATE/);
  first.close();
  const replay = stream(panel, cookie, 1); t.after(replay.close);
  await until(() => replay.text().includes("event: replay"));
  replay.close();
  for (let i = 0; i < 10; i++) bus.emit(c, "model.started");
  const old = stream(panel, cookie, 1); t.after(old.close);
  await until(() => old.text().includes("event: snapshot")); old.close();
  const clients = Array.from({ length: 8 }, () => stream(panel, cookie)); t.after(() => clients.forEach(c => c.close()));
  await until(() => clients.every(c => c.text().includes("event: snapshot")));
  assert.equal((await api("/api/events")).status, 429);
});

test("closing Sats server or its subscribers never cancels an active task or approves a tool", async t => {
  const { bus, panel, cookie } = await fixture(t);
  let approve, writes = 0;
  const context = createRunContext({ bus, agentId: "script" });
  const running = runAgent({ target: { provider: {}, model: "mock" }, messages: [], context,
    tools: [{ name: "edit_file", mutating: true, run: () => { writes++; return "ok"; } }],
    hooks: { approve: () => new Promise(resolve => approve = resolve) },
    callModelImpl: async ({ messages }) => messages.length ? { text: "done" } : { toolCalls: [{ id: "write", name: "edit_file", args: {} }] },
  });
  const client = stream(panel, cookie); t.after(client.close);
  await until(() => approve);
  await panel.close();
  assert.equal(bus.busy, true); assert.equal(writes, 0);
  approve(true); assert.equal(await running, "done"); assert.equal(writes, 1);
  await assert.rejects(fetch(panel.origin));
});

test("static allowlist rejects symlinks outside each public directory", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bc-sats-public-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "assets/sats/node"), { recursive: true });
  await writeFile(path.join(root, "private.txt"), "PRIVATE");
  await symlink(path.join(root, "private.txt"), path.join(root, "assets/sats/node/idle-256.webp"));
  const { request } = await fixture(t, { root });
  const result = await request("/assets/sats/node/idle-256.webp");
  assert.equal(result.status, 404); assert.doesNotMatch(result.text, /PRIVATE/);
});

test("two local panels have independent authentication cookies", async t => {
  const a = await fixture(t), b = await fixture(t);
  assert.notEqual(a.cookie.split("=")[0], b.cookie.split("=")[0]);
  assert.equal((await b.request("/api/bootstrap", { cookie: a.cookie })).status, 401);
});
