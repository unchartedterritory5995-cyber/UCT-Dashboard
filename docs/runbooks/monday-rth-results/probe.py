"""Read-only production probes for the Monday RTH OPEN run.

Cloudflare 1010-blocks raw python/curl UAs against uctintelligence.com, so every
request carries a browser User-Agent. Nothing here writes to production.

Paths are passed WITHOUT a leading slash (`api/health`, not `/api/health`) --
Git Bash rewrites a leading-slash argv entry into a Windows path before python
ever sees it, which silently turned every probe into `C:/Program Files/Git/...`.
"""
from __future__ import annotations

import datetime
import json
import sys
import urllib.error
import urllib.request

BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
ET = datetime.timezone(datetime.timedelta(hours=-4))          # EDT on 2026-09-14


def now_et():
    return datetime.datetime.now(datetime.timezone.utc).astimezone(ET).isoformat()


def get(path, timeout=60, headers=None, want_headers=()):
    if not path.startswith("/"):
        path = "/" + path
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    req = urllib.request.Request(BASE + path, headers=h)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            out = {"path": path, "status": resp.status, "body": body,
                   "elapsed_ms": round((time.monotonic() - t0) * 1000, 1),
                   "at_et": now_et()}
    except urllib.error.HTTPError as e:
        out = {"path": path, "status": e.code,
               "body": e.read().decode("utf-8", "replace")[:4000],
               "elapsed_ms": round((time.monotonic() - t0) * 1000, 1),
               "at_et": now_et()}
        resp = e
    except Exception as e:                                    # noqa: BLE001
        return {"path": path, "status": None, "error": repr(e),
                "elapsed_ms": round((time.monotonic() - t0) * 1000, 1),
                "at_et": now_et()}
    if want_headers:
        out["picked_headers"] = {k: resp.headers.get(k) for k in want_headers}
    return out


def get_json(path, timeout=60, **kw):
    r = get(path, timeout, **kw)
    if r.get("status") == 200:
        try:
            r["json"] = json.loads(r["body"])
            r.pop("body", None)
        except Exception as e:                                # noqa: BLE001
            r["parse_error"] = repr(e)
    return r


import time  # noqa: E402  (used above; imported late to keep the header readable)

if __name__ == "__main__":
    out = {}
    for p in sys.argv[1:]:
        out[p] = get_json(p)
    print(json.dumps(out, indent=1, default=str))
