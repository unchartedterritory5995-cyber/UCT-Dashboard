"""Sector ETF money flow analysis.

Computes 5-day vs 20-day average dollar volume ratios for 11 SPDR sector ETFs
to identify institutional money flow trends.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from api.services.cache import cache
from api.services.massive import _get_client, _REST_BASE

SECTOR_ETFS = [
    ("Technology",     "XLK"),
    ("Financials",     "XLF"),
    ("Health Care",    "XLV"),
    ("Energy",         "XLE"),
    ("Industrials",    "XLI"),
    ("Cons. Discret.", "XLY"),
    ("Cons. Staples",  "XLP"),
    ("Utilities",      "XLU"),
    ("Real Estate",    "XLRE"),
    ("Materials",      "XLB"),
    ("Communication",  "XLC"),
]

_CACHE_KEY = "sector_flows"
_CACHE_TTL = 900  # 15 minutes


def _fetch_bars(client, ticker: str, from_date: str, to_date: str) -> list[dict]:
    """Fetch daily OHLCV bars from Massive agg endpoint."""
    url = (
        f"{_REST_BASE}/v2/aggs/ticker/{ticker}/range/1/day"
        f"/{from_date}/{to_date}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
    )
    try:
        data = client._get(url)
        return data.get("results") or []
    except Exception:
        return []


def compute_sector_flows() -> list[dict]:
    """Compute money flow metrics for all 11 sector ETFs.

    Returns list sorted by flow_ratio descending:
        [{sector, etf, flow_ratio, flow_trend, return_5d, avg_volume_5d, avg_volume_20d}]
    """
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    client = _get_client()

    # Date range: ~30 calendar days back to ensure 20+ trading days
    now_et = datetime.now(ZoneInfo("America/New_York"))
    to_date = now_et.strftime("%Y-%m-%d")
    from_date = (now_et - timedelta(days=35)).strftime("%Y-%m-%d")

    results = []
    for sector_name, etf in SECTOR_ETFS:
        bars = _fetch_bars(client, etf, from_date, to_date)
        if len(bars) < 6:
            # Not enough data — skip
            results.append({
                "sector": sector_name,
                "etf": etf,
                "flow_ratio": 1.0,
                "flow_trend": "neutral",
                "return_5d": 0.0,
                "avg_volume_5d": 0,
                "avg_volume_20d": 0,
            })
            continue

        # Use last 20 bars (or all if fewer)
        bars_20 = bars[-20:]
        bars_5 = bars[-5:]

        # Dollar volume = close * volume for each bar
        def dollar_vol(b):
            return float(b.get("c", 0)) * float(b.get("v", 0))

        dvol_20 = [dollar_vol(b) for b in bars_20]
        dvol_5 = [dollar_vol(b) for b in bars_5]

        avg_20 = sum(dvol_20) / len(dvol_20) if dvol_20 else 1.0
        avg_5 = sum(dvol_5) / len(dvol_5) if dvol_5 else 1.0

        flow_ratio = round(avg_5 / avg_20, 3) if avg_20 > 0 else 1.0

        # Flow trend classification
        if flow_ratio > 1.15:
            flow_trend = "inflow"
        elif flow_ratio < 0.85:
            flow_trend = "outflow"
        else:
            flow_trend = "neutral"

        # 5-day price return
        if len(bars_5) >= 2:
            close_now = float(bars_5[-1].get("c", 0))
            # Use the bar just before the 5-day window as reference
            ref_idx = max(0, len(bars_20) - 6)
            close_ref = float(bars_20[ref_idx].get("c", 0))
            return_5d = round(((close_now - close_ref) / close_ref * 100) if close_ref else 0.0, 2)
        else:
            return_5d = 0.0

        results.append({
            "sector": sector_name,
            "etf": etf,
            "flow_ratio": flow_ratio,
            "flow_trend": flow_trend,
            "return_5d": return_5d,
            "avg_volume_5d": round(avg_5),
            "avg_volume_20d": round(avg_20),
        })

    # Sort by flow_ratio descending (strongest inflows first)
    results.sort(key=lambda x: x["flow_ratio"], reverse=True)

    cache.set(_CACHE_KEY, results, ttl=_CACHE_TTL)
    return results
