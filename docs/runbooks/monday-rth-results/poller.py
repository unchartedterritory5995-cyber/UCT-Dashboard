"""Session-long sampler for /api/flow/aggregate-health + /api/health.

Appends one JSON object per sample to scratchpad/monday-rth/health-samples.jsonl.
This is the evidence base for items 4, 5, 6, 8 and 12 -- rolls_steady is a
BOUNDED ring on the pod, so a roll that is not sampled while it is in the ring
is gone. Sampling every 10 s is what makes those items measurable at all.

Read-only. Never writes to production.
"""
from __future__ import annotations

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
ET = datetime.timezone(datetime.timedelta(hours=-4))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "health-samples.jsonl")
INTERVAL = float(os.environ.get("POLL_INTERVAL", "10"))
STOP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "STOP-POLLER")


def now_et():
    return datetime.datetime.now(datetime.timezone.utc).astimezone(ET).isoformat()


def fetch(path, timeout=30):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, {"_http_error": e.read().decode("utf-8", "replace")[:800]}
    except Exception as e:                                    # noqa: BLE001
        return None, {"_error": repr(e)}


def main():
    deadline = time.time() + float(sys.argv[1]) if len(sys.argv) > 1 else None
    n = 0
    while True:
        if os.path.exists(STOP):
            break
        if deadline and time.time() > deadline:
            break
        t0 = time.time()
        hs, hj = fetch("/api/health")
        as_, aj = fetch("/api/flow/aggregate-health")
        rec = {"at_et": now_et(), "n": n,
               "health_status": hs, "health": hj,
               "agg_status": as_, "agg": aj}
        with open(OUT, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, default=str) + "\n")
        n += 1
        time.sleep(max(0.5, INTERVAL - (time.time() - t0)))
    print("poller stopped after %d samples" % n)


if __name__ == "__main__":
    main()
