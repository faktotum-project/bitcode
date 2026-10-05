# bitcode × QVAC

QVAC's maintained OpenAI-compatible server connects to bitcode's existing
streaming/tool-calling adapter. The SDK runs its own Bare worker. This integration
does not require a global Bare installation or a second completion wrapper.

From the bitcode repository:

```sh
npm --prefix integrations/qvac ci
npm --prefix integrations/qvac start
```

In a second terminal:

```sh
node bitcode.mjs -m qvac/bitcode-local -p 'Rispondi in italiano: quanto fa 2 + 2?'
node bitcode.mjs -m qvac
```

The desktop model picker uses the same provider registry. After rebuilding and
restarting the desktop app, select `qvac/bitcode-local` among local models while
the server is running. An older installed desktop build needs an update.

`agent-skill/` preserves the skill installed in the separate QVAC source tree.
Copy it to that repository's `.agents/skills/bitcode`, create the Claude mirror
at `.claude/skills/bitcode` pointing to `../../.agents/skills/bitcode`, and link
the skill from that repository's AGENTS.md. Its documentation links are relative
to the target QVAC skill location. Run the QVAC repository agent validator after
installation.

The server listens on `127.0.0.1:11435`; Ollama uses a different port. `/models`
discovers QVAC's configured aliases. The first completion downloads and loads
Qwen3 600M Q4 through QVAC's registry. This small model is a smoke-test default;
coding and reliable tool use benefit from a larger instruction model chosen for
the available memory. All inference happens locally once weights are available.

For an existing local GGUF, replace the model entry with:

```json
{
  "src": "/absolute/path/to/model.gguf",
  "type": "llamacpp-completion",
  "default": true,
  "preload": false,
  "config": { "ctx_size": 8192, "tools": true }
}
```

Use an instruction model with a chat template and tool support. Adjust context
to memory and prompt length. `preload: true` loads the model before the server
accepts connections. Stop the server with Ctrl+C to release the worker.

For a custom server address, configure
`providers.qvac.baseURL` with `bitcode config set`. For authenticated serving,
pass `--api-key-file` to QVAC and set `QVAC_API_KEY` for bitcode. Keep credentials
out of the checked-in configuration.

Sources: [QVAC server](https://docs.qvac.tether.io/cli/http-server/),
[Node SDK lifecycle](https://docs.qvac.tether.io/js-ts-sdk/).

## Validation

Verified on 2026-10-05 with the installed CLI and its packaged native addons:

- bitcode syntax checks and all 179 tests passed, including a two-turn streaming
  tool-call/result integration test.
- The real QVAC server exposed `bitcode-local`, downloaded the 382 MB model,
  loaded it, and completed GPU inference.
- A real bitcode one-shot request with read-only tools returned `4` for `2 + 2`
  with status `completed`.
- The desktop build and all 29 desktop tests passed. The desktop controller's
  real `models.available` response included the running `qvac/bitcode-local`.
- The QVAC repository agent validator passed after installing the bitcode skill;
  its Claude symlink resolves to the canonical skill.
- The optional full Claude-mirror check reports missing pre-existing entries for
  other skills. The generic Codex skill validator rejects QVAC's Claude-specific
  `disable-model-invocation` field; the repository validator accepts it, and the
  Codex invocation policy is explicitly false in `agents/openai.yaml`.

This uses published packages and precompiled addons; the complete QVAC source
monorepo and its C++ addons were not compiled from source.
