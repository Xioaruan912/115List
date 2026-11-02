#!/usr/bin/env bash
# Build the TGVIO OpenList binary from this checkout.
# Usage: bash tgvio/build.sh [out-dir]   (default: /root/build/openlist-tgvio)
#   OPENLIST_UI=tgvio (default)  embed the site's own front end built from tgvio-web/
#   OPENLIST_UI=official         embed the official OpenList-Frontend release instead
#   (TGVIO_UI, its former name, still works)
# Explicit official builds also keep a verified copy in <out-dir>/web.
set -Eeuo pipefail
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-/root/build/openlist-tgvio}
ui=${OPENLIST_UI:-${TGVIO_UI:-tgvio}}
web_version=v4.2.6
web_sha256=eb620950a07dd081c5470a91361bde018ffd6a3cefb5b9a11b0f24f07960b444
export PATH=/usr/local/go/bin:/root/.local/bin:$PATH
commit=$(git -C "$repo" rev-parse --short HEAD)
[[ -z "$(git -C "$repo" status --porcelain)" ]] || { echo "working tree is not clean" >&2; exit 2; }
trap 'git -C "$repo" checkout -q -- public/dist && git -C "$repo" clean -fdq public/dist' EXIT
rm -rf "$repo/public/dist" && mkdir -p "$repo/public/dist"
case "$ui" in
    tgvio)
        bash "$repo/tgvio/prepare-web.sh" "$out/web/tgvio-assets"
        label="ppee-web-$commit"
        ;;
    official)
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
        tar -xzf "$dist" -C "$repo/public/dist"
        label=$web_version
        ;;
    *) echo "OPENLIST_UI must be tgvio or official" >&2; exit 2 ;;
esac
pkg=github.com/OpenListTeam/OpenList/v4/internal/conf
(cd "$repo" && go build -o "$out/openlist-$commit" -tags=jsoniter -ldflags="-w -s \
    -X '$pkg.BuiltAt=$(date -u '+%F %T %z')' -X '$pkg.GitAuthor=Xioaruan912' \
    -X '$pkg.GitCommit=$commit' -X '$pkg.Version=v4.2.7-ppee' -X '$pkg.WebVersion=$label'" .)
"$out/openlist-$commit" version | grep -E 'Commit|Version'
echo "built: $out/openlist-$commit (ui: $ui)"
