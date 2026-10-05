# Entry points

- Repository architecture: [README.md](../../../README.md) and
  [docs/architecture](../../../docs/architecture/).
- Pure Bare engine and plugin assembly:
  [packages/inference](../../../packages/inference/README.md).
- Node worker lifecycle: [packages/sdk](../../../packages/sdk/README.md).
- Native LLM addon: [packages/llm-llamacpp](../../../packages/llm-llamacpp/README.md).
- Local HTTP serving: [serve guide](../../../packages/cli/docs/serve/README.md)
  and [OpenAI extension](../../../packages/cli/docs/serve/openai.md).
- Contribution and dependency lockfile rules:
  [CONTRIBUTING.md](../../../CONTRIBUTING.md).

bitcode accepts OpenAI-compatible streaming Chat Completions, forwards tool
definitions and history, and executes returned calls in its own agent loop.
Its QVAC provider uses model aliases declared under `serve.models`. A configured
alias may be lazy-loaded; listing it does not prove its weights are downloaded.
Model quality and tool reliability depend on the selected model and chat template.

Canonical skills live in `.agents/skills`. Claude's compatibility view is managed
by `/setup claude`; edit the canonical files and preserve other agent directories.
