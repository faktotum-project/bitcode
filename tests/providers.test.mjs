import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { callModel, providerHealth } from "../src/providers.mjs";

let server;
let port;
let handler;

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
after(() => server.close());

const provider = () => ({ api: "openai", baseURL: `http://127.0.0.1:${port}/v1` });
const call = () =>
  callModel({ provider: provider(), model: "m", apiKey: null, system: "s", messages: [{ role: "user", content: "x" }], tools: [] });

test("callModel retries on 429 (Retry-After) and recovers", async () => {
  let hits = 0;
  handler = (req, res) => {
    hits++;
    if (hits <= 2) {
      res.writeHead(429, { "retry-after": "0" });
      return res.end("rate limited");
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  };
  const r = await call();
  assert.equal(r.text, "ok");
  assert.equal(hits, 3);
});

test("callModel does not retry a non-retryable 400", async () => {
  let hits = 0;
  handler = (req, res) => {
    hits++;
    res.writeHead(400);
    res.end("bad request");
  };
  await assert.rejects(call(), /HTTP 400/);
  assert.equal(hits, 1);
});

test("providerHealth reports reachable vs dead endpoints", async () => {
  handler = (req, res) => {
    res.writeHead(200);
    res.end("{}");
  };
  const ok = await providerHealth(provider(), null);
  assert.equal(ok.ok, true);
  const dead = await providerHealth({ api: "openai", baseURL: "http://127.0.0.1:1/v1" }, null);
  assert.equal(dead.ok, false);
});
