#!/usr/bin/env bash
set -euo pipefail
# Fetch Lightning Labs' official prebuilt Wavelength binaries (waved + wavecli)
# and stage them into deps/wavelength/bin so the wavelength tools can find
# them by a stable path.
#
# Unlike CDK (deps/cdk, built from a submodule with cargo), Wavelength ships
# no buildable native target in its SDK repo: the daemon is a separate Go
# project (github.com/lightninglabs/wavelength) that Lightning Labs releases
# as signed, reproducible prebuilt binaries per platform. So this script
# downloads + checksum-verifies the release tarball instead of compiling one.
# See update_wavelength.md for the full research trail.
#
# Usage:  ./scripts/build-wavelength.sh [version]   (default: pinned below)
#
# Verification: SHA-256 of the downloaded tarball against the release's
# published manifest-<version>.txt. This proves the download matches what
# Lightning Labs published, but does not itself verify the manifest was
# signed by a trusted key — manifest-roasbeef-<version>.sig (a well-known
# Lightning Labs release signer, same as lnd's release process) is fetched
# alongside for anyone who wants to layer on `gpg --verify` by hand.

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WAVELENGTH_VERSION="${1:-v0.1.1}"
BIN_DIR="$REPO/deps/wavelength/bin"
RELEASE_URL="https://github.com/lightninglabs/wavelength/releases/download/${WAVELENGTH_VERSION}"

case "$(uname -s)" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) echo "ERROR: unsupported OS $(uname -s) — Wavelength publishes linux/darwin/windows binaries only"; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  armv7l) ARCH="armv7" ;;
  *) echo "ERROR: unsupported architecture $(uname -m)"; exit 1 ;;
esac

# Only linux/armv7 ships as an armv7 build; darwin has no armv7 release.
if [ "$OS" = "darwin" ] && [ "$ARCH" = "armv7" ]; then
  echo "ERROR: no darwin/armv7 Wavelength release"; exit 1
fi

PKG="wavelength-${OS}-${ARCH}-${WAVELENGTH_VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Fetching Wavelength ${WAVELENGTH_VERSION} (${OS}/${ARCH})..."
curl -sL -o "$TMP/manifest.txt" "$RELEASE_URL/manifest-${WAVELENGTH_VERSION}.txt"
curl -sL -o "$TMP/${PKG}.tar.gz" "$RELEASE_URL/${PKG}.tar.gz"

echo "==> Verifying checksum against the published manifest..."
EXPECTED="$(grep " ${PKG}.tar.gz\$" "$TMP/manifest.txt" | awk '{print $1}')"
if [ -z "$EXPECTED" ]; then
  echo "ERROR: ${PKG}.tar.gz not listed in manifest-${WAVELENGTH_VERSION}.txt"
  exit 1
fi
ACTUAL="$(sha256sum "$TMP/${PKG}.tar.gz" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "ERROR: checksum mismatch for ${PKG}.tar.gz"
  echo "  expected: $EXPECTED"
  echo "  actual:   $ACTUAL"
  exit 1
fi

echo "==> Extracting..."
tar xzf "$TMP/${PKG}.tar.gz" -C "$TMP"

mkdir -p "$BIN_DIR"
cp "$TMP/${PKG}/waved" "$BIN_DIR/"
cp "$TMP/${PKG}/wavecli" "$BIN_DIR/"
chmod +x "$BIN_DIR/waved" "$BIN_DIR/wavecli"

echo "==> Done. Binaries in $BIN_DIR:"
ls -la "$BIN_DIR/"
