---
description: Guided, verified install of Bitcoin Core (never curl | bash)
---
Help me install and run Bitcoin Core, following these rules strictly:

1. Detect OS/architecture with `bash` first (`uname -a`), and pick the matching release asset.
2. Source of truth is ONLY the official Bitcoin Core release page (bitcoincore.org/en/download or the bitcoin/bitcoin GitHub releases) and its signed SHA256SUMS file — never a mirror, never a third-party download page.
3. Download the binary tarball, `SHA256SUMS`, and `SHA256SUMS.asc` as three separate files. Do not pipe the download directly into an archive extractor or shell.
4. Verify BEFORE extracting or running anything:
   - `sha256sum --ignore-missing --check SHA256SUMS` must pass for the downloaded tarball.
   - The PGP signature on `SHA256SUMS.asc` must verify against Bitcoin Core release-signing keys (the guix-attestation signers listed in `contrib/builder-keys/keys.txt` in the bitcoin/bitcoin repo). If `gpg` isn't available or the key isn't already trusted locally, say so explicitly and stop rather than skipping verification.
   - If either check fails, STOP. Do not extract or run the binary. Report exactly what failed.
5. Only after both checks pass: extract, and offer to start `bitcoind` with sane, low-footprint defaults for a first run — signet network, pruned mode (e.g. `-signet -prune=550 -daemon`) — unless I explicitly ask for mainnet.
6. After it's running, help me add the matching `bitcoin.rpc` block to `~/.bitcode/config.json` (cookie auth is the default in bitcode — usually no `user`/`pass` needed, just make sure `bitcoin.network` matches) so bitcode's own `bitcoin_rpc` and chain tools can reach it.

Never use `curl ... | bash` or `curl ... | sh` at any point. Explain each command before running it.
