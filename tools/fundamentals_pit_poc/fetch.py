"""Audit-only SEC fetcher: declared UA, <=4 req/s, disk cache (never re-fetches)."""
import json, os, sys, time, gzip, urllib.request
UA = "UCTDashboard contact@unchartedterritory.com"
CACHE = os.environ.get("FPIT_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache"))
os.makedirs(CACHE, exist_ok=True)
_last = [0.0]
def get(url, name):
    p = os.path.join(CACHE, name)
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    wait = 0.25 - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip": raw = gzip.decompress(raw)
    _last[0] = time.time()
    data = json.loads(raw)
    json.dump(data, open(p, "w", encoding="utf-8"))
    return data
def cik_map():
    j = get("https://www.sec.gov/files/company_tickers.json", "company_tickers.json")
    return {v["ticker"]: int(v["cik_str"]) for v in j.values()}
def company(ticker):
    cik = cik_map()[ticker]
    facts = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", f"facts_{ticker}.json")
    sub = get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", f"sub_{ticker}.json")
    pages = [sub["filings"]["recent"]]
    for f in sub["filings"].get("files", []):
        pages.append(get(f"https://data.sec.gov/submissions/{f['name']}", f"sub_{ticker}_{f['name']}"))
    return cik, facts, sub, pages
if __name__ == "__main__":
    for t in sys.argv[1:]:
        cik, facts, sub, pages = company(t)
        n = sum(len(v["units"][u]) for tax in facts["facts"].values() for v in tax.values() for u in v["units"])
        print(t, cik, sub.get("name"), "fye", sub.get("fiscalYearEnd"), "facts", n, "sub pages", len(pages), "filings", sum(len(p["accessionNumber"]) for p in pages))
