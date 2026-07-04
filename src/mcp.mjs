// Minimal MCP (Model Context Protocol) client: connect to a server over stdio,
// speak JSON-RPC 2.0, list its tools and expose them as bitcode tools. This is
// the base — it covers initialize / tools/list / tools/call, which is enough to
// use most MCP tool servers. Configure servers in config.mcp:
//
//   "mcp": { "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] } }

import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2024-11-05";

// Open a stdio JSON-RPC channel to an MCP server process.
export function mcpConnect({ command, args = [], env } = {}) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
  const pending = new Map();
  let nextId = 1;
  let buf = "";

  // Keep the process alive only while a request is in flight. Idle, the server
  // must not block exit (so one-shot/doctor terminate); during an await its
  // stdout is ref'd so the response can arrive.
  const updateRefs = () => {
    try {
      if (pending.size > 0) {
        child.ref?.();
        child.stdout.ref?.();
      } else {
        child.unref?.();
        child.stdout.unref?.();
      }
    } catch {
      // handles may already be closed
    }
  };
  child.stdin.unref?.();
  updateRefs();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        updateRefs();
        if (msg.error) reject(new Error(msg.error.message || "MCP error"));
        else resolve(msg.result);
      }
    }
  });
  child.on("error", (err) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  });

  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      updateRefs();
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  return {
    child,
    rpc,
    initialize: () =>
      rpc("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "bitcode", version: "0.1.0" },
      }),
    listTools: async () => (await rpc("tools/list", {}))?.tools || [],
    callTool: (name, args) => rpc("tools/call", { name, arguments: args || {} }),
    close: () => {
      try {
        child.stdin.end();
        child.kill();
      } catch {
        // already gone
      }
    },
  };
}

// Connect to every server in config.mcp and return their tools wrapped as
// bitcode tools (named mcp_<server>_<tool>). Best-effort: a server that fails to
// start or handshake is skipped. Returns { tools, servers } for diagnostics.
export async function mcpTools(config = {}) {
  const servers = config.mcp || {};
  const tools = [];
  const report = [];
  for (const [name, spec] of Object.entries(servers)) {
    const client = mcpConnect(spec);
    try {
      await client.initialize();
      const list = await client.listTools();
      for (const def of list) {
        tools.push({
          name: `mcp_${name}_${def.name}`,
          mutating: true, // external side effects are unknown → gate by default
          description: def.description || `MCP tool "${def.name}" from server "${name}".`,
          parameters: def.inputSchema || { type: "object", properties: {} },
          run: async (args) => {
            const res = await client.callTool(def.name, args);
            if (res?.content) {
              return res.content.map((c) => c.text ?? JSON.stringify(c)).join("\n");
            }
            return JSON.stringify(res ?? {});
          },
        });
      }
      report.push({ name, ok: true, tools: list.length });
    } catch (err) {
      client.close();
      report.push({ name, ok: false, error: err.message });
    }
  }
  return { tools, servers: report };
}
