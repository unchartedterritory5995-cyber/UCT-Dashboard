"""ETF holdings + the ETF-symbol universe, for the chart's "View Holdings" panel.

Holdings come from FMP's stable etf/holdings endpoint — the SAME source the
'UCT Index Components' prebuilt lists use (see index_constituents): the holding
ticker is `asset`, weight is `weightPercentage`. The ETF-symbol universe (the
is-ETF gate for the button) comes from Massive's reference tickers (type=ETF),
served once to the client like the breadth-symbol catalog.

In-process TTL caches only (holdings barely move day-to-day); both refuse to
cache an empty result over a good one.
"""
import json
import os
import time
import urllib.parse
import urllib.request

from api.services import index_constituents as ic  # _looks_us, _get, _BASE

_HOLDINGS_TTL = 12 * 3600
_UNIVERSE_TTL = 24 * 3600
_MASSIVE_BASE = "https://api.massive.com"

# ETF-name tokens that mark a LEVERAGED / INVERSE / single-stock product — funds
# that hold swaps or futures on one name or an index, NOT a real basket of stocks.
# "View Holdings" is only for real-basket ETFs (owner: not MSTU/SQQQ/GLL/NVDL/…),
# so any ETF whose name contains one of these is dropped from the served set.
# Deliberately NO bare "SHORT"/"LONG" (they match "Short-Term" / "Long-Term" bond
# ETFs, which are real baskets); the multiplier + "ULTRA" tokens already catch the
# ProShares/Direxion/GraniteShares leveraged & inverse lineups.
_NON_BASKET_TOKENS = (
    "2X", "3X", "4X", "5X", "1.5X", "1.25X", "1.75X", "2.5X",
    "-1X", "-2X", "-3X",
    "ULTRA", "LEVERAGED", "INVERSE", "GEARED", "DAILY TARGET",
    "BULL", "BEAR", "BOOST", "T-REX", "YIELDMAX",
)


def _is_basket_etf(name: str) -> bool:
    """True unless the ETF name marks it leveraged/inverse/single-stock."""
    n = (name or "").upper()
    return not any(tok in n for tok in _NON_BASKET_TOKENS)

_holdings_cache: dict = {}                     # sym -> (ts, [rows])
_universe_cache: dict = {"ts": 0.0, "set": None}


def get_holdings(sym: str) -> list:
    """[{sym, name, weight}] for an ETF — weight-descending, US-filtered. Empty for a
    non-ETF (FMP returns no holdings) or when FMP is unreachable."""
    sym = (sym or "").strip().upper()
    if not sym:
        return []
    hit = _holdings_cache.get(sym)
    if hit and (time.time() - hit[0]) < _HOLDINGS_TTL:
        return hit[1]
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return []
    q = urllib.parse.urlencode({"symbol": sym, "apikey": key})
    try:
        rows = ic._get(f"{ic._BASE}/stable/etf/holdings?{q}")
    except Exception:
        rows = None
    out, seen = [], set()
    for r in (rows or []):
        t = str((r or {}).get("asset") or "").strip().upper()
        if not ic._looks_us(t) or t in seen:
            continue
        seen.add(t)
        w = (r or {}).get("weightPercentage")
        try:
            w = round(float(w), 2) if w is not None else None
        except (TypeError, ValueError):
            w = None
        out.append({"sym": t, "name": (r or {}).get("name") or None, "weight": w})
    out.sort(key=lambda h: (h["weight"] if h["weight"] is not None else -1.0), reverse=True)
    if out:  # never cache an empty result over a prior good one
        _holdings_cache[sym] = (time.time(), out)
    return out


def _paginate_massive(url: str, key: str, cap: int = 400) -> list:
    out = []
    for _ in range(cap):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read())
        except Exception:
            break
        out.extend(d.get("results") or [])
        nx = d.get("next_url")
        if not nx:
            break
        url = nx + (f"&apiKey={key}" if "apiKey=" not in nx else "")
    return out


def etf_symbol_set() -> set:
    """Set of active US ETF tickers (Massive reference type=ETF), cached 24h. Used only
    to decide whether the chart shows the 'View Holdings' button."""
    now = time.time()
    if _universe_cache["set"] is not None and (now - _universe_cache["ts"]) < _UNIVERSE_TTL:
        return _universe_cache["set"]
    key = os.environ.get("MASSIVE_API_KEY", "")
    s = set()
    if key:
        rows = _paginate_massive(
            f"{_MASSIVE_BASE}/v3/reference/tickers?type=ETF&active=true&market=stocks&limit=1000&apiKey={key}",
            key,
        )
        for r in rows:
            t = str((r or {}).get("ticker") or "").strip().upper()
            if t and _is_basket_etf((r or {}).get("name")):
                s.add(t)
    if s:  # never cache an empty set over a good one
        _universe_cache["set"] = s
        _universe_cache["ts"] = now
    return _universe_cache["set"] or set()
