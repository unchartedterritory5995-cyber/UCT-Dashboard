"""Build ALL prebuilt ETF watchlists → api/data/prebuilt_lists.json.

A 'Bull & Bear ETFs' list (traditional leveraged/inverse index/sector/commodity ETFs above a
liquidity floor) plus a set of curated theme lists (Sector SPDRs, Broad Market,
Industry/Thematic, Country/Region, Commodities, Bonds/Rates, Crypto, Factor/Smart-Beta). Each
list is filtered to tickers that actually traded (grouped-daily data present) and sorted by
dollar volume so the most liquid appear first. Consumed by api/services/watchlist_prebuilt.

Run: railway run --service web -- python tools/build_prebuilt_lists.py
"""
import os
import json
import datetime
import urllib.request

KEY = os.environ.get("MASSIVE_API_KEY", "")
BASE = "https://api.massive.com"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "data", "prebuilt_lists.json")

# 'Bull & Bear ETFs' candidates — TRADITIONAL leveraged (bull) + inverse (bear) ETFs whose
# underlying is an INDEX / SECTOR / COMMODITY / BOND / VOLATILITY basket, never a single stock
# (no NVDL/TSLL/MSTU/…). Filtered to names trading >= MIN_LEV_DVOL dollar volume so the list
# stays liquid and tradable, then sorted by dollar volume.
MIN_LEV_DVOL = 5_000_000
LEVERAGED = [
    # S&P 500
    "UPRO", "SPXL", "SSO", "SPUU", "SPXU", "SPXS", "SDS", "SH", "SPDN",
    # Nasdaq 100
    "TQQQ", "QLD", "SQQQ", "QID", "PSQ",
    # Dow
    "UDOW", "DDM", "SDOW", "DXD", "DOG",
    # Russell 2000 / small cap
    "TNA", "URTY", "UWM", "TZA", "SRTY", "TWM", "RWM",
    # Semis / tech
    "SOXL", "SOXS", "USD", "SSG", "TECL", "TECS", "ROM", "REW",
    # Financials / banks
    "FAS", "FAZ", "UYG", "SKF", "DPST",
    # Energy
    "ERX", "ERY", "GUSH", "DRIP", "DIG", "DUG",
    # Biotech / healthcare
    "LABU", "LABD", "BIB", "BIS", "CURE", "PILL",
    # Gold & junior miners
    "NUGT", "DUST", "JNUG", "JDST",
    # Real estate
    "DRN", "DRV", "URE", "SRS",
    # Other sectors
    "RETL", "DFEN", "UTSL", "WANT", "NAIL",
    # China / EM / international
    "YINN", "YANG", "CWEB", "CHAU", "EDC", "EDZ", "BRZU", "KORU", "INDL", "MEXX", "EURL", "JPNL",
    # MicroSectors index baskets
    "FNGU", "FNGD", "BULZ", "WEBL", "WEBS",
    # Commodities — metals & energy
    "UGL", "GLL", "AGQ", "ZSL", "UCO", "SCO", "BOIL", "KOLD",
    # Treasuries / rates
    "TMF", "TMV", "TBT", "TTT", "UBT", "TYD", "TYO", "UST", "PST", "TBF",
    # Volatility
    "UVXY", "SVXY", "UVIX", "SVIX",
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

    # Bull & Bear ETFs — traditional leveraged/inverse ETFs above the liquidity floor, $vol-sorted.
    lev_kept = sorted([t for t in LEVERAGED if dvol.get(t.upper(), 0) >= MIN_LEV_DVOL],
                      key=lambda t: dvol.get(t.upper(), 0), reverse=True)
    lev_dropped = [t for t in LEVERAGED if dvol.get(t.upper(), 0) < MIN_LEV_DVOL]
    if lev_dropped:
        print(f"  Bull & Bear ETFs: dropped (< ${MIN_LEV_DVOL/1e6:.0f}M/day or no data): {lev_dropped}")
    lists.append({
        "name": "Bull & Bear ETFs",
        "desc": "Traditional leveraged (bull) and inverse (bear) ETFs of major indices, sectors, "
                "commodities, bonds and volatility — SOXL, TQQQ, SQQQ, SPXL, DUST, GLL and more. "
                "No single-stock funds.",
        "category": "UCT ETF Lists",
        "tickers": lev_kept,
    })

    # Curated theme lists — keep tickers that traded, sort by $vol desc.
    for name, desc, cands in CURATED:
        kept = [t.upper() for t in cands if t.upper() in dvol]
        kept.sort(key=lambda t: dvol.get(t, 0), reverse=True)
        missing = [t for t in cands if t.upper() not in dvol]
        if missing:
            print(f"  {name}: dropped (no data): {missing}")
        lists.append({"name": name, "desc": desc, "category": "UCT ETF Lists", "tickers": kept})

    json.dump(lists, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"\nwrote {len(lists)} lists -> {OUT}")
    for l in lists:
        print(f"  {l['name']:26s} {len(l['tickers']):3d}  {l['tickers'][:6]}")


if __name__ == "__main__":
    main()
