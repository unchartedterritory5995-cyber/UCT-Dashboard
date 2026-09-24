"""PHASE 5 (independent) — the dividend-adjusted basis vs yfinance, the collector's own source.

Uses oracle3's own implementation of the spec (no import of breadth_dividend_basis):
  r_e = 1 − Σ_type cash_e / RAW_close(prev session), ex mapped to the next session.
Checks
  (1) our event table == the correction's `dividend_basis_table.json` (applied + withheld)
  (2) per-event: our r_e vs Yahoo's implied step AdjClose/Close at the ex-date
  (3) per-level: [S(d)·Π r] / S(D−1) vs AdjY(d)/AdjY(D−1) over whole frames (anchor-free)
Every mismatch is classified.
"""
import bisect, collections, json, math, os, sys
import numpy as np
from common import write

TAG = sys.argv[1]
os.environ["V2C2_TAG"] = TAG
import oracle3                                   # the ONE independent dividend implementation
IN = "/data/_audit/v2cc/inputs_" + TAG
cal = oracle3.CAL
gf = lambda iso, adj: oracle3.oracle2.gfile(iso, bool(adj))
divs = json.load(open(IN + "/dividends_ledger.json"))
LAST = divs["ex_date_lte"]
cur_census = collections.Counter((d.get("currency") or "USD").upper() for d in divs["dividends"])
type_census = collections.Counter(d.get("dividend_type") or "?" for d in divs["dividends"])
mine_app, mine_wh = oracle3.build_dividends(json.load(open(IN + "/pit_reference.json")))
grp = {(d.get("ticker"), d.get("ex_dividend_date")) for d in divs["dividends"] if d.get("ex_dividend_date")}
theirs = json.load(open(IN + "/dividend_basis_table.json"))
same_app = {t: [(s, round(r, 12)) for s, r in v] for t, v in mine_app.items()} == \
           {t: [(s, round(r, 12)) for s, r in v] for t, v in theirs["applied"].items()}
same_wh = {t: sorted(v) for t, v in mine_wh.items()} == {t: sorted(v) for t, v in theirs["withheld_boundaries"].items()}
diff_app = sorted(set(mine_app) ^ set(theirs["applied"]))[:40]
diff_wh = sorted(t for t in set(mine_wh) | set(theirs["withheld_boundaries"])
                 if sorted(mine_wh.get(t, [])) != sorted(theirs["withheld_boundaries"].get(t, [])))[:40]
R = {"records": divs["n"], "currency_census": dict(cur_census), "type_census": dict(type_census),
     "applied_events": sum(len(v) for v in mine_app.values()), "withheld_events": sum(len(v) for v in mine_wh.values()),
     "identical_to_correction_applied": same_app, "identical_to_correction_withheld": same_wh,
     "applied_ticker_symdiff": diff_app, "withheld_ticker_diff": diff_wh, "correction_version": theirs["version"],
     "first_ex": min(k[1] for k in grp), "tickers": len({k[0] for k in grp})}
R["interlisted_applied"] = {t: len(mine_app.get(t, [])) for t in ("BMO", "TD", "RY", "BNS", "CM", "ENB", "CNQ", "CP", "CNI", "SU", "BCE", "FTS", "CCJ", "DB", "AZN", "ALC")}
R["dual_class_applied"] = {t: len(mine_app.get(t, [])) for t in ("BF.B", "BF.A", "HEI.A", "MOG.A", "MOG.B", "LEN.B", "GEF.B", "CWEN.A", "UHAL.B", "STZ.B", "KELY.A", "WSO.B", "GOOG", "GOOGL")}
# ── Yahoo ──
import yfinance as yf
GOLD = {"AAPL": "AAPL", "TSLA": "TSLA", "AMZN": "AMZN", "GOOGL": "GOOGL", "GOOG": "GOOG", "NVDA": "NVDA",
        "WHLR": "WHLR", "MO": "MO", "T": "T", "KO": "KO", "O": "O", "COST": "COST", "XOM": "XOM", "BLK": "BLK",
        "BF.B": "BF-B", "BF.A": "BF-A", "HEI.A": "HEI-A", "MOG.A": "MOG-A", "META": "META", "WMT": "WMT",
        "BP": "BP", "DDS": "DDS", "CALM": "CALM",
        # dual-class dividend payers (ledger spells them LENB/GEFB) and ticker changes with dividends
        "LEN.B": "LEN-B", "GEF.B": "GEF-B", "LEN": "LEN", "GEF": "GEF", "RTX": "RTX", "ELV": "ELV"}
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
