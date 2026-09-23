"""PHASE 9 — which closing cross-section should the Close of a breadth candle be?

For each sample session and universe, the metric is evaluated at the close under four
candidate closing snapshots, over the SAME path population:
  A  last_minute  the last regular-session minute of the reconstructed path (as-traded,
                  basis-lifted, carried forward) — what V1 stored
  B  barsdb       bars.db daily close for D (the product store; adjusted to its own
                  vintage; only for names it carries) — the OLD accepted F5
  C  grouped      provider grouped ADJUSTED daily close for D — what corrected V2 stores
  D  auction      the minute bar AT the derived close minute (16:00 / 13:00 closing
                  cross), as-traded × the provider factor
Coverage (names with a price) and the metric value under each are recorded, plus the
difference of A/B/D from C.
"""
import collections
import json
import sqlite3
import sys

import numpy as np

from common import SCRATCH, ro, write
import oracle as O

dates = sys.argv[1].split(",")
S3 = O.s3()
bars = sqlite3.connect("file:/data/bars.db?mode=ro&immutable=1", uri=True)
out = {"dates": {}, "variant_doc": __doc__}
agg = collections.defaultdict(lambda: collections.defaultdict(list))
for D in dates:
    df = O.load_minutes(D, S3)
    geo = O.session_geometry(df)
    traded = set(df["ticker"].unique())
    mem = O.membership(D, traded)
    union = sorted({t for u in mem for t in mem[u]})
    a, r = O.dashed(O.grouped_raw(D, True)), O.dashed(O.grouped_raw(D, False))
    fac = {t: a[t] / r[t] for t in union if t in a and t in r}
    ts = int(D.replace("-", ""))
    bdb = {}
    for t in union:
        for k in (t, t.replace(".", "-")):
            row = bars.execute("SELECT c FROM ohlcv WHERE ticker=? AND tf='D' AND ts=?", (k, ts)).fetchone()
            if row and row[0] and row[0] > 0:
                bdb[t] = float(row[0]); break
    auc = df[df["m"] == geo["close_min"]]
    auction = {t: float(px) * fac[t] for t, px in zip(auc["ticker"], auc["close"]) if t in fac}
    extra = {"barsdb": bdb, "auction": auction}
    res = {v: O.replay(D, tuple(u for u in ("uct", "us", "nasdaq", "nyse") if D >= "2011-01-03" or u in ("uct", "us")),
                       mode="faithful", df=df, close_variant=v, extra=extra)
           for v in ("grouped", "last_minute", "barsdb", "auction")}
    day = {"close_min": geo["close_min"], "coverage": {}, "metrics": {}}
    for u in [k for k in res["grouped"] if not k.startswith("_")]:
        names = mem[u]
        day["coverage"][u] = {"members": len(names),
                              "grouped": sum(1 for t in names if t in a),
                              "barsdb": sum(1 for t in names if t in bdb),
                              "auction": sum(1 for t in names if t in auction),
                              "close_pop_grouped": res["grouped"][u]["_pop"]["close"],
                              "close_pop_barsdb": res["barsdb"][u]["_pop"]["close"],
                              "close_pop_auction": res["auction"][u]["_pop"]["close"],
                              "last_minute_pop": res["last_minute"][u]["_pop"]["last"]}
        for m in res["grouped"][u]:
            if m.startswith("_"):
                continue
            cvals = {v: (res[v][u].get(m) or {}).get("c") for v in res}
            day["metrics"]["%s|%s" % (u, m)] = cvals
            base = cvals["grouped"]
            for v in ("last_minute", "barsdb", "auction"):
                if base is not None and cvals[v] is not None:
                    agg["%s|%s" % (v, m)][u].append(cvals[v] - base)
    out["dates"][D] = day
    print(D, json.dumps(day["coverage"]), flush=True)
out["summary_diff_vs_grouped"] = {k: {u: {"n": len(x), "mean": round(float(np.mean(x)), 3),
                                          "mean_abs": round(float(np.mean(np.abs(x))), 3),
                                          "max_abs": round(float(np.max(np.abs(x))), 3)}
                                      for u, x in d.items()} for k, d in sorted(agg.items())}
print(write("f5.json", out))
for k in ("last_minute|universe_count", "barsdb|universe_count", "auction|universe_count",
          "last_minute|pct_above_50sma", "barsdb|pct_above_50sma", "auction|pct_above_50sma",
          "last_minute|advancing", "barsdb|advancing", "auction|advancing",
          "barsdb|new_52w_highs", "last_minute|new_52w_highs", "auction|new_52w_highs"):
    print(k, out["summary_diff_vs_grouped"].get(k))
