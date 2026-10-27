# Personal Bitcoin node

The node wizard shares a deterministic installer between the terminal CLI and Desktop's **Node / Nodo** page. AI is optional. Merkle coordinates NODE inspection, SCRIPT's approved node operations and HASH's review of evidence. The bundled `bitcoin-fullnode` skill is available outside a project directory.

## CLI

```sh
bitcode node install
bitcode node plan --network signet --explorer --json
bitcode node discover --json
bitcode node commands --network signet --explorer
bitcode node dependencies --network signet --explorer
bitcode node install --network signet --explorer --yes
bitcode node status --id signet --json
bitcode node doctor --id signet
bitcode node use --id signet
```

`--yes` is explicit authorization for the displayed operation, not permission to run arbitrary commands. Use `plan` before noninteractive installation. The Terminal commands install a root-owned administrative helper; later privileged operations use system authentication. The helper accepts a fixed operation set, never shell command text. Dependency profiles are fixed by component choice: Core-only does not install MariaDB or Rust tooling; explorer and experimental-source builds request their own required packages. Applications and all node components run as the requesting non-root user.

New instances default to `~/.bitcode/nodes/<id>/data`; each has separate state, downloads, binaries and indexes. Mainnet, Signet, Testnet4 and experimental Mutinynet have separate ports. A full archive is required for the explorer. Core downloads are authenticated by bundled Guix builder keys (minimum three distinct valid primary signers) and archive hashes before extraction. GnuPG is used as the maintained verification implementation, in an isolated keyring, without agent autostart or runtime key discovery.

For a second Core-only instance on the same network, choose unused `--rpc-port` and `--p2p-port` values. Desktop exposes both fields. The preview rejects duplicate or occupied ports, and resuming an installation cannot change those ports. Explorer services retain the network's fixed port set.

The local explorer comprises electrs, a MariaDB-backed mempool backend, and a loopback frontend/API/WebSocket service. The user-owned web service avoids editing an existing shared nginx deployment. Its route adapter maps legacy `/api/...` requests to the backend's `/api/v1/...` routes. The frontend sets `ROOT_NETWORK` for non-mainnet instances. The bitcode theme includes bundled fonts and their licenses; mempool attribution remains visible.

`node use` explicitly changes bitcode's Bitcoin network and RPC connection. If this instance includes an explorer, it also selects its local route adapter. Otherwise explorer-based lookups retain the network's normal default service. It never creates or migrates a wallet.

## Existing installations and lifecycle

```sh
bitcode node connect --id existing --network mainnet --datadir '/absolute/existing/data' --explorer
bitcode node adopt --id existing --network mainnet --datadir '/absolute/existing/data' --services bitcoind,electrs,mempool-backend --explorer
bitcode node stop --id existing
bitcode node start --id existing
bitcode node uninstall --id existing
```

Discovery lists same-user Bitcoin processes and default data directories without returning raw process arguments or credentials. Candidates are not proof of network identity or readiness. Legacy Testnet3 can be connected, but cannot be newly installed. Connecting is read-only apart from storing the connection. Adoption registers existing same-user services after checking their ownership and the exact data-directory argument of the live Core process. It does not rewrite their files. Adoption currently recognizes `bitcoind`, `electrs` and `mempool-backend`; different service names require a reviewed extension. Start/stop/restart and detach are supported for those services. Automatic binary updates apply to managed installations; an adopted installation needs explicit migration/review before its existing binaries or configuration are replaced. Detaching an adopted instance leaves original services untouched. Managed uninstall stops/removes bitcode's service units and retains data, indexes, databases and downloaded artifacts.

State survives application restarts. A failed step can be resumed with the same install options. An interrupted process may leave an instance lock; `doctor` reports its owner, and `recover` removes it only after proving the recorded process is no longer alive. A PID that has been reused conservatively requires manual investigation. Recovery has a separate exclusion marker so a stale diagnostic cannot remove a newly acquired operation lock. If the application is forcibly killed inside that short recovery transaction, doctor reports the retained recovery marker; verify its owner before manual repair.

Core synchronization, Core indexes, Electrum indexed height and explorer API height are checked separately. Opening a port is not readiness. Signet identity is checked against the live RPC `signet_challenge`, including when connecting Mutinynet. Core's documentation describes that field: https://bitcoincore.org/en/doc/29.0.0/rpc/blockchain/getblockchaininfo/ .

## Current release boundaries

Release v0.3.0 contains Desktop 0.3.0 and CLI 0.4.0. Publication is gated by the [release verification record](releases/0.3.0.md); platform and synchronization checks below describe the evidence currently available.

- Ubuntu/Debian x64 and ARM64 code paths are provided. Native builds require Node >=22 and Rust >=1.85; older distribution toolchains fail explicitly and are not replaced by downloaded shell installers.
- Core is pinned to 31.1. Only the 31.0 → 31.1 upgrade path is listed. Other upgrade paths stop before stopping the running node. No automatic database downgrade is offered.
- Experimental Mutinynet builds Bitcoin Inquisition from the curated commit `2fda7bfc027e3c2586bb4684401524165c164e65` and mempool-electrs 3.3.0 from `141215c349d5cfbabf8f2b925f3dcea59fed0510`. Both source archives have hashes distributed with bitcode. These are **not** official Core binaries or Guix multi-builder attestations. The fork is compiled without wallet support; its explorer requires Rust >=1.87. Installation is host-tested; full synchronization is not yet. `node use` remains unavailable for Mutinynet until the financial adapters distinguish that network.
- Host-tested on Ubuntu 26.04 x64 (GCC 15, Node 24): administrative helper and explorer dependency profile; a full Signet install with explorer (verified Core 31.1, electrs, mempool backend/frontend, web service under systemd); stop, start and restart with data preserved; adoption of an existing Mainnet node with its `bitcoind`, `electrs` and `mempool-backend` services, reported ready at the live tip; refusal to adopt when the live Core process uses a different data directory. Experimental Mutinynet with explorer: pinned Bitcoin Inquisition and mempool-electrs source builds, services started, live custom challenge accepted and blocks downloading from the Mutinynet peer.
- Further host checks on 2026-10-27: Signet and Mutinynet Core, electrs, mempool and web services were enabled and started automatically at 21:53:24 CET after the 2026-10-26 21:53:10 CET reboot. Mainnet adoption stop/start/restart returned Core, both indexes and the explorer to readiness at height 973387; detaching a temporary adoption left the original services and adoption intact and the original `bitcoin.conf` hash unchanged.
- A fresh managed Mainnet pruned instance was installed beside the existing node on RPC 58332/P2P 58333 using verified Core 31.1. It downloaded real blocks from the explicitly selected local Mainnet peer, worked through bitcode's Bitcoin RPC adapter, and passed stop/start/restart and managed uninstall with blocks retained. This checks installation and initial sync, not completion of Mainnet IBD. The first attempt using Internet peers timed out during header presynchronization and was cleaned up before the successful local-peer check.
- Still pending: readiness after complete Signet synchronization, a fully synchronized Mutinynet explorer, and native ARM64 release verification. The release record tracks new Mainnet installation checks separately from existing-node adoption.
- The native Electron wizard smoke passed on Linux x64, including profile/network selection and preview without starting an install job. It does not certify privileged provisioning.

## Verification

```sh
npm run check
npm run build:desktop
npm run test:desktop
python3 /path/to/skill-creator/scripts/quick_validate.py content/skills/bitcoin-fullnode
BITCODE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node desktop/tests/node-ui-smoke.mjs
node scripts/node/package-check.mjs desktop/release/bitcode-desktop_0.3.0_amd64.deb
```

The tests include altered signatures/checksums, duplicate signer identities, expiry, archive traversal, instance locks, wrong networks/challenges, human-origin restrictions, upgrade refusal, local RPC authentication and the explorer route adapter. Public signed metadata fixtures are from the same official Core 31.1 verification snapshot; they contain no credentials.

## Experimental Mutinynet provenance

- Fork release and source identity: https://github.com/benthecarman/bitcoin/releases/tag/mutinynet-inq-template-hash . The release points to the source commit pinned by bitcode; the source archive is independently hashed before extraction. Runtime moving tags are never used.
- Indexer: https://github.com/mempool/electrs/releases/tag/v3.3.0 . This indexer supports custom network magic and JSON-RPC import. The romanz/electrs 0.12 bindex path used for Core 31 needs newer REST endpoints and is not reused for this older fork.
- Mutinynet configuration: https://faucet.mutinynet.com/ . The custom challenge and 30-second target are explicit; the derived magic is passed to the indexer. The local mempool frontend reports Mutinynet as experimental, while upstream's protocol network identifier is Signet.
- Experimental verification policy: trusted code review pins the full source commit and source archive hash; compilation is local and the resulting executables are hashed for the instance record. A checksum fetched alongside a binary is never represented as independent signature verification.

## Optional host checks

Verify an existing node without adopting it, changing its configuration, or retaining a connection record:

```sh
node scripts/node/verify-existing.mjs --network mainnet --datadir '/absolute/existing/data' --explorer
```

The script creates and removes a temporary bitcode home, reads authenticated local RPC, and optionally compares electrs and mempool heights. It reports an unavailable or unsynchronized component with a nonzero exit status. Cookie contents are never printed. This check passed against the existing Mainnet node, all indexes and explorer at height 973262.

Validate the generated configuration with an existing Core executable in a fresh temporary Signet directory:

```sh
BITCODE_CORE_BINARY=/absolute/path/to/bitcoind node scripts/node/core-smoke.mjs
```

This launches only a temporary child with peers and its P2P listener disabled. It verifies real cookie authentication, live standard Signet identity, both indexes, and that an unsynchronized node remains unready. It stops its child and removes its own directory. This check passed with Core 31.1 on Linux x64; it does not test full synchronization or systemd provisioning.

Explicit host acceptance scripts are also available. `mainnet-smoke.mjs --yes --home /absolute/test/home` installs a separate pruned Mainnet node on RPC/P2P ports 58332/58333, checks real blocks and lifecycle, then removes its services while retaining data. It requires at least the installer's advertised free space; `--peer 127.0.0.1:8333` explicitly selects an existing local Mainnet peer for bootstrap. `adoption-smoke.mjs --id EXISTING_ADOPTED_ID --yes` temporarily adopts and interrupts that instance's services, checks stop/start/restart, restores readiness and detaches its temporary record. Both use the root-owned helper and operating-system authentication; review their operations before running them.
