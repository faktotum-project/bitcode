# Operating agreement

Follow the repository AGENTS.md and nearest package instructions. Preserve
unrelated work and package boundaries. Check implementation and manifests before
using API examples: inference runs on Bare, while the SDK owns Node worker startup.

Do not execute model-generated tools inside an inference bridge. Return calls to
bitcode so its existing approval policy and tool loop apply. Respect cancellation
and report truncated completions without executing their partial tool calls.

Run the affected package's narrow checks and report actual failures or unavailable
dependencies. Validate agent configuration after changing this skill. Do not
commit, push, publish, or install system dependencies without task authorization.
