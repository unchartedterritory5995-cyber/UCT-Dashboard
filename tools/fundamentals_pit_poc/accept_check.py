"""Independent acceptance-time check: submissions JSON vs the raw EDGAR SGML header of each filing."""
import json, re, random
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from load import load
from docs import raw
ET = ZoneInfo("America/New_York")
random.seed(7)
rows = []
for t in ["AAPL","NVDA","JPM","CAT","CAVA","CELH","PLUG","SMCI","MSFT"]:
    doc, sub, fl, fx = load(t)
    cik = int(doc["cik"])
    accns = sorted({f.accn for f in fx if fl[f.accn].form in ("10-K","10-Q","10-K/A","10-Q/A")})
    pick = random.sample(accns, 3)
    late = [a for a in accns if fl[a].public_at > fl[a].accepted_at]
    if late: pick.append(late[-1])
    for a in pick:
        f = fl[a]
        h = raw(f"https://www.sec.gov/Archives/edgar/data/{cik}/{a.replace('-','')}/{a}.hdr.sgml", f"hdr_{a}.sgml")
        m = re.search(r"<ACCEPTANCE-DATETIME>(\d{14})", h); fd = re.search(r"<FILING-DATE>(\d{8})", h)
        hdr = datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=ET)
        ok = hdr.astimezone(timezone.utc) == f.accepted_at
        rows.append((t, a, f.form, hdr.strftime("%Y-%m-%d %H:%M:%S ET"), f.accepted_at.isoformat(), fd.group(1) if fd else None, f.filing_date.isoformat(), f.public_at.astimezone(ET).strftime("%Y-%m-%d %H:%M ET"), ok))
        print(f"{t:5s} {a} {f.form:6s} header={hdr:%Y-%m-%d %H:%M:%S} ET  json={f.accepted_at.astimezone(ET):%Y-%m-%d %H:%M:%S} ET  filingDate={f.filing_date}  public_at={f.public_at.astimezone(ET):%Y-%m-%d %H:%M} ET  {'OK' if ok else 'MISMATCH'}")
json.dump(rows, open("accept_rows.json","w"), indent=1)
print("mismatches:", sum(1 for r in rows if not r[-1]), "of", len(rows))
