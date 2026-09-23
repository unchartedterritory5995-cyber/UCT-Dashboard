import re
from datetime import date, datetime, timezone, timedelta
from load import load
from run import yahoo_ledger
from docs import index, raw
from api.services.fundamentals_pit import knowledge as K, metrics as M, restatement_signals as R
from api.services.fundamentals_pit.concepts import PRIMITIVES
from api.services.fundamentals_pit.filings import ET
TAGS = {tg for p in PRIMITIVES.values() for tg in p.tags}
t, cik, accn = "CELH", 1341766, "0000950170-22-003965"
idx = index(cik, accn)
href = [h for h in re.findall(r"href=\"([^\"]+)\"", idx) if h.endswith("_htm.xml")][0]
inst = raw("https://www.sec.gov" + href, f"inst_{accn}_" + href.split("/")[-1])
span = R.restated_span(inst)
print("instance", href.split("/")[-1], "restated span:", span)
doc, sub, fl, fx = load(t); led = yahoo_ledger(t)
for label, epochs in [("companyfacts only", []), ("+ filing signal", [(fl[accn].public_at, span[0], span[1])])]:
    kb = K.build(fx, fl); kb.filing_epochs = epochs
    print("==", label)
    for when in [fl[accn].public_at + timedelta(minutes=1), datetime(2022, 5, 11, tzinfo=timezone.utc), datetime(2022, 11, 10, tzinfo=timezone.utc)]:
        b = M.build_book({k: v for k, v in kb.state_at(when).items() if k[0] in TAGS}, led, kb, when)
        q3 = M.quarter_value(b, "net_income", date(2021, 9, 30)); q4 = M.quarter_value(b, "net_income", date(2021, 12, 31))
        fy = M.ttm(b, "net_income", date(2021, 12, 31))
        f = lambda v: "withheld" if v is None else f"{v.v/1e3:,.0f}K"
        print(f"   at {when.astimezone(ET):%Y-%m-%d}: Q3'21 NI={f(q3)}  Q4'21 NI={f(q4)}  FY'21 NI={f(fy)}")
