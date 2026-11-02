#!/usr/bin/env bash
# Build and stage PPEE's own frontend; optionally retain six builds of CDN assets.
set -Eeuo pipefail
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
history=${1:-}
(cd "$repo/tgvio-web" && npm ci --no-audit --no-fund --loglevel=error && npm run check)
test -s "$repo/tgvio-web/dist/index.html"
test -n "$(find "$repo/tgvio-web/dist/assets" -type f -name '*.js' -print -quit)"
rm -rf "$repo/public/dist"
mkdir -p "$repo/public/dist/assets"
if [[ -n "$history" ]]; then
    commit=$(git -C "$repo" rev-parse --short HEAD)
    mkdir -p "$history/$commit"
    cp -r "$repo/tgvio-web/dist/assets/." "$history/$commit/"
    for old in $(ls -1t "$history" | head -n 6); do
        cp -rn "$history/$old/." "$repo/public/dist/assets/"
    done
    ls -1t "$history" | tail -n +7 | while read -r gone; do rm -r -- "${history:?}/$gone"; done
fi
cp -r "$repo/tgvio-web/dist/." "$repo/public/dist/"
