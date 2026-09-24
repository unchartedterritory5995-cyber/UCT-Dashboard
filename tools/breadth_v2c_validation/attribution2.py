"""PHASE 12 — attribution v2: every value change frozen V2c → V2c2 (dividend basis) on the
20 anchors, one correction per step.

  S0..S6  exactly attribution.py (old vintage v20260923, split-only, oracle.py replay)
  S6'     oracle2 on the OLD vintage — implementation equivalence: S6' must equal S6
  S7 VINTAGE         oracle2 on the NEW single vintage with ITS OWN guard boundaries
  S8 DIVIDEND BASIS (withholding)  oracle3 with dividend withholding, factors off
  S9 DIVIDEND BASIS (factors)      oracle3, full dividend basis (own code, no import of the correction)
OTHER = (S0 ≠ frozen) + (S6 ≠ S6') + (S9 ≠ new artifact). ratio_5day/ratio_10day are
RATIO (new metrics) and are proven cell-exact by golden3; canonical PIT `uct` rows are UCT PIT
MEMBERSHIP (no old counterpart).
argv: NEW_ARTIFACT TAG
"""
import bisect, collections, json, os, sys
from common import FROZEN, ro, write
import oracle as O
import oracle2

NEW, TAG = sys.argv[1], sys.argv[2]
ANCH = ["2008-10-10", "2008-11-28", "2009-03-10", "2011-01-03", "2011-06-27", "2012-07-03",
        "2014-06-09", "2015-08-24", "2018-12-24", "2020-03-16", "2020-03-24", "2020-08-31",
        "2022-06-06", "2022-07-18", "2024-06-10", "2024-08-05", "2025-04-09", "2026-04-15",
        "2026-06-25", "2026-09-11"]
RATIO = ("ratio_5day", "ratio_10day")
OLDV = "/data/grouped_closes_v20260923"
OUTD = "/data/_audit/validation/v2c_final/out/"
gb = json.load(open(OUTD + "guard_oracle_boundaries.json"))


def withhold(t, f0, d):
    xs = gb.get(t)
    if not xs:
        return False
    j = bisect.bisect_right(xs, f0)
    return j < len(xs) and xs[j] <= d


allowed = oracle2.identity_allowed_fn()
STEPS = [("S0", "faithful_prodema", {}),
         ("S1 FILE-VINTAGE", "faithful_prodema", {"gdir": OLDV}),
         ("S2 DUAL-CLASS", "spec_prodema", {"gdir": OLDV}),
         ("S3 SESSION BOUNDARY", "spec_prodema", {"gdir": OLDV, "calendar": True}),
         ("S4 ADJUSTED-SERIES GUARD", "spec_prodema", {"gdir": OLDV, "calendar": True, "withhold": withhold}),
         ("S5 EMA FIX", "spec", {"gdir": OLDV, "calendar": True, "withhold": withhold}),
         ("S6 TICKER-REUSE", "spec", {"gdir": OLDV, "calendar": True, "withhold": withhold, "uct_filter": allowed})]
NAMES = [s[0] for s in STEPS] + ["S7 VINTAGE", "S8 DIVIDEND BASIS/withholding", "S9 DIVIDEND BASIS/factors"]


def tup(x):
    return None if x is None else (x["o"], x["h"], x["l"], x["c"], x["src"])


def same(a, b):
    return a is not None and b is not None and a[4] == b[4] and all(abs(p - q) < 1e-9 for p, q in zip(a[:4], b[:4]))


def rows(path, D):
    out = collections.defaultdict(dict)
    for u, m, o, h, l, c, s in ro(path).execute("SELECT universe,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date=?", (D,)):
        out[u][m] = (o, h, l, c, "body" if s.endswith("_body") else "path")
    return out


def strip(r, ren):
    return {ren.get(u, u): {m: tup(v) for m, v in (r[u] or {}).items() if not m.startswith("_") and m not in RATIO}
            for u in r if r[u]}


# ── phase A: old vintage (S0..S6 + S6') ──
S3c = O.s3()
chain = {}
O2old = oracle2.Oracle2()
for D in ANCH:
    df = O.load_minutes(D, S3c)
    unis = ("uct", "us", "nasdaq", "nyse") if D >= "2011-01-03" else ("uct", "us")
    outs = []
    for name, mode, conf in STEPS:
        O.CONF.update({"gdir": None, "calendar": False, "withhold": None, "uct_filter": None}); O.CONF.update(conf)
        O._UCT = None; O._REF = None
        outs.append(strip(O.replay(D, unis, mode=mode, df=df), {"uct": "uct_backtest"}))
    O.CONF.update({"gdir": None, "calendar": False, "withhold": None, "uct_filter": None})
    u2 = tuple("uct_backtest" if u == "uct" else u for u in unis)
    outs.append(strip(O2old.day(D, u2) or {}, {}))                     # S6'
    chain[D] = outs
    print("A", D, flush=True)
del O2old

# ── phase B: new single vintage (S7, S8) ──
os.environ["V2C2_TAG"] = TAG
os.environ["GUARD_BOUNDARIES"] = OUTD + "guard_oracle_boundaries_%s.json" % TAG
import oracle3                                                          # re-points oracle2 globals
o7 = oracle3.Oracle3(dividends=False)
o8 = oracle3.Oracle3(dividends=True, apply_factors=False)
o9 = oracle3.Oracle3(dividends=True)
for D in ANCH:
    unis = ("uct", "uct_backtest", "us", "nasdaq", "nyse") if D >= "2011-01-03" else ("uct", "uct_backtest", "us")
    chain[D].append(strip(o7.day(D, unis) or {}, {}))
    chain[D].append(strip(o8.day(D, unis) or {}, {}))
    chain[D].append(strip(o9.day(D, unis) or {}, {}))
    print("B", D, flush=True)

attr = collections.Counter(); per_metric = collections.defaultdict(collections.Counter)
mags = collections.defaultdict(list); other = []; pit = collections.Counter()
for D in ANCH:
    outs = chain[D]
    s = outs[:7] + outs[8:]                 # S0..S6, S7, S8, S9 (S6' is only an equivalence check)
    old, new = rows(FROZEN, D), rows(NEW, D)
    for u, v in old.items():
        nu = "uct_backtest" if u == "uct" else u
        for m in set(v) | set(outs[0].get(nu, {})):
            if m not in RATIO and not same(v.get(m), outs[0].get(nu, {}).get(m)):
                other.append(("S0_vs_frozen", D, u, m, v.get(m), outs[0].get(nu, {}).get(m)))
    for u in set(outs[6]) | set(outs[7]):
        for m in set(outs[6].get(u, {})) | set(outs[7].get(u, {})):
            if not same(outs[6].get(u, {}).get(m), outs[7].get(u, {}).get(m)):
                other.append(("S6_vs_S6prime", D, u, m, outs[6].get(u, {}).get(m), outs[7].get(u, {}).get(m)))
    for u in set(new) | set(outs[-1]):
        for m in set(new.get(u, {})) | set(outs[-1].get(u, {})):
            if m in RATIO:
                continue
            if not same(new.get(u, {}).get(m), outs[-1].get(u, {}).get(m)):
                other.append(("S9_vs_new", D, u, m, new.get(u, {}).get(m), outs[-1].get(u, {}).get(m)))
    for u in set().union(*[set(x) for x in s]):
        if u == "uct":
            pit["canonical_pit_uct_cells"] += len(s[-1].get("uct", {}))
            continue
        for m in set().union(*[set(x.get(u, {})) for x in s]):
            changed = False
            for k in range(1, len(s)):
                a, b = s[k - 1].get(u, {}).get(m), s[k].get(u, {}).get(m)
                if not same(a, b):
                    attr[NAMES[k]] += 1; per_metric[NAMES[k]][m] += 1; changed = True
                    if a and b:
                        mags[(NAMES[k], m)].append(max(abs(p - q) for p, q in zip(a[:4], b[:4])))
            if not changed:
                attr["UNCHANGED"] += 1
    print(D, dict(attr), "other", len(other), flush=True)
R = {"anchors": ANCH, "steps": NAMES, "tag": TAG, "new_artifact": NEW, "changes_by_step": dict(attr),
     "changes_by_step_metric": {k: dict(v.most_common()) for k, v in per_metric.items()},
     "max_abs_change": {"%s|%s" % k: round(max(v), 4) for k, v in mags.items()},
     "OTHER_count": len(other), "OTHER_by_kind": dict(collections.Counter(o[0] for o in other)),
     "OTHER": other[:300], "uct_pit_membership": dict(pit)}
print(write("attribution2_%s.json" % TAG, R))
print(json.dumps({k: v for k, v in R.items() if k in ("changes_by_step", "OTHER_count", "OTHER_by_kind", "uct_pit_membership")}, indent=1))
for o in other[:40]:
    print("OTHER", o)
