"""PHASE 11 — the 2 non-exact matrix cells (pct_above_20ema, 2018-12-11 NYSE / 2018-12-12 US) on the
V2c2 dividend basis. The correction computes the EMA with its own recursion (breadth_live._ewm_last,
restated below: pandas adjust=False semantics, different float arithmetic); the oracle uses pandas
ewm. The level matrices are built in different float orders:
  correction  closes * F      (F = ones, F[r, :pos] *= ratio per event — breadth_dividend_basis.factors)
  oracle3     C[r, :pos] *= ratio per event, in place
Find the names whose EMA differs bitwise between the two orders AND whose intraday price lies
between (or on) the two EMAs — the only way a 0.1-pt cell can differ. Expected: an exact tie.
argv: VINTAGE
"""
import bisect, json, os, sys
os.environ["V2C2_TAG"] = sys.argv[1]
os.environ["GUARD_BOUNDARIES"] = "/data/_audit/validation/v2c_final/out/guard_oracle_boundaries_%s.json" % sys.argv[1]
import numpy as np, pandas as pd
import oracle3
from common import write


def recursion_ewm(C, a):              # breadth_live._ewm_last, restated (adjust=False weight reset)
    n, m = C.shape; out = np.full(n, np.nan); w = np.ones(n)
    for j in range(m):
        col = C[:, j]; ok = ~np.isnan(col); seed = ok & np.isnan(out)
        out[seed] = col[seed]; w[seed] = 1.0
        step = ~np.isnan(out) & ~seed; w[step] *= (1 - a); upd = step & ok
        out[upd] = (w[upd] * out[upd] + a * col[upd]) / (w[upd] + a); w[upd] = 1.0
    return out

O3 = oracle3.Oracle3(dividends=True)
o2 = oracle3.oracle2
res = {}
for D, uni in (("2018-12-11", "nyse"), ("2018-12-12", "us")):
    df = o2.O.load_minutes(D, O3.s3)
    mem = O3.members(D, set(df["ticker"].unique()))
    names = sorted(set(mem[uni]))
    i = bisect.bisect_left(oracle3.CAL, D)
    fr = oracle3.CAL[max(0, i - 380):i]
    pos = {d: k for k, d in enumerate(fr)}
    S = np.ascontiguousarray(np.array([[o2.gfile(d, True).get(t, np.nan) for d in fr] for t in names]))
    F = np.ones_like(S)
    A_inplace = S.copy()
    for r, t in enumerate(names):
        for s, ratio in O3.dapp.get(t, ()):
            if fr[0] < s <= fr[-1]:
                F[r, :pos[s]] *= ratio
                A_inplace[r, :pos[s]] *= ratio
    A_factor = S * F
    wh = np.array([O3.withheld(t, fr[0], D) for t in names])
    A_factor[wh, :] = np.nan; A_inplace[wh, :] = np.nan
    e1 = recursion_ewm(A_factor, 2 / 21)                                   # the correction
    e2 = pd.DataFrame(A_inplace.T).ewm(alpha=2 / 21, adjust=False, ignore_na=False).mean().iloc[-1].to_numpy()
    bit = [k for k in range(len(names)) if np.isfinite(e1[k]) and e1[k] != e2[k]]
    adj, raw = o2.gfile(D, True), o2.gfile(D, False)
    sub = df[df["ticker"].isin(set(names)) & (df["m"] >= 570) & (df["m"] <= 959)]
    flips = []
    for k in bit:
        t = names[k]
        f = adj.get(t, np.nan) / raw.get(t, np.nan) if raw.get(t) else np.nan
        px = list(sub[sub["ticker"] == t]["close"].to_numpy() * f) + [adj.get(t, np.nan)]
        lo, hi = min(e1[k], e2[k]), max(e1[k], e2[k])
        on = [float(p) for p in px if lo <= p <= hi]
        near = sorted(px, key=lambda p: abs(p - e1[k]))[:1]
        if on or (near and abs(near[0] - e1[k]) < 1e-9 * max(1, abs(e1[k]))):
            flips.append({"t": t, "ema_correction": float(e1[k]), "ema_oracle": float(e2[k]),
                          "diff": float(e1[k] - e2[k]), "prices_on_or_between": on[:5], "nearest_price": float(near[0])})
    res["%s|%s" % (D, uni)] = {"names": len(names), "bitwise_ema_differences": len(bit),
                               "max_abs_diff": float(max((abs(e1[k] - e2[k]) for k in bit), default=0.0)),
                               "tie_names": flips}
    print(D, uni, len(names), "bitwise diffs", len(bit), "ties", flips, flush=True)
print(write("ema_tie3_%s.json" % sys.argv[1], res))
