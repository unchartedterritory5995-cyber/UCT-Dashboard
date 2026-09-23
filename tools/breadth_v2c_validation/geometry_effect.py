"""PHASE 4c — does the derived session boundary change the DAILY candle?

For each session: the oracle replays the stored geometry, then the calendar-correct
geometry (last bar 15:59 on a full day, 12:59 on a half day), and every candle field that
moves is counted. The Close never moves (it is the official grouped close, not the path),
so only O/H/L can.
"""
import collections
import json
import sys

from common import write
import oracle as O

if sys.argv[1] == "auto":
    import random
    cg = json.load(open("/data/_audit/validation/v2c_final/out/calendar_geometry.json"))["phase4"]
    half = sorted(d for d, v in cg.items() if v.get("stored_early_close") and v.get("stored_buckets", 0) > 210)
    b389 = sorted(d for d, v in cg.items() if v.get("stored_buckets") == 389)
    random.seed(7)
    dates = half + sorted(random.sample(b389, 14))
else:
    dates = sys.argv[1].split(",")
S3 = O.s3()
res, agg = {}, collections.Counter()
mags = collections.defaultdict(list)
for D in dates:
    df = O.load_minutes(D, S3)
    g = O.session_geometry(df)
    early = g["close_min"] < 900
    cal_last = 779 if early else 959
    unis = tuple(u for u in ("uct", "us", "nasdaq", "nyse") if D >= "2011-01-03" or u in ("uct", "us"))
    a = O.replay(D, unis, df=df)
    b = O.replay(D, unis, df=df, last_bar_override=cal_last)
    ch = []
    for u in unis:
        for m, x in a[u].items():
            if m.startswith("_"):
                continue
            y = b[u].get(m)
            if not y:
                continue
            for f in "ohlc":
                if abs(x[f] - y[f]) > 1e-9:
                    ch.append((u, m, f, x[f], y[f], x["src"], y["src"]))
                    agg[f] += 1
                    mags[m].append(abs(x[f] - y[f]))
            if x["src"] != y["src"]:
                agg["source_class_changes"] += 1
            agg["cells"] += 1
    res[D] = {"derived_last_bar": g["last_bar"], "calendar_last_bar": cal_last,
              "changed_fields": len(ch), "changes": ch[:40]}
    print(D, g["last_bar"], cal_last, len(ch), flush=True)
out = {"dates": res, "totals": dict(agg),
       "max_abs_change_by_metric": {m: max(v) for m, v in mags.items()}}
print(write("geometry_effect.json", out))
print(json.dumps({"totals": out["totals"], "max_abs_change_by_metric": out["max_abs_change_by_metric"]}, indent=1))
