from datetime import datetime, date, timedelta, timezone
from load import load
from api.services.fundamentals_pit import knowledge as K, metrics as M, series as S
from api.services.fundamentals_pit.filings import ET
doc, sub, fl, fx = load("AAPL"); kb = K.build(fx, fl)
T1 = fl["0001193125-09-214859"].public_at; T2 = fl["0001193125-10-012091"].public_at
print("T1 original 10-K public:", T1.astimezone(ET), " accepted:", fl["0001193125-09-214859"].accepted_at.astimezone(ET))
print("T2 10-K/A public:       ", T2.astimezone(ET))
q = date(2009, 9, 26)
for label, t in [("T1 - 1s", T1 - timedelta(seconds=1)), ("T1", T1), ("T2 - 1s", T2 - timedelta(seconds=1)), ("T2", T2), ("2012-01-01", datetime(2012,1,1,tzinfo=timezone.utc))]:
    b = M.build_book(kb.state_at(t), None, kb, t)
    r = M.ttm(b, "revenue", q); n = M.ttm(b, "net_income", q)
    print(f"  {label:10s} FY2009 revenue = {r.v/1e6 if r else None!s:>8}M  net income = {n.v/1e6 if n else None!s:>7}M  via {r.sources[0][3] if r else '-'}")
ser = S.build_series(kb, ["revenue_ttm"])["revenue_ttm"]
print("revenue_ttm points 2009-07..2010-08:")
for p in ser:
    if datetime(2009,7,1,tzinfo=timezone.utc) <= p.t_eff <= datetime(2010,8,1,tzinfo=timezone.utc):
        print(f"   {p.t_eff.astimezone(ET):%Y-%m-%d %H:%M} period {p.period_end} {p.v/1e6:,.0f}M {p.method}")
