"""UCT PIT rebuild, stage 5b: the MARKET-WIDE Monitor columns for the rebuilt sessions, each by
production's own definition (they do not depend on the list; every universe copies UCT's):
  spy_close / qqq_close + the four above-SMA flags  breadth_live.compute_index_metrics: close > the
        SMA including today, on the dividend basis (the collector's auto-adjusted closes)
  rsp_close, iwm_close, rsp_spy_ratio, iwm_qqq_ratio  breadth_eod_extras.index_closes (rounding)
  spy_dist_days / qqq_dist_days  breadth_eod_extras._count_dist over 120 sessions through the PRIOR
        session (split-adjusted bars, as bars.db holds them)
  vix, vxn, vxmt, avg_10d_vix, avg_10d_vxn, vix_term_structure  breadth_eod_extras.cboe_levels over
        Cboe's published daily CSVs (market_indicators.cboe_store.parse_csv)
  sp500_close  Cboe's SPX daily CSV when it publishes one (display only: the column is shaded by
        spy_day_pct, which the Monitor derives from spy_close)
Bars: the S3 day files (raw) split-adjusted with the provider's splits. Dividends: provider's
cash dividends. Writes market_wide.json {date: {...}}. Prints counts only."""
import json, os, sys
sys.path.insert(0, "/data/_audit/uct_pit/code"); sys.path.insert(0, "/app")
import membership as M
from api.services.breadth_eod_extras import _count_dist
from api.services.market_indicators import cboe_store as cs
from acquire import get, BASE
ROOT = "/data/_audit/uct_pit"
LO, HI = "2008-01-02", sys.argv[1] if len(sys.argv) > 1 else "2025-12-31"
SYMS = ("SPY", "QQQ", "RSP", "IWM")
ss = M.sessions(); spl = M.Splits()
ohlcv = {s: {} for s in SYMS}
for d in ss:
    b = M.bars(d)
    for s in SYMS:
        bar = b.get(s) or (b.get("QQQQ") if s == "QQQ" else None)   # QQQ traded as QQQQ to 2011-03
        if bar and bar[3]: ohlcv[s][d] = bar
last = ss[-1]
def adj(s, d, x):            # split-adjusted to the newest session's basis (bars.db's basis)
    return x / spl.factor(s, d, last) if x is not None else None
div = {}
for s, names in (("SPY", ("SPY",)), ("QQQ", ("QQQ", "QQQQ"))):
    got = {}
    for nm in names:
        j = get(f"{BASE}/v3/reference/dividends?ticker={nm}&limit=1000&order=asc")
        for r in j.get("results") or []:
            if r.get("ex_dividend_date") and r.get("cash_amount"):
                got[r["ex_dividend_date"]] = float(r["cash_amount"])
    div[s] = sorted(got.items())
print("dividends", {s: len(v) for s, v in div.items()})
def div_adjusted(s, ds):
    """the dividend basis (breadth_live `_apply_dividend_basis`): closes before an ex-date x r."""
    c = [adj(s, d, ohlcv[s][d][3]) for d in ds]
    out = list(c); pos = {d: i for i, d in enumerate(ds)}
    for ex, cash in div[s]:
        i = pos.get(ex)
        if i is None or i == 0: continue
        r = 1 - cash / c[i - 1]
        for k in range(i): out[k] *= r
    return out
def csv(sym):
    try: return {b["date"]: b["c"] for b in cs.parse_csv(cs.fetch_csv(sym))[0]}
    except Exception as e: print("cboe", sym, "unavailable", type(e).__name__); return {}
cboe = {k: csv(k) for k in ("VIX", "VXN", "VIX6M", "SPX")}
print("cboe rows", {k: len(v) for k, v in cboe.items()})
out = {}
for s in ("SPY", "QQQ"): pass
idx = {s: sorted(ohlcv[s]) for s in SYMS}
for i, d in enumerate(ss):
    if not (LO <= d <= HI): continue
    m = {}
    for s in ("SPY", "QQQ"):
        k = s.lower(); ds = [x for x in idx[s] if x <= d]
        if not ds or ds[-1] != d: continue
        m[f"{k}_close"] = round(adj(s, d, ohlcv[s][d][3]), 2)
        a = div_adjusted(s, ds[-201:])
        px = a[-1]
        for w in (10, 20, 50, 200):
            if len(a) >= w: m[f"{k}_above_{w}sma"] = 1 if px > sum(a[-w:]) / w else 0
        # distribution days the morning of d: bars through the prior session
        win = [x for x in ss[max(0, i - 119):i + 1]][:-1]
        rows = [(adj(s, x, ohlcv[s][x][3]), ohlcv[s][x][4] * spl.factor(s, x, last),
                 adj(s, x, ohlcv[s][x][1]), adj(s, x, ohlcv[s][x][2])) for x in win if x in ohlcv[s]]
        if len(win) >= 59 and len(rows) >= 55:
            m[f"{k}_dist_days"] = _count_dist([r[0] for r in rows], [float(r[1] or 0) for r in rows],
                                              [r[2] if r[2] is not None else r[0] for r in rows],
                                              [r[3] if r[3] is not None else r[0] for r in rows])
    px = {s: (adj(s, d, ohlcv[s][d][3]) if d in ohlcv[s] else None) for s in SYMS}
    if px["RSP"]:
        m["rsp_close"] = round(px["RSP"], 2)
        if px["SPY"]: m["rsp_spy_ratio"] = round(px["RSP"] / round(px["SPY"], 2), 4)
    if px["IWM"]:
        m["iwm_close"] = round(px["IWM"], 2)
        if px["QQQ"]: m["iwm_qqq_ratio"] = round(px["IWM"] / round(px["QQQ"], 2), 4)
    for sym, key in (("VIX", "vix"), ("VXN", "vxn"), ("VIX6M", "vxmt")):
        ser = cboe[sym]
        if d in ser:
            m[key] = round(float(ser[d]), 2)
            if key in ("vix", "vxn"):
                past = [ser[x] for x in sorted(ser) if x <= d][-10:]
                if len(past) >= 10: m[f"avg_10d_{key}"] = round(sum(past) / 10, 2)
    if m.get("vxmt") and m.get("vix"): m["vix_term_structure"] = round(m["vxmt"] / m["vix"], 3)
    if d in cboe["SPX"]: m["sp500_close"] = round(float(cboe["SPX"][d]), 2)
    out[d] = m
json.dump(out, open(f"{ROOT}/market_wide.json", "w"))
from collections import Counter
cov = Counter(k for m in out.values() for k in m)
print("sessions", len(out), "coverage", {k: round(v / len(out), 3) for k, v in sorted(cov.items())})
