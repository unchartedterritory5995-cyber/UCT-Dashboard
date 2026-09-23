import re
from datetime import datetime, timezone, timedelta, date
from load import load
from run import yahoo_ledger
from docs import doc_of_type
from api.services.fundamentals_pit import knowledge as K, metrics as M
from api.services.fundamentals_pit.concepts import PRIMITIVES
from api.services.fundamentals_pit.filings import ET
TAGS = {tg for p in PRIMITIVES.values() for tg in p.tags}
def qv(t, kb, led, when, prim, s, e, how):
    b = M.build_book({k: v for k, v in kb.state_at(when).items() if k[0] in TAGS}, led, kb, when)
    v = M.quarter_value(b, prim, e) if how == "q" else M.ttm(b, prim, e)
    return None if v is None else v.v
for t, cik, prim, how, s, e, docs_ in [
    ("AAPL", 320193, "revenue", "ttm", "2008-09-28", "2009-09-26", [("0001193125-09-214859", "10-K", "36,537"), ("0001193125-10-012091", "10-K/A", "42,905")]),
    ("CELH", 1341766, "net_income", "q", "2021-07-01", "2021-09-30", [("0001829126-21-014180", "10-Q", "2,745,791"), ("0000950170-22-023818", "10-Q", "(9,371")]),
]:
    doc, sub, fl, fx = load(t); kb = K.build(fx, fl); led = yahoo_ledger(t)
    print(f"== {t} {prim} {how} {s}..{e}")
    for accn, typ, needle in docs_:
        txt = doc_of_type(cik, accn, typ)
        m = txt and re.search(re.escape(needle), txt)
        pa = fl[accn].public_at
        print(f"   document {accn} ({fl[accn].form}, public {pa.astimezone(ET):%Y-%m-%d %H:%M} ET) states {needle!r}: {'YES' if m else 'NO'}  ...{txt[m.start()-90:m.end()+15] if m else ''}")
    t1, t2 = fl[docs_[0][0]].public_at, fl[docs_[1][0]].public_at
    for label, when in [("T1-1s", t1 - timedelta(seconds=1)), ("T1", t1), ("T2-1s", t2 - timedelta(seconds=1)), ("T2", t2), ("today", datetime(2026, 9, 22, tzinfo=timezone.utc))]:
        v = qv(t, kb, led, when, prim, date.fromisoformat(s), date.fromisoformat(e), how)
        print(f"   {label:6s} {when.astimezone(ET):%Y-%m-%d %H:%M:%S} ET -> {v if v is None else f'{v:,.0f}'}")
