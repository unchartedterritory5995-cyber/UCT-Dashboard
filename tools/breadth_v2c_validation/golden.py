"""PHASE 13 (+7, +8, +14) — the independent oracle matrix.

For every (date, universe, metric): oracle (faithful) vs stored corrected V2, and the
oracle in SPEC mode (dual-class names normalised) to measure the dot/dash defect. The
same cells are pulled from ORIGINAL V2, V1 and the production snapshot for the
three-way comparison.

Tolerance, stated once: pct_above_* ±0.1 pt (one published rounding unit); hi/lo_ratio
±0.01; counts ±1. Anything else is a MISMATCH and is listed individually.
"""
import json
import sys
import time

from common import ORIG_V2, PROD, SCRATCH, V1, ro, write
import oracle as O

dates = sys.argv[1].split(",")
tag = sys.argv[2] if len(sys.argv) > 2 else "golden"
modes = ("faithful", "faithful_prodema", "spec")

def stored(path, D):
    try:
        c = ro(path)
        rows = c.execute("SELECT universe,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date=?", (D,)).fetchall()
    except Exception as e:
        return {"_error": str(e)}
    out = {}
    for u, m, o, h, l, cc, s in rows:
        out.setdefault(u, {})[m] = {"o": o, "h": h, "l": l, "c": cc, "src": s}
    return out

def tol(m):
    if m.startswith("pct_above"):
        return 0.1 + 1e-9
    if m in ("hi_ratio", "lo_ratio"):
        return 0.01 + 1e-9
    return 1 + 1e-9

def classify(m, a, b):
    if a is None or b is None:
        return "unavailable"
    d = max(abs(a[k] - b[k]) for k in "ohlc")
    sa = "body" if (a.get("src") or "").endswith(("body",)) else "path"
    sb = "body" if (b.get("src") or "").endswith(("body",)) else "path"
    if d < 1e-9 and sa == sb:
        return "exact"
    if d <= tol(m):
        return "tolerance" if sa == sb else "tolerance_srcdiff"
    return "mismatch"

S3 = O.s3()
report = {"dates": dates, "tolerance": "pct ±0.1pt, hi/lo_ratio ±0.01, counts ±1",
          "cells": [], "summary": {}, "sessions": {}}
sc = ro(SCRATCH)
for D in dates:
    t0 = time.time()
    df = O.load_minutes(D, S3)
    st_new, st_old, st_v1, st_prod = stored(SCRATCH, D), stored(ORIG_V2, D), stored(V1, D), stored(PROD, D)
    ps = sc.execute("SELECT universe_sizes,buckets,early_close FROM pass_session WHERE date=?", (D,)).fetchone()
    unis = [u for u in ("uct", "us", "nasdaq", "nyse") if u in st_new]
    rep = {m: O.replay(D, unis, mode=m, df=df) for m in modes}
    sizes_stored = json.loads(ps[0]) if ps else {}
    report["sessions"][D] = {
        "universes": unis, "stored_sizes": sizes_stored,
        "oracle_sizes": rep["faithful"]["_sizes"],
        "sizes_equal": all(sizes_stored.get(u) == rep["faithful"]["_sizes"].get(u) for u in unis),
        "stored_buckets": ps[1] if ps else None, "early_close": ps[2] if ps else None,
        "oracle_geometry": rep["faithful"]["_geometry"],
        "pop": {m: {u: rep[m][u]["_pop"] for u in unis} for m in modes},
        "geometry_per_universe": {u: {k: v for k, v in rep["faithful"][u]["_geometry"].items() if k != "participation_edge"} for u in unis},
        "seconds": round(time.time() - t0, 1)}
    for u in unis:
        for m in sorted(st_new[u]):
            f = rep["faithful"][u].get(m)
            s = rep["spec"][u].get(m)
            cell = {"date": D, "u": u, "m": m, "stored": st_new[u][m], "oracle": f,
                    "spec": s, "orig_v2": st_old.get(u, {}).get(m) if isinstance(st_old, dict) else None,
                    "v1": st_v1.get(u, {}).get(m) if isinstance(st_v1, dict) else None,
                    "prod": st_prod.get(u, {}).get(m) if isinstance(st_prod, dict) else None}
            cell["vs_oracle"] = classify(m, st_new[u][m], f)
            cell["spec_vs_oracle"] = classify(m, s, f)
            fp = rep["faithful_prodema"][u].get(m)
            cell["oracle_prodema"] = fp
            cell["vs_oracle_prodema"] = classify(m, st_new[u][m], fp)
            report["cells"].append(cell)
        extra = sorted(k for k in set(rep["faithful"][u]) - set(st_new[u]) if not k.startswith("_"))
        if extra:
            report["sessions"][D].setdefault("oracle_only_metrics", {})[u] = extra
    print(D, report["sessions"][D]["seconds"], "s", {u: sum(1 for c in report["cells"] if c["date"] == D and c["u"] == u and c["vs_oracle"] == "exact") for u in unis}, flush=True)

import collections
s = collections.Counter(c["vs_oracle"] for c in report["cells"])
report["summary"]["stored_vs_oracle"] = dict(s)
report["summary"]["stored_vs_oracle_prodema"] = dict(collections.Counter(c["vs_oracle_prodema"] for c in report["cells"]))
report["summary"]["spec_vs_faithful"] = dict(collections.Counter(c["spec_vs_oracle"] for c in report["cells"]))
report["summary"]["by_universe"] = {u: dict(collections.Counter(c["vs_oracle"] for c in report["cells"] if c["u"] == u))
                                     for u in ("uct", "us", "nasdaq", "nyse")}
report["summary"]["sizes_all_equal"] = all(v["sizes_equal"] for v in report["sessions"].values())
report["mismatches"] = [c for c in report["cells"] if c["vs_oracle"] not in ("exact",)]
report["nonexact_prodema"] = [c for c in report["cells"] if c["vs_oracle_prodema"] not in ("exact",)]
print(write("%s.json" % tag, report))
print(json.dumps(report["summary"], indent=1))
for c in report["nonexact_prodema"][:60]:
    print("NONEXACT_PRODEMA", c["date"], c["u"], c["m"], c["vs_oracle_prodema"], c["stored"], c["oracle_prodema"])
for c in report["mismatches"][:10]:
    print("NONEXACT", c["date"], c["u"], c["m"], c["vs_oracle"], c["stored"], c["oracle"])
