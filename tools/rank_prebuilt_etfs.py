"""Rank US ETFs by dollar volume → the 'Liquid Major ETFs' prebuilt watchlist.

EXCLUDES leveraged/inverse ETFs (SOXL, TQQQ, SQQQ…) and single-stock ETFs (MSTX, MSTU,
NVDL, YieldMax…) by name — the owner wants only core/plain ETFs. Writes the top
`TOP_N` survivors to api/data/prebuilt_etfs.json.

Run: railway run --service web -- python tools/rank_prebuilt_etfs.py
"""
import os
import json
import datetime
import urllib.request

KEY = os.environ.get("MASSIVE_API_KEY", "")
BASE = "https://api.massive.com"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "data", "prebuilt_etfs.json")
TOP_N = 100

# Name substrings that mark a leveraged/inverse or single-stock ETF (uppercased match).
_EXCLUDE = [
    "2X", "3X", "4X", "1.5X", "1.25X", "-1X", "-2X", "-3X",   # multipliers (leveraged/inverse + single-stock)
    "ULTRA", "LEVERAGED", "INVERSE", "GEARED", "BOOST",        # ProShares Ultra/UltraPro/UltraShort etc.
    "BULL", "BEAR",                                            # Direxion Daily … Bull/Bear
    "YIELDMAX", "T-REX", "DAILY TARGET",                       # single-stock (YieldMax / T-Rex / Defiance)
]


def _excluded(name: str) -> bool:
    n = (name or "").upper()
    return any(k in n for k in _EXCLUDE)


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
    etf_rows = paginate(f"{BASE}/v3/reference/tickers?type=ETF&active=true&market=stocks&limit=1000&apiKey={KEY}")
    names = {(r.get("ticker") or "").upper(): (r.get("name") or "") for r in etf_rows}
    print("ETF symbols:", len(names))

    d = datetime.date.today()
    grouped = None
    for _ in range(6):
        data = get(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d.isoformat()}?adjusted=true&apiKey={KEY}")
        if data.get("results"):
            grouped = data["results"]
            print("grouped day:", d.isoformat(), "rows:", len(grouped))
            break
        d -= datetime.timedelta(days=1)

    ranked = []
    for r in (grouped or []):
        t = (r.get("T") or "").upper()
        if t not in names:
            continue
        c, v = r.get("c"), r.get("v")
        if c and v:
            ranked.append((t, c * v))
    ranked.sort(key=lambda x: x[1], reverse=True)

    kept, dropped = [], []
    for t, _dv in ranked:
        (dropped if _excluded(names.get(t, "")) else kept).append(t)
        if len(kept) >= TOP_N:
            break
    print(f"kept {len(kept)} core ETFs; dropped (leveraged/single-stock) sample:",
          [(t, names.get(t, "")[:34]) for t in dropped[:12]])
    print("top 20 kept:", kept[:20])
    json.dump(kept, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print("wrote", len(kept), "->", OUT)


if __name__ == "__main__":
    main()
