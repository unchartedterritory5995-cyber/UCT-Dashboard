"""Explain the 4 residual pct_above_20ema cells (2018-12-11/12, US/NYSE): find the names whose
above/below-EMA classification differs between pandas' EWM and the corrected production
recursion (restated here, adjust=False weight reset) — expected: exact ties (price == EMA)."""
import bisect, json
import numpy as np, pandas as pd
import oracle2
from common import write

def prod_ewm(C, a):
    n, m = C.shape; out = np.full(n, np.nan); w = np.ones(n)
    for j in range(m):
        col = C[:, j]; ok = ~np.isnan(col); seed = ok & np.isnan(out)
        out[seed] = col[seed]; w[seed] = 1.0
        step = ~np.isnan(out) & ~seed; w[step] *= (1 - a); upd = step & ok
        out[upd] = (w[upd] * out[upd] + a * col[upd]) / (w[upd] + a); w[upd] = 1.0
    return out

O2 = oracle2.Oracle2()
res = {}
for D in ("2018-12-11", "2018-12-12"):
    df = oracle2.O.load_minutes(D, O2.s3)
    mem = O2.members(D, set(df["ticker"].unique()))
    names = sorted(set(mem["us"]))
    L, wh, f0 = O2.levels(names, D)
    i = bisect.bisect_left(oracle2.CAL, D)
    fr = oracle2.CAL[max(0, i - 380):i]
    C = np.ascontiguousarray(np.array([[oracle2.gfile(d, True).get(t, np.nan) for d in fr] for t in names]))
    C[wh, :] = np.nan
    ep = pd.DataFrame(C.T).ewm(alpha=2 / 21, adjust=False, ignore_na=False).mean().iloc[-1].to_numpy()
    eq = prod_ewm(C, 2 / 21)
    diff = [(t, float(ep[k]), float(eq[k]), float(ep[k] - eq[k])) for k, t in enumerate(names)
            if np.isfinite(ep[k]) and ep[k] != eq[k]]
    near = [(t, a, b, d) for t, a, b, d in diff if abs(d) > 0]
    # a name can only flip if some intraday price sits between the two EMAs
    sub = df[df["ticker"].isin(names) & (df["m"] >= 570) & (df["m"] <= 959)]
    adj, raw = oracle2.gfile(D, True), oracle2.gfile(D, False)
    flips = []
    for t, a, b, d in near:
        f = adj.get(t, np.nan) / raw.get(t, np.nan) if raw.get(t) else np.nan
        px = sub[sub["ticker"] == t]["close"].to_numpy() * f
        lo, hi = min(a, b), max(a, b)
        between = [(float(p)) for p in list(px) + [adj.get(t, np.nan)] if lo < p <= hi or p == lo or p == hi]
        if between:
            flips.append({"t": t, "ema_pandas": a, "ema_prod": b, "diff": d, "prices_in_gap": between[:5]})
    res[D] = {"names_with_bitwise_ema_difference": len(near), "max_abs_diff": max((abs(x[3]) for x in near), default=0),
              "names_whose_price_sits_between_the_two": flips}
    print(D, res[D]["names_with_bitwise_ema_difference"], res[D]["max_abs_diff"], flips, flush=True)
print(write("ema_tie.json", res))
