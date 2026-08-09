"""Enrich api/data/delisted_tickers_bulk.json with sector + industry from Massive's SIC data
(the ticker DETAILS endpoint, queried with a `date` during the company's trading life —
delisted tickers 404 without it). Gives every delisted chart a proper watermark sector/
industry line, from what it was when it delisted.

Resumable + concurrent: only fetches entries still missing `sector`, writes back every 200,
so a re-run continues where it left off. Run with the Massive key:
`railway run --service web -- python tools/enrich_delisted_sectors.py`
"""
import os
import json
import datetime
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

_HERE = os.path.dirname(os.path.abspath(__file__))
BULK = os.path.join(_HERE, "..", "api", "data", "delisted_tickers_bulk.json")
KEY = os.environ.get("MASSIVE_API_KEY", "")
BASE = "https://api.massive.com"


def sic_sector(code):
    try:
        c = int(code)
    except (TypeError, ValueError):
        return None
    if 100 <= c <= 999: return "Consumer Staples"
    if 1000 <= c <= 1099 or 1400 <= c <= 1499: return "Materials"
    if 1200 <= c <= 1399: return "Energy"
    if 1500 <= c <= 1799: return "Industrials"
    if 2000 <= c <= 2199: return "Consumer Staples"
    if 2200 <= c <= 2399: return "Consumer Discretionary"
    if 2400 <= c <= 2599: return "Industrials"
    if 2600 <= c <= 2699: return "Materials"
    if 2700 <= c <= 2799: return "Communication Services"
    if 2830 <= c <= 2836: return "Healthcare"
    if 2800 <= c <= 2899: return "Materials"
    if 2900 <= c <= 2999: return "Energy"
    if 3000 <= c <= 3399: return "Materials"
    if 3400 <= c <= 3569: return "Industrials"
    if 3570 <= c <= 3699: return "Technology"
    if 3700 <= c <= 3716: return "Consumer Discretionary"
    if 3720 <= c <= 3799: return "Industrials"
    if 3800 <= c <= 3829: return "Technology"
    if 3840 <= c <= 3851: return "Healthcare"
    if 3860 <= c <= 3999: return "Consumer Discretionary"
    if 4000 <= c <= 4799: return "Industrials"
    if 4800 <= c <= 4899: return "Communication Services"
    if 4900 <= c <= 4999: return "Utilities"
    if 5000 <= c <= 5199: return "Industrials"
    if 5200 <= c <= 5999: return "Consumer Discretionary"
    if 6000 <= c <= 6499 or 6700 <= c <= 6799: return "Financials"
    if 6500 <= c <= 6599: return "Real Estate"
    if 7000 <= c <= 7099: return "Consumer Discretionary"
    if 7370 <= c <= 7379: return "Technology"
    if 7200 <= c <= 7399: return "Industrials"
    if 7800 <= c <= 7999: return "Communication Services"
    if 8000 <= c <= 8099: return "Healthcare"
    if 8700 <= c <= 8799: return "Industrials"
    return "Industrials"


def clean_industry(desc):
    if not desc:
        return None
    # Strip prefixes/suffixes on the RAW uppercase, THEN capitalize — otherwise a hyphenated
    # token like "SERVICES-COMPUTER" capitalizes to "Services-computer" and the strip leaves
    # a lowercase "computer".
    s = str(desc).strip().upper()
    s = s.replace(", ETC.", "").replace(" ETC.", "").replace(" & ALLIED PRODUCTS", "")
    for pref in ("SERVICES-", "WHOLESALE-", "RETAIL-", "SERVICES "):
        if s.startswith(pref):
            s = s[len(pref):]
    s = " ".join(w.capitalize() for w in s.split())
    return s.strip(" -,") or None


def _detail_date(entry):
    # A date comfortably within the trading window (details 404 for delisted without one).
    ld = entry.get("last_date") or entry.get("delisted_date")
    try:
        d = datetime.date.fromisoformat(ld) - datetime.timedelta(days=60)
        fd = entry.get("first_date")
        if fd and d < datetime.date.fromisoformat(fd):
            d = datetime.date.fromisoformat(fd) + datetime.timedelta(days=10)
        return d.isoformat()
    except Exception:
        return "2010-01-01"


def fetch_sic(entry):
    sym = entry.get("provider_symbol") or entry.get("ticker")
    url = f"{BASE}/v3/reference/tickers/{sym}?date={_detail_date(entry)}&apiKey={KEY}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=25) as r:
            res = json.loads(r.read()).get("results") or {}
        return entry["ticker"], res.get("sic_code"), res.get("sic_description")
    except Exception:
        return entry["ticker"], None, None


def main():
    if not KEY:
        raise SystemExit("MASSIVE_API_KEY not set")
    data = json.load(open(BULK, encoding="utf-8"))
    by_key = {e["ticker"]: e for e in data}
    # Re-normalize casing on any already-enriched industries (idempotent).
    for e in data:
        if e.get("industry"):
            e["industry"] = clean_industry(e["industry"])
    todo = [e for e in data if not e.get("sector")]
    print(f"{len(data)} entries, {len(todo)} need sector")
    done = 0
    with ThreadPoolExecutor(max_workers=10) as ex:
        for key, sic, desc in ex.map(fetch_sic, todo):
            e = by_key.get(key)
            if e and sic:
                e["sector"] = sic_sector(sic)
                ind = clean_industry(desc)
                if ind:
                    e["industry"] = ind
            done += 1
            if done % 200 == 0:
                json.dump(data, open(BULK, "w", encoding="utf-8"), separators=(",", ":"))
                print(f"  {done}/{len(todo)} (checkpoint saved)")
    json.dump(data, open(BULK, "w", encoding="utf-8"), separators=(",", ":"))
    got = sum(1 for e in data if e.get("sector"))
    print(f"done — {got}/{len(data)} now have sector")


if __name__ == "__main__":
    main()
