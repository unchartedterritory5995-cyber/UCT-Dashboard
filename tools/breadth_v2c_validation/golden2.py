"""PHASE 8 — the V2c2 bounded artifacts vs the independent oracle v2, every cell."""
import collections, json, sys
from common import ro, write
import oracle2

art, tag = sys.argv[1], sys.argv[2]
unis = tuple(sys.argv[3].split(",")) if len(sys.argv) > 3 else ("uct", "uct_backtest", "us", "nasdaq", "nyse")
c = ro(art)
dates = [d for (d,) in c.execute("SELECT date FROM pass_checkpoint WHERE status='done' ORDER BY date")]
stored = collections.defaultdict(dict)
for u, d, m, o, h, l, cc, s in c.execute("SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc"):
    stored[(u, d)][m] = {"o": o, "h": h, "l": l, "c": cc, "src": "body" if s.endswith("_body") else "path"}
sess = {d: json.loads(b) for d, b in c.execute("SELECT date, universe_buckets FROM pass_session_v2c2")}
wh = {d: json.loads(b) for d, b in c.execute("SELECT date, withheld FROM pass_session_v2c2")}
O2 = oracle2.Oracle2()
cells, meta = [], {}
for D in dates:
    r = O2.day(D, unis) or {}
    for u in unis:
        a, b = stored.get((u, D), {}), (r.get(u) or {})
        mm = b.pop("_meta", {}) if b else {}
        meta["%s|%s" % (u, D)] = {**mm, "stored_buckets": sess.get(D, {}).get(u), "stored_withheld": wh.get(D, {}).get(u)}
        for m in sorted(set(a) | set(b)):
            x, y = a.get(m), b.get(m)
            if x is None or y is None:
                k = "missing_in_" + ("artifact" if x is None else "oracle")
            else:
                d = max(abs(x[f] - y[f]) for f in "ohlc")
                k = "exact" if d < 1e-9 and x["src"] == y["src"] else ("src_diff" if d < 1e-9 else "mismatch")
            cells.append({"date": D, "u": u, "m": m, "class": k, "stored": x, "oracle": y})
    print(D, collections.Counter(x["class"] for x in cells if x["date"] == D), flush=True)
S = {"sessions": len(dates), "cells": len(cells), "classes": dict(collections.Counter(x["class"] for x in cells)),
     "by_universe": {u: dict(collections.Counter(x["class"] for x in cells if x["u"] == u)) for u in unis},
     "bucket_agreement": sum(1 for v in meta.values() if v.get("buckets") == v.get("stored_buckets")),
     "withheld_agreement": sum(1 for v in meta.values() if v.get("withheld") == v.get("stored_withheld")),
     "universe_sessions": len(meta)}
print(write("%s.json" % tag, {"summary": S, "meta": meta, "nonexact": [x for x in cells if x["class"] != "exact"]}))
print(json.dumps(S, indent=1))
for x in [x for x in cells if x["class"] != "exact"][:40]:
    print("NONEXACT", x)
