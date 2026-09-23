import os
import json, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
import scan
from scan import sub_pages
from datetime import timedelta
from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, series as S
from api.services.fundamentals_pit.concepts import PRIMITIVES
from api.services.fundamentals_pit.filings import ET
TAGS = {t for p in PRIMITIVES.values() for t in p.tags}
res = {r.get("tickers", [None])[0] if r.get("tickers") else r["name"]: r for r in json.load(open("scan.json"))}
scan._open()
for tk in ["PTRN","AIRO","EVMN","SNTL","CD","SSM","JAN","AMSS","ELMT","UROY","BNTC","OMER","SCE-PG","BHLL","ITRMF"]:
    r = res.get(tk)
    if not r: print(tk, "missing"); continue
    doc = json.loads(scan._cf.read(r["name"])); fx = F.parse_companyfacts(doc, TAGS)
    main, pages = sub_pages(r["cik"]); fl = FL.parse_submission_pages(pages); kb = K.build(fx, fl)
    ev = kb.events_for(TAGS)
    s0 = S.build_series(kb, ["revenue_ttm"], warmup=timedelta(0))["revenue_ttm"]
    s1 = S.build_series(kb, ["revenue_ttm"])["revenue_ttm"]
    last0 = s0[-1].period_end if s0 else None; last1 = s1[-1].period_end if s1 else None
    print(f"{tk:7s} first XBRL {ev[0].astimezone(ET):%Y-%m-%d}  last revenue_ttm period: warmup={last1}  no-warmup={last0}")
