# Operating workflow

1. Run environment and node_plan. Unsupported systems, insufficient space, occupied ports and nonempty data directories require a changed plan. Use connect or adopt for existing data.
2. Explain full vs pruned storage. The explorer requires an unpruned node. Resource estimates are conservative configuration values, not live measurements of future chain growth.
3. Review changes, obtain the host approval, install the root-owned helper through the displayed Terminal command, then install fixed dependencies. The helper never accepts arbitrary shell commands. Rebuilding the application does not silently replace the privileged helper.
4. Install or resume the same instance with unchanged options. Core releases use the bundled builder keys and at least three distinct valid primary signers. Hashes alone do not authenticate a release. Missing or expired signatures are not valid votes. Never lower the threshold.
5. Check readiness using RPC, Core indexes, Electrum headers and explorer API. Index heights count blocks, not percentage of elapsed installation time. Keep monitoring without restarting a healthy indexer.
6. For failures, inspect doctor. Never remove an instance lock while its owner is alive. Do not discard configuration or database files to force a retry.
7. Link tools explicitly: selecting a node for bitcode RPC must not silently switch a wallet's network or assume arbitrary mempool deployments have the managed explorer's Esplora-compatible route adapter.
8. On adopted installations, retain the original service names and settings. Detach leaves their services and data in place. On managed installations, uninstall removes only bitcode's units; data and databases are retained.

Mutinynet uses the separately pinned Bitcoin Inquisition source recipe and mempool-electrs indexer, with explicit experimental warnings. Source commit/archive hashes are curated with bitcode, not Guix multi-builder attestations. Do not substitute Core 31 or its bindex indexer for this older fork. Verify the live challenge and indexed chain before readiness; installation does not enable wallet support or the financial adapters.
