"""PHASE 12 (lineage) — the same (universe, date, metric) close across every generation:
V1 → original V2 → frozen V2c → V2c2 (dividend) → production snapshot, on the anchors.
Pairwise exact counts / |Δ| per universe; the per-step CAUSE of frozen→V2c2 is attribution2.
argv: NEW_ARTIFACT TAG
"""
import collections, json, statistics as st, sys
from common import FROZEN, ORIG_V2, PROD, V1, ro, write

NEW, TAG = sys.argv[1], sys.argv[2]
ANCH = ["2008-10-10", "2008-11-28", "2009-03-10", "2011-01-03", "2011-06-27", "2012-07-03",
        "2014-06-09", "2015-08-24", "2018-12-24", "2020-03-16", "2020-03-24", "2020-08-31",
        "2022-06-06", "2022-07-18", "2024-06-10", "2024-08-05", "2025-04-09", "2026-04-15",
        "2026-06-25", "2026-09-11"]
GEN = [("V1", V1), ("V2_orig", ORIG_V2), ("V2c_frozen", FROZEN), ("V2c2_div", NEW), ("production", PROD)]


def load(p):
    c = ro(p)
    cols = [r[1] for r in c.execute("PRAGMA table_info(breadth_daily_ohlc)")]
    out = {}
    q = "SELECT universe,date,metric,c FROM breadth_daily_ohlc WHERE date IN (%s)" % ",".join("?" * len(ANCH))
    for u, d, m, v in c.execute(q, ANCH):
        out[(u, d, m)] = v
    return out, cols


data = {}
for g, p in GEN:
    try:
        data[g], _ = load(p)
    except Exception as e:                                  # noqa: BLE001 — report, never guess
        data[g] = {}
        print("unreadable", g, p, e)
R = {"rows": {g: len(v) for g, v in data.items()}, "pairs": {}}
for (ga, _), (gb, _) in zip(GEN, GEN[1:]):
    a, b = data[ga], data[gb]
    per = collections.defaultdict(list)
    for k in set(a) & set(b):
        # the new generation's `uct` is canonical PIT and exists only from 2026-03-23
        if a[k] is None or b[k] is None:
            continue
        per[k[0]].append(abs(a[k] - b[k]))
    R["pairs"]["%s→%s" % (ga, gb)] = {u: {"n": len(v), "exact": sum(1 for x in v if x < 1e-9),
                                          "median_abs": round(st.median(v), 4), "max_abs": round(max(v), 4)}
                                      for u, v in sorted(per.items()) if v}
    R["pairs"]["%s→%s" % (ga, gb)]["_only_in_" + ga] = len(set(a) - set(b))
    R["pairs"]["%s→%s" % (ga, gb)]["_only_in_" + gb] = len(set(b) - set(a))
print(write("lineage_%s.json" % TAG, R))
print(json.dumps(R, indent=1)[:8000])
