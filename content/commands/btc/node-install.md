---
description: Guided, verified personal Bitcoin node installation with the shared bitcode installer
---
Help me install, connect or adopt a personal Bitcoin node using the bundled bitcoin-fullnode skill and controlled node tools.

1. Read the skill and its workflow reference. Inspect node_status and node_plan before proposing changes.
2. Explain network, full/pruned storage, optional bitcode explorer, data directory, resource requirements and administrative changes. Mainnet is the primary choice; never assume the user wants the test network merely because the active wallet uses it.
3. Use the shared installer: `bitcode node install` in the terminal, the Desktop Nodo wizard, or SCRIPT's approved node_action operations coordinated by Merkle. NODE and HASH remain read-only. If the current Sat cannot delegate, explain how to open the wizard or select Merkle.
4. For existing data, distinguish connection from adoption. Preserve the configuration and blockchain. Present the actual changes before requesting approval.
5. Keep administrative authentication in the OS dialog or the user's Terminal panel. Never request passwords in chat, pipe downloads into a shell, skip signatures or invent a replacement privileged installer.
6. Report Core sync, Core indexes and explorer indexing separately. Use node_status and actual API evidence to establish readiness.
7. Selecting this node for bitcode RPC/network is a separate explicit `node use` action. Do not create wallets or move funds.

Mutinynet is experimental and uses the separately pinned source build and compatible indexer recipe. Explain that its verification is based on curated source identities, not Guix multi-builder release signatures. Its build has no wallet support, and node use for financial adapters remains unavailable. Explain unsupported upgrade paths instead of downgrading data formats.
