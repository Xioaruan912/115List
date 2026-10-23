"""Run on the host: `python3 tgvio/probe.py list|rw|batch`.

list: print every top-level listing the site depends on, as JSON.
rw:    create, read back and delete a probe file under /115/软件/.openlist-probe.
batch: remove two files in two folders with one /api/fs/remove call.
Uses a dedicated low-permission OpenList account read from a 0600 env file
(OPENLIST_PROBE_USER / OPENLIST_PROBE_PASSWORD); prints no secrets.
"""
import base64
import http.client
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ENV_FILE = os.environ.get("OPENLIST_PROBE_ENV", "/root/.config/openlist-probe/env")


def credentials():
    if os.stat(ENV_FILE).st_mode & 0o077:
        sys.exit(f"{ENV_FILE} must be mode 0600")
    values = {}
    with open(ENV_FILE) as f:
        for line in f:
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                values[key] = value
    return values["OPENLIST_PROBE_USER"], values["OPENLIST_PROBE_PASSWORD"]


USER, PASSWORD = credentials()
HOST, PORT = "127.0.0.1", 5244
BASE = f"http://{HOST}:{PORT}"
PATHS = ["/", "/115", "/115/Yello", "/115/影视库", "/115/读书", "/115/软件", "/onedrive"]
PROBE_DIR = "/115/软件/.openlist-probe"


def api(route, body, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    request = urllib.request.Request(BASE + route, json.dumps(body).encode(), headers)
    return json.load(urllib.request.urlopen(request, timeout=120))


def listing():
    token = api("/api/auth/login", {"username": USER, "password": PASSWORD})["data"]["token"]
    out = {}
    for path in PATHS:
        data = api("/api/fs/list", {"path": path, "page": 1, "per_page": 0, "refresh": False}, token)
        content = (data.get("data") or {}).get("content") or []
        out[path] = {"code": data["code"], "names": sorted(item["name"] for item in content)}
    print(json.dumps(out, ensure_ascii=False))


def dav(method, path, data=None, headers=None):
    auth = "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
    conn = http.client.HTTPConnection(HOST, PORT, timeout=120)
    conn.request(method, "/dav" + urllib.parse.quote(path), body=data,
                 headers={"Authorization": auth, **(headers or {})})
    response = conn.getresponse()
    body = response.read()
    conn.close()
    return response.status, body


def read_write():
    dav("MKCOL", PROBE_DIR)
    base = f"{PROBE_DIR}/swap-{int(time.time())}"
    payload = os.urandom(100_000)
    steps = [
        ("MKCOL", dav("MKCOL", base)[0], {201}),
        ("PUT", dav("PUT", base + "/probe.bin", payload,
                    {"Content-Type": "application/octet-stream",
                     "Content-Length": str(len(payload))})[0], {200, 201, 204}),
    ]
    status, body = dav("GET", base + "/probe.bin")
    steps.append(("GET", status if body == payload else -1, {200}))
    steps.append(("DELETE", dav("DELETE", base)[0], {200, 204}))
    steps.append(("GONE", dav("PROPFIND", base, headers={"Depth": "0"})[0], {404}))
    ok = all(status in wanted for _, status, wanted in steps)
    print(json.dumps({"ok": ok, "steps": [(name, status) for name, status, _ in steps]}))
    sys.exit(0 if ok else 1)


def batch_remove():
    """Two files in different sub-folders, removed by one /api/fs/remove call."""
    token = api("/api/auth/login", {"username": USER, "password": PASSWORD})["data"]["token"]
    dav("MKCOL", PROBE_DIR)
    base = f"{PROBE_DIR}/batch-{int(time.time())}"
    dav("MKCOL", base)
    for folder in ("a", "b"):
        dav("MKCOL", f"{base}/{folder}")
        dav("PUT", f"{base}/{folder}/f.bin", b"x" * 1000,
            {"Content-Type": "application/octet-stream", "Content-Length": "1000"})
    result = api("/api/fs/remove", {"dir": base, "names": ["a/f.bin", "b/f.bin"]}, token)
    gone = [dav("PROPFIND", f"{base}/{folder}/f.bin", headers={"Depth": "0"})[0] for folder in ("a", "b")]
    dav("DELETE", base)
    ok = result.get("code") == 200 and gone == [404, 404]
    print(json.dumps({"ok": ok, "remove_code": result.get("code"), "after": gone}))
    sys.exit(0 if ok else 1)


{"list": listing, "rw": read_write, "batch": batch_remove}[sys.argv[1]]()
