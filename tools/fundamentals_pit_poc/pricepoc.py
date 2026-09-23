import sqlite3, sys, json, os
from datetime import date, datetime, timezone
from run import run
from api.services.fundamentals_pit import price_derived as PD, beta as B, asof as A
from api.services.fundamentals_pit.filings import ET
DB = sqlite3.connect('file:C:/data/bars.db?mode=ro', uri=True)
def closes(t):
    rows = DB.execute("select ts,c from ohlcv where ticker=? and tf='D' order by ts", (t,)).fetchall()
    return [(date(ts//10000, ts//100%100, ts%100), c) for ts, c in rows]
spy = closes("SPY")
out = {}
for t in sys.argv[1:]:
    kb, led, ser, dt = run(t)
    px = closes(t)
    keys = [d.isoformat() for d, _ in px]
    now = datetime(2026, 9, 22, tzinfo=timezone.utc)
    der = PD.derive(keys, [c for _, c in px], ser, "D", now)
    bt = dict(B.rolling_beta(px, spy))
    def at(k):
        i = keys.index(k) if k in keys else None
        return {m: (der[m][i] if i is not None else None) for m in der} | {"beta": bt.get(date.fromisoformat(k)), "close": px[i][1] if i is not None else None}
    snap = {k: at(k) for k in ("2016-06-30", "2020-03-23", "2021-12-31", "2024-06-07", "2024-06-10", "2026-09-21")}
    out[t] = snap
    print(t)
    for k, v in snap.items():
        fmt = lambda x, s="": "—" if x is None else (f"{x/1e9:,.1f}B" if s == "B" else f"{x:.2f}")
        print(f"   {k} close={fmt(v['close'])} mcap={fmt(v['market_cap'],'B')} P/E={fmt(v['pe_ttm'])} P/S={fmt(v['ps_ttm'])} P/B={fmt(v['pb'])} FCFy={fmt(v['fcf_yield'])} DivY={fmt(v['dividend_yield'])} beta={fmt(v['beta'])}")
json.dump(out, open("price_snap.json","w"), default=str, indent=1)
