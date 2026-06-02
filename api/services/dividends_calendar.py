"""Forward dividends and splits calendar service.

Uses yfinance to build a forward-looking (date >= today) list of
dividends and splits for a set of symbols.

Normalized output per event:
  { sym, type: 'dividend' | 'split', date, amount | ratio }

  dividend: { sym, type='dividend', date (YYYY-MM-DD ex-date), amount (float) }
  split:    { sym, type='split',    date (YYYY-MM-DD),         ratio (str, e.g. '4:1') }

Cached 12 hours per symbol-set key.  Never raises — returns [] on any failure.
"""

from __future__ import annotations
import logging
from datetime import date, timezone, datetime

from api.services.cache import cache

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12 hours


def _syms_cache_key(syms: list[str]) -> str:
    """Stable cache key for an ordered, deduped sym list."""
    key_syms = ",".join(sorted(set(s.upper() for s in syms)))
    return f"dividends_calendar_{key_syms}"


def _to_date_str(ts) -> str | None:
    """Convert a pandas Timestamp / datetime.date / datetime.datetime → YYYY-MM-DD or None."""
    if ts is None:
        return None
    if isinstance(ts, date) and not isinstance(ts, datetime):
        return ts.strftime("%Y-%m-%d")
    try:
        # pandas Timestamp (may be tz-aware)
        if hasattr(ts, "date"):
            return ts.date().strftime("%Y-%m-%d")
        return str(ts)[:10]
    except Exception:
        return None


def _get_forward_dividend(ticker_obj, sym: str, today: date) -> dict | None:
    """Extract the next forward ex-dividend event from yfinance.calendar."""
    try:
        cal = ticker_obj.calendar
        if not isinstance(cal, dict):
            return None
        ex_raw = cal.get("Ex-Dividend Date")
        if ex_raw is None:
            return None
        ex_date_str = _to_date_str(ex_raw)
        if not ex_date_str:
            return None
        ex_date = date.fromisoformat(ex_date_str)
        if ex_date < today:
            return None  # already paid

        # Try to get the dividend amount from .dividends (most recent)
        amount: float | None = None
        try:
            divs = ticker_obj.dividends
            if divs is not None and not divs.empty:
                amount = float(divs.iloc[-1])
        except Exception:
            pass

        return {
            "sym":    sym.upper(),
            "type":   "dividend",
            "date":   ex_date_str,
            "amount": amount,
        }
    except Exception as exc:
        _logger.debug("dividends_calendar: forward dividend fetch failed for %s: %s", sym, exc)
        return None


def _get_forward_splits(ticker_obj, sym: str, today: date) -> list[dict]:
    """Extract forward-looking splits from yfinance.splits."""
    results = []
    try:
        splits = ticker_obj.splits
        if splits is None or splits.empty:
            return []
        for ts, ratio_val in splits.items():
            date_str = _to_date_str(ts)
            if not date_str:
                continue
            try:
                split_date = date.fromisoformat(date_str)
            except ValueError:
                continue
            if split_date < today:
                continue
            # ratio_val is a float (e.g. 4.0 for 4-for-1); express as "N:1"
            try:
                r = float(ratio_val)
                ratio_str = f"{int(r)}:1" if r == int(r) else f"{r}:1"
            except (ValueError, TypeError):
                ratio_str = str(ratio_val)
            results.append({
                "sym":   sym.upper(),
                "type":  "split",
                "date":  date_str,
                "ratio": ratio_str,
            })
    except Exception as exc:
        _logger.debug("dividends_calendar: splits fetch failed for %s: %s", sym, exc)
    return results


def get_events(syms: list[str]) -> list[dict]:
    """Return forward dividends + splits for the given symbols.

    Result: list of { sym, type: 'dividend'|'split', date, amount? (dividend), ratio? (split) }
    Only events with date >= today are returned.
    Cached 12 h per symbol-set.  Never raises — returns [] on any failure.

    Args:
        syms: list of ticker strings (case-insensitive)
    """
    if not syms:
        return []

    clean_syms = sorted({s.strip().upper() for s in syms if s and s.strip()})
    if not clean_syms:
        return []

    cache_key = _syms_cache_key(clean_syms)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    today = date.today()
    results: list[dict] = []

    # Import inside function to allow easy mocking in tests
    try:
        import yfinance as yf
    except ImportError:
        _logger.warning("dividends_calendar: yfinance not installed")
        cache.set(cache_key, [], ttl=_CACHE_TTL)
        return []

    for sym in clean_syms:
        try:
            ticker = yf.Ticker(sym)

            # Forward dividend (from .calendar ex-date)
            div_event = _get_forward_dividend(ticker, sym, today)
            if div_event:
                results.append(div_event)

            # Forward splits (from .splits, future dates only)
            split_events = _get_forward_splits(ticker, sym, today)
            results.extend(split_events)

        except Exception as exc:
            _logger.debug("dividends_calendar: error processing %s: %s", sym, exc)

    # Sort by date ascending
    results.sort(key=lambda e: e.get("date") or "")

    cache.set(cache_key, results, ttl=_CACHE_TTL)
    return results
