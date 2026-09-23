"""PHASE 4b — do any sessions carry bar TIMESTAMPS that are not minutes of session D?

The pass counts buckets as DISTINCT EPOCH TIMESTAMPS filtered by ET minute-of-day, not by
date. A bar stamped on another calendar day whose ET minute falls inside 09:30..last_bar
would therefore become a bucket — and because buckets are SORTED, a stray from an EARLIER
day becomes the FIRST bucket, i.e. it would define the candle's OPEN.

For each session given: every timestamp inside the RTH minute window whose ET date != D,
how many bars/names carry it, and where it sorts.
"""
import datetime as dt
import json
import sys

import pandas as pd

from common import SCRATCH, ro, write
import oracle as O

c = ro(SCRATCH)
if sys.argv[1] == "odd":
    dates = [d for d, b, ec in c.execute("SELECT date,buckets,early_close FROM pass_session")
             if (ec and b != 210) or (not ec and b not in (389, 390))]
else:
    dates = sys.argv[1].split(",")
S3 = O.s3()
out = {}
for D in dates:
    df = O.load_minutes(D, S3)
    et = pd.to_datetime(df["t"], unit="s", utc=True).dt.tz_convert("America/New_York")
    df["etdate"] = et.dt.date.astype(str)
    g = O.session_geometry(df)
    win = df[(df["m"] >= 570) & (df["m"] <= g["last_bar"])]
    ts = sorted(win["t"].unique())
    stray = win[win["etdate"] != D]
    first_t = ts[0] if ts else None
    out[D] = {"stored_buckets": c.execute("SELECT buckets FROM pass_session WHERE date=?", (D,)).fetchone()[0],
              "distinct_ts_in_window": len(ts), "distinct_minutes_in_window": int(win["m"].nunique()),
              "stray_bars": int(len(stray)), "stray_dates": sorted(stray["etdate"].unique().tolist()),
              "stray_timestamps": sorted(int(x) for x in stray["t"].unique())[:10],
              "stray_names": sorted(stray["ticker"].unique().tolist())[:20],
              "first_bucket_is_stray": bool(first_t is not None and first_t in set(stray["t"])),
              "last_bucket_is_stray": bool(ts and ts[-1] in set(stray["t"]))}
    print(D, out[D], flush=True)
print(write("stray_buckets.json", out))
