"""The same drift audit run on the served histories (2026-11-22), now on the rebuilt UCT series:
per year, the median share of the universe expressed as a z-score against the whole history
(median / IQR), plus the year's top- and bottom-quartile share. Value-free."""
import glob, json, sys, statistics as st
D = sys.argv[1] if len(sys.argv) > 1 else "/data/_audit/uct_pit/out"
rows = []
for p in sorted(glob.glob(f"{D}/rows_20*-01-0*_20*.jsonl")):
    rows += [j for j in map(json.loads, open(p)) if j.get("ok")]
rows.sort(key=lambda r: r["date"])
print("sessions", len(rows), rows[0]["date"], "->", rows[-1]["date"])
def q(a, p):
    s = sorted(a); return s[int((len(s) - 1) * p)]
for k in ["up_4pct_today", "down_4pct_today", "up_20pct_5d", "up_25pct_month", "down_50pct_month", "new_52w_highs",
          "new_52w_lows", "pct_above_50sma", "pct_above_200sma", "universe_count"]:
    ser = []
    for r in rows:
        m = r["metrics"]; v = m.get(k); uc = m.get("universe_count")
        if v is None or not uc: continue
        ser.append((r["date"][:4], v if (k.startswith("pct_") or k == "universe_count") else v / uc))
    allv = [v for _y, v in ser]; med = q(allv, .5); iqr = (q(allv, .75) - q(allv, .25)) or 1e-9
    p25, p75 = q(allv, .25), q(allv, .75)
    by = {}
    for y, v in ser: by.setdefault(y, []).append(v)
    if k == "universe_count":
        print(f"{k:18s}", " ".join(f"{y[2:]}:{q(v,.5)/med:.2f}" for y, v in sorted(by.items())), "(size vs median)")
        continue
    print(f"{k:18s}", " ".join(f"{y[2:]}:{(q(v,.5)-med)/iqr:+.1f}/{sum(x>=p75 for x in v)/len(v):.2f}" for y, v in sorted(by.items())))
