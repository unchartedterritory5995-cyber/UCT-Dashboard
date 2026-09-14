"""Item 15: every anomaly observed, with timestamps."""
from __future__ import annotations

import json
import os
import re
import sys

sys.stdout.reconfigure(errors="backslashreplace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import collect_rolls, deploys, load_samples       # noqa: E402

s = load_samples()
print("SAMPLER: %d samples, %s .. %s" % (len(s), s[0]["at_et"], s[-1]["at_et"]))

print("\n--- non-200 / failed samples ---")
bad = [r for r in s if r.get("health_status") != 200 or r.get("agg_status") != 200]
print("count: %d of %d (%.2f%%)" % (len(bad), len(s), 100.0 * len(bad) / len(s)))
for r in bad:
    h, a = r.get("health") or {}, r.get("agg") or {}
    hs = r.get("health_status")
    as_ = r.get("agg_status")
    note = ""
    if hs != 200:
        note += " health=%s %s" % (hs, str(h.get("_http_error") or h.get("_error") or "")[:60])
    if as_ != 200:
        note += " agg=%s %s" % (as_, str(a.get("_http_error") or a.get("_error") or "")[:60])
    print("  %s %s" % (r["at_et"][11:19], note.strip()))

print("\n--- restarts (uptime went down) ---")
for d in deploys(s):
    print("  %s  uptime %s -> %s" % (d["at_et"][11:19], d["uptime_before"], d["uptime_after"]))

print("\n--- counter transitions ---")
prev = None
for r in s:
    if r.get("agg_status") != 200:
        continue
    sp = (r.get("agg") or {}).get("stats_process_local") or {}
    cur = (sp.get("build_failures"), sp.get("parts_rejected_missing"),
           sp.get("stale_served"), sp.get("declined_busy"))
    if cur != prev:
        print("  %s  build_failures=%s parts_rejected=%s stale_served=%s declined_busy=%s"
              % ((r["at_et"][11:19],) + cur))
        prev = cur

print("\n--- parts cache depth (distinct values) ---")
print("  %s" % sorted({len(((r.get("agg") or {}).get("parts") or {}).get("entries") or [])
                       for r in s if r.get("agg_status") == 200}))

rolls = collect_rolls(s, "rolls_steady")
print("\n--- rolls: anomalous ---")
print("  total steady rolls: %d" % len(rolls))
print("  prepare_ms == 0: %s"
      % [(r["_first_seen_et"][11:19], r["version"]) for r in rolls if r.get("prepare_ms") == 0])
print("  handoff_ms > 500: %s"
      % [(r["_first_seen_et"][11:19], r["handoff_ms"]) for r in rolls
         if isinstance(r.get("handoff_ms"), (int, float)) and r["handoff_ms"] > 500])
print("  pass2_skipped true: %s" % [r["version"] for r in rolls if r.get("pass2_skipped")])
vs = [r["version"] for r in rolls]
gaps = [(vs[i - 1], vs[i]) for i in range(1, len(vs)) if vs[i] != vs[i - 1] + 1]
print("  version sequence gaps: %s" % (gaps if gaps else "none - contiguous"))

print("\n--- errors in captured flow-worker logs ---")
rows = []
p = os.path.join(HERE, "flowworker-log-stream.jsonl")
if os.path.exists(p):
    for line in open(p, encoding="utf-8", errors="replace"):
        try:
            rows.append(json.loads(line))
        except Exception:                                      # noqa: BLE001
            pass
pat = re.compile(r"Traceback|ERROR|CRITICAL|Exception|TOO_BIG|failed", re.I)
hits = [o for o in rows if pat.search(o.get("message", ""))]
from collections import Counter
kinds = Counter()
for o in hits:
    m = o["message"]
    if "schwab" in m.lower():
        kinds["schwab token refresh failed"] += 1
    elif "TOO_BIG" in m:
        kinds["flow-search TOO_BIG"] += 1
    elif "warm budget" in m:
        kinds["flow-search warm budget declined"] += 1
    else:
        kinds["other: " + m.strip()[:90]] += 1
print("  %d matching lines" % len(hits))
for k, v in kinds.most_common(12):
    print("    %4d  %s" % (v, k))
