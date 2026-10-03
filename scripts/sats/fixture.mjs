// Local development/test fixture: exercises the real CLI with a deterministic
// loopback provider, no external model or funded wallet.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function until(fn, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (!fn()) { if (Date.now() > end) throw new Error("Fixture condition timed out"); await delay(10); }
  return fn();
}
export async function startCliFixture({ args = ["--sats", "--no-session"], cwd, home } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bc-sats-flow-"));
  cwd ||= directory; home ||= path.join(directory, "state");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(cwd, "note.txt"), "PRIVATE_FILE_CONTENT");
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); requests.push(input);
    const prompt = input.messages.filter(m => m.role === "user").at(-1)?.content || "";
    if (prompt === "error") { res.writeHead(400); res.end("PRIVATE_PROVIDER_ERROR"); return; }
    if (prompt === "wait") { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(": waiting\n\n"); return; }
    let text, tool;
    if (input.messages.at(-1)?.role === "user" || prompt === "max") {
      if (prompt === "change") tool = { name: "write_file", args: { path: "example.txt", content: "PRIVATE_CONTENT <img src=x onerror=alert(1)>" } };
      else if (prompt === "delegate") tool = { name: "subagent", args: { agent: "hash", prompt: "read" } };
      else if (["read", "max", "hostile"].includes(prompt)) tool = { name: "read_file", args: { path: prompt === "hostile" ? "<img src=x onerror=alert(1)>" : "note.txt" } };
      else text = "PRIVATE_FINAL_RESULT";
    } else text = "PRIVATE_FINAL_RESULT <img src=x onerror=alert(1)>";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = tool ? { tool_calls: [{ index: 0, id: "call-" + requests.length, function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { content: text };
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  await writeFile(path.join(home, "config.json"), JSON.stringify({
    model: "mock/fixture", profile: "code", network: "signet", permissions: { mode: "suggest" },
    providers: { mock: { api: "openai", baseURL: `http://127.0.0.1:${provider.address().port}/v1` } },
  }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../bitcode.mjs", import.meta.url)), "--cwd", cwd, ...args], {
    env: { ...process.env, BITCODE_HOME: home, BITCODE_MODEL: "", NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", exit;
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const closed = new Promise(resolve => child.on("close", code => { exit = code; resolve(code); }));
  child.on("error", err => stderr += err.message);
  return {
    child, cwd, home, requests, stdout: () => stdout, stderr: () => stderr,
    send: text => child.stdin.write(text + "\n"),
    async panelUrl() {
      return until(() => stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/)?.[0]);
    },
    async ready() { await until(() => stdout.includes("Ctrl+D to quit.")); },
    async exited() { await until(() => exit !== undefined); return exit; },
    async close() {
      if (exit === undefined) {
        child.stdin.end("/exit\n");
        await Promise.race([closed, delay(1500)]);
        if (exit === undefined) { child.kill("SIGTERM"); await closed; }
      }
      await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
