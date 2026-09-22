# Bitcode architecture and financial-agent readiness

## 1. Status and baseline

This is the Phase 0 architecture audit for the proposed local economic agent. It documents the existing implementation, integration points, security gaps, dependency impact, and migration risks. **It does not implement or certify the proposed financial guarantees.** Stop after this document; Phase 1 is separate work.

| Baseline | Value |
| --- | --- |
| Inspection date | 2026-09-22 |
| Branch | `feat/local-model-discovery` |
| Commit | `298a0bdf31cecdf076f53efc3c2c12f32732178f` |
| Package | `bitcode` 0.2.0 |
| Runtime | Node.js >= 22, ESM |
| Worktree before this document | Clean |
| New dependencies, runtime changes, transactions | None |

The assessment covers first-party runtime paths and relevant tests, configuration, command templates, and install scripts. It is not a complete cryptographic review of dependencies, an operational audit of a user's wallet/node, or a live QVAC/RGB/WDK interoperability test. Static implementation evidence takes precedence over aspirational comments and older roadmap documents.

The target remains: local financial reasoning, self-custodial execution, deterministic policy, and explicit human approval. Extend the existing architecture rather than replacing its agent loop, provider adapters, registry, CLI, or working Bitcoin functionality.

## 2. Current architecture

```text
bitcode.mjs
  -> CLI: arguments, config, workspace, profile, permissions
  -> provider selection + extensions + tool construction
  -> interactive or one-shot session
  -> runAgent
       -> callModel(primary / configured fallbacks)
       -> validate tool arguments
       -> approval hook for mutations, when supplied
       -> tool execution -> formatted result -> model conversation
       -> checkpoint/session persistence
```

| Subsystem | Source and existing behavior | Extension point |
| --- | --- | --- |
| Entry and CLI | [bitcode.mjs](bitcode.mjs), [cli.mjs](src/cli.mjs): startup, one-shot/interactive runs, slash commands, provider switching, approvals and shutdown | Financial session setup and trusted review UI |
| Agent loop | [agent.mjs](src/agent.mjs): `runAgent`, budgets, cancellation, parallel reads, mutation barriers, provider fallback; no automatic retries of mutating tools | Enforce financial context through the existing loop |
| Provider registry | [config.mjs](src/config.mjs): built-ins, custom providers, aliases and `<provider>/<model>` resolution | Register QVAC without another model-selection system |
| Inference adapters | [providers.mjs](src/providers.mjs): Responses, OpenAI-compatible Chat Completions and Anthropic Messages; streaming and canonical tool calls | Adapt QVAC output to the same message/tool-call contract |
| Local discovery | [local-models.mjs](src/local-models.mjs): Ollama/compatible model listing, health and startup selection | Reuse discovery and add runtime-specific lifecycle only where needed |
| Tool registry | [tools.mjs](src/tools.mjs): schema-bearing `run` tools, plugin registry, profile composition and name deduplication | Add financial adapters through `buildTools`; reject unsafe collisions |
| Validation and permissions | [runtime.mjs](src/runtime.mjs), [permissions.mjs](src/permissions.mjs): AJV validation, result truncation, mutation classification and permission modes | Mandatory financial authorization, safe result projection |
| Configuration and state | [config.mjs](src/config.mjs), [paths.mjs](src/paths.mjs): JSON config and `BITCODE_HOME`, defaulting to `~/.bitcode` | Validated policy and separate durable financial state |
| Commands and subagents | [commands.mjs](src/commands.mjs), [agents.mjs](src/agents.mjs), [tools.mjs](src/tools.mjs): Markdown command templates and personas; nested agents inherit execution context, hooks and budgets | Preserve restrictions across both tool and slash-command delegation |
| Coding plans | [plans.mjs](src/plans.mjs), [cli.mjs](src/cli.mjs): `/plan` runs with read-only tool filtering and saves Markdown; `/build` runs that plan with normal gates | Keep coding plans separate from financial proposals |
| Workspace and shell | [project.mjs](src/project.mjs), [processes.mjs](src/processes.mjs), [workspace-tools.mjs](src/workspace-tools.mjs): file path confinement, shell/process tools, Git, web fetch and skills | Capability and environment isolation for financial sessions |
| Conversation lifecycle | [session.mjs](src/session.mjs), [context.mjs](src/context.mjs), [mentions.mjs](src/mentions.mjs): persistence, export, model-based compaction and file inclusion | Protect all financial context before inference, export and storage |
| Extensions | [plugins.mjs](src/plugins.mjs), [hooks.mjs](src/hooks.mjs), [mcp.mjs](src/mcp.mjs): in-process JS plugins, observers and external MCP servers | Define trusted extensions and deny unapproved financial capabilities |
| Presentation and diagnostics | [tui.mjs](src/tui.mjs), [settings.mjs](src/settings.mjs), [diagnostics.mjs](src/diagnostics.mjs) | Reuse terminal interaction and show measured runtime/safety status |
| Filesystem undo | [checkpoint.mjs](src/checkpoint.mjs): snapshots workspace files and Git index for `/undo` | Exclude financial state from coding rollback; never imply payment reversal |

### Profiles, commands and state

The CLI resolves `code` or `bitcoin` from explicit configuration or project signals; the fallback is `code`. `buildTools` itself defaults to `bitcoin` when called without a profile, so library callers must pass their intended profile explicitly. Both profiles include generic coding/process tools and applicable registered extensions. A profile is not currently a financial isolation boundary.

Built-in namespaced commands such as `/btc:send` and `/ln:pay` are Markdown prompts. Their instructions are useful UX guidance, not enforcement. User/workspace command definitions can override bundled templates. Future policy/status/audit commands should display trusted application state; payment commands must use the same protected execution path as model-requested tools.

Model resolution prefers CLI, then `BITCODE_MODEL`, config, and a built-in fallback. Local discovery can select an installed model when no model/key has been configured. This is convenience behavior, not a mandatory local-only policy.

Config and session writes use atomic replacement and owner-only modes. Plans and other subsystem state have their own persistence paths. The new audit directory must respect `bitcodeHome()` rather than hardcoding `~/.bitcode`.

## 3. Existing Bitcoin and adjacent infrastructure

| Component | Implemented capability | Important boundary |
| --- | --- | --- |
| Bitcoin wallet | [wallet.mjs](src/bitcoin/wallet.mjs): BIP39/BIP32, BIP84, descriptors, UTXO scanning, unsigned PSBT construction, local signing, optional broadcast and sweep | `createPsbt` and `signPsbt` are reusable; `send` currently combines preparation and signing |
| Bitcoin network/data | [network.mjs](src/bitcoin/network.mjs), [esplora.mjs](src/bitcoin/esplora.mjs): mainnet, testnet, testnet4 and default signet; public Esplora defaults | This resolver does not currently support regtest; local reasoning does not make explorer queries private |
| Bitcoin Core | [rpc.mjs](src/bitcoin/rpc.mjs), [tools.mjs](src/bitcoin/tools.mjs): arbitrary RPC method/params with configured or cookie authentication | A generic financial approval prompt does not validate RPC semantics |
| Lightning | [lnd.mjs](src/lightning/lnd.mjs), [bolt11.mjs](src/lightning/bolt11.mjs), [tools.mjs](src/lightning/tools.mjs): invoice decoding, balances, channels, invoice creation and payment | LND holds signing authority; its configured endpoint need not run in the CLI process or on this machine |
| Taproot Assets | [tapd.mjs](src/lightning/tapd.mjs): balance/assets/address/send client; balance/send exposed as tools | Separate tapd credentials; preserve support, but do not silently substitute it for RGB |
| Liquid | [liquid/tools.mjs](src/liquid/tools.mjs): chain/asset queries | Read-only integration; no local Liquid spending wallet here |
| Cashu | [cashu/tools.mjs](src/cashu/tools.mjs), [cashu/wallet.mjs](src/cashu/wallet.mjs): CDK subprocess wallet, mint/melt/send/receive, requests and proof inspection | Bearer tokens and mint trust require separate treatment; proof-list redaction does not sanitize every result |
| CoinJoin | [coinjoin/tools.mjs](src/coinjoin/tools.mjs): risk-consent record and isolated temporary-wallet create/status/drain/destroy | JoinMarket round execution is not wired up; a consent string supplied by an LLM is not proof of human input |
| Wavelength | [wavelength/tools.mjs](src/wavelength/tools.mjs): optional managed `waved` and `wavecli` MCP integration | Only schema-classified read-only methods are registered; daemon startup itself changes local state |

The Bitcoin wallet stores its mnemonic in an owner-readable wallet JSON file, or reads `BITCODE_MNEMONIC`. Creation does not return the mnemonic. A human CLI seed-reveal command exists. However, the agent-facing `wallet_create` schema accepts a mnemonic for restoration, and read/prepare wallet operations derive from the secret in the same process. This is not a watch-only planner separated from a signer.

No QVAC, RGB, WDK, economic policy, financial proposal store or dedicated financial audit implementation was found in the inspected first-party runtime. Existing roadmap documents and protocol comments are not evidence of a working integration or currently available assets.

## 4. Current security boundaries and gaps

The current safety model combines tool metadata, CLI prompts, scoped file helpers, optional shell sandboxing and instructions. It does not yet provide the complete financial boundary described in the mission.

| Priority | Evidence | Required correction in later implementation |
| --- | --- | --- |
| Blocking | `runAgent` checks `hooks.approve` only when present | Deny financial execution when the trusted approval authority is missing; protect the executor/signer as well as the UI |
| Blocking | CLI `requiresPaymentApproval` defeats `--yolo`, but one-shot `--allow-payments` authorizes financial tools wholesale | No blanket approval in Financial Safe Mode; reject unattended signing without a reviewed, transaction-bound approval |
| Blocking | Shell children inherit environment; unsandboxed processes run with user access; plugins execute arbitrary JS in-process | Keep signing secrets outside the agent's accessible capabilities; an in-process module boundary is insufficient against arbitrary code |
| Blocking | `bitcoin_rpc` passes arbitrary methods; `wallet_create` accepts mnemonic arguments | Restrict financial RPC capabilities; move seed import/reveal to a protected human-only path |
| Blocking | Tool arguments, formatted results and exception text enter conversation/hooks/session state | Apply safe projections before observers, persistence and model requests; prevent secret ingress, not just known-key redaction |
| Blocking | Provider fallback, model switching, session resume and compaction can reuse context | Establish local-only restrictions before the first financial prompt and retain them across every inference path |
| High | `isLocalProvider` trusts `local: true`; extensions and web tools can communicate externally | Validate allowed inference endpoints/runtime and restrict egress; a provider label is not evidence of locality |
| High | Approval precedes `wallet_send` preparation; displayed arguments can omit calculated fees | Prepare and verify a concrete proposal before human review and signing |
| High | `ln_invoice_create` is marked `mutating: false` despite creating node state | Separate read-only, local preparation and value-moving actions; `/plan` must not gain unintended side effects |
| High | Coding checkpoints can include application state if stored inside the workspace | Keep secrets and financial state outside generic snapshot/undo paths; rollback must not resurrect approval or spending allowance |

The shell sandbox currently uses Bubblewrap for full-auto, with network isolation and a masked `/home`; if unavailable the CLI downgrades to auto-edit. It is not enabled for every execution path, does not provide a clean secret-free environment, and does not sandbox in-process plugins. File helpers enforce workspace boundaries, but `@path` inclusion uses a separate path-reading implementation. Inspect both, along with credentials stored inside the workspace.

Treat project instructions, invoices, asset metadata, external tool results and model output as untrusted data. None can authorize a payment, change policy, or assert that the human approved. Read-only access can still leak private financial data.

Preserve existing coding behavior where compatible. In the protected financial session, disable legacy financial tools and extensions until their adapters satisfy the new guarantees. Do not advertise those guarantees for other sessions or already-exported history. Loading untrusted plugins before enabling the mode cannot be repaired by hiding their tools afterward.

## 5. Proposed integration architecture — not implemented

```text
Human <-> existing Bitcode CLI/session
              |
              v
       existing agent loop <-> QVAC local provider
              |
       financial tools in existing registry
              |
       validated intent + verified wallet data
              |
       policy precheck -> compatible route -> unsigned preparation
              |
       final deterministic policy check + durable proposal/reservation
              |
       trusted human review -> one-use approval
              |
       protected executor / signer -> rail execution -> reconciliation
              |
       durable operation state + local audit
```

QVAC is a provider inside the existing agent architecture, not a second agent loop. WDK is a wallet backend, not a payment rail alongside Bitcoin and RGB. Lightning keeps its node-managed payment lifecycle rather than pretending every payment has a separately broadcastable PSBT.

| Proposed module | Responsibility and existing integration point |
| --- | --- |
| `src/economic/intent.mjs`, `router.mjs`, `proposal.mjs`, `audit.mjs` | Validate intent, resolve compatible routes, persist proposal/execution state and record sanitized events; expose capabilities through existing tools |
| `src/policy/engine.mjs`, `rules.mjs`, `store.mjs` | Deterministic checks, versioned human-controlled rules, durable spending/reservation state; status/check tools are informative, never authorization tokens |
| `src/qvac/provider.mjs`, `runtime.mjs`, `models.mjs` | Extend provider registry/discovery; supply canonical model responses and only the lifecycle operations not already covered |
| `src/rgb/` client/wallet/assets/transfers/validation/index | Isolated backend adapter, registered tools and CLI entry points; no RGB-specific logic embedded in `agent.mjs` |
| `src/wdk/` client/wallet/index | Optional wallet adapter after the primary flow works; preserve the current wallet as default |
| Protected signing boundary | Reuse Bitcoin signing primitives behind enforced authorization; decide process/OS isolation before claiming shell or plugin resistance |

These are proposed internal interfaces and responsibilities, not shipped APIs or a requirement to create every file immediately. There are no public API changes in Phase 0. Keep existing provider/message contracts and tool schema validation. Extend metadata centrally instead of maintaining a growing list of payment names as the sole security mechanism.

The proposed `WalletProvider` surface (`getBalance`, `getAddress`, `prepareTransfer`, `signTransfer`, `broadcastTransfer`) is an adapter contract for compatible wallets. Capability detection and rail-specific execution remain necessary. Switching `walletProvider` must not silently import seeds, migrate state, change networks or share RGB-controlled UTXOs.

### Financial invariants

- Identify assets by stable protocol identifiers, not a ticker such as `USD`. Keep asset identity, rail and chain environment distinct; `rgb` does not identify mainnet versus a test environment.
- Use exact atomic amounts, with explicit decimals and string serialization where needed. Do deterministic budget arithmetic outside the model. Fiat valuation requires a declared source and freshness policy; absent that, do not invent conversion rates.
- Resolve the recipient or validate an invoice before preparing a payment. Ambiguous names require human clarification. Route selection may recommend a supported rail but must not silently exchange assets or switch rails after failure.
- Precheck policy before preparation and check the completed proposal again with current balances, fees and reserved spending. Define the daily time window, fee accounting and minimum reserve per asset/account.
- Bind approval to a canonical proposal identity, wallet, recipient, amount, asset, chain, rail, fee policy, expiry and applicable policy version. The signer verifies the actual transaction/commitments; immutable JSON alone is insufficient.
- On changed approval-bound fields, expiry or invalidated state, abort and require a new review. A fee estimate and an approved maximum are distinct, especially for Lightning.
- Capture approval through trusted human interaction, not model text or tool arguments. Consume it once; concurrent processes and restart recovery must not permit replay or overspending.
- Persist operation state before irreversible execution. Treat interrupted broadcasts/payments as unknown until reconciled by transaction/payment identifier. Never retry by creating another payment merely because a response was lost.
- Require a durable audit event before signing/execution. If recording fails afterward, preserve the known/unknown transaction outcome and reconcile it; do not report that funds did not move.
- Keep secrets, bearer material, signed broadcastable payloads and raw credentials out of model context and general logs. Use minimal structured audit fields, owner-only access and an explicit retention policy.

JSONL is suitable for audit events, but is not by itself an atomic proposal/approval/budget ledger. Session history is not that ledger either. Historical spending analytics must reconcile wallet activity, including payments made outside Bitcode; an audit of agent actions alone is incomplete.

## 6. Integration feasibility and dependency impact

### QVAC

The official [QVAC overview](https://docs.qvac.tether.io/) documents a Node-compatible JS/TS SDK and an OpenAI-compatible HTTP server. The [HTTP server documentation](https://docs.qvac.tether.io/cli/http-server/) covers model listing, streaming, unloading and function tools, with model configuration requirements. These establish plausible reuse of Bitcode's adapters, not tested interoperability in this repository.

Prefer evaluating the local compatible-server path first because it reuses the existing transport. Adopt direct SDK embedding only if lifecycle, deployment or required capabilities justify it. Either approach must keep tool execution in Bitcode, pin tested versions, specify supported hardware/model/context limits, and test cancellation and multi-turn tool results. Keep model downloads separate from verified offline inference. Runtime memory/device/status fields must be measured or reported unavailable.

There is a concrete discovery compatibility issue: QVAC documents port `11434`, while Bitcode's `isOllama` also recognizes providers by that port. Choose a distinct endpoint or correct identification before claiming native QVAC discovery.

### RGB

Official [developer tooling](https://rgb.info/build/developer-tools/) provides candidate libraries and bindings. The [rgb-lib repository](https://github.com/RGB-Tools/rgb-lib) documents watch-only use with external signing, API instability before 1.0, and exclusive wallet/UTXO ownership requirements. **Do not reuse its wallet concurrently from Bitcode's ordinary coin selection or WDK.** Start with segregated wallet state/funds unless a single coordinated UTXO owner is proven.

Choose and pin a backend, binding/daemon interface and supported test network. Validate unsigned preparation, external signing, proof transport, recovery and receiver compatibility before finalizing the adapter. The [documented transfer flows](https://github.com/RGB-Tools/rgb-lib/blob/master/docs/transfer_flows.md) distinguish default receiver-ACK transfers from donation mode; the adapter must deliberately select and expose the actual lifecycle.

Acceptance must include valid consignment delivery/verification, recipient state and sufficient Bitcoin confirmation evidence, not merely a broadcast response. Preserve client-side state and backup/recovery material; seed backup alone must not be assumed sufficient. Classify tools by actual backend effects: verification/import or status refresh must not be labeled read-only if it changes state or advances execution.

### WDK

The official [Bitcoin API](https://docs.wdk.tether.io/sdk/wallet-modules/wallet-btc/api-reference/) documents quote, sign-without-broadcast and send operations. Compatibility with a frozen unsigned Bitcode proposal still needs a contract test; a quote followed by a separately rebuilt transaction is not automatically the reviewed transaction. Confirm network support and state ownership explicitly. A generic Bitcoin wallet module does not establish RGB support.

### Dependency inventory

The six direct npm dependencies in [package.json](package.json) are `@modelcontextprotocol/client`, `@noble/hashes`, `@scure/bip32`, `@scure/bip39`, `@scure/btc-signer` and `ajv`. The existing `postinstall` also builds CDK Rust binaries and downloads Wavelength binaries through the repository scripts. Minimal dependencies therefore means controlling native/runtime and transitive costs as well as npm counts.

| Addition | Likely impact to measure before adoption |
| --- | --- |
| Policy/proposals/audit | Can begin with existing Node primitives; durable locking and crash consistency require an explicit design before choosing a database dependency |
| QVAC | External local runtime or embedded SDK, model storage, native backends, RAM/VRAM and startup lifecycle |
| RGB | Protocol library/bindings or daemon, wallet database, proof storage/transport and chain-indexing service |
| WDK | Optional wallet package and transitive dependencies; provider/network configuration and signing compatibility |

No package or model was installed for this audit. Record exact selected versions, licensing, platforms, size, network behavior and purpose before adding any dependency. In particular, no-telemetry claims must cover the selected runtime configuration and dependencies, not just first-party code.

## 7. Corrected demo contract

The original `$120` example cannot be policy-allowed under a `$50` per-transaction limit. For a successful demo, use an explicitly configured maximum of at least 120 asset units (for example 150), a daily allowance that covers the payment and applicable fee accounting, and a reserve of 500. Do not modify a policy silently to make the demo pass.

Before the user says “Pay”, establish:

1. A verified available balance of 800 units of the identified RGB asset; a user-stated balance is only a hypothetical input.
2. A compatible recipient invoice/address, amount 120, and explicit test/production chain.
3. BTC funds for anchor fees and any required output funding, shown separately from the asset balance.
4. Prior daily spending and pending reservations; an unexpired prepared proposal.

The asset balance after payment is 680 units before any asset-denominated charges. Show BTC costs separately. A test-issued token labeled as a dollar is not evidence of a redeemable dollar asset; identify the issuer/contract and label test assets honestly.

“Pay” requests preparation/review, not approval. A separate human confirmation authorizes the specific proposal. Display prepared, approved, executing, submitted/pending, confirmed or unknown states from backend evidence. “No funds moved” is valid only when non-execution is known. Receiver validation and chain confirmation complete the RGB acceptance check.

For the initial end-to-end demo, use one asset, one known recipient and one supported RGB route. General multi-rail recommendations, anomaly detection and WDK must not delay that flow.

## 8. Migration risks and compatibility

| Risk | Mitigation / acceptance condition |
| --- | --- |
| Financial controls accidentally disable ordinary coding automation | Keep coding permissions separate; test `--yolo` for coding and mandatory gates for protected payments |
| Existing tools bypass the new executor | Inventory all signing, broadcast, credential, RPC, plugin and subprocess paths; disable unsupported capabilities in financial sessions |
| Secrets remain reachable through environment or state files | Define the threat model and enforce process/OS access boundaries before enabling the guarantee |
| Cloud provider sees finance before intent detection | Activate the protected session before inference; do not rely on a cloud model to classify private requests first |
| Saved sessions leak on model/profile change | Persist the privacy restriction and refuse unsafe reuse; a new clean coding session must not inherit finance history |
| Policy edits or `/undo` restore spending headroom | Protect policy updates, version them, and keep financial state outside coding rollback |
| Wallet backend switch changes derivation/network/UTXOs | Explicit account mapping, isolated RGB ownership, no automatic seed/state migration |
| Test infrastructure assumes unsupported regtest | Select a mutually supported isolated network or plan the required network support explicitly |
| Local finance mode inherits unrelated legacy rails | Keep them available in their existing supported context, but exclude them from the new guarantee until adapted and tested |

Signing authority can live in an owned LND node or another protected signer, rather than inside the CLI. Display the actual configured signing location; do not report “local” solely because the wallet is self-custodial.

## 9. Hackathon boundary and delivery order

The [official Agentic Dollars event page](https://rgbprotocol.org/agentic-dollars-hackathon/) lists October 17–18, 2026, requires RGB and QVAC, awards a bonus for WDK, and evaluates working execution and substantial work completed during event hours alongside marketability and UX. It does not, by itself, settle every question about permitted pre-existing code or preparatory mocks.

The user's preparation boundary is stricter: before the build window, prepare architecture, research, security design, demo specification and only permitted interfaces/tests/mocks. Do not assume Phase 1 is exempt. Confirm detailed organizer rules before implementing event-specific work; tag/commit provenance is evidence, not an eligibility waiver.

Recommended later order, preserving the original phase identities:

1. **Phase 0 — this audit:** documentation only, then stop.
2. **Phase 1 — safety foundation:** protected context, deterministic intent/policy, proposals, approval, execution state and audit over existing supported Bitcoin/Lightning paths; no new protocol required.
3. **Phase 2 — QVAC:** verify local inference and the existing agent loop with a pinned model/runtime.
4. **Phase 3 plus the minimum Phase 5 connection:** one real RGB transfer through intent, policy, review, execution and recipient verification.
5. **Phase 6 — hardening:** restart recovery, failure visibility, offline reasoning and reproducibility of that minimal flow.
6. **Phase 4 — optional WDK:** add only after the primary flow works; broaden Phase 5 routing/intelligence afterward as time permits.

Document a concrete target user and payment problem for the demo, rather than presenting every existing rail as part of the new product. Preserve Bitcode's existing capabilities without claiming they all satisfy the new self-custodial-dollar workflow.

The intended `pre-agentic-dollars` tag and `hackathon/agentic-dollars` branch are not created in Phase 0. At the appropriate build boundary, capture the actual baseline commit and an inventory of pre-existing functionality; do not backdate provenance.

## 10. Verification evidence and Phase 1 entry conditions

During the preceding coherence review in this session, the following targeted command passed **55 tests, 0 failures, 0 skipped** against the baseline commit:

```bash
node --test --test-timeout=30000 --test-reporter=spec tests/agent.test.mjs tests/cli.test.mjs tests/tools.test.mjs tests/runtime.test.mjs tests/providers.test.mjs tests/local-models.test.mjs
```

The initial sandboxed run could not complete successfully; the authorized rerun supporting local HTTP test servers passed. Coverage includes tool ordering, cancellation, mutation retry prevention, provider streaming/fallback, local discovery, schema validation, default financial refusal, inherited subagent approval, and `/plan`/`/build`. No real payment or QVAC/RGB/WDK integration was exercised. This is not the full regression suite and does not demonstrate the proposed security properties. No new tests are introduced for this documentation-only change.

Before Phase 1 implementation, resolve and record:

- The permitted build window and scope of preparatory work.
- The financial session entry point, trusted-extension policy and enforceable signer isolation on the target OS.
- Exact asset/unit semantics, daily window, fee limits, reserve rules and treatment of external wallet activity.
- A durable proposal/approval/reservation state design with atomic consumption and crash reconciliation.
- A supported isolated test environment and approved adapter inventory; retain no unprotected execution escape paths.

Phase 1 must then demonstrate the following before a new rail can execute:

| Scenario | Required result |
| --- | --- |
| No approval hook/UI; one-shot; `--yolo`; `--allow-payments` | Protected financial execution denied without transaction-specific human approval |
| Proposal, recipient, asset, network, wallet or fee policy changed; proposal expired | Existing approval invalidated; no signature before a new review |
| Replayed approval, duplicate request, two concurrent sessions or process restart | At most one execution authorization; spending reservations remain consistent |
| Timeout after submit or crash after signing | Outcome marked unknown/pending and reconciled; no fresh automatic payment |
| Audit/state write fails before execution | No financial execution; explicit diagnostic |
| Seed, private key, macaroon or bearer token supplied through tools/errors/files | No secret reaches model requests, hooks, transcripts, audit or general logs |
| Primary inference fails; subagent/compaction runs; model/profile/session changes | Financial context never reaches a cloud provider |
| Insufficient balance/reserve, exceeded budget, unsupported asset/rail or unavailable fees | Deterministic rejection; no silent asset conversion or rail fallback |
| Coding `/plan`, `/build`, `/undo` and existing provider behavior | Compatibility retained; no ability to authorize or roll back a payment |

Subsequent integration checks must additionally prove QVAC offline tool-call round trips, genuine RGB sender/receiver interoperability and recovery, exclusive UTXO ownership, and the optional WDK adapter's reviewed-transaction contract. Run the relevant regression suite after each implementation phase using isolated state and no real-value transfers.

**Phase 0 completion:** only this document is added. All new APIs, modules, guarantees and integration choices above are proposals or explicit entry conditions, not implemented functionality.
