"""PHASE 7 (post-grind, full census) — golden3's cell comparison over a date chunk of the FINAL
artifact, with a ratio WARM-UP: the oracle's ratio priors are its own previous closes, so each
chunk first replays the 9 grouped-calendar sessions before `lo` (computed, never scored).
argv: artifact out_tag lo:hi VINTAGE [sens_every]"""
import bisect, collections, json, os, sys
os.environ["V2C2_TAG"] = sys.argv[4]
os.environ["GUARD_BOUNDARIES"] = "/data/_audit/validation/v2c_final/out/guard_oracle_boundaries_%s.json" % sys.argv[4]
from common import ro, write
import oracle3

art, tag = sys.argv[1], sys.argv[2]
lo, hi = sys.argv[3].split(":")
sens_every = int(sys.argv[5]) if len(sys.argv) > 5 else 5
unis = ("uct", "uct_backtest", "us", "nasdaq", "nyse")
INSENSITIVE = {"universe_count", "advancing", "declining", "adv_decline", "up_4pct_today",
               "down_4pct_today", "ratio_5day", "ratio_10day"}
c = ro(art)
dates = [d for (d,) in c.execute("SELECT date FROM pass_checkpoint WHERE status='done' AND date BETWEEN ? AND ? ORDER BY date", (lo, hi))]
cal = oracle3.CAL
i0 = bisect.bisect_left(cal, lo)
first = c.execute("SELECT MIN(date) FROM pass_checkpoint WHERE status='done'").fetchone()[0]
warm = cal[max(0, i0 - 9):i0] if lo > first else []    # the artifact itself has no sessions before its first
stored = collections.defaultdict(dict)
for u, d, m, o, h, l, cc, s in c.execute("SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date BETWEEN ? AND ?", (lo, hi)):
    stored[(u, d)][m] = {"o": o, "h": h, "l": l, "c": cc, "src": "body" if s.endswith("_body") else "path"}
sess = {d: json.loads(b) for d, b in c.execute("SELECT date, universe_buckets FROM pass_session_v2c2 WHERE date BETWEEN ? AND ?", (lo, hi))}
whs = {d: json.loads(b) for d, b in c.execute("SELECT date, withheld FROM pass_session_v2c2 WHERE date BETWEEN ? AND ?", (lo, hi))}
O3 = oracle3.Oracle3(dividends=True)
O3s = oracle3.Oracle3(dividends=True, apply_factors=False)
for D in warm:
    O3.day(D, unis)
    print("WARM", D, flush=True)
cells, meta = [], {}
sens = collections.defaultdict(lambda: [0, 0])
for i, D in enumerate(dates):
    r = O3.day(D, unis) or {}
    use_s = (i % sens_every == 0)
    rs = O3s.day(D, unis) if use_s else None     # factors-off twin, as golden3 (its ratio cells lack priors)
    for u in unis:
        a, b = stored.get((u, D), {}), dict(r.get(u) or {})
        mm = b.pop("_meta", {})
        meta["%s|%s" % (u, D)] = {**mm, "stored_buckets": sess.get(D, {}).get(u), "stored_withheld": whs.get(D, {}).get(u)}
        for m in sorted(set(a) | set(b)):
            x, y = a.get(m), b.get(m)
            if x is None or y is None:
                k = "missing_in_" + ("artifact" if x is None else "oracle")
            else:
                dd = max(abs(x[f] - y[f]) for f in "ohlc")
                k = "exact" if dd < 1e-9 and x["src"] == y["src"] else ("src_diff" if dd < 1e-9 else "mismatch")
            cells.append({"date": D, "u": u, "m": m, "class": k, "stored": x, "oracle": y})
        if use_s and rs is not None and u in rs:
            for m, y in b.items():
                z = (rs[u] or {}).get(m)
                if isinstance(y, dict) and isinstance(z, dict):
                    sens[m][1] += 1
                    if max(abs(y[f] - z[f]) for f in "ohlc") > 1e-9:
                        sens[m][0] += 1
    print(D, collections.Counter(x["class"] for x in cells if x["date"] == D), flush=True)
S = {"chunk": [lo, hi], "warmup": warm, "sessions": len(dates), "cells": len(cells),
     "classes": dict(collections.Counter(x["class"] for x in cells)),
     "by_universe": {u: dict(collections.Counter(x["class"] for x in cells if x["u"] == u)) for u in unis},
     "bucket_agreement": sum(1 for v in meta.values() if v.get("buckets") == v.get("stored_buckets")),
     "withheld_agreement": sum(1 for v in meta.values() if v.get("withheld") == v.get("stored_withheld")),
     "universe_sessions": len(meta),
     "sensitivity_empirical": {m: {"sessions_differing": v[0], "compared": v[1],
                                   "classified": "INSENSITIVE" if m in INSENSITIVE else "SENSITIVE"}
                               for m, v in sorted(sens.items())},
     "insensitive_violations": [m for m, v in sens.items() if m in INSENSITIVE and v[0] > 0]}
print(write("%s.json" % tag, {"summary": S, "meta": meta, "nonexact": [x for x in cells if x["class"] != "exact"]}))
print(json.dumps({k: v for k, v in S.items() if k not in ("sensitivity_empirical", "warmup")}, indent=1))
for x in [x for x in cells if x["class"] != "exact"][:30]:
    print("NONEXACT", x)
