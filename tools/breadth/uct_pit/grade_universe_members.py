"""Membership counts vs the authorities' universe_count. Prints match rates only."""
import json, sqlite3, sys
counts = json.load(open(sys.argv[1]))
src = {"us": ("/data/_audit/breadth_replacement_v2_corrected_COMPLETE_FROZEN_2026-09-23.db", "us"),
       "nasdaq": (sys.argv[2], "nasdaq"), "nyse": (sys.argv[2], "nyse")}
for u, (db, name) in src.items():
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    auth = dict(c.execute("select date, c from breadth_daily_ohlc where universe=? and metric='universe_count'", (name,)))
    ds = [d for d in counts if d in auth and counts[d][u]]
    diff = sorted(abs(counts[d][u] - auth[d]) / auth[d] for d in ds)
    ex = sum(counts[d][u] == auth[d] for d in ds)
    print(u, "sessions", len(ds), "exact", ex, "median rel diff", round(diff[len(diff)//2], 5) if diff else None,
          "p95", round(diff[int(len(diff)*.95)], 4) if diff else None, "max", round(diff[-1], 4) if diff else None)
