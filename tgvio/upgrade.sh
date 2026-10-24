#!/usr/bin/env bash
# Replace only the OpenList binary with a newer TGVIO build (no database change).
# Verifies listings, a read/write/delete round trip and a batch removal; any
# failure puts the previous binary back.
# Usage: bash tgvio/upgrade.sh /root/build/openlist-tgvio/openlist-<commit>
# Rollback: systemctl stop openlist && install -m 755 <backup>/openlist.previous /opt/openlist/openlist && systemctl start openlist
set -Eeuo pipefail
new_bin=${1:?path to the new openlist binary}
probe=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/probe.py
backup=/root/backup/openlist-upgrade-$(date -u +%Y%m%dT%H%M%SZ)
run_probe() { python3 "$probe" "$1"; }
ping_ok() {
    for _ in $(seq 1 30); do
        [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5244/api/ping)" == 200 ]] && return 0
        sleep 2
    done
    return 1
}
# Videos played through the server (cloud transcoding) break when it restarts;
# others play from the drive straight. Wait until none has played for a minute,
# at most OPENLIST_UPGRADE_WAIT seconds (default 600; 0 skips; TGVIO_WAIT is its
# former name). The admin token stays here.
wait_idle() {
    local max=${OPENLIST_UPGRADE_WAIT:-${TGVIO_WAIT:-600}} waited=0 token idle
    (( max > 0 )) || return 0
    token=$(cd /opt/openlist && ./openlist admin token 2>/dev/null | sed -n 's/^Admin token: //p')
    while :; do
        idle=$(curl -s -H "Authorization: $token" http://127.0.0.1:5244/api/admin/tgvio/activity |
            python3 -c 'import json,sys
try: print(json.load(sys.stdin)["data"]["idle"])
except Exception: print(-1)')
        if (( idle < 0 || idle >= 60 )); then return 0; fi
        if (( waited >= max )); then echo "still playing after ${max}s; restarting anyway" >&2; return 0; fi
        (( waited == 0 )) && echo "a video is playing through the server; waiting until it stops (at most ${max}s)" >&2
        sleep 15; waited=$((waited + 15))
    done
}
"$new_bin" version | grep -qE 'Version: v4\.2\.[67]-(ppee|tgvio)'
python3 "$probe" list > /dev/null  # credentials and site reachable before touching anything
mkdir -p "$backup"
cp -a /opt/openlist/openlist "$backup/openlist.previous"
run_probe list > "$backup/baseline.json"
rollback() {
    echo "ROLLBACK: $1" >&2
    systemctl stop openlist
    install -m 755 "$backup/openlist.previous" /opt/openlist/openlist
    systemctl start openlist
    ping_ok && echo "previous binary restored; ping ok" >&2
    exit 1
}
wait_idle
trap 'rollback "unexpected error at line $LINENO"' ERR
systemctl stop openlist
install -m 755 "$new_bin" /opt/openlist/openlist
systemctl start openlist
ping_ok || rollback "ping failed"
/opt/openlist/openlist version | grep -E 'Commit'
for _ in $(seq 1 30); do
    run_probe list > "$backup/after.json" 2>/dev/null && cmp -s "$backup/baseline.json" "$backup/after.json" && break
    sleep 5
done
cmp -s "$backup/baseline.json" "$backup/after.json" || rollback "listings differ from the baseline"
echo "listings: identical"
run_probe rw || rollback "read/write probe failed"
run_probe batch || rollback "batch removal probe failed"
trap - ERR
echo "upgrade complete; previous binary kept at $backup/openlist.previous"
