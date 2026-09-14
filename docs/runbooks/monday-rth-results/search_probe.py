"""Item 14: Search deep-dive on the head names. OBSERVATION ONLY.

Endpoint: GET /api/flow/ticker-product/{SYM}?source=stocks[&warm_only=1]
(api/flow_router.py:1002). Its contract, read from the source:

  - cache HIT            -> 200
  - MISS + warm_only=1   -> 503 "not warm" IMMEDIATELY, and a background build
                            is spawned. This is the "client falls back to the
                            legacy tape now" path.
  - MISS, no warm_only   -> builds inline (blocking), unless the single-flight
                            lock is held, in which case DECLINED_BUSY.

So the question "does the timeout discard the work, or does it complete after
the client gives up?" is answerable WITHOUT ever holding a request open: fire
warm_only=1 (get the 503, i.e. give up immediately), then poll warm_only=1 until
it answers 200. The time to that first 200 is the background derive time, and a
200 arriving at all proves the work was not discarded.

⛔ Nothing here writes. A warm build is a cache fill the product already does on
every member search.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="backslashreplace")
    except Exception:                                          # noqa: BLE001
        pass

BASE = os.environ.get("RIG_BASE", "https://uctintelligence.com")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
ET = datetime.timezone(datetime.timedelta(hours=-4))


def now_et():
    return datetime.datetime.now(datetime.timezone.utc).astimezone(ET).isoformat()


def login():
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    data = json.dumps({"email": os.environ["MEMBER_SMOKE_EMAIL"],
                       "password": os.environ["MEMBER_SMOKE_PASSWORD"]}).encode()
    rq = urllib.request.Request(BASE + "/api/auth/login", data=data,
                                headers={"User-Agent": UA,
                                         "Content-Type": "application/json"})
    with op.open(rq, timeout=60) as r:
        body = json.loads(r.read().decode())
    return op, body.get("user", {}).get("role")


def get(op, path, timeout):
    rq = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    t0 = time.monotonic()
    try:
        with op.open(rq, timeout=timeout) as r:
            b = r.read()
            return {"status": r.status, "ms": round((time.monotonic() - t0) * 1000),
                    "bytes": len(b),
                    "x_flow_version": r.headers.get("x-flow-version"),
                    "cache": r.headers.get("x-flow-cache")}
    except urllib.error.HTTPError as e:
        b = e.read()
        return {"status": e.code, "ms": round((time.monotonic() - t0) * 1000),
                "bytes": len(b), "body": b.decode("utf-8", "replace")[:200]}
    except Exception as e:                                     # noqa: BLE001
        return {"status": None, "ms": round((time.monotonic() - t0) * 1000),
                "error": repr(e)}


def probe(op, sym, poll_budget_s, poll_every_s):
    out = {"symbol": sym, "started_et": now_et()}
    p = "/api/flow/ticker-product/%s?source=stocks" % sym
    first = get(op, p + "&warm_only=1", 60)
    out["warm_only_first"] = first
    print("  %-5s warm_only=1 -> %s in %sms  (%s)"
          % (sym, first["status"], first["ms"],
             "HIT, already warm" if first["status"] == 200
             else "MISS -> 503, client would fall back to the legacy tape now"))
    if first["status"] == 200:
        out["verdict"] = "already warm; no derive needed"
        return out
    t0 = time.monotonic()
    polls = []
    became_warm_at = None
    while time.monotonic() - t0 < poll_budget_s:
        time.sleep(poll_every_s)
        r = get(op, p + "&warm_only=1", 60)
        el = round(time.monotonic() - t0, 1)
        polls.append({"t_s": el, "status": r["status"], "ms": r["ms"],
                      "bytes": r.get("bytes")})
        print("      +%6.1fs -> %s (%sB)" % (el, r["status"], r.get("bytes")))
        if r["status"] == 200:
            became_warm_at = el
            out["warm_response"] = r
            break
    out["polls"] = polls
    out["background_derive_s"] = became_warm_at
    out["verdict"] = ("background build COMPLETED %.1fs after the client gave up "
                      "-- the work was NOT discarded" % became_warm_at
                      if became_warm_at is not None else
                      "still not warm after %ss of polling" % poll_budget_s)
    print("      => %s" % out["verdict"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="NVDA,SPY,MU")
    ap.add_argument("--budget", type=float, default=150.0)
    ap.add_argument("--every", type=float, default=5.0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if not os.environ.get("MEMBER_SMOKE_EMAIL"):
        print("INCONCLUSIVE: MEMBER_SMOKE_* not set")
        return 2
    op, role = login()
    print("logged in role=%s at %s" % (role, now_et()))
    rows = []
    for s in [x.strip().upper() for x in a.symbols.split(",") if x.strip()]:
        rows.append(probe(op, s, a.budget, a.every))
    if a.out:
        json.dump({"label": "item 14 search probe (observation only)",
                   "role": role, "rows": rows},
                  open(a.out, "w", encoding="utf-8"), indent=1, default=str)
        print("saved: %s" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
