"""Run on the host: `python3 tgvio/probe.py list|rw|batch`.

list: print every top-level listing the site depends on, as JSON.
rw:    upload, read back and delete a probe file under /115/软件.
batch: remove two files with one /api/fs/remove call.
Uses a dedicated low-permission OpenList account read from a 0600 env file
(OPENLIST_PROBE_USER / OPENLIST_PROBE_PASSWORD); prints no secrets.

Uploads go through /api/fs/put (what the web app uses): 115 answers the WebDAV
PUT with "Access denied by bucket policy", and a file written into a folder
made a moment before does not always land, so the probe writes at the mount root.
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
PROBE_DIR = "/115/软件"


def api(route, body, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    request = urllib.request.Request(BASE + route, json.dumps(body).encode(), headers)
    return json.load(urllib.request.urlopen(request, timeout=120))


def login():
    return api("/api/auth/login", {"username": USER, "password": PASSWORD})["data"]["token"]


def upload(path, payload, token):
    request = urllib.request.Request(
        BASE + "/api/fs/put", payload, method="PUT",
        headers={"Authorization": token, "File-Path": urllib.parse.quote(path),
                 "Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def dav(method, path, data=None, headers=None):
    auth = "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
    conn = http.client.HTTPConnection(HOST, PORT, timeout=120)
    conn.request(method, "/dav" + urllib.parse.quote(path), body=data,
                 headers={"Authorization": auth, **(headers or {})})
    response = conn.getresponse()
    body = response.read()
    conn.close()
    return response.status, body


def listing():
    token = login()
    out = {}
    for path in PATHS:
        data = api("/api/fs/list", {"path": path, "page": 1, "per_page": 0, "refresh": False}, token)
        content = (data.get("data") or {}).get("content") or []
        out[path] = {"code": data["code"], "names": sorted(item["name"] for item in content)}
    print(json.dumps(out, ensure_ascii=False))


def read_file_size(path, token, tries=10):
    folder, name = path.rsplit("/", 1)
    for _ in range(tries):
        data = api("/api/fs/list", {"path": folder, "page": 1, "per_page": 0, "refresh": True}, token)
        for item in (data.get("data") or {}).get("content") or []:
            if item["name"] == name:
                return item["size"]
        time.sleep(1)
    return None


def read_write():
    token = login()
    name = f".tgvio-probe-{int(time.time())}.bin"
    path = f"{PROBE_DIR}/{name}"
    payload = os.urandom(100_000)
    steps = [("PUT", upload(path, payload, token)[0], {200, 201, 204})]
    size = read_file_size(path, token)
    steps.append(("GET", 200 if size == len(payload) else -1, {200}))
    steps.append(("DELETE", dav("DELETE", path)[0], {200, 204}))
    steps.append(("GONE", dav("PROPFIND", path, headers={"Depth": "0"})[0], {404}))
    ok = all(status in wanted for _, status, wanted in steps)
    print(json.dumps({"ok": ok, "steps": [(name, status) for name, status, _ in steps]}))
    sys.exit(0 if ok else 1)


def batch_remove():
    """Two files, removed by one /api/fs/remove call."""
    token = login()
    stamp = int(time.time())
    names = [f".tgvio-batch-a-{stamp}.bin", f".tgvio-batch-b-{stamp}.bin"]
    for name in names:
        upload(f"{PROBE_DIR}/{name}", b"x" * 1000, token)
    landed = [read_file_size(f"{PROBE_DIR}/{name}", token) for name in names]
    if landed != [1000, 1000]:
        print(json.dumps({"ok": False, "landed": landed}))
        sys.exit(1)
    result = api("/api/fs/remove", {"dir": PROBE_DIR, "names": names}, token)
    gone = [dav("PROPFIND", f"{PROBE_DIR}/{name}", headers={"Depth": "0"})[0] for name in names]
    ok = result.get("code") == 200 and gone == [404, 404]
    print(json.dumps({"ok": ok, "remove_code": result.get("code"), "after": gone}))
    sys.exit(0 if ok else 1)


{"list": listing, "rw": read_write, "batch": batch_remove}[sys.argv[1]]()
