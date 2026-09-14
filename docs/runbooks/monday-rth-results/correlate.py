"""Correlate storm runs against the roll cycle and the prepare window."""
from __future__ import annotations

import json
import os
import sys

sys.stdout.reconfigure(errors="backslashreplace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import collect_rolls, load_samples                # noqa: E402

samples = load_samples()
pts = [(x["at_et"], (x.get("health") or {}).get("uptime_seconds"))
       for x in samples if (x.get("health") or {}).get("uptime_seconds")]


def wall_for_uptime(u):
    best = min(pts, key=lambda p: abs(p[1] - u))
    return best[0][11:19], abs(best[1] - u)


path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "rig-item13b.json")
d = json.load(open(path, encoding="utf-8"))
print("run  uptime_before  approx_wall_et  (+/-s)  shape   version_ms  picks_ms")
runs = []
for r in d["raw"]:
    ub = r.get("uptime_before")
    fl = r.get("fetches", [])
    ver = [f for f in fl if f.get("url", "").endswith("/version")]
    vdur = round((ver[0].get("done") or 0) - ver[0]["t"]) if ver and ver[0].get("done") else None
    pk = [m for m in r.get("mounts", []) if m["name"] == "picks"]
    pms = round(pk[0]["t"]) if pk else None
    shape = "STORM" if len(fl) > 8 else "clean"
    if not ub:
        print("%3d  (no uptime)  shape=%s" % (r["run"], shape))
        continue
    w, dl = wall_for_uptime(ub)
    runs.append((r["run"], w, shape, vdur, pms))
    print("%3d  %8s  %s  (+/-%ss)  %-5s  %8s  %8s"
          % (r["run"], ub, w, dl, shape, vdur, pms))

print()
rolls = collect_rolls(samples, "rolls_steady")
lo = min(w for _, w, _, _, _ in runs) if runs else "00:00:00"
hi = max(w for _, w, _, _, _ in runs) if runs else "23:59:59"
print("rolls first-seen between %s and %s:" % (lo, hi))
for x in rolls:
    t = x["_first_seen_et"][11:19]
    if lo <= t <= hi:
        print("   %s  v=%s  prepare_ms=%s  handoff_ms=%s"
              % (t, x["version"], x["prepare_ms"], x["handoff_ms"]))
