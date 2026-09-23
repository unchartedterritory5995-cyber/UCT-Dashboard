"""PHASE 9 — attribute every old→new value change on the anchor sessions to ONE correction.

Cumulative oracle configurations (each adds exactly one correction):
  S0 V2c spec (reproduced the frozen artifact 5,874/5,874)
  S1 + FILE-VINTAGE        one-vintage grouped cache
  S2 + DUAL-CLASS          canonical ticker spelling
  S3 + SESSION BOUNDARY    calendar window
  S4 + ADJUSTED-SERIES GUARD
  S5 + EMA FIX             pandas adjust=False
  S6 + TICKER-REUSE        identity filter on the UCT back-test population
OTHER = S0 vs the frozen artifact, plus S6 vs the new artifact (both must be zero).
ratio_5day/ratio_10day are NEW METRICS; canonical 'uct' (PIT) vs the old retrospective 'uct'
is UCT PIT MEMBERSHIP.
"""
import collections, json, sys
from common import ORIG_V2, FROZEN, ro, write
import oracle as O
import oracle2

NEW = sys.argv[1]
ANCH = ["2008-10-10", "2008-11-28", "2009-03-10", "2011-01-03", "2011-06-27", "2012-07-03",
        "2014-06-09", "2015-08-24", "2018-12-24", "2020-03-16", "2020-03-24", "2020-08-31",
        "2022-06-06", "2022-07-18", "2024-06-10", "2024-08-05", "2025-04-09", "2026-04-15",
        "2026-06-25", "2026-09-11"]
VINT = "/data/grouped_closes_v20260923"
gb = json.load(open("/data/_audit/validation/v2c_final/out/guard_oracle_boundaries.json"))
import bisect
def withhold(t, f0, d):
    xs = gb.get(t)
    if not xs: return False
    j = bisect.bisect_right(xs, f0)
    return j < len(xs) and xs[j] <= d
allowed = oracle2.identity_allowed_fn()
STEPS = [("S0", "faithful_prodema", {}),
         ("S1 FILE-VINTAGE", "faithful_prodema", {"gdir": VINT}),
         ("S2 DUAL-CLASS", "spec_prodema", {"gdir": VINT}),
         ("S3 SESSION BOUNDARY", "spec_prodema", {"gdir": VINT, "calendar": True}),
         ("S4 ADJUSTED-SERIES GUARD", "spec_prodema", {"gdir": VINT, "calendar": True, "withhold": withhold}),
         ("S5 EMA FIX", "spec", {"gdir": VINT, "calendar": True, "withhold": withhold}),
         ("S6 TICKER-REUSE", "spec", {"gdir": VINT, "calendar": True, "withhold": withhold, "uct_filter": allowed})]

def rows(path, D):
    out = collections.defaultdict(dict)
    for u, m, o, h, l, c, s in ro(path).execute("SELECT universe,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date=?", (D,)):
        out[u][m] = (o, h, l, c, "body" if s.endswith("_body") else "path")
    return out

def tup(x):
    return None if x is None else (x["o"], x["h"], x["l"], x["c"], x["src"])

def same(a, b):
    return a is not None and b is not None and a[4] == b[4] and all(abs(p - q) < 1e-9 for p, q in zip(a[:4], b[:4]))

S3c = O.s3()
attr = collections.Counter(); per_metric = collections.defaultdict(collections.Counter)
other = []; mags = collections.defaultdict(list); newmetric = collections.Counter(); pitu = collections.Counter()
for D in ANCH:
    df = O.load_minutes(D, S3c)
    unis = ("uct", "us", "nasdaq", "nyse") if D >= "2011-01-03" else ("uct", "us")
    outs = []
    for name, mode, conf in STEPS:
        O.CONF.update({"gdir": None, "calendar": False, "withhold": None, "uct_filter": None}); O.CONF.update(conf)
        O._UCT = None; O._REF = None
        r = O.replay(D, unis, mode=mode, df=df)
        outs.append({u: {m: tup(v) for m, v in r[u].items() if not m.startswith("_")} for u in unis if u in r})
    O.CONF.update({"gdir": None, "calendar": False, "withhold": None, "uct_filter": None})
    old, new = rows(FROZEN, D), rows(NEW, D)
    for u in unis:
        nu = "uct_backtest" if u == "uct" else u
        for m in set(old.get(u, {})) | set(outs[0].get(u, {})):
            if not same(old.get(u, {}).get(m), outs[0].get(u, {}).get(m)):
                other.append(("S0_vs_frozen", D, u, m, old.get(u, {}).get(m), outs[0].get(u, {}).get(m)))
        for m in set(new.get(nu, {})) | set(outs[-1].get(u, {})):
            if m in ("ratio_5day", "ratio_10day"):
                newmetric[m] += 1
                continue
            if not same(new.get(nu, {}).get(m), outs[-1].get(u, {}).get(m)):
                other.append(("S6_vs_new", D, nu, m, new.get(nu, {}).get(m), outs[-1].get(u, {}).get(m)))
        for m in set(outs[0].get(u, {})) | set(outs[-1].get(u, {})):
            changed = False
            for k in range(1, len(STEPS)):
                a, b = outs[k - 1].get(u, {}).get(m), outs[k].get(u, {}).get(m)
                if not same(a, b):
                    attr[STEPS[k][0]] += 1; per_metric[STEPS[k][0]][m] += 1; changed = True
                    if a and b:
                        mags[(STEPS[k][0], m)].append(max(abs(p - q) for p, q in zip(a[:4], b[:4])))
            if not changed:
                attr["UNCHANGED"] += 1
        if u == "uct" and "uct" in new:
            for m, v in new["uct"].items():
                pitu["canonical_pit_uct_rows"] += 1
    print(D, dict(attr), "other", len(other), flush=True)
R = {"anchors": ANCH, "steps": [s[0] for s in STEPS], "changes_by_step": dict(attr),
     "changes_by_step_metric": {k: dict(v.most_common()) for k, v in per_metric.items()},
     "max_abs_change": {"%s|%s" % k: round(max(v), 4) for k, v in mags.items()},
     "OTHER_count": len(other), "OTHER": other[:200], "new_metric_cells": dict(newmetric),
     "uct_pit_membership": dict(pitu)}
print(write("attribution.json", R))
print(json.dumps({k: v for k, v in R.items() if k in ("changes_by_step", "OTHER_count", "new_metric_cells", "uct_pit_membership")}, indent=1))
for o in other[:30]:
    print("OTHER", o)
