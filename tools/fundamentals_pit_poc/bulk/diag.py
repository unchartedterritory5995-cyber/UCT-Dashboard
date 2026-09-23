import os
import json, zipfile, sys, random, collections
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from scan import sub_pages, _open
import scan
from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, metrics as M
from api.services.fundamentals_pit.concepts import PRIMITIVES
from datetime import datetime, timezone
res = json.load(open("scan.json"))
sact = [r for r in res if "points" in r and (r.get("last_periodic") or "") >= "2025-03-22" and "us-gaap" in r["tax"] and r.get("tickers")]
REV = PRIMITIVES["revenue"].tags
bad = [r for r in sact if any(r["tags"].get(t) for t in REV) and not (r["latest"].get("revenue_ttm") and r["latest"]["revenue_ttm"] >= "2025-06-01")]
print("revenue-tagged but no current revenue_ttm:", len(bad), "of", sum(1 for r in sact if any(r["tags"].get(t) for t in REV)))
scan._open()
cats = collections.Counter()
for r in bad[:40]:
    doc = json.loads(scan._cf.read(r["name"])); fx = F.parse_companyfacts(doc, {t for p in PRIMITIVES.values() for t in p.tags})
    main, pages = sub_pages(r["cik"]); fl = FL.parse_submission_pages(pages); kb = K.build(fx, fl)
    now = datetime(2026,9,22,tzinfo=timezone.utc)
    b = M.build_book(kb.state_at(now), None, kb, now)
    rq = sorted(b.quarters.get("revenue",{}))[-5:]; ry = sorted(b.fiscal_years.get("revenue",{}))[-2:]
    lastrev = max((f.end for f in fx if f.tag in REV), default=None)
    tags_used = sorted({f.tag.split(':')[1][:28] for f in fx if f.tag in REV and f.end.year >= 2025})
    fy_end = main.get("fiscalYearEnd")
    if lastrev is None or lastrev.isoformat() < "2025-06-01": c = "revenue tags stop before 2025-06 (switched to extension/other tag)"
    elif not rq: c = "no standalone quarters derivable"
    else: c = "quarters exist but TTM window broken"
    cats[c] += 1
    print(f"{r['tickers'][:2]} {main.get('sicDescription','')[:28]:28s} fye={fy_end} lastrev={lastrev} tags25={tags_used} q={[str(x) for x in rq]} fy={[str(x) for x in ry]} -> {c}")
print(cats)
