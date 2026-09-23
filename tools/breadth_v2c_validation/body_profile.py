"""PHASE 11b — WHY is each body-only row body-only? Replays sessions and, for every
body cell, records the rule that fired, the withheld path o/h/l, where the largest move
sits (the opening minute? mid-session?) and how often the path reverses."""
import collections, json, sys
from common import SCRATCH, ro, write
import oracle as O
c = ro(SCRATCH)
dates = sys.argv[1].split(",")
S3 = O.s3(); cells = []
for D in dates:
    df = O.load_minutes(D, S3)
    unis = tuple(u for u in ("uct", "us", "nasdaq", "nyse") if D >= "2011-01-03" or u in ("uct", "us"))
    r = O.replay(D, unis, df=df)
    for u in unis:
        for m, x in r[u].items():
            if isinstance(x, dict) and x.get("src") == "body":
                st = c.execute("SELECT source FROM breadth_daily_ohlc WHERE universe=? AND date=? AND metric=?", (u, D, m)).fetchone()
                cells.append({"date": D, "u": u, "m": m, "stored_src": st[0] if st else None, **x})
    print(D, sum(1 for x in cells if x["date"] == D), flush=True)
agg = {"cells": len(cells),
       "stored_agrees_body": sum(1 for x in cells if (x["stored_src"] or "").endswith("_body")),
       "rule": dict(collections.Counter(x["reason"].split(" ")[0] for x in cells)),
       "max_jump_is_opening_move": sum(1 for x in cells if x["profile"]["first_move_is_max"]),
       "max_jump_minute_hist": dict(collections.Counter((x["profile"]["top_jumps"][0][1] // 30) * 30 for x in cells if x["profile"]["top_jumps"])),
       "withheld_range_median": sorted(x["withheld_path"]["h"] - x["withheld_path"]["l"] for x in cells)[len(cells) // 2] if cells else None,
       "reversals_median": sorted(x["profile"]["reversals"] for x in cells)[len(cells) // 2] if cells else None,
       "by_metric": dict(collections.Counter(x["m"] for x in cells).most_common())}
print(write("body_profile.json", {"summary": agg, "cells": cells}))
print(json.dumps(agg, indent=1))
for x in cells[:25]:
    print(x["date"], x["u"], x["m"], x["reason"], "close", x["c"], "withheld", x["withheld_path"], x["profile"]["top_jumps"][:2], "rev", x["profile"]["reversals"], "/", x["profile"]["moves"])
