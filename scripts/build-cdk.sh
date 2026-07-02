#!/usr/bin/env bash
set -euo pipefail
# Build CDK Rust binaries (cdk-cli + cdk-mintd) and copy them into
# the deps/cdk directory so the Cashu tools can find them by a stable path.
#
# Usage:  ./scripts/build-cdk.sh [--release]
#
# Prerequisites: Rust toolchain (rustc, cargo) installed.
#   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CDK_DIR="$REPO/deps/cdk"

if [ ! -f "$CDK_DIR/Cargo.toml" ]; then
  echo "ERROR: CDK submodule not found at $CDK_DIR"
  echo "Run:  git submodule update --init --recursive"
  exit 1
fi

PROFILE="${1:---release}"
TARGET_DIR="$CDK_DIR/target"

echo "==> Building CDK ($PROFILE)..."

cargo build \
  $([ "$PROFILE" = "--release" ] && echo "--release") \
  --manifest-path "$CDK_DIR/Cargo.toml" \
  -p cdk-cli \
  -p cdk-mintd \
  --features "redb"

BIN_DIR="$CDK_DIR/bin"
mkdir -p "$BIN_DIR"

if [ "$PROFILE" = "--release" ]; then
  cp "$TARGET_DIR/release/cdk-cli"   "$BIN_DIR/"
  cp "$TARGET_DIR/release/cdk-mintd" "$BIN_DIR/"
else
  cp "$TARGET_DIR/debug/cdk-cli"   "$BIN_DIR/"
  cp "$TARGET_DIR/debug/cdk-mintd" "$BIN_DIR/"
fi

echo "==> Done. Binaries in $BIN_DIR:"
ls -la "$BIN_DIR/"
