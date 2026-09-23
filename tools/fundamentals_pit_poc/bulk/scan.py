import os
"""Universe scan over the SEC bulk archives (read-only, local)."""
import json, zipfile, sys, time, random, collections, os
from multiprocessing import Pool
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from api.services.fundamentals_pit.concepts import PRIMITIVES
from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, series as S
TAGS = {tg for p in PRIMITIVES.values() for tg in p.tags}
CF = os.environ.get("FPIT_COMPANYFACTS_ZIP", "companyfacts.zip")
SUB = os.environ.get("FPIT_SUBMISSIONS_ZIP", "submissions.zip")
_cf = _sub = None
def _open():
    global _cf, _sub
    if _cf is None:
        _cf, _sub = zipfile.ZipFile(CF), zipfile.ZipFile(SUB)
        _sub.names = set(_sub.namelist())
def sub_pages(cik):
    main = json.loads(_sub.read(f"CIK{cik:010d}.json"))
    pages = [main["filings"]["recent"]]
    for f in main["filings"].get("files", []):
        if f["name"] in _sub.names:
            pages.append(json.loads(_sub.read(f["name"])))
    return main, pages
def work(args):
    name, run_series = args
    _open()
    try:
        return _work(name, run_series)
    except Exception as e:
        import traceback
        return {"name": name, "err": traceback.format_exc()[-600:]}
def _work(name, run_series):
    try:
        doc = json.loads(_cf.read(name))
    except Exception as e:
        return {"name": name, "err": str(e)}
    cik = int(doc.get("cik") or 0)
    taxonomies = list((doc.get("facts") or {}).keys())
    allf = sum(len(r) for tx in doc.get("facts", {}).values() for c in tx.values() for r in c.get("units", {}).values())
    fx = F.parse_companyfacts(doc, TAGS)
    out = {"name": name, "cik": cik, "tax": taxonomies, "all_facts": allf, "rel_facts": len(fx),
           "tags": collections.Counter(f.tag for f in fx), "bytes": _cf.getinfo(name).file_size}
    try:
        main, pages = sub_pages(cik)
    except KeyError:
        out["nosub"] = True; return out
    anom = []
    fl = FL.parse_submission_pages(pages, anom)
    out["anomalies"] = len(anom)
    accns = {f.accn for f in fx}
    out["accns"] = len(accns); out["joined"] = sum(1 for a in accns if a in fl)
    periodic = [f for f in fl.values() if f.form in ("10-K", "10-Q")]
    out["last_periodic"] = max((f.filing_date.isoformat() for f in periodic), default=None)
    out["forms"] = collections.Counter(f.form for f in fl.values() if f.form in FL.PERIODIC_FORMS)
    out["tickers"] = main.get("tickers") or []
    if run_series and fx:
        t0 = time.time()
        try:
            kb = K.build(fx, fl)
            ser = S.build_series(kb)
        except Exception as e:
            import traceback
            out["series_err"] = traceback.format_exc()[-600:]
            return out
        out["series_s"] = time.time() - t0
        out["points"] = {m: len(p) for m, p in ser.items()}
        out["latest"] = {m: (p[-1].period_end.isoformat() if p else None) for m, p in ser.items()}
    return out
if __name__ == "__main__":
    z = zipfile.ZipFile(CF); names = [i.filename for i in z.infolist()]
    random.seed(11); sample = set(random.sample(names, 600))
    if len(sys.argv) > 1 and sys.argv[1] == "all": sample = set(names)
    t0 = time.time()
    with Pool(10) as pool:
        res = list(pool.imap_unordered(work, [(n, n in sample) for n in names], chunksize=20))
    json.dump(res, open("scan_all.json" if len(sys.argv) > 1 else "scan.json", "w"), default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o))
    print("scanned", len(res), "in", round(time.time() - t0), "s")
