#!/usr/bin/env bash
# Builds the engine and installs it where the Raycast extension looks for it:
#   ~/Library/Application Support/Sift/bin/sift
# With --link, also links it into ~/.local/bin for use from a terminal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$HOME/Library/Application Support/Sift/bin"

[[ -f "$ROOT/vendor/llama-build/TAG" ]] || "$ROOT/scripts/build-llama.sh"
(cd "$ROOT/engine" && cargo build --release)   # from engine/, so its .cargo/config.toml applies
mkdir -p "$BIN"
# Copy, then rename: a running indexer keeps its old binary, and the next start gets the new one.
cp "$ROOT/engine/target/release/sift" "$BIN/sift.new"
mv -f "$BIN/sift.new" "$BIN/sift"
echo "installed $BIN/sift"
if [[ "${1:-}" == "--link" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$BIN/sift" "$HOME/.local/bin/sift"
  echo "linked ~/.local/bin/sift"
fi
