"""Block until the sampler has seen at least N distinct steady rolls.

Reads health-samples.jsonl (written by poller.py) rather than polling production
again -- one sampler, one source of truth, no extra load on the pod.
"""
from __future__ import annotations

import datetime
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import collect_rolls, load_samples          # noqa: E402

ET = datetime.timezone(datetime.timedelta(hours=-4))
want = int(sys.argv[1]) if len(sys.argv) > 1 else 1
budget = float(sys.argv[2]) if len(sys.argv) > 2 else 1800.0

t0 = time.time()
last = -1
while time.time() - t0 < budget:
    rolls = collect_rolls(load_samples(), "rolls_steady")
    if len(rolls) != last:
        now = datetime.datetime.now(datetime.timezone.utc).astimezone(ET)
        print("%s  distinct steady rolls = %d" % (now.strftime("%H:%M:%S"), len(rolls)),
              flush=True)
        last = len(rolls)
    if len(rolls) >= want:
        print("REACHED %d after %.0fs" % (len(rolls), time.time() - t0))
        for r in rolls:
            print("  first_seen=%s v=%s prepare_ms=%s handoff_ms=%s blocked_by=%s"
                  % (r["_first_seen_et"][11:19], r.get("version"),
                     r.get("prepare_ms"), r.get("handoff_ms"), r.get("blocked_by")))
        sys.exit(0)
    time.sleep(15)
print("TIMEOUT after %.0fs with %d distinct steady rolls" % (time.time() - t0, last))
sys.exit(3)
