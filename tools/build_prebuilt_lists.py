"""Build ALL prebuilt ETF watchlists → api/data/prebuilt_lists.json.

One 'Liquid Major ETFs' list (top N liquid ETFs, leveraged/single-stock excluded) plus a set
of curated theme lists (Sector SPDRs, Broad Market, Industry/Thematic, Country/Region,
Commodities, Bonds/Rates, Crypto, Factor/Smart-Beta). Each curated list is filtered to
tickers that actually traded (grouped-daily data present) and sorted by dollar volume so the
most liquid appear first. Consumed by api/services/watchlist_prebuilt.

Run: railway run --service web -- python tools/build_prebuilt_lists.py
"""
import os
import json
import datetime
import urllib.request

KEY = os.environ.get("MASSIVE_API_KEY", "")
BASE = "https://api.massive.com"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "data", "prebuilt_lists.json")
TOP_N = 100

_LEV_EXCLUDE = [
    "2X", "3X", "4X", "1.5X", "1.25X", "-1X", "-2X", "-3X",
    "ULTRA", "LEVERAGED", "INVERSE", "GEARED", "BOOST", "BULL", "BEAR",
    "YIELDMAX", "T-REX", "DAILY TARGET",
]

# Curated theme lists (candidate tickers; filtered to what actually trades, then $vol-sorted).
CURATED = [
    ("Sector SPDRs", "The 11 GICS sector SPDR ETFs — the classic sector-rotation and relative-strength dashboard.",
     ["XLK", "XLF", "XLE", "XLV", "XLI", "XLP", "XLY", "XLU", "XLB", "XLRE", "XLC"]),
    ("Broad Market & Index", "Core US index ETFs — the market-context board.",
     ["SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "IVV", "RSP", "MDY", "IJR", "QQQM", "SCHX"]),
    ("Industry & Thematic ETFs", "Industry and thematic ETFs where market leadership shows up — semis, biotech, miners, banks, homebuilders and more.",
     ["SMH", "SOXX", "XBI", "IBB", "GDX", "GDXJ", "KRE", "KBE", "XHB", "ITB", "JETS", "URA", "TAN",
      "ICLN", "CIBR", "HACK", "SKYY", "IGV", "XRT", "OIH", "XOP", "XME", "ARKK", "ARKG", "BOTZ",
      "LIT", "PAVE", "IYT", "FDN", "COPX", "SIL", "KWEB", "SLX", "NLR", "ESPO", "GRID"]),
    ("Country & Region ETFs", "Single-country and regional ETFs for global macro rotation.",
     ["EWJ", "FXI", "MCHI", "EWZ", "EWY", "INDA", "EWG", "EWW", "EEM", "VWO", "EFA", "EWU", "EWT",
      "EWA", "EWC", "VGK", "ILF", "EWH", "EPI", "EWP"]),
    ("Commodities", "Commodity ETFs — metals, energy and agriculture.",
     ["GLD", "IAU", "GLDM", "SLV", "SIVR", "USO", "BNO", "UNG", "CPER", "DBA", "DBC", "PDBC",
      "URA", "PPLT", "PALL", "CORN", "WEAT", "UGA"]),
    ("Bonds & Rates", "Fixed-income ETFs across the curve and credit spectrum.",
     ["TLT", "IEF", "SHY", "SGOV", "BIL", "SHV", "GOVT", "TLH", "LQD", "HYG", "JNK", "TIP", "MUB",
      "AGG", "BND", "VCIT", "VCSH", "EMB", "VGSH", "VGIT"]),
    ("Crypto ETFs", "Spot and futures crypto ETFs.",
     ["IBIT", "FBTC", "BITB", "ARKB", "GBTC", "HODL", "ETHA", "ETHE", "ETHW", "BITO", "EZBC", "BRRR"]),
    ("Factor & Smart-Beta ETFs", "Factor / smart-beta ETFs — momentum, quality, value and low-volatility.",
     ["MTUM", "QUAL", "VLUE", "USMV", "SIZE", "SPLV", "SPHB", "DYNF", "FNDX", "VFMO"]),
]


def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def paginate(u, cap=400):
    out = []
    for _ in range(cap):
        d = get(u)
        out.extend(d.get("results") or [])
        nx = d.get("next_url")
        if not nx:
            break
        u = nx + (f"&apiKey={KEY}" if "apiKey=" not in nx else "")
    return out


def main():
    if not KEY:
        raise SystemExit("MASSIVE_API_KEY not set")
    etf_rows = paginate(f"{BASE}/v3/reference/tickers?type=ETF&active=true&market=stocks&limit=1000&apiKey={KEY}")
    etf_names = {(r.get("ticker") or "").upper(): (r.get("name") or "") for r in etf_rows}

    d = datetime.date.today()
    grouped = None
    for _ in range(6):
        data = get(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d.isoformat()}?adjusted=true&apiKey={KEY}")
        if data.get("results"):
            grouped = data["results"]
            print("grouped day:", d.isoformat())
            break
        d -= datetime.timedelta(days=1)
    dvol = {}
    for r in (grouped or []):
        t, c, v = (r.get("T") or "").upper(), r.get("c"), r.get("v")
        if t and c and v:
            dvol[t] = c * v

    lists = []

    # Liquid Major ETFs — top N ETFs by $vol, leveraged/single-stock excluded.
    ranked = sorted(((t, dv) for t, dv in dvol.items() if t in etf_names), key=lambda x: x[1], reverse=True)
    liquid = []
    for t, _dv in ranked:
        nm = etf_names.get(t, "").upper()
        if not any(k in nm for k in _LEV_EXCLUDE):
            liquid.append(t)
        if len(liquid) >= TOP_N:
            break
    lists.append({
        "name": "Liquid Major ETFs",
        "desc": "The most liquid US ETFs by dollar volume — broad market, sectors, factors, thematic, bonds and commodities.",
        "tickers": liquid,
    })

    # Curated theme lists — keep tickers that traded, sort by $vol desc.
    for name, desc, cands in CURATED:
        kept = [t.upper() for t in cands if t.upper() in dvol]
        kept.sort(key=lambda t: dvol.get(t, 0), reverse=True)
        missing = [t for t in cands if t.upper() not in dvol]
        if missing:
            print(f"  {name}: dropped (no data): {missing}")
        lists.append({"name": name, "desc": desc, "tickers": kept})

    json.dump(lists, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"\nwrote {len(lists)} lists -> {OUT}")
    for l in lists:
        print(f"  {l['name']:26s} {len(l['tickers']):3d}  {l['tickers'][:6]}")


if __name__ == "__main__":
    main()
