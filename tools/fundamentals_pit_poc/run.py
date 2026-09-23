import sys, json, os, time
from datetime import date
from load import load
from api.services.fundamentals_pit import knowledge as K, series as S, splits as SP, metrics as M
from api.services.fundamentals_pit.filings import ET
from fetch import CACHE as _C
LEDGER_CACHE = os.path.join(_C, "yahoo_splits.json")
def yahoo_ledger(t):
    c = json.load(open(LEDGER_CACHE)) if os.path.exists(LEDGER_CACHE) else {}
    if t not in c:
        import yfinance as yf
        s = yf.Ticker(t).splits
        c[t] = [[str(d.date()), float(r)] for d, r in s.items()]
        json.dump(c, open(LEDGER_CACHE, "w"))
    return SP.Ledger([SP.Split(date.fromisoformat(d), r) for d, r in c[t]])
def run(t, metrics=None):
    doc, sub, fl, fx = load(t)
    kb = K.build(fx, fl)
    led = yahoo_ledger(t)
    t0 = time.time()
    ser = S.build_series(kb, metrics, led)
    return kb, led, ser, time.time() - t0
if __name__ == "__main__":
    t = sys.argv[1]; ms = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    kb, led, ser, dt = run(t, ms)
    print(t, "events", len(kb.events), "conflicts", len(kb.conflicts), "unjoined", len(kb.unjoined), "splits", [(s.ex_date.isoformat(), s.ratio) for s in led.splits if s.ex_date.year >= 2005], f"{dt:.1f}s")
    for m, pts in ser.items():
        tail = pts[-6:]
        print(f"  {m:24s} n={len(pts):3d} first={pts[0].t_eff.astimezone(ET):%Y-%m-%d} " if pts else f"  {m:24s} n=0", " | ".join(f"{p.t_eff.astimezone(ET):%y-%m-%d %H:%M} {p.period_end:%y-%m} {p.v:,.4g}" for p in tail))
