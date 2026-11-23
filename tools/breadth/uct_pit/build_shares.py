"""UCT PIT rebuild, stage 2: share-count observations per SEC registrant (CIK).
Every observation keeps its AS-OF date (`end`) and when it became public (`filed`).
Sources: dei:EntityCommonStockSharesOutstanding (cover; summed across classes per filing
and as-of) and us-gaap:CommonStockSharesOutstanding (balance sheet, incl. comparative
prior-period values). Writes /data/_audit/uct_pit/shares.json.gz. No market values printed."""
import gzip, json, zipfile, time
from collections import defaultdict
ROOT = "/data/_audit/uct_pit"
z = zipfile.ZipFile(f"{ROOT}/sec/companyfacts.zip")
out, n, with_obs = {}, 0, 0
t0 = time.time()
for name in z.namelist():
    if not name.endswith(".json"):
        continue
    n += 1
    try:
        j = json.loads(z.read(name))
    except Exception:
        continue
    cik = str(j.get("cik") or name[3:13]).lstrip("0")
    facts = j.get("facts") or {}
    obs = []
    dei = ((facts.get("dei") or {}).get("EntityCommonStockSharesOutstanding") or {}).get("units", {}).get("shares") or []
    agg = defaultdict(float)
    meta = {}
    for f in dei:
        v = f.get("val")
        if not isinstance(v, (int, float)) or v <= 0 or not f.get("end"):
            continue
        k = (f.get("accn"), f["end"])
        agg[k] += v
        meta[k] = f.get("filed")
    for (accn, end), v in agg.items():
        obs.append([end, meta[(accn, end)], v, "cover"])
    bs = ((facts.get("us-gaap") or {}).get("CommonStockSharesOutstanding") or {}).get("units", {}).get("shares") or []
    seen = set()
    for f in bs:
        v = f.get("val")
        if not isinstance(v, (int, float)) or v <= 0 or not f.get("end"):
            continue
        k = (f["end"], v)
        if k in seen:
            continue
        seen.add(k)
        obs.append([f["end"], f.get("filed"), v, "bs"])
    # Fallback when no outstanding count is reported without a class dimension (two-class
    # issuers, IFRS filers): the period's weighted-average basic shares, as of the period end.
    for tax, concept in (("us-gaap", "WeightedAverageNumberOfSharesOutstandingBasic"),
                         ("ifrs-full", "WeightedAverageShares"),
                         ("ifrs-full", "NumberOfSharesOutstanding")):
        seen = set()
        for f in ((facts.get(tax) or {}).get(concept) or {}).get("units", {}).get("shares") or []:
            v = f.get("val")
            if not isinstance(v, (int, float)) or v <= 0 or not f.get("end"):
                continue
            if f.get("start"):
                from datetime import date as _d
                try:
                    days = (_d.fromisoformat(f["end"]) - _d.fromisoformat(f["start"])).days
                except Exception:
                    continue
                if days > 380:      # a quarter, or a year for annual-only (foreign) filers
                    continue
            k = (f["end"], v)
            if k in seen:
                continue
            seen.add(k)
            obs.append([f["end"], f.get("filed"), v, "wavg" if tax == "us-gaap" else "ifrs"])
    if obs:
        obs.sort()
        out[cik] = obs
        with_obs += 1
with gzip.open(f"{ROOT}/shares.json.gz.tmp", "wt") as fh:
    json.dump(out, fh)
import os
os.replace(f"{ROOT}/shares.json.gz.tmp", f"{ROOT}/shares.json.gz")
print("companies", n, "with share observations", with_obs, "secs", round(time.time() - t0))
