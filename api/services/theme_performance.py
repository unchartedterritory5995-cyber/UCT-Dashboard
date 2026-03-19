"""api/services/theme_performance.py

Loads themes from wire_data, fetches daily OHLCV bars from Massive for
each holding, computes 1D/1W/1M/3M/1Y/YTD returns, and returns a
structured themes-with-holdings response.

Cache TTL: 15 min. Computation runs in background — callers never block.
"""
from __future__ import annotations

import concurrent.futures
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars


_CACHE_KEY = "theme_performance"
_CACHE_TTL = 900   # 15 minutes
_MAX_WORKERS = 8   # safe for Railway 512MB: 8 threads × ~8MB + httpx overhead
_BAR_DAYS = 420    # ~14 months → ≥252 trading days for 1Y
_EXCLUDED = {"TLT", "HYG", "URA", "IBB", "FXI", "MSOS"}

# Background computation state
_computing = False
_compute_lock = threading.Lock()

_COMPUTING_RESPONSE = {
    "themes": [],
    "status": "computing",
    "generated_at": None,
}


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
    """Compute 1D/1W/1M/3M/1Y/YTD % returns from a sorted list of daily bars."""
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
        idx = -n
        if abs(idx) > len(closes):
            return closes[0]
        return closes[idx]

    current_year = date.today().year
    ytd_close = None
    for b in bars:
        if datetime.fromtimestamp(b["t"] / 1000, tz=timezone.utc).year == current_year:
            ytd_close = b["c"]
            break
    if ytd_close is None:
        ytd_close = closes[0]

    return {
        "1d":  pct(close_at(2)),
        "1w":  pct(close_at(6)),
        "1m":  pct(close_at(23)),
        "3m":  pct(close_at(67)),
        "1y":  pct(close_at(253)),
        "ytd": pct(ytd_close),
    }


def _fetch_returns_for(ticker: str, from_date: str, to_date: str) -> dict:
    bars = get_agg_bars(ticker, from_date, to_date)
    return _compute_returns(bars)


def _run_computation() -> None:
    """Background thread: fetch all returns and populate cache."""
    global _computing
    try:
        wire = _load_wire_data()
        raw_themes = wire.get("themes", {}) if wire else {}

        if not raw_themes or not isinstance(raw_themes, dict):
            result = {"themes": [], "status": "ok", "generated_at": datetime.now(timezone.utc).isoformat()}
            cache.set(_CACHE_KEY, result, ttl=60)
            return

        today = date.today()
        from_date = (today - timedelta(days=_BAR_DAYS)).strftime("%Y-%m-%d")
        to_date = today.strftime("%Y-%m-%d")

        # Collect all unique symbols
        all_syms: set[str] = set()
        for etf_key, theme_data in raw_themes.items():
            if not isinstance(theme_data, dict) or etf_key in _EXCLUDED:
                continue
            for sym in _resolve_holdings(etf_key, theme_data, wire):
                all_syms.add(sym)

        # Fetch bars with conservative worker count to stay within Railway memory
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

        # Build response
        themes_out = []
        for etf_ticker, theme_data in raw_themes.items():
            if not isinstance(theme_data, dict) or etf_ticker in _EXCLUDED:
                continue
            syms = _resolve_holdings(etf_ticker, theme_data, wire)
            holdings_out = [
                {
                    "sym": sym,
                    "name": theme_data.get("name", sym),
                    "weight_pct": 0.0,
                    "returns": returns_map.get(sym, {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}),
                }
                for sym in syms
            ]
            themes_out.append({
                "name": theme_data.get("name", etf_ticker),
                "ticker": etf_ticker,
                "etf_name": theme_data.get("etf_name", ""),
                "holdings": holdings_out,
            })

        result = {
            "themes": themes_out,
            "status": "ok",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        cache.set(_CACHE_KEY, result, ttl=_CACHE_TTL)
    except Exception as e:
        # On failure, cache a short-TTL empty result so we retry sooner
        cache.set(_CACHE_KEY, {"themes": [], "status": "ok", "generated_at": datetime.now(timezone.utc).isoformat()}, ttl=60)
    finally:
        with _compute_lock:
            global _computing
            _computing = False


def get_theme_performance() -> dict:
    """Return cached theme performance data, or trigger background computation.

    Returns immediately — never blocks the HTTP request thread.
    When cache is cold, returns {"themes": [], "status": "computing"} and
    kicks off background computation. Poll again in ~30s for results.
    """
    global _computing

    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    with _compute_lock:
        if _computing:
            # Already running — return computing placeholder
            return {**_COMPUTING_RESPONSE, "generated_at": datetime.now(timezone.utc).isoformat()}
        _computing = True

    # Kick off background computation
    t = threading.Thread(target=_run_computation, daemon=True, name="theme-perf-compute")
    t.start()

    return {**_COMPUTING_RESPONSE, "generated_at": datetime.now(timezone.utc).isoformat()}
