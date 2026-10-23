#!/usr/bin/env bash
# Build the TGVIO OpenList binary from this checkout.
# Usage: bash tgvio/build.sh [out-dir]   (default: /root/build/openlist-tgvio)
#   TGVIO_UI=tgvio (default)  embed the TGVIO front end built from tgvio-web/
#   TGVIO_UI=official         embed the official OpenList-Frontend release instead
# The official dist is always fetched and verified into <out-dir>/web, so it can be
# served without a rebuild by pointing dist_dir in data/config.json at it.
set -Eeuo pipefail
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-/root/build/openlist-tgvio}
ui=${TGVIO_UI:-tgvio}
web_version=v4.2.6
web_sha256=eb620950a07dd081c5470a91361bde018ffd6a3cefb5b9a11b0f24f07960b444
export PATH=/usr/local/go/bin:/root/.local/bin:$PATH
mkdir -p "$out/web"
dist="$out/web/openlist-frontend-dist-$web_version.tar.gz"
if [[ ! -f "$dist" ]]; then
    curl -fsSL -o "$dist" "https://github.com/OpenListTeam/OpenList-Frontend/releases/download/$web_version/openlist-frontend-dist-$web_version.tar.gz"
fi
echo "$web_sha256  $dist" | sha256sum -c --quiet
official="$out/web/official-$web_version"
if [[ ! -f "$official/index.html" ]]; then
    rm -rf "$official" && mkdir -p "$official" && tar -xzf "$dist" -C "$official"
fi
commit=$(git -C "$repo" rev-parse --short HEAD)
[[ -z "$(git -C "$repo" status --porcelain)" ]] || { echo "working tree is not clean" >&2; exit 2; }
trap 'git -C "$repo" checkout -q -- public/dist && git -C "$repo" clean -fdq public/dist' EXIT
rm -rf "$repo/public/dist" && mkdir -p "$repo/public/dist"
case "$ui" in
    tgvio)
        (cd "$repo/tgvio-web" && npm ci --no-audit --no-fund --loglevel=error && npm run check)
        # Keep the hashed assets of the last few builds too: a CDN or browser still
        # holding an older index.html then loads that version instead of a blank page.
        history="$out/web/tgvio-assets"
        mkdir -p "$history/$commit" && cp -r "$repo/tgvio-web/dist/assets/." "$history/$commit/"
        mkdir -p "$repo/public/dist/assets"
        for old in $(ls -1t "$history" | head -n 6); do cp -rn "$history/$old/." "$repo/public/dist/assets/"; done
        ls -1t "$history" | tail -n +7 | while read -r gone; do rm -r -- "${history:?}/$gone"; done
        cp -r "$repo/tgvio-web/dist/." "$repo/public/dist/"
        label="tgvio-web-$commit"
        ;;
    official)
        tar -xzf "$dist" -C "$repo/public/dist"
        label=$web_version
        ;;
    *) echo "TGVIO_UI must be tgvio or official" >&2; exit 2 ;;
esac
pkg=github.com/OpenListTeam/OpenList/v4/internal/conf
(cd "$repo" && go build -o "$out/openlist-$commit" -tags=jsoniter -ldflags="-w -s \
    -X '$pkg.BuiltAt=$(date -u '+%F %T %z')' -X '$pkg.GitAuthor=Xioaruan912' \
    -X '$pkg.GitCommit=$commit' -X '$pkg.Version=v4.2.7-tgvio' -X '$pkg.WebVersion=$label'" .)
"$out/openlist-$commit" version | grep -E 'Commit|Version'
echo "built: $out/openlist-$commit (ui: $ui)"
