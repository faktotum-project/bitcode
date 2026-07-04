# bitcode

A minimal, **zero-dependency** multi-provider terminal coding agent — in the
style of claude code / codex / opencode. Pure Node ESM: no build step, no
`node_modules`. Just run it.

```
node bitcode.mjs
```

## Requirements

- Node.js >= 22 (uses built-in `fetch`-free `node:http` streaming, `readline`, `crypto`).

## Install (optional)

Link it as a global `bitcode` command:

```bash
cd bitcode
npm link        # or: npm install -g .
bitcode --help
```

Or just call it directly: `node /path/to/bitcode/bitcode.mjs`.

## Usage

```bash
bitcode                                   # interactive session (REPL)
bitcode "refactor utils.js and run tests" # one-shot
bitcode -p "summarize this repo"          # explicit one-shot
bitcode -m ollama/gpt-oss:20b             # pick a model
bitcode models                            # list providers + default models
```

### Interactive slash commands

```
/model [spec]   show or switch model (e.g. /model anthropic/claude-sonnet-4-6)
/models         pick a model from a numbered list of known providers
/subagent [name] [prompt]
                list personas (~/.bitcode/agents/*.md), or delegate a
                sub-task to one and print just its final answer
/tools          list tools
/reset          clear conversation history
/session list|save|load|export
                manage conversation sessions (list saved, save current,
                load a checkpoint, export as markdown/JSON)
/config get|set [path] [value]
                read or set configuration (dot-path, e.g.
                /config get agent.maxToolCallsPerTurn)
/setting add|list
                configure providers and API keys
/provider add|list|health
                manage providers and check their health
/doctor         diagnose the agent (version, node, config, tools, plugins)
/exit           quit
```

Custom commands: drop a markdown file at `~/.bitcode/commands/<name>.md`
and it becomes its own `/<name>` command. The body is a prompt template —
use `$ARGUMENTS` as a placeholder for whatever you type after the command
name, or omit it and typed text is appended. A file one directory down
(`~/.bitcode/commands/foo/bar.md`) becomes namespaced: `/foo:bar`.

Bundled Bitcoin commands (`commands/btc/*.md`, shipped with bitcode) cover
common vertical workflows out of the box: `/btc:fees`, `/btc:mempool`,
`/btc:block [height|hash]`, `/btc:tx <txid>`, `/btc:address <addr>`,
`/btc:balance`, `/btc:receive`, `/btc:descriptor` (public output
descriptor, safe to share), `/btc:send <address> <amount>` (checks fee
rates and asks for explicit confirmation before broadcasting — same
approval gate as calling `wallet_send` directly), and `/btc:coinjoin
<address> <amount-btc>` (isolated temp wallet, mandatory risk disclosure —
see `update_cj.md`; actual JoinMarket round execution is not implemented
yet). Add your own commands at `~/.bitcode/commands/` — they merge with the
bundled set and win on name collisions.

`@path` in a message is expanded when you hit enter: if it resolves to a
real file, its content is appended to your message before it's sent to the
model (e.g. `explain @src/agent.mjs`). Unmatched `@something` is left as
plain text.

Subagents (`~/.bitcode/agents/<name>.md`) are markdown personas: their body
is appended to bitcode's system prompt for that delegated turn. They're
usable both via `/subagent` and autonomously by the model itself through
the `subagent` tool, which returns only the sub-task's final answer (not
its full transcript) to keep the parent conversation's context small.
Approving a `subagent` tool call authorizes everything it does internally —
it runs without further per-tool confirmation prompts.

## Models & providers

Choose a model with `-m <provider>/<model>`. Resolution order:
`-m flag` → `BITCODE_MODEL` env → config `"model"` → built-in fallback.

Built-in providers:

| provider     | api    | key env              | example model                |
|--------------|--------|----------------------|------------------------------|
| `anthropic`  | messages | `ANTHROPIC_API_KEY`  | `claude-sonnet-4-6`          |
| `openai`     | chat   | `OPENAI_API_KEY`     | `gpt-5.5`                    |
| `openrouter` | chat   | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.6`|
| `groq`       | chat   | `GROQ_API_KEY`       | `llama-3.3-70b-versatile`    |
| `ollama`     | chat   | — (local)            | `gpt-oss:20b`                |

Any OpenAI-compatible endpoint works. Add custom providers in
`~/.bitcode/config.json`:

```json
{
  "model": "ollama/gpt-oss:20b",
  "providers": {
    "myllm": {
      "api": "openai",
      "baseURL": "http://my-host:8000/v1",
      "keyEnv": "MY_KEY",
      "defaultModel": "some-model"
    }
  },
  "aliases": {
    "claude": "anthropic/claude-sonnet-4-6",
    "gpt": "openai/gpt-5.5"
  },
  "agent": {
    "fallback": ["anthropic", "openai", "openrouter"]
  }
}
```

**Fallback chain**: set `agent.fallback` to an ordered list of provider names.
If the primary model (from `-m`, env, or config) fails with a retryable error
(429, 5xx), the agent tries the next provider in the chain. Check provider
health with `/provider health` or `bitcode provider health`.

**Provider health probes**: each provider endpoint is tested with a timeout of
5s. Probes are non-blocking (they run in the background) and surface via `/doctor`.

## Tools

The agent can call: `bash`, `read_file`, `write_file`, `edit_file`, `list_dir`.
All paths resolve against the current working directory.

Mutating tools (`bash`, `write_file`, `edit_file`) prompt for approval in
interactive mode. Skip prompts with `--yolo`. One-shot mode (`-p`) auto-approves.

**Parallel execution & budgets**: tool calls within a single turn are executed
in parallel. Configure budget limits in `~/.bitcode/config.json`:

```json
{
  "agent": {
    "maxToolCallsPerTurn": 10,
    "maxTotalToolCalls": 50,
    "maxRetries": 3
  }
}
```

- `maxToolCallsPerTurn`: max tool calls in a single model response (default 10).
- `maxTotalToolCalls`: max tool calls across the entire session (default 50).
- `maxRetries`: retry failed tool calls with exponential backoff (default 0).

A tool call exceeding budget is rejected without being executed; the agent
receives the rejection and can decide to stop or continue with other tasks.

## Session Management

Conversations are auto-saved to `~/.bitcode/sessions/` after each turn. Use
slash commands to manage them:

```bash
/session list          # show all saved sessions
/session save my-task  # save current session as "my-task"
/session load my-task  # load a checkpoint
/session export md     # export current session as markdown transcript
/session export json   # export current session as JSON
```

Sessions include full message history, tool calls, and results — resume where
you left off without losing context.

## Extensibility

### Plugins

Drop `.mjs` files in `~/.bitcode/plugins/` to extend the agent:

```javascript
// ~/.bitcode/plugins/hello.mjs
export default function ({ registerTool, on, EVENTS }) {
  registerTool({
    name: "greet",
    description: "Say hello to someone",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } }
    },
    run: async ({ name }) => `Hello, ${name}!`
  });

  on("toolEnd", ({ tc, result }) => {
    console.log(`Tool ${tc.name} returned: ${result}`);
  });
}
```

Plugins are loaded at startup. A plugin that throws is reported but doesn't
halt the agent. The plugin API provides `registerTool`, `unregisterTool`,
event listeners (`on`/`off`), and the full event list (`EVENTS`).

### MCP (Model Context Protocol) Servers

Connect to MCP servers (tool-bearing protocol servers) by configuring them in
`~/.bitcode/config.json`:

```json
{
  "mcp": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "postgres": {
      "command": "node",
      "args": ["/path/to/postgres-mcp-server.mjs"]
    }
  }
}
```

Tools from each server are wrapped as `mcp_<server>_<tool>` and available to
the agent just like built-in tools. MCP servers are spawned on demand and kept
alive only while the agent is using them (so one-shot mode exits cleanly).

## Design system

The CLI is themed from the **bitcode design system** (`bitcode design system/`)
— a faithful translation of its brand into 24-bit ANSI:

- **Brand**: Bitcoin Orange `#f7931a` accent, Ink `#26251e`, the ⚡ mark and
  `bitcode` wordmark, Success `#1f8a65` / Error `#cf2d56`.
- **Signature reasoning timeline**: the design's five-stage, colour-coded
  pipeline (Pending → Relayed → Mempool → Confirming → Confirmed) drives a live
  `Reasoning` view. Each tool the agent runs prints a coloured stage pill —
  `reading` (read_file/list_dir), `running` (bash), `drafting` (write/edit) —
  with a `✓`/`✗` result marker, so every answer shows its work.

```
⚡ bitcode  agent · ollama/gpt-oss:20b   ● ready

R E A S O N I N G
  [READING]  notes.txt
    ✓ bitcode works.
```

Tokens live in `src/theme.mjs`. Styling auto-disables when output is not a TTY
or `NO_COLOR` is set.

## Architecture

```
bitcode.mjs        entry point
src/config.mjs     provider registry + model resolution + config I/O (atomic saves)
src/providers.mjs  Anthropic + OpenAI-compatible adapters (SSE over node:http)
                   + exponential backoff retry (429/5xx) + health probes
src/tools.mjs      tool definitions + runners + registry (grep, glob, patch + builtins)
src/agent.mjs      the tool-calling loop (parallel execution, budgets, retries)
src/theme.mjs      design-system tokens → terminal theme (banner, pills, timeline)
src/cli.mjs        arg parsing, REPL, one-shot, approval prompts
src/session.mjs    conversation checkpoints (save/load/export)
src/settings.mjs   provider configuration UI (password-masked input)
src/hooks.mjs      event bus (toolStart, toolEnd, modelResponse, error, etc.)
src/plugins.mjs    plugin loader (~/.bitcode/plugins/*.mjs)
src/mcp.mjs        MCP (Model Context Protocol) stdio client + tool wrapper
src/markdown-config.mjs  shared *.md + frontmatter loader
src/commands.mjs   custom /commands (bundled commands/ + ~/.bitcode/commands/)
src/agents.mjs     subagent personas (~/.bitcode/agents/*.md)
src/mentions.mjs   @path file-reference expansion
commands/btc/      bundled Bitcoin-vertical commands (/btc:fees, /btc:send, ...)
tests/             node:test suite (27 tests covering all major modules)
```

The loop: send messages → if the model returns tool calls, run them in
parallel and feed results back → repeat until it returns a final text answer.
Each turn is gated by a user approval prompt (or auto-approved in one-shot mode)
before any tool runs. Tools that fail are retried with exponential backoff
(configurable); budget overages are rejected without execution.

## Development

Run tests with Node's built-in test runner:

```bash
npm test              # run all tests in tests/
npm run lint          # syntax check all .mjs files (no external linter)
```

The test suite covers config merging, tool registry, session I/O, agent loop
(parallel, budget, retry, fallback), provider retry logic, health probes, hooks,
plugins, and MCP client. All tests use in-process mocks and are deterministic.

GitHub Actions CI runs on every push: install (--ignore-scripts), lint, and test.

## Notes

- Streaming uses `node:http` directly (not `fetch`) so a slow, cold-loading
  local model doesn't trip undici's non-configurable headers timeout.
- Local CPU-only models (e.g. a 20B on Ollama without a GPU) are slow on first
  load (minutes). Once warm they respond quickly. Use a smaller model or a
  cloud provider for snappier sessions.
- Tool calls are executed in parallel, so I/O-bound operations (file reads,
  network requests) can run concurrently. Approval gates are sequential
  (user confirms once per turn), but tool execution is not.
