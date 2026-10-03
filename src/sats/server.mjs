import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadRegistry } from "./registry.mjs";
import { TOKEN, STAGE } from "../design-tokens.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
function secureEqual(a, b) {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
async function jsonBody(req, limit) {
  const parts = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > limit)
      throw Object.assign(new Error("Request too large."), { status: 413 });
    parts.push(part);
  }
  try {
    const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error("Invalid JSON object."), { status: 400 });
  }
}
export async function startSatsServer({
  bus,
  network,
  registry = loadRegistry(),
  root = ROOT,
  heartbeatMs = 15_000,
}) {
  const token = randomBytes(32).toString("hex"),
    cookie = randomBytes(32).toString("hex");
  const cookieName = "bitcode_sats_" + randomBytes(8).toString("hex");
  const clients = new Set();
  const files = new Map([
    ["/", "ui/sats/index.html"],
    ["/ui/app.mjs", "ui/sats/app.mjs"],
    ["/ui/styles.css", "ui/sats/styles.css"],
    ["/ui/fonts/InterVariable.woff2", "ui/sats/fonts/InterVariable.woff2"],
    [
      "/ui/fonts/JetBrainsMono-Regular.woff2",
      "ui/sats/fonts/JetBrainsMono-Regular.woff2",
    ],
  ]);
  files.set("/ui/state.mjs", "src/runtime/state.mjs");
  for (const a of registry)
    for (const file of [
      a.poster,
      a.avatar,
      ...Object.values(a.poses),
      ...Object.values(a.poses).map((p) => p.replace(/\.webp$/, ".png")),
    ])
      files.set(file, file.slice(1));
  const realRoot = await realpath(root);
  let origin,
    host,
    closed = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (
        req.headers.host !== host ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return send(403, { error: "Forbidden origin." });
      // Match the raw path: URL normalisation must not turn traversal into a valid asset.
      const route = (req.url || "").split("?")[0];
      if (route.includes("%") || route.includes("..") || route.includes("\\"))
        return send(404, { error: "Not found." });
      if (req.method === "GET" && files.has(route)) {
        const relativeFile = files.get(route);
        const file = await realpath(path.join(root, relativeFile));
        const publicDir = relativeFile.startsWith("assets/") ? "assets/sats" : relativeFile.startsWith("ui/") ? "ui/sats" : "src/runtime";
        if (!file.startsWith(path.join(realRoot, publicDir) + path.sep))
          return send(404, { error: "Not found." });
        const data = await readFile(file);
        res.writeHead(200, {
          "Content-Type":
            MIME[path.extname(file)] || "application/octet-stream",
        });
        res.end(data);
        return;
      }
      if (!route.startsWith("/api/")) return send(404, { error: "Not found." });
      if (req.method === "POST" && req.headers.origin !== origin)
        return send(403, { error: "Origin required." });
      if (
        req.method === "POST" &&
        !/^application\/json(?:;|$)/.test(req.headers["content-type"] || "")
      )
        return send(415, { error: "JSON required." });
      if (route === "/api/attach" && req.method === "POST") {
        const body = await jsonBody(req, 4096);
        if (!body || !secureEqual(body.token, token))
          return send(401, { error: "Invalid token." });
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return send(200, { attached: true });
      }
      const credential = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`).exec(
        req.headers.cookie || "",
      )?.[1];
      if (!secureEqual(credential, cookie))
        return send(401, { error: "Open the link printed by Bitcode." });
      if (route === "/api/bootstrap" && req.method === "GET")
        return send(200, {
          version: 1,
          mode: "observer",
          network: ["mainnet", "testnet", "testnet4", "signet", "regtest"].includes(network)
            ? network
            : "unknown",
          registry,
          tokens: TOKEN,
          stages: STAGE,
          snapshot: bus.snapshot(),
        });
      if (route === "/api/events" && req.method === "GET") {
        if (clients.size >= 8)
          return send(429, { error: "Too many open panels." });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        const write = (kind, data, id) => {
          if (res.destroyed) return;
          // A slow observer never backpressures the agent or accumulates an unbounded queue.
          if (res.writableLength > 64 * 1024) {
            res.destroy();
            return;
          }
          res.write(
            `id: ${id}\nevent: ${kind}\ndata: ${JSON.stringify(data)}\n\n`,
          );
        };
        const after = req.headers["last-event-id"];
        const replay = after == null ? null : bus.replay(Number(after));
        if (replay === null) {
          const snapshot = bus.snapshot();
          write("snapshot", snapshot, snapshot.seq);
        } else for (const event of replay) write("replay", event, event.seq);
        const unsubscribe = bus.subscribe((event) =>
          write("activity", event, event.seq),
        );
        const heartbeat = setInterval(() => {
          if (res.writableLength > 64 * 1024) res.destroy();
          else res.write(": heartbeat\n\n");
        }, heartbeatMs);
        heartbeat.unref();
        clients.add(res);
        res.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
          clients.delete(res);
        });
        return;
      }
      return send(404, { error: "Not found." });
    } catch (error) {
      if (!res.headersSent)
        send(error.status || (error.code === "ENOENT" ? 404 : 500), {
          error: error.status
            ? error.message
            : "Request could not be completed.",
        });
      else res.destroy();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  host = `127.0.0.1:${server.address().port}`;
  origin = `http://${host}`;
  return {
    origin,
    url: `${origin}/#token=${token}`,
    async close() {
      if (closed) return;
      closed = true;
      for (const client of clients) client.end();
      const stopped = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await stopped;
    },
  };
}
