#!/usr/bin/env bash
# The 27 archetype spaces (GLB · thumbnail · space.json) come from the private yc9954/consumer-jev repo.
# They are not committed here (this repo is public); this pulls them into app/static/spaces/.
# Needs `gh` logged in with access to consumer-jev.
set -euo pipefail
REF="${1:-0519fe3}"
DST="$(cd "$(dirname "$0")" && pwd)/static/spaces"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
gh repo clone yc9954/consumer-jev "$TMP/cj" -- --filter=blob:none --sparse -q
git -C "$TMP/cj" sparse-checkout set artifacts/sim3d-demos-20260929/spaces
git -C "$TMP/cj" checkout -q "$REF"
mkdir -p "$DST"
cp "$TMP"/cj/artifacts/sim3d-demos-20260929/spaces/arch_*.{glb,png,space.json} "$DST"/
echo "copied $(ls "$DST" | wc -l | tr -d ' ') files into $DST"
