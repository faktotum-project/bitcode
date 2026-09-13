# bitcode

A terminal coding and Bitcoin agent, written in Node.js ESM. Version 0.2 adds
OpenAI Responses, MCP SDK v2, managed processes, repository instructions,
local skills, planning, context compaction and stricter tool execution.

## Install and run

Requires Node.js **22 or newer** and Bash for the POSIX shell tools.
There is no JavaScript build step. Dependencies include the MCP client, AJV
and the existing Bitcoin cryptography libraries.

```bash
npm ci --ignore-scripts
node bitcode.mjs --help
node bitcode.mjs doctor
node bitcode.mjs -m ollama/gpt-oss:20b
node bitcode.mjs -m openai/gpt-6-astra -p "inspect this repository"
```

`--ignore-scripts` installs the coding agent without compiling/downloading the
optional wallet binaries. Build them when needed:

```bash
npm run build:cdk          # Rust toolchain + deps/cdk submodule required
npm run build:wavelength   # downloads the pinned waved/wavecli release
```

The existing `postinstall` still runs both scripts when installation scripts
are enabled. `npm link --ignore-scripts` exposes the global `bitcode` command.

Run `bitcode login` to choose a provider, or `bitcode login openai` (also
`node bitcode.mjs login openai`) to configure one directly. Enter the API key
at the masked prompt; it is saved in `~/.bitcode/config.json` with owner-only
permissions (0600 on POSIX). This configures API-key authentication, not browser
OAuth or a subscription login, and does not validate the key over the network.
Environment variables take precedence over saved keys. Login preserves the
selected model; use `-m <provider>/<model>` or `/model` to switch.
`/login [provider]` and `/provider add <name>` are also available interactively.
Ollama needs no login; configured custom providers appear in the selection list.
State lives in `~/.bitcode`; set `BITCODE_HOME` to use a separate directory.
`--cwd <path>` changes the project before loading instructions and extensions.

## CLI and interactive commands

```bash
bitcode -p "fix the failing test"       # one-shot, ordinary mutations approved
bitcode --read-only -p "review code"    # read-only tool catalog
bitcode --json -p "inspect README.md"   # machine-readable answer/usage/events
bitcode --max-steps 10 -p "inspect src"
bitcode --continue -p "continue the task"
bitcode --resume <session-id>
bitcode models
bitcode login
bitcode login anthropic
bitcode tools --json
bitcode commands
bitcode skills
bitcode mcp
bitcode provider list
bitcode provider health
bitcode session list --json
bitcode doctor --json
```

`--json` one-shot results contain `status`, `answer` (or `error`), `session_id`,
`usage` and tool `events`. Exit status is 0 on a final answer, 1 on failure,
and 2 when a runtime budget stops the task. JSON catalogs are also supported
by `tools`, `commands`, `skills`, `models`, `mcp`, `doctor`, `provider list`
and `session list`.

| Slash command | Behavior |
| --- | --- |
| `/plan <task>` | Investigate with read-only tools and save an implementation plan |
| `/build` | Execute the latest saved plan with the active approval policy |
| `/compact` | Summarize older context; retain the latest two user turns and tool/result pairs |
| `/status` | Show model, context size, reported token usage and current task plan |
| `/model [spec]`, `/models` | Inspect/switch provider and model |
| `/login [provider]` | Choose a provider and save its API key with masked input |
| `/provider add <name>`, `list`, `health` | Set a masked API key, list providers, probe endpoints |
| `/config get [path]`, `/config set <path> <value>` | Read/set configuration, including JSON objects and arrays |
| `/setting` | Provider key status and active configuration path |
| `/session list`, `save [label]`, `load <id>`, `export [md\|json]` | Manage conversations |
| `/subagent [persona] <task>` | Delegate a bounded task with inherited permissions and budgets |
| `/tools [filter]` | Inspect tools and approval requirements |
| `/skills`, `/commands`, `/mcp`, `/doctor` | Inspect capabilities and dependencies |
| `/reset` | Start a fresh conversation/session and clear task progress |
| `/exit`, `/quit` | Close the session and managed processes |

Ctrl+C during a model/tool turn cancels supported ongoing operations and stops
further calls. Native HTTP, shell/process, Cashu CLI and MCP requests receive
the cancellation signal. Third-party plugins must honor `context.signal`.

Both interactive and one-shot conversations save atomically, including native
Responses output items. Sessions use owner-only files on POSIX. A session from
a different Bitcoin network is rejected. `/compact` saves a full checkpoint
before summarizing; it calls the selected model and consumes tokens.

## Tools

| Area | Tools |
| --- | --- |
| Files | `read_file`, `write_file`, `edit_file`, `list_dir`, `grep`, `glob`, `patch` |
| Shell/processes | `bash`, `exec_command`, `write_stdin`, `list_processes`, `terminate_process` |
| Git | `git_status`, `git_diff`, `git_log` |
| Web | `web_fetch` — bounded HTTP(S) GET for text, JSON and HTML |
| Planning/input | `update_plan`, `read_plan`, `ask_user` |
| Skills/delegation | `list_skills`, `read_skill`, `subagent` |
| MCP | Registered server tools, `mcp_list_resources`, `mcp_read_resource`, `mcp_list_prompts`, `mcp_get_prompt` |
| Bitcoin | Chain/mempool/fee queries, Core RPC, BIP84 wallet and transaction tools |
| Liquid | Read-only fees, mempool, transactions, addresses, blocks and assets |
| Lightning/tapd | Invoice decoding; node, channel, balance, invoice and asset tools when configured |
| Cashu | Wallet, mint quotes, tokens, payment requests and local mint lifecycle |
| Wavelength | Read-only tools discovered from the configured official `wavecli` schema |
| CoinJoin | Existing isolated temporary-wallet lifecycle; no JoinMarket round execution |

`read_file` accepts 1-based `offset`, `limit` and `line_numbers`. `edit_file`
requires a nonempty, unique exact match. `patch` handles a strict single-file
unified diff and rejects incomplete or mismatching hunks before writing.
`grep` accepts a regex and optional filename/path glob; searches skip common
vendor/build folders and large/binary files.

`exec_command` returns a process `session_id`, bounded output, `next_offset`
and status after up to one second. Continue with `write_stdin`; pass the previous
`next_offset` to read incremental output. This uses pipes, **not a PTY**.
Processes belong to the CLI session and are terminated on exit. Use `bash`
for a single command whose completion should be awaited.

`web_fetch` retrieves known URLs; it is not a search engine or browser. A
configured MCP server can provide search/browser capabilities. Binary MCP
image/audio blocks are described in text, not rendered by this CLI.

## Execution and approval policy

The runtime validates tool arguments against JSON Schema using AJV. Read-only
calls run in bounded batches. Mutations are barriers: earlier reads finish
first, mutations run sequentially, and later reads observe the updated state.
Unknown mutation metadata defaults to requiring approval. Mutating tools are
never automatically retried, including payments whose response was lost.

Interactive mode asks before mutations. `--yolo` skips ordinary mutation
prompts. Built-in financial tools still require confirmation. One-shot mode
rejects those financial tools unless `--allow-payments` was explicitly passed.
Plugins can mark their tools `financial: true` to use the same gate. This gate
is tool policy, not an OS sandbox: shell commands and trusted plugins can
access the user's machine and must only perform authorized work.

Subagents inherit approvals, cancellation, read-only restrictions and a shared
total tool-call budget. They cannot recursively delegate. `/plan` and
`--read-only` expose only tools classified as read-only; plugin/server trust
still matters.

```json
{
  "agent": {
    "maxSteps": 50,
    "maxToolCallsPerTurn": 16,
    "maxTotalToolCalls": 200,
    "maxParallelTools": 4,
    "maxResultChars": 50000,
    "toolRetryAttempts": 0,
    "toolRetryDelay": 500,
    "fallback": ["ollama/gpt-oss:20b"]
  }
}
```

Limits apply to a user turn and its delegated runs. `maxRetries` is accepted
as a legacy alias for `toolRetryAttempts`. Only read-only tools are eligible
for tool retry. Provider fallback runs on transient network/server failures,
not authentication/invalid-request errors or after text has already streamed.

## Models and providers

Resolution order: CLI `-m` → `BITCODE_MODEL` → config `model` → built-in fallback.
Explicit model names and custom provider settings are preserved.

| Provider | API | Key environment variable | Default model |
| --- | --- | --- | --- |
| `anthropic` | Messages | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `openai` | Responses | `OPENAI_API_KEY` | `gpt-6-astra` |
| `openrouter` | Chat Completions | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.6` |
| `groq` | Chat Completions | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `ollama` | Chat Completions | none | `gpt-oss:20b` |

The built-in fallback remains Anthropic. Add any compatible endpoint:

```json
{
  "model": "local/my-model",
  "providers": {
    "local": {
      "api": "openai",
      "baseURL": "http://127.0.0.1:8000/v1",
      "defaultModel": "my-model"
    },
    "openai": {
      "reasoningEffort": "medium",
      "maxOutputTokens": 16000
    }
  },
  "aliases": { "gpt": "openai/gpt-6-astra" }
}
```

`api: "openai"` retains the historical meaning **Chat Completions**;
`api: "responses"` selects Responses. Responses runs with `store: false` and
replays native output items, including encrypted reasoning, across tool rounds.
The adapters reject malformed tool arguments, provider error events, truncated
streams and incomplete model responses. Usage is recorded when reported by the
provider; `/status` token estimates for context size are approximate.

## Instructions, skills and custom commands

At startup the agent loads applicable ancestor/root `AGENTS.md` files and is
instructed to inspect nested instructions before editing those directories.
Skills are discovered from:

- `$BITCODE_HOME/skills/<name>/SKILL.md` (default `~/.bitcode/skills`)
- `<project>/.agents/skills/<name>/SKILL.md`
- `<project>/.bitcode/skills/<name>/SKILL.md`

Only names/descriptions enter the initial context. `read_skill` loads the full
instructions when needed. Project entries override user entries of the same name.

Custom command Markdown files are loaded from bundled `commands/`, the user's
`commands/` directory, then `<project>/.bitcode/commands/`. A subdirectory creates
a namespace, e.g. `repo/review.md` → `/repo:review`. `$ARGUMENTS` expands to the
text following the command. Bundled/custom commands also expand in one-shot
prompts. `@path` attaches bounded text-file contents to a user request.

Bundled namespaces include `/repo:review`, `/repo:test`, `/repo:fix`,
`/repo:explain`, plus `/btc:*`, `/ln:*`, `/liquid:*`, `/cashu:*`, and `/wl:*`.
Run `bitcode commands` for the complete catalog and descriptions.

Personas live in the user's `agents/<name>.md` directory. Their body extends
the base prompt for a delegated run.

## MCP

Uses the official `@modelcontextprotocol/client` v2 SDK. Automatic negotiation
supports the **2026-07-28** protocol and legacy initialization; stdio and
Streamable HTTP are supported. For stdio, automatic negotiation can launch a
short-lived probe process before the actual server. Set `negotiation: "legacy"`
for older servers that should skip probing, or `protocolVersion: "2026-07-28"`
to pin the modern protocol.

```json
{
  "mcp": {
    "local": {
      "command": "node",
      "args": ["/absolute/path/server.mjs"],
      "env": { "SERVICE_MODE": "local" },
      "timeoutMs": 30000
    },
    "remote": {
      "url": "https://your-server.example/mcp",
      "headerEnv": { "Authorization": "MY_MCP_AUTHORIZATION" },
      "allowedTools": ["search", "lookup"],
      "trustReadOnlyAnnotations": false
    }
  }
}
```

For the example above, `MY_MCP_AUTHORIZATION` must contain the complete header
value (e.g. `Bearer …`). SDK-safe environment defaults are inherited by stdio
servers; pass additional variables explicitly through `env`. HTTP redirects
are rejected. Interactive OAuth login is not implemented.

Tool discovery handles pagination. Server failures are reported in `/mcp` and
`/doctor`; a failing server does not prevent other servers from loading.
Tool names are sanitized/bounded with a hash to avoid lossy-name collisions.
External tools require approval unless the user explicitly trusts the server's
read-only annotations. MCP errors retain their error status; structured content
is preserved. Connections close when the CLI exits.

## Plugins

Put `.mjs` files in the user's `plugins/` directory. Plugins are trusted local
code and can register tools and hook event listeners:

```js
export default function ({ registerTool, on }) {
  registerTool({
    name: "greet",
    description: "Return a greeting",
    mutating: false,
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false
    },
    run: async ({ name }, { signal }) => {
      signal?.throwIfAborted();
      return { greeting: `Hello, ${name}` };
    }
  });
  on("toolEnd", ({ tc }) => { /* inspect tc.name */ });
}
```

A tool may set `retryable: false`, `serial: true` or `financial: true`.
`serial: true` prevents overlap even for a tool that is logically read-only.
Plugins that fail to load are reported. Registering a tool with an existing
name overrides it; only load plugins you trust.

## Bitcoin integrations and verification scope

Bitcoin and Liquid queries use public endpoints unless overridden. LND/tapd
require configured REST endpoints, macaroons and optional pinned certificates.
Cashu requires `cdk-cli`; `cashu.cliPath` can select an installed binary. The
adapter matches the vendored CLI's mint/send/melt/restore/request arguments,
uses argument arrays instead of a shell, and redacts proof secrets when listing.
Wavelength requires `waved` and `wavecli` and currently exposes read-only tools.
CoinJoin round execution and Wavelength spending remain unimplemented.

No test sends real funds. The automated suite uses local model/MCP/HTTP servers,
real file/process operations and command fixtures for optional binaries. Live
cloud models and funded wallets require separate credentials/infrastructure.
`doctor` reports missing optional executables rather than claiming readiness.

## Development

```bash
npm run check       # syntax checks + tests
npm test            # bounded tests under tests/, excludes vendored dependencies
npm run lint        # syntax-check ESM files
npm run doctor
npm audit --omit=dev
```

CI installs with `npm ci --ignore-scripts` and runs checks on Node 22 and 24.
Source code lives in `src/`; `runtime.mjs` handles validation/call context,
`agent.mjs` scheduling, `providers.mjs` streaming, `mcp.mjs` integrations,
`processes.mjs` processes, `context.mjs` instructions/compaction, and
`workspace-tools.mjs` planning/Git/web/skills. The terminal theme remains based
on `bitcode design system/`.

Protocol references used for this update: [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model),
[Responses function calling](https://developers.openai.com/api/docs/guides/function-calling),
[reasoning state](https://developers.openai.com/api/docs/guides/reasoning),
[MCP SDK v2 client](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.html),
[MCP protocol negotiation](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html).
