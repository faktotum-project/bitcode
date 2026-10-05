---
name: bitcode
description: Develop QVAC packages with the bitcode coding agent and connect bitcode to local QVAC inference when explicitly requested.
disable-model-invocation: true
---

# bitcode for QVAC

Read [conduct.md](conduct.md) before changing QVAC and
[knowledge.md](knowledge.md) for package and integration entry points.

For a coding request, identify the affected package and follow its own commands.
For local bitcode inference, use the maintained QVAC OpenAI server and bitcode's
OpenAI-compatible provider. Read the CLI's serve documentation before configuring
model aliases, tools, context, or authentication. Use the in-process inference API
only for a Bare application; Node applications use the SDK or HTTP server.

Validate agent configuration with `node scripts/ci/validate-agent-config.mjs`.
