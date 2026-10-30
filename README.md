<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/wordmark-on-dark.svg">
    <img src="brand/logo/wordmark.svg" alt="bitcode" height="44">
  </picture>
</h1>

**Not your code, not your Sats.**

[![CI](https://github.com/faktotum-project/bitcode/actions/workflows/ci.yml/badge.svg)](https://github.com/faktotum-project/bitcode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22+](https://img.shields.io/badge/node-22%2B-339933)

[Website](https://bitcode-agent.vercel.app/) · [Full reference](docs/reference.md) · [Italiano](README.it.md)

bitcode is a coding agent for the terminal that can also work with Bitcoin,
Lightning and RGB assets. It runs on cloud or fully local models, and it treats
money differently from code: it works on test networks by default, every
payment needs your explicit approval, and spending limits are enforced by code,
not by the prompt. A Linux desktop app ships the same agent in a full workspace.

![bitcode desktop](site/public/assets/desktop/desktop-preview.webp)

## Quick start

```bash
git clone https://github.com/faktotum-project/bitcode.git && cd bitcode
npm ci --ignore-scripts
node bitcode.mjs login                       # choose a provider and enter your API key
node bitcode.mjs                             # interactive session
node bitcode.mjs -p "fix the failing test"   # one-shot
```

No API key? Use a local model: `node bitcode.mjs -m ollama/gpt-oss:20b`.

## Install and run

Requires Node.js **22+** and Bash. There is no build step.

`npm ci --ignore-scripts` installs the coding agent only. The optional Cashu and
Wavelength wallet binaries are built separately, when you need them:

```bash
npm run build:cdk          # Cashu (cdk-cli): Rust toolchain + deps/cdk submodule
npm run build:wavelength   # downloads the pinned waved/wavecli release
npm link --ignore-scripts  # exposes the global `bitcode` command
bitcode doctor             # reports what is configured and what is missing
```

State and keys live in `~/.bitcode` (owner-only files); set `BITCODE_HOME` to
use another directory. See [install and run](docs/reference.md#install-and-run)
for every option.

## Models and providers

Pick a model with `-m <provider>/<model>`, or switch inside a session with
`/model` and `/models`.

| Provider | Runs | Key |
|---|---|---|
| `anthropic` | cloud | `ANTHROPIC_API_KEY` |
| `openai` | cloud (Responses API) | `OPENAI_API_KEY` |
| `openrouter` | cloud | `OPENROUTER_API_KEY` |
| `groq` | cloud | `GROQ_API_KEY` |
| `ollama` | local | none |
| `lmstudio` | local | none |
| `qvac` | local | none |

Local models are discovered at runtime: `/models` lists what is installed on
your machine. Any OpenAI-compatible endpoint can be added in
`~/.bitcode/config.json`. Details in
[models and providers](docs/reference.md#models-and-providers).

### Local inference with QVAC

```bash
npm --prefix integrations/qvac ci
npm --prefix integrations/qvac start          # server on 127.0.0.1:11435
node bitcode.mjs -m qvac/bitcode-local
```

See [QVAC setup and model configuration](integrations/qvac/README.md).

## Tools

Tools are grouped in profiles. Switch with `--profile` or `/profile`.

| Profile | What the agent can do |
|---|---|
| `code` (default) | files, shell and managed processes, Git, web fetch, planning, skills, subagents, MCP servers |
| `bitcoin` | adds chain and mempool queries, BIP84 wallet, Lightning/tapd, Cashu, Liquid (read-only), Wavelength (read-only) |
| `rgb` | operates an RGB Lightning Node through `kaleido-mcp`: balances, invoices, transfers |

Extend it with [MCP servers](docs/reference.md#mcp), local skills, custom slash
commands in `content/commands/` and [plugins](docs/reference.md#plugins). The full list
is in [tools](docs/reference.md#tools).

### RGB assets

```bash
node bitcode.mjs -m qvac/bitcode-rgb-4b --profile rgb
```

Check balances, create invoices and send RGB assets in plain language, on
Signet (Mutinynet) test funds. See [node setup](integrations/kaleido/README.md).

## Safety and approvals

- **Test networks by default.** The protected `bitcode finance` path accepts
  only signet, testnet and testnet4. The wallet tools refuse mainnet broadcasts
  unless you set `bitcoin.allowMainnetSpend=true`.
- **You approve every payment.** Financial tools always ask for confirmation,
  in every permission mode. One-shot runs refuse them unless you pass
  `--allow-payments`.
- **Limits in code.** `bitcode finance policy` sets per-payment, daily, fee and
  reserve limits in satoshis. A model can only *prepare* a proposal;
  `bitcode finance execute` shows the exact payment and asks you to type its ID.
- **Undo for code.** `/diff` and `/undo` restore the files changed by the last
  agent turn.
- **Sandboxed shell.** In `full-auto`, shell commands run inside Bubblewrap with
  no network access and only the project and `/tmp` writable.

Shell commands and plugins you trust can still reach your machine: the payment
gate is tool policy, not an OS sandbox. See
[execution and approval policy](docs/reference.md#execution-and-approval-policy)
and [financial proposals](docs/reference.md#financial-proposals-phase-1-testnet-path).

## Desktop app (Linux)

Release **v0.3.0** pairs **Desktop 0.3.0** with **CLI 0.4.0**. Their package
versions are independent. See the [release verification record](docs/releases/0.3.0.md).

The same agent in an Electron workspace: projects, editor, Git, terminal, an
agent worker isolated with Bubblewrap, a Bitcoin test wallet and RGB wallet
sessions with payment approvals.

```bash
npm run dist:desktop              # builds desktop/release/bitcode-desktop_<version>_amd64.deb
sudo apt install ./desktop/release/bitcode-desktop_*_amd64.deb
bitcode-desktop                   # or: bitcode desktop
```

The package (amd64) also installs the CLI as `/usr/bin/bitcode`, unless another
`bitcode` already owns that path. The app lives in the tray, can start at login
and blocks system suspension only while an agent run is active. See
[desktop/](desktop/) and the [plan](docs/archive/desktop-plan.md).

## Sats

Four specialist subagents, each with a fixed role and a tool allowlist enforced
in code:

| Sat | Role |
|---|---|
| Node | research and context, read-only chain queries |
| Script | implementation |
| Hash | security analysis |
| Merkle | review |

```text
/sats                       list the Sats
/sat merkle                 use a Sat for the next messages
node bitcode.mjs --sats     open the animated companion
```

See [docs/sats.md](docs/sats.md).

## Glossary

| Term | Meaning |
|---|---|
| **RGB** | assets issued on Bitcoin, validated client-side and transferred on-chain or over Lightning |
| **QVAC** | Tether's local AI runtime, used here as an OpenAI-compatible server |
| **Cashu** | ecash protocol for private payments backed by a Lightning mint |
| **Wavelength** | Lightning Labs toolkit for self-custodial Bitcoin, Lightning and Ark payments without running a node |
| **Signet / Mutinynet** | Bitcoin test networks: coins with no value |
| **MCP** | Model Context Protocol, the standard way to plug external tools into an agent |

## Repository layout

| Folder | What |
|---|---|
| `src/` | CLI source (`bitcode.mjs` is the entry point) |
| `content/` | Markdown the CLI loads at runtime: `agents/`, `commands/`, `sats/` |
| `ui/sats/`, `assets/sats/` | The `/sats` web view and the Sats images it serves |
| `desktop/` | Electron desktop app |
| `integrations/`, `deps/` | QVAC and Kaleido integrations; Cashu `cdk` submodule |
| `brand/` | Design system: tokens, logo, Sats profiles ([brand/README.md](brand/README.md)) |
| `site/` | Website: `src/` template and i18n, `public/` what Vercel serves, `scripts/` build and checks |
| `docs/` | Reference and Sats docs; `docs/archive/` holds completed plans |
| `scripts/`, `tests/` | Build helpers (Cashu, Wavelength, lint, Sats assets) and the test suite |

## Development

```bash
npm run check          # lint + tests
npm run test:desktop   # desktop app tests
```

CI runs on Node 22 and 24. Code layout and internals: [ARCHITECTURE.md](ARCHITECTURE.md)
and [development](docs/reference.md#development). Changes per version:
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)

### Personal full node

`bitcode node install` opens the Bitcoin Core wizard without requiring an AI provider. Desktop's **Node** page uses the same installer, with optional local mempool explorer, connection/adoption of existing nodes, and Merkle-assisted diagnosis. Ubuntu x64 host checks cover Signet provisioning, Mainnet adoption and lifecycle, experimental Mutinynet builds, and service startup after reboot. See [node setup](docs/fullnode.md) and the [release verification record](docs/releases/0.3.0.md) for synchronization and platform gates.
