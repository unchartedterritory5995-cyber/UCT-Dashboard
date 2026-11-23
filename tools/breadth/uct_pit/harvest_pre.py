"""UCT PIT rebuild, stage 2b: share counts from 10-K/10-Q COVER PAGES filed before an issuer's
machine-readable (XBRL) share facts, for the issuers that need them in 2007-2011. Reuses the
market-cap project's cover parser (api.services.marketcap.textcover) and its rate-limited SEC
fetch. Writes /data/_audit/uct_pit/text_shares.json.gz {cik: [[as_of, filed, count, "text"], ...]}.
Resumable (fetches are cached under MCAP_CACHE). Prints counts only."""
import gzip, json, os, sys, zipfile, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
sys.path.insert(0, "/data/_audit/uct_pit/code")
os.environ.setdefault("MCAP_CACHE", "/data/_audit/uct_pit/sec_cache")
import membership as M
from api.services.marketcap import textcover
from api.services.marketcap.fetch import get_head
from api.services.fundamentals_pit import sec_client as SEC
ROOT = "/data/_audit/uct_pit"
FORMS = ("10-K", "10-Q", "10-K405", "10-KSB", "10-QSB", "10-KT", "20-F", "40-F", "10-KSB40")
LO, HI = os.environ.get("H_LO", "2006-10-01"), os.environ.get("H_HI", "2011-12-31")
WIN = (os.environ.get("W_LO", "2007-06-01"), os.environ.get("W_HI", "2011-06-30"))
OUT = os.environ.get("H_OUT", "text_shares.json.gz")
FAILED = []

def target_ciks():
    ref, sh = M.Ref(), M.Shares()
    ss = [d for d in M.sessions() if WIN[0] <= d <= WIN[1]]
    need = set()
    for d in ss[1::5]:
        i = M.sessions().index(d); prev = M.sessions()[i - 1]
        for t, b in M.bars(prev).items():
            if not b[3] or b[3] < 2 or not b[4] or b[4] < 2e5: continue
            rec = ref.at(t, prev)
            if not rec or not rec[1] or rec[0] not in ("CS", "ADRC", "CS~", "ADRC~"): continue
            s = sh.at(rec[1], prev)
            if s is None or s[2] == "backfill" or (date.fromisoformat(prev) - date.fromisoformat(s[0])).days > 200:
                need.add(rec[1])
    return need

def filings(z, names, cik, extra):
    out = []
    base = f"CIK{int(cik):010d}"
    for n in [f"{base}.json"] + extra.get(base, []):
        if n not in names: continue
        j = json.loads(z.read(n))
        f = j.get("filings", {}).get("recent", j) if n.endswith(f"{base}.json") else j
        for accn, form, fd, rd in zip(f.get("accessionNumber", []), f.get("form", []), f.get("filingDate", []), f.get("reportDate", [])):
            if form in FORMS and LO <= fd <= HI:
                out.append((accn, form, fd, rd))
    return out

def one(cik, accn, form, fd, rd):
    try:
        b = get_head(f"{SEC.WWW}/Archives/edgar/data/{int(cik)}/{accn}.txt")
    except Exception:
        FAILED.append(accn); return []
    if b is None: return []
    try:
        r = textcover.parse(textcover.normalize(b), date.fromisoformat(fd), form,
                            report_date=date.fromisoformat(rd) if rd else None)
    except Exception:
        return []
    by = {}
    for h in r.hits:
        if h.count and h.count > 0 and h.as_of:
            k = h.as_of.isoformat()
            by[k] = by.get(k, 0) + h.count if h.class_label else max(by.get(k, 0), h.count)
    return [[k, fd, v, "text"] for k, v in by.items()]

if __name__ == "__main__":
    t0 = time.time()
    need = sorted(target_ciks())
    print("target issuers", len(need), flush=True)
    z = zipfile.ZipFile(f"{ROOT}/sec/submissions.zip"); names = set(z.namelist())
    extra = {}
    for n in sorted(names):
        if "-submissions-" in n: extra.setdefault(n.split("-submissions-")[0], []).append(n)
    jobs = [(c,) + f for c in need for f in filings(z, names, c, extra)]
    print("filings to read", len(jobs), flush=True)
    out = {}
    done = 0
    with ThreadPoolExecutor(6) as ex:
        for (job, res) in zip(jobs, ex.map(lambda j: one(*j), jobs)):
            if res: out.setdefault(job[0], []).extend(res)
            done += 1
            if done % 2000 == 0: print("read", done, "issuers with counts", len(out), "fetch failures", len(FAILED), "min", round((time.time() - t0) / 60), flush=True)
    with gzip.open(f"{ROOT}/{OUT}", "wt") as f: json.dump(out, f)
    print("DONE issuers with counts", len(out), "of", len(need), "fetch failures", len(FAILED), "min", round((time.time() - t0) / 60), flush=True)
