# bitcode

A terminal coding and Bitcoin agent, written in Node.js ESM. Works with several
model providers (OpenAI, Anthropic, Groq, Ollama, LM Studio), MCP, local skills
and custom commands. Bitcoin payment tools are testnet-only and always need
your explicit approval.

## Quick start

Requires Node.js **22+** and Bash. No build step.

```bash
npm ci --ignore-scripts
node bitcode.mjs login            # choose a provider and enter your API key
node bitcode.mjs                  # interactive session
node bitcode.mjs -p "fix the failing test"   # one-shot
node bitcode.mjs doctor           # check your setup
```

Local models need no key: `node bitcode.mjs -m ollama/gpt-oss:20b`.

QVAC local inference: `node bitcode.mjs -m qvac/bitcode-local`.
See [setup and model configuration](integrations/qvac/README.md).

## What's inside

| Folder | Content |
|---|---|
| `src/` | agent, providers, MCP, tools, Bitcoin integrations |
| `commands/` | custom slash commands |
| `agents/`, `sats/` | subagent personas and the Sats companion |
| `desktop/` | Electron desktop app (preview) |
| `docs/` | [full reference](docs/reference.md), [Sats](docs/sats.md), [architecture](ARCHITECTURE.md), [plans](docs/plans/) |
| `design/system/` | design system the terminal theme is based on |

## Development

```bash
npm run check    # lint + tests
```

CI runs on Node 22 and 24. See [docs/reference.md](docs/reference.md) for every
command, the approval policy, providers, plugins and the Bitcoin integrations.

## License

MIT
