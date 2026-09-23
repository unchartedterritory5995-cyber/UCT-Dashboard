"""PHASE 5 (independent) — the dividend-adjusted basis vs yfinance, the collector's own source.

Own implementation of the spec (no import of breadth_dividend_basis):
  r_e = 1 − Σ_type cash_e / RAW_close(prev session), ex mapped to the next session.
Checks
  (1) our event table == the correction's `dividend_basis_table.json` (applied + withheld)
  (2) per-event: our r_e vs Yahoo's implied step AdjClose/Close at the ex-date
  (3) per-level: [S(d)·Π r] / S(D−1) vs AdjY(d)/AdjY(D−1) over whole frames (anchor-free)
Every mismatch is classified.
"""
import bisect, collections, json, math, os, sys
os.environ.setdefault("V2C2_TAG", "v20260923b")
import numpy as np
from common import write

TAG = sys.argv[1]
IN = "/data/_audit/v2cc/inputs_" + TAG
G = "/data/grouped_closes_" + TAG
cal = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_1.json"))
_c = {}
def gf(iso, adj):
    k = (iso, adj)
    if k not in _c:
        _c[k] = {t.replace("-", "."): v for t, v in json.load(open("%s/%s_%d.json" % (G, iso, adj))).items()}
        if len(_c) > 40: _c.pop(next(iter(_c)))
    return _c[k]
canon = lambda t: t.replace("-", ".")
divs = json.load(open(IN + "/dividends_ledger.json"))
LAST = divs["ex_date_lte"]
grp = collections.defaultdict(list)
for d in divs["dividends"]:
    if d.get("ticker") and d.get("ex_dividend_date") and d.get("cash_amount") is not None and d["ex_dividend_date"] <= LAST:
        grp[(canon(d["ticker"]), d["ex_dividend_date"])].append(d)
mine_app, mine_wh = collections.defaultdict(list), collections.defaultdict(list)
cur_census = collections.Counter(); type_census = collections.Counter()
for (t, ex), recs in sorted(grp.items(), key=lambda kv: kv[0][1]):
    j = bisect.bisect_left(cal, ex)
    if j >= len(cal): continue
    s = cal[j]
    for r in recs:
        cur_census[(r.get("currency") or "USD").upper()] += 1; type_census[r.get("dividend_type") or "?"] += 1
    if {(r.get("currency") or "USD").upper() for r in recs} != {"USD"}:
        mine_wh[t].append(s); continue
    bt = collections.defaultdict(set)
    for r in recs:
        c = float(r["cash_amount"])
        if c > 0: bt[r.get("dividend_type") or "?"].add(round(c, 10))
    if not bt: continue
    if any(len(v) > 1 for v in bt.values()):
        mine_wh[t].append(s); continue
    cash = sum(min(v) for v in bt.values())
    prev = next((gf(cal[k], 0).get(t) for k in range(j - 1, max(-1, j - 6), -1) if gf(cal[k], 0).get(t)), None)
    if not prev or 1 - cash / prev <= 0.5:
        mine_wh[t].append(s); continue
    mine_app[t].append((s, 1 - cash / prev))
theirs = json.load(open(IN + "/dividend_basis_table.json"))
same_app = {t: [(s, round(r, 12)) for s, r in v] for t, v in mine_app.items()} == \
           {t: [(s, round(r, 12)) for s, r in v] for t, v in theirs["applied"].items()}
same_wh = {t: sorted(v) for t, v in mine_wh.items()} == {t: sorted(v) for t, v in theirs["withheld_boundaries"].items()}
R = {"records": divs["n"], "currency_census": dict(cur_census), "type_census": dict(type_census),
     "applied_events": sum(len(v) for v in mine_app.values()), "withheld_events": sum(len(v) for v in mine_wh.values()),
     "identical_to_correction_applied": same_app, "identical_to_correction_withheld": same_wh,
     "first_ex": min(k[1] for k in grp), "tickers": len({k[0] for k in grp})}
# ── Yahoo ──
import yfinance as yf
GOLD = {"AAPL": "AAPL", "TSLA": "TSLA", "AMZN": "AMZN", "GOOGL": "GOOGL", "GOOG": "GOOG", "NVDA": "NVDA",
        "WHLR": "WHLR", "MO": "MO", "T": "T", "KO": "KO", "O": "O", "COST": "COST", "XOM": "XOM", "BLK": "BLK",
        "BF.B": "BF-B", "BF.A": "BF-A", "HEI.A": "HEI-A", "MOG.A": "MOG-A", "META": "META", "WMT": "WMT",
        "BP": "BP", "DDS": "DDS", "CALM": "CALM"}
ev_rows, lvl_rows = [], []
for t, y in GOLD.items():
    h = yf.Ticker(y).history(start="2006-01-01", end="2026-09-23", auto_adjust=False, actions=True)
    if h is None or h.empty:
        R.setdefault("yahoo_empty", []).append(t); continue
    h.index = [d.strftime("%Y-%m-%d") for d in h.index]
    fy = (h["Adj Close"] / h["Close"]).to_dict()
    ydiv = {d: v for d, v in h["Dividends"].items() if v > 0}
    ours = dict(mine_app.get(t, []))
    for d in sorted(set(ydiv) | set(ours)):
        if d < "2008-01-02" or d > LAST: continue
        i = bisect.bisect_left(cal, d)
        p = cal[i - 1] if i > 0 else None
        yr = (fy.get(p) / fy.get(d)) if (p in fy and d in fy and fy.get(d)) else None
        orr = ours.get(d)
        if orr is None and yr is not None and abs(yr - 1) < 1e-6:
            continue
        k = ("match" if (orr is not None and yr is not None and abs(orr - yr) < 1e-3) else
             "missing_in_provider_ledger" if orr is None else
             "missing_in_yahoo" if d not in ydiv else "ratio_differs")
        ev_rows.append((t, d, k, orr, yr, ydiv.get(d)))
    # anchor-free level check on three frames
    for D in ("2012-06-15", "2020-03-16", "2026-09-11"):
        i = bisect.bisect_left(cal, D); fr = cal[max(0, i - 380):i]
        S = np.array([gf(d, 1).get(t, np.nan) for d in fr])
        F = np.ones(len(fr))
        for s, r in mine_app.get(t, []):
            if fr and fr[0] < s <= fr[-1]:
                F[:fr.index(s)] *= r
        A = S * F
        ya = np.array([h["Adj Close"].get(d, np.nan) for d in fr])
        ok = np.isfinite(A) & np.isfinite(ya) & np.isfinite(A[-1]) & np.isfinite(ya[-1])
        if ok.sum() < 10 or not np.isfinite(A[-1]):
            continue
        rel = np.abs((A[ok] / A[-1]) / (ya[ok] / ya[-1]) - 1)
        lvl_rows.append((t, D, int(ok.sum()), float(np.median(rel)), float(np.max(rel))))
R["yahoo_event_classes"] = dict(collections.Counter(r[2] for r in ev_rows))
R["yahoo_event_nonmatch"] = [r for r in ev_rows if r[2] != "match"][:120]
R["level_check"] = lvl_rows
R["level_max_rel_err"] = max((r[4] for r in lvl_rows), default=None)
print(write("dividend_oracle_%s.json" % TAG, R))
print(json.dumps({k: v for k, v in R.items() if k not in ("yahoo_event_nonmatch", "level_check")}, indent=1))
for r in R["yahoo_event_nonmatch"][:50]: print("NONMATCH", r)
for r in lvl_rows: print("LEVEL", r)
