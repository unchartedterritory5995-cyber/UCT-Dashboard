"""api/services/theme_performance.py

Loads themes from wire_data, fetches daily OHLCV bars from Massive for
each holding, computes 1D/1W/1M/3M/1Y/YTD returns, and returns a
structured themes-with-holdings response.

Cache TTL: 15 min (covers intraday refreshes without hammering Massive).
"""
from __future__ import annotations

import concurrent.futures
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars


_CACHE_KEY = "theme_performance"
_CACHE_TTL = 900  # 15 minutes
_MAX_WORKERS = 40
_BAR_DAYS = 420   # ~14 months of calendar days → ≥252 trading days for 1Y
_EXCLUDED = {"TLT", "HYG", "URA", "IBB", "FXI", "MSOS"}


def _resolve_holdings(etf_key: str, theme_data: dict, wire: dict) -> list[str]:
    """Return the symbol list for a theme.

    UCT20 is special-cased to pull from wire_data['leadership'] so the theme
    updates daily when the morning wire pushes new data. All other themes use
    the static holdings list stored in theme_data.
    """
    if etf_key == "UCT20":
        leadership = wire.get("leadership", [])
        return [entry["sym"] for entry in leadership if isinstance(entry, dict) and "sym" in entry]
    return [h["sym"] for h in theme_data.get("holdings", []) if isinstance(h, dict) and h.get("sym")]


def _compute_returns(bars: list[dict]) -> dict[str, Optional[float]]:
    """Compute 1D/1W/1M/3M/1Y/YTD % returns from a sorted list of daily bars.

    Each bar must have: t (unix ms), c (close price).
    Falls back to the first available bar when history is shorter than needed.
    Returns None for all periods when bars is empty.
    """
    null = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}
    if not bars:
        return null

    closes = [b["c"] for b in bars]
    cur = closes[-1]

    def pct(ref: Optional[float]) -> Optional[float]:
        if ref is None or ref == 0:
            return None
        return round((cur - ref) / ref * 100, 2)

    def close_at(n: int) -> float:
        """Close n sessions ago; falls back to earliest bar if history too short."""
        idx = -n
        if abs(idx) > len(closes):
            return closes[0]
        return closes[idx]

    # YTD: first bar whose timestamp falls in the current calendar year
    current_year = date.today().year
    ytd_close = None
    for b in bars:
        if datetime.fromtimestamp(b["t"] / 1000, tz=timezone.utc).year == current_year:
            ytd_close = b["c"]
            break
    if ytd_close is None:
        ytd_close = closes[0]

    return {
        "1d":  pct(close_at(2)),   # today vs yesterday
        "1w":  pct(close_at(6)),   # today vs 5 sessions ago
        "1m":  pct(close_at(23)),  # today vs 22 sessions ago
        "3m":  pct(close_at(67)),  # today vs 66 sessions ago
        "1y":  pct(close_at(253)), # today vs 252 sessions ago
        "ytd": pct(ytd_close),
    }


def _fetch_returns_for(ticker: str, from_date: str, to_date: str) -> dict:
    """Fetch bars and compute returns for a single ticker. Used in thread pool."""
    bars = get_agg_bars(ticker, from_date, to_date)
    return _compute_returns(bars)


def get_theme_performance() -> dict:
    """Return all themes with per-holding multi-period returns.

    Response shape:
    {
        "themes": [
            {
                "name": "Space",
                "ticker": "UFO",
                "etf_name": "Procure Space ETF",
                "holdings": [
                    {
                        "sym": "RKLB",
                        "name": "Rocket Lab",
                        "weight_pct": 8.5,
                        "returns": {"1d": 10.2, "1w": 14.0, "1m": 16.5,
                                    "3m": 27.8, "1y": 317.8, "ytd": 3.4}
                    },
                    ...
                ]
            },
            ...
        ],
        "generated_at": "2026-03-18T09:30:00"
    }
    """
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    wire = _load_wire_data()
    raw_themes = wire.get("themes", {}) if wire else {}

    if not raw_themes or not isinstance(raw_themes, dict):
        result = {"themes": [], "generated_at": datetime.now(timezone.utc).isoformat()}
        cache.set(_CACHE_KEY, result, ttl=60)  # retry sooner if no data
        return result

    today = date.today()
    from_date = (today - timedelta(days=_BAR_DAYS)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    # Collect all unique US holdings across all themes
    all_syms: set[str] = set()
    for etf_key, theme_data in raw_themes.items():
        if not isinstance(theme_data, dict) or etf_key in _EXCLUDED:
            continue
        for sym in _resolve_holdings(etf_key, theme_data, wire):
            all_syms.add(sym)

    # Fetch bars in parallel
    returns_map: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        future_to_sym = {
            executor.submit(_fetch_returns_for, sym, from_date, to_date): sym
            for sym in all_syms
        }
        for future in concurrent.futures.as_completed(future_to_sym):
            sym = future_to_sym[future]
            try:
                returns_map[sym] = future.result()
            except Exception:
                returns_map[sym] = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}

    # Build structured response — preserve wire_data theme order
    themes_out = []
    for etf_ticker, theme_data in raw_themes.items():
        if not isinstance(theme_data, dict):
            continue
        if etf_ticker in _EXCLUDED:
            continue

        syms = _resolve_holdings(etf_ticker, theme_data, wire)
        holdings_out = []
        for sym in syms:
            holdings_out.append({
                "sym": sym,
                "name": theme_data.get("name", sym),
                "weight_pct": 0.0,
                "returns": returns_map.get(sym, {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}),
            })

        themes_out.append({
            "name": theme_data.get("name", etf_ticker),
            "ticker": etf_ticker,
            "etf_name": theme_data.get("etf_name", ""),
            "holdings": holdings_out,
        })

    result = {
        "themes": themes_out,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    cache.set(_CACHE_KEY, result, ttl=_CACHE_TTL)
    return result
