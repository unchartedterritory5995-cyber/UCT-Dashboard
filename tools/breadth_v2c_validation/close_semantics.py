"""PHASE 9b — what IS the provider's grouped daily close?

For each session, per name (raw, as-traded): grouped close vs the minute file's
  - last regular-session minute bar close (the minute before the derived close)
  - the close-minute bar (16:00 / 13:00 — the closing cross)
  - the last bar of the whole day (after-hours included)
Exact-equality shares say which print the grouped close is.
"""
import json
import sys

from common import write
import oracle as O

out = {}
S3 = O.s3()
for D in sys.argv[1].split(","):
    df = O.load_minutes(D, S3)
    g = O.session_geometry(df)
    raw = O.grouped_raw(D, False)
    cm = g["close_min"]
    last_rth = df[(df["m"] >= 570) & (df["m"] < cm)].sort_values("t").groupby("ticker")["close"].last()
    at_close = df[df["m"] == cm].groupby("ticker")["close"].last()
    last_day = df.sort_values("t").groupby("ticker")["close"].last()
    names = [t for t in raw if t in last_rth.index]
    def share(s):
        n = [t for t in names if t in s.index]
        eq = sum(1 for t in n if abs(float(s[t]) - raw[t]) < 1e-6)
        return {"n": len(n), "equal": eq, "share": round(eq / max(len(n), 1), 4)}
    out[D] = {"close_min": cm, "names": len(names),
              "grouped_eq_last_rth_minute": share(last_rth),
              "grouped_eq_close_minute_bar": share(at_close),
              "grouped_eq_last_bar_of_day": share(last_day),
              "grouped_eq_any_of_the_three": sum(1 for t in names if any(
                  t in s.index and abs(float(s[t]) - raw[t]) < 1e-6 for s in (last_rth, at_close, last_day)))}
    print(D, out[D], flush=True)
print(write("close_semantics.json", out))
