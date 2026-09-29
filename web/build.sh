#!/bin/sh
set -eu
cd "$(dirname "$0")"
cargo build --manifest-path rust/Cargo.toml --release --target wasm32-unknown-unknown --offline
cp rust/target/wasm32-unknown-unknown/release/briskmap_mesher.wasm src/engine/mesher.wasm
