"""PHASE 3b — WHY does canonical PIT UCT still sit 1-2 pt below what members saw in 2026?

Hypothesis (from breadth_live._apply_dividend_basis): the collector reads yfinance
auto_adjust=True — a DIVIDEND-adjusted basis — while the provider grouped 'adjusted' series
is split-only. Test: recompute close-only metrics on sample PIT dates with the SAME
membership and close, frames (a) split-only and (b) dividend-adjusted by production's own
rule (each ex-date multiplies every EARLIER frame close by 1 − cash/prior_close; the frame's
last bar stays raw), and compare both to the collector's stored values.
"""
import bisect, json, statistics as st
import numpy as np
import oracle as O
import oracle2
from common import write

col = json.load(open("/data/_audit/v2cc/inputs_seam/collector_metrics.json"))
divs = json.load(open("/data/_audit/v2cc/inputs_seam/divs.json"))
pit = json.load(open("/data/_audit/v2cc/inputs/pit_uct_ledger.json"))
dv = {}
for t, ex, cash in divs:
    dv.setdefault(t.replace("-", "."), []).append((str(ex), cash))
K = ("pct_above_5sma", "pct_above_20ema", "pct_above_50sma", "pct_above_200sma", "new_52w_highs",
     "new_52w_lows", "stage2_count", "stage4_count", "near_52w_high")
dates = sorted(d for d in pit["dates"] if d in col and d <= "2026-09-11")[::10]
cal = oracle2.CAL
res = {}
for D in dates:
    names = sorted({oracle2.canon(t) for t in pit["dates"][D]["tickers"]} & set(oracle2.gfile(D, False)))
    i = bisect.bisect_left(cal, D)
    fr = cal[max(0, i - 380):i]
    C = np.array([[oracle2.gfile(d, True).get(t, np.nan) for d in fr] for t in names])
    Cd = C.copy()
    ymd = [d.replace("-", "") for d in fr]
    for r, t in enumerate(names):
        for ex, cash in dv.get(t, ()):
            j = bisect.bisect_left(ymd, ex)
            if j <= 0 or j >= len(fr):
                continue
            prev = C[r, j - 1]
            if not (prev > 0) or cash <= 0 or cash >= prev:
                continue
            Cd[r, :j] *= (1.0 - cash / prev)
    px = np.array([oracle2.gfile(D, True).get(t, np.nan) for t in names])
    out = {}
    for tag, M in (("split_only", C), ("dividend_adj", Cd)):
        L = {"prev": M[:, -1]}
        for w in O.SMA:
            tail = M[:, -(w - 1):]
            L["ok%d" % w] = ~np.isnan(tail).any(axis=1); L["sum%d" % w] = np.nansum(tail, axis=1)
        import pandas as pd
        L["ema"] = pd.DataFrame(M.T).ewm(alpha=2 / 21, adjust=False, ignore_na=False).mean().iloc[-1].to_numpy()
        for b in (1, 5, 21, 34, 65):
            L["back%d" % b] = M[:, -b]
        for nm, w in (("52", 251), ("20", 19)):
            tail = M[:, -w:]; ok = ~np.isnan(tail).any(axis=1)
            L["max" + nm] = np.where(ok, np.max(np.where(np.isnan(tail), -np.inf, tail), axis=1), np.nan)
            L["min" + nm] = np.where(ok, np.min(np.where(np.isnan(tail), np.inf, tail), axis=1), np.nan)
            L["ok" + nm] = ok
        win = M[:, -220:-20]
        L["s200b21"] = np.where(~np.isnan(win).any(axis=1), win.sum(axis=1) / 200.0, np.nan)
        m = O.metrics_matrix(L, px[:, None])
        out[tag] = {k: m[k][0] for k in K}
    out["collector"] = {k: col[D].get(k) for k in K}
    res[D] = out
    print(D, {k: (out["split_only"][k], out["dividend_adj"][k], out["collector"][k]) for k in K[:4]}, flush=True)
summ = {}
for k in K:
    a = [res[d]["split_only"][k] - res[d]["collector"][k] for d in res if res[d]["collector"][k] is not None]
    b = [res[d]["dividend_adj"][k] - res[d]["collector"][k] for d in res if res[d]["collector"][k] is not None]
    summ[k] = {"split_only_mean_diff": round(st.mean(a), 2), "split_only_mean_abs": round(st.mean(map(abs, a)), 2),
               "dividend_adj_mean_diff": round(st.mean(b), 2), "dividend_adj_mean_abs": round(st.mean(map(abs, b)), 2)}
print(write("dividend_seam.json", {"dates": dates, "summary": summ, "per_date": res}))
print(json.dumps(summ, indent=1))
