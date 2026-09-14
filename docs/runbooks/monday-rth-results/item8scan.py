"""Item 8: the measured p50 row, over >=60 steady rolls."""
from __future__ import annotations

import json
import os
import statistics
import sys

sys.stdout.reconfigure(errors="backslashreplace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import collect_rolls, load_samples                # noqa: E402

BASELINE_MS = 6199
COMPONENT_SAVING_MS = 1420

samples = load_samples()
rolls = collect_rolls(samples, "rolls_steady")
pm = [r["prepare_ms"] for r in rolls if isinstance(r.get("prepare_ms"), (int, float))]
s = sorted(pm)


def pc(q):
    return s[min(len(s) - 1, int(round((len(s) - 1) * q)))]


print("steady rolls: %d   window %s .. %s"
      % (len(rolls), rolls[0]["_first_seen_et"][11:19],
         rolls[-1]["_first_seen_et"][11:19]))
print("prepare_ms  n=%d  min=%d  p50=%d  p95=%d  max=%d  mean=%.0f"
      % (len(s), s[0], pc(.50), pc(.95), s[-1], statistics.mean(s)))
print("baseline=%d ms -> delta p50 = %+d ms (%.1f%% of baseline)"
      % (BASELINE_MS, pc(.50) - BASELINE_MS,
         100.0 * (pc(.50) - BASELINE_MS) / BASELINE_MS))
print("claimed component saving = %d ms; observed p50 delta = %d ms"
      % (COMPONENT_SAVING_MS, pc(.50) - BASELINE_MS))

print("\nquarter-hour drift (p50 / max / n):")
buckets = {}
for r in rolls:
    hm = r["_first_seen_et"][11:16]
    q = hm[:3] + ("00" if int(hm[3:5]) < 15 else "15" if int(hm[3:5]) < 30
                  else "30" if int(hm[3:5]) < 45 else "45")
    buckets.setdefault(q, []).append(r.get("prepare_ms"))
for k in sorted(buckets):
    v = sorted(x for x in buckets[k] if isinstance(x, (int, float)))
    if v:
        print("  %s  n=%2d  p50=%6d  max=%6d" % (k, len(v), v[len(v) // 2], v[-1]))

print("\ntape volume (last_build seen across the session):")
seen = {}
for x in samples:
    lb = ((x.get("agg") or {}).get("stats_process_local") or {}).get("last_build")
    if not lb:
        continue
    k = (lb.get("at"), lb.get("date_filter"))
    if k not in seen:
        seen[k] = (x["at_et"], lb)
for k in sorted(seen, key=lambda z: z[0] or 0):
    t, lb = seen[k]
    print("  %s  filter=%-7s ms=%-6s raw_rows=%-7s selected=%-7s trades=%-7s json_bytes=%s"
          % (t[11:19], lb.get("date_filter"), lb.get("ms"), lb.get("raw_rows"),
             lb.get("selected_rows"), lb.get("trades"), lb.get("json_bytes")))

print("\ncsv_provider: %s"
      % ("NOT EXPOSED anywhere in /api/flow/aggregate-health"
         if not any("csv_provider" in json.dumps(x.get("agg") or {})
                    for x in samples[:5]) else "present"))
print("\nall prepare_ms samples:")
print([r.get("prepare_ms") for r in rolls])
