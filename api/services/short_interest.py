"""Short interest + days-to-cover for a ticker.

Free source: yfinance pulls FINRA-reported short interest from Yahoo
Finance's quote summary endpoint (sharesShort, sharesShortPriorMonth,
shortRatio, shortPercentOfFloat). Updates bi-monthly per FINRA cadence.

If yfinance fails, returns graceful error so voice degrades cleanly.
"""

import logging
from typing import Any

import yfinance as yf

from api.services import yf_util
from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_CACHE = TTLCache()
_CACHE_TTL = 3600  # 1 hour — short interest barely changes intraday


def _fmt_int(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _fmt_pct(v) -> float | None:
    """Yahoo returns shortPercentOfFloat as fraction (0.0234 = 2.34%).
    Convert to percentage points."""
    try:
        return round(float(v) * 100.0, 2)
    except (TypeError, ValueError):
        return None


def _fmt_float(v) -> float | None:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def get_short_interest(ticker: str) -> dict[str, Any]:
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    cache_key = f"short::{sym}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        info = yf_util.bounded_call(lambda: yf.Ticker(sym).info, None)
        if info is None:
            raise RuntimeError("bounded yfinance call returned no data")
        info = info or {}
    except Exception as e:
        _log.warning("yfinance short interest failed for %s: %s", sym, e)
        return {"error": f"yfinance failed: {e}", "ticker": sym}

    shares_short = _fmt_int(info.get("sharesShort"))
    prior_month = _fmt_int(info.get("sharesShortPriorMonth"))
    short_ratio = _fmt_float(info.get("shortRatio"))   # days-to-cover
    short_pct_float = _fmt_pct(info.get("shortPercentOfFloat"))
    short_pct_outstanding = _fmt_pct(info.get("shortPercentOfShares"))

    change = None
    if shares_short is not None and prior_month and prior_month > 0:
        change = round((shares_short - prior_month) / prior_month * 100.0, 2)

    # Interpretation hint for voice
    crowded = "low"
    if short_pct_float and short_pct_float >= 20:
        crowded = "very_high"
    elif short_pct_float and short_pct_float >= 10:
        crowded = "high"
    elif short_pct_float and short_pct_float >= 5:
        crowded = "moderate"

    if not any([shares_short, short_ratio, short_pct_float]):
        return {"ticker": sym, "error": "no short interest data available"}

    result = {
        "ticker": sym,
        "shares_short": shares_short,
        "shares_short_prior_month": prior_month,
        "shares_short_change_pct": change,
        "days_to_cover": short_ratio,
        "short_pct_of_float": short_pct_float,
        "short_pct_of_shares_outstanding": short_pct_outstanding,
        "crowded": crowded,
        "as_of": info.get("dateShortInterest"),
        "source": "yfinance / FINRA",
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
