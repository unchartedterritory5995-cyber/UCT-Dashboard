"""mm21 — the arithmetic mechanism behind every non-exact cell, demonstrated on the four prices.

The correction's EMA (`breadth_live._ewm_last`, restated here byte-for-byte in behaviour) always
evaluates `(w·ema + α·x)/(w + α)`. On a CONSTANT series with gaps (w = (1−α)^k ≠ 1) that expression
is not idempotent in float64 and lands a few ULP below x. pandas' ewm (the oracle, and the
documented definition in pass_meta `ema`) stays exactly on x. Then `price > ema` is TRUE on the
correction's side and FALSE on the oracle's, for a price that equals its EMA exactly."""
import json, os
import mm21_common as mc
mc.arm_guard()
import numpy as np, pandas as pd

A = 2 / 21


def recursion(xs):
    out, w = np.nan, 1.0
    for x in xs:
        ok = x == x
        if out != out:
            if ok:
                out, w = x, 1.0
            continue
        w *= (1 - A)
        if ok:
            out = (w * out + A * x) / (w + A)
            w = 1.0
    return out


res = []
for v in (9.65, 9.63, 9.83, 10.0):
    for lab, pat in (("no gaps", [v] * 30), ("with gaps", [v, np.nan, np.nan, v, np.nan, v] * 5)):
        r = recursion(pat)
        p = float(pd.Series(pat).ewm(alpha=A, adjust=False, ignore_na=False).mean().iloc[-1])
        res.append({"price": v, "series": lab, "correction_recursion": repr(r), "pandas": repr(p),
                    "recursion_vs_price": "below" if r < v else ("equal" if r == v else "above"),
                    "pandas_vs_price": "below" if p < v else ("equal" if p == v else "above")})
        print(res[-1], flush=True)
with open(os.path.join(mc.OUTDIR, "mm21_mechanism.json"), "x") as f:
    json.dump({"pandas": pd.__version__, "numpy": np.__version__, "cases": res}, f, indent=1)
print("DONE")
