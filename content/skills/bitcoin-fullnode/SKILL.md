---
name: bitcoin-fullnode
description: Guide installation, connection, adoption and maintenance of a personal Bitcoin full node using bitcode node operations. Use for Core, Electrum indexing and the local bitcode explorer, including diagnosis and interrupted installations.
---

# Bitcoin full node

Read [the workflow](references/workflow.md) before installing or adopting. Use node_status and node_plan to gather facts; SCRIPT uses node_action for approved mutations. Do not invent an alternative shell installer when a supported operation exists.

Merkle coordinates; NODE assesses resources, configuration and health; SCRIPT requests installation operations; HASH reviews the resulting verification evidence. Delegation does not transfer permissions. The deterministic wizard also works without AI.

Explain the network, storage profile, data directory, component changes and required privileges. Distinguish connection from adoption. Preserve existing configurations and data. Never treat a detected installation as permission to manage it.

For official Core, verify release signatures and archive hashes before extraction or execution. For experimental Mutinynet, use only the curated source recipe and verify its distributed source hashes; explain that this is not a Guix-attested release. Stop on missing trust evidence, unsupported architecture or failed verification. Never pipe downloads into a shell. Administrative authentication belongs in the operating system prompt or the user's terminal, never in chat.

Use persisted installer steps to resume. Keep local interfaces on loopback by default. Mainnet, Signet, Testnet4 and experimental Mutinynet are separate instances. A configured custom Signet is not proven Mutinynet solely because RPC reports `signet`.

Report Core sync, Core indexes and electrs indexing separately. A running service or an open port does not prove readiness. Verify API responses and network identity, and distinguish executed checks from recommendations.

Updates require verified artifacts and a reviewed database compatibility path. Uninstall preserves data by default. Do not create wallets, move funds, open router ports or delete data as part of node installation.
