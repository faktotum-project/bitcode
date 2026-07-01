---
description: Guided, verified install of LND (+ optional Taproot Assets), never curl | bash
---
Help me install and run LND (and, if I want it, tapd for Taproot Assets), following these rules strictly:

1. Detect OS/architecture with `bash` first (`uname -a`).
2. Source of truth is ONLY the official GitHub releases: github.com/lightningnetwork/lnd/releases for LND, and github.com/lightninglabs/taproot-assets/releases for tapd — never a mirror or third-party build.
3. Download the binary archive and its `manifest-*.txt` + signature files as separate files. Do not pipe the download directly into an archive extractor or shell.
4. Verify BEFORE extracting or running anything:
   - The checksum in the manifest must match the downloaded archive (`sha256sum --check`).
   - The manifest's signature must verify against a maintainer key documented in that repo's release process. If verification tooling or the key isn't available locally, say so explicitly and stop rather than skipping it.
   - If either check fails, STOP. Do not extract or run the binary. Report exactly what failed.
5. Only after both checks pass: extract, and offer to start `lnd` with low-footprint defaults for a first run — signet network, neutrino or pruned backend if practical — unless I explicitly ask for mainnet. Assumes a Bitcoin node is already reachable (see `/btc:node-install`); confirm that first if unsure.
6. Once `lnd` is running and has generated its macaroons/TLS cert, help me fill in `~/.bitcode/config.json`'s `lightning` block: `lndRestUrl`, `lndMacaroonPath` (point at the actual `admin.macaroon` path, don't paste its contents into chat), and `tlsCertPath` (pin the node's real cert — never suggest disabling TLS verification).
7. If I also want Taproot Assets: repeat the same download-then-verify discipline for tapd, then add `tapdRestUrl`/`tapdMacaroonPath` to the same `lightning` config block.

Never use `curl ... | bash` or `curl ... | sh` at any point. Explain each command before running it. A Lightning node holds spendable funds once channels are open — treat every step with the same care as an on-chain wallet.
