#!/usr/bin/env bash
# Exercise frontend selection and packaging without network or cross-compilers.
set -Eeuo pipefail
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/repo/tgvio" "$fixture/bin" "$fixture/official"
cp "$repo/build.sh" "$fixture/repo/"
if [[ -f "$repo/tgvio/prepare-web.sh" ]]; then
    cp "$repo/tgvio/prepare-web.sh" "$fixture/repo/tgvio/"
fi
printf 'official frontend' > "$fixture/official/index.html"
tar -czf "$fixture/official.tar.gz" -C "$fixture/official" .
export BUILD_FIXTURE="$fixture"
cat > "$fixture/bin/git" <<'SH'
#!/usr/bin/env bash
case "$*" in
    *describe*) echo v-test ;;
    *) echo abc123 ;;
esac
SH
cat > "$fixture/bin/npm" <<'SH'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$BUILD_FIXTURE/npm.log"
if [[ "$*" == "run check" ]]; then
    [[ ${FAIL_WEB:-0} != 1 ]] || exit 42
    rm -rf dist
    mkdir -p dist/assets
    printf '<script src="/assets/ppee.js"></script>' > dist/index.html
    if [[ ${MISSING_ASSETS:-0} != 1 ]]; then
        printf 'ppee bundle' > dist/assets/ppee.js
    fi
fi
SH
cat > "$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$BUILD_FIXTURE/curl.log"
[[ ${OPENLIST_UI:-tgvio} == official ]] || { echo 'unexpected upstream download' >&2; exit 88; }
while (($#)); do
    if [[ $1 == -o ]]; then cp "$BUILD_FIXTURE/official.tar.gz" "$2"; exit; fi
    shift
done
printf '{\n"tag_name":"v-test",\n"assets":[{"browser_download_url":"https://fixture/openlist-frontend-dist.tar.gz"}]\n}'
SH
cat > "$fixture/bin/go" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$BUILD_FIXTURE/go.log"
SH
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
mkdir -p "$fixture/repo/tgvio-web"
cd "$fixture/repo"
for args in 'dev web' 'beta web' 'release web' 'release lite web' 'release docker'; do
    rm -rf public/dist
    bash build.sh $args
    grep -q 'assets/ppee.js' public/dist/index.html
    test -s public/dist/assets/ppee.js
done
test ! -e "$fixture/curl.log"
grep -q 'WebVersion=ppee-web-abc123' "$fixture/go.log"
grep -q '^ci ' "$fixture/npm.log"
grep -q '^run check$' "$fixture/npm.log"
if FAIL_WEB=1 bash build.sh dev docker; then
    echo 'a failing frontend check was ignored' >&2; exit 1
fi
if OPENLIST_UI=unknown bash build.sh dev web; then
    echo 'an unknown frontend selection was accepted' >&2; exit 1
fi
if MISSING_ASSETS=1 bash build.sh dev web; then
    echo 'an incomplete frontend was packaged' >&2; exit 1
fi
mkdir -p "$fixture/history"
for i in {1..7}; do
    mkdir "$fixture/history/old$i"
    printf 'old bundle' > "$fixture/history/old$i/old$i.js"
    touch -t "20260101000$i" "$fixture/history/old$i"
done
bash tgvio/prepare-web.sh "$fixture/history"
test "$(find "$fixture/history" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 6
test ! -d "$fixture/history/old1"
test -s public/dist/assets/old7.js
test -s public/dist/assets/ppee.js
OPENLIST_UI=official bash build.sh dev web
grep -q 'official frontend' public/dist/index.html
OPENLIST_UI=official bash build.sh release web
grep -q 'official frontend' public/dist/index.html
echo 'frontend build selection checks passed'
