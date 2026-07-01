# bitcode

A minimal, **zero-dependency** multi-provider terminal coding agent — in the
style of claude code / codex / opencode. Pure Node ESM: no build step, no
`node_modules`. Just run it.

```
node bitcode.mjs
```

## Principles

- **Not your key, not your BTC.** No seed, macaroon, or credential ever
  leaves your machine toward a third party. Signing happens locally
  (`src/bitcoin/wallet.mjs`); remote calls only ever go to nodes you
  configure yourself, or to public endpoints for chain data that carries no
  secrets either way.
- **Full privacy.** No telemetry, no analytics, no network calls beyond
  what a tool you invoked actually needs.
- **Decentralized, like Bitcoin.** Prefer running your own infrastructure
  over depending on someone else's API — see `/btc:node-install` and
  `/ln:node-install` for guided, signature-verified setup of your own
  Bitcoin Core / LND nodes.
- **Minimal dependencies.** A handful of audited crypto libraries
  (`@scure/*`, `@noble/*`) for signing and encoding — everything else
  (HTTP client, ANSI colors, frontmatter parsing, BOLT11 decoding) is
  hand-rolled rather than pulled in as a package.

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
approval gate as calling `wallet_send` directly), and `/btc:node-install`
(guided, signature-verified Bitcoin Core setup). `/ln:node-install` does
the same for LND + Taproot Assets. Add your own commands at
`~/.bitcode/commands/` — they merge with the bundled set and win on name
collisions.

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
  }
}
```

## Tools

Coding: `bash`, `read_file`, `write_file`, `edit_file`, `list_dir`. All
paths resolve against the current working directory.

Bitcoin: chain/mempool/fees (`btc_fees`, `btc_mempool`, `btc_tx`,
`btc_address`, `btc_block`), a full-node RPC bridge (`bitcoin_rpc`), and an
HD wallet (`wallet_create`, `wallet_info`, `wallet_new_address`,
`wallet_descriptor`, `wallet_send`, `btc_broadcast`).

Liquid: read-only chain/mempool/asset tools (`liquid_fees`,
`liquid_mempool`, `liquid_tx`, `liquid_address`, `liquid_block`,
`liquid_asset`) against Blockstream's public Esplora. No wallet — Liquid
uses confidential Elements transactions, which the Bitcoin-only signing
library here can't produce; adding that would mean a new dependency, so
it's out of scope by design.

Lightning: `ln_decode_invoice` (BOLT11 decoding, pure JS, no node needed —
`src/lightning/bolt11.mjs`) always works. With `lightning.lndRestUrl` set
in config (see below): `ln_info`, `ln_balance`, `ln_channels`,
`ln_invoice_create`, `ln_invoice_pay`, and — if `tapdRestUrl` is also set —
`taproot_asset_balance`/`taproot_asset_send` for Taproot Assets (the
protocol Tether's USD₮ runs on over Lightning).

Mutating tools (`bash`, `write_file`, `edit_file`, `wallet_send`,
`ln_invoice_pay`, `taproot_asset_send`, ...) prompt for approval in
interactive mode. Skip prompts with `--yolo`. One-shot mode (`-p`)
auto-approves.

### Lightning / Taproot Assets config

Entirely optional — omit `lightning` from config and only
`ln_decode_invoice` is available. To connect a node you control:

```json
{
  "lightning": {
    "lndRestUrl": "https://127.0.0.1:8080",
    "lndMacaroonPath": "~/.lnd/data/chain/bitcoin/signet/admin.macaroon",
    "tlsCertPath": "~/.lnd/tls.cert",
    "tapdRestUrl": "https://127.0.0.1:8089",
    "tapdMacaroonPath": "~/.tapd/data/signet/admin.macaroon"
  }
}
```

`tlsCertPath` pins the node's own certificate rather than disabling TLS
verification. See `/ln:node-install` for a guided setup.

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
src/config.mjs     provider registry + model resolution
src/providers.mjs  Anthropic + OpenAI-compatible adapters (SSE streaming over node:http)
src/http.mjs       shared zero-dependency HTTP(S) client (Esplora, RPC, LND, tapd)
src/tools.mjs      tool definitions + runners
src/agent.mjs      the tool-calling loop
src/theme.mjs      design-system tokens → terminal theme (banner, pills, timeline)
src/cli.mjs        arg parsing, REPL, one-shot, approval prompts
src/markdown-config.mjs  shared *.md + frontmatter loader
src/commands.mjs   custom /commands (bundled commands/ + ~/.bitcode/commands/)
src/agents.mjs     subagent personas (~/.bitcode/agents/*.md)
src/mentions.mjs   @path file-reference expansion
src/bitcoin/       chain/mempool/RPC/wallet (BIP84, PSBT)
src/liquid/        read-only Liquid sidechain tools (reuses bitcoin/esplora.mjs)
src/lightning/     BOLT11 decoder, LND + Taproot Assets REST clients
commands/btc/      bundled Bitcoin-vertical commands (/btc:fees, /btc:send, ...)
commands/ln/       bundled Lightning-vertical commands (/ln:node-install)
```

The loop: send messages → if the model returns tool calls, run them and feed
results back → repeat until it returns a final text answer.

## Notes

- Streaming uses `node:http` directly (not `fetch`) so a slow, cold-loading
  local model doesn't trip undici's non-configurable headers timeout.
- Local CPU-only models (e.g. a 20B on Ollama without a GPU) are slow on first
  load (minutes). Once warm they respond quickly. Use a smaller model or a
  cloud provider for snappier sessions.
