"""Item 12: handoff attribution over the full session."""
from __future__ import annotations

import json
import os
import statistics
import sys

sys.stdout.reconfigure(errors="backslashreplace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import collect_rolls, load_samples                # noqa: E402

samples = load_samples()
rolls = collect_rolls(samples, "rolls_steady")
print("distinct steady rolls: %d" % len(rolls))
print("window: %s .. %s" % (rolls[0]["_first_seen_et"][11:19] if rolls else "-",
                            rolls[-1]["_first_seen_et"][11:19] if rolls else "-"))

hi = [r for r in rolls if isinstance(r.get("handoff_ms"), (int, float))
      and r["handoff_ms"] > 500]
print("\nrolls with handoff_ms > 500: %d of %d (%.1f%%)"
      % (len(hi), len(rolls), 100.0 * len(hi) / len(rolls) if rolls else 0))
print("\n%-9s %-10s %9s %9s %-12s %-6s %11s %11s"
      % ("seen", "version", "handoff_ms", "prepare_ms", "blocked_by", "pass",
         "blocked_held", "residual"))
for r in sorted(hi, key=lambda x: -x["handoff_ms"]):
    held = r.get("blocked_held_ms")
    resid = (r["handoff_ms"] - held) if isinstance(held, (int, float)) else None
    print("%-9s %-10s %9s %9s %-12s %-6s %11s %11s"
          % (r["_first_seen_et"][11:19], r.get("version"), r.get("handoff_ms"),
             r.get("prepare_ms"), r.get("blocked_by"), r.get("blocked_pass"),
             held, resid))

h = [r["handoff_ms"] for r in rolls if isinstance(r.get("handoff_ms"), (int, float))]
p = [r["prepare_ms"] for r in rolls if isinstance(r.get("prepare_ms"), (int, float))]


def st(v, name):
    if not v:
        return
    s = sorted(v)

    def pc(q):
        return s[min(len(s) - 1, int(round((len(s) - 1) * q)))]
    print("\n%s n=%d min=%d p50=%d p90=%d p95=%d p99=%d max=%d mean=%.0f"
          % (name, len(s), s[0], pc(.5), pc(.9), pc(.95), pc(.99), s[-1],
             statistics.mean(s)))


st(h, "handoff_ms")
st(p, "prepare_ms")
print("\nhandoff buckets: <=10ms=%d  11-100=%d  101-500=%d  501-5000=%d  >5000=%d"
      % (sum(1 for x in h if x <= 10), sum(1 for x in h if 10 < x <= 100),
         sum(1 for x in h if 100 < x <= 500), sum(1 for x in h if 500 < x <= 5000),
         sum(1 for x in h if x > 5000)))
print("blocked_by values across ALL rolls: %s"
      % {v: sum(1 for r in rolls if r.get("blocked_by") == v)
         for v in {r.get("blocked_by") for r in rolls}})
print("pass2_skipped across ALL rolls: %s"
      % {v: sum(1 for r in rolls if r.get("pass2_skipped") == v)
         for v in {r.get("pass2_skipped") for r in rolls}})

print("\nprepare_ms drift by 15-min bucket:")
buckets = {}
for r in rolls:
    hhmm = r["_first_seen_et"][11:16]
    key = hhmm[:3] + ("0" if int(hhmm[3:5]) < 15 else "15" if int(hhmm[3:5]) < 30
                      else "30" if int(hhmm[3:5]) < 45 else "45")
    buckets.setdefault(key, []).append(r.get("prepare_ms"))
for k in sorted(buckets):
    v = [x for x in buckets[k] if isinstance(x, (int, float))]
    if v:
        print("  %s  n=%2d  p50=%6d  max=%6d" % (k, len(v), sorted(v)[len(v) // 2], max(v)))
