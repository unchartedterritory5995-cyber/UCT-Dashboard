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

from api.services import yf_util
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12 hours
_CACHE_TTL_PARTIAL = 300  # a symbol shed by the 25s deadline self-heals in 5 min, not 12h


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

    # Cap at 200 to prevent a large My-Stocks set from hanging the request
    # with sequential yfinance fetches (each ~1s).
    clean_syms = clean_syms[:200]

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

    # Parallelize + hard-deadline the per-symbol yfinance work. Sequentially this
    # was up to 200 × ~1s (tens of seconds) and a hung yfinance call had no
    # timeout — it could pin the request forever. An 8-wide pool + a 25s total
    # deadline + non-blocking shutdown keeps the request bounded. (2026-07-01)
    from concurrent.futures import ThreadPoolExecutor
    import time as _time

    def _one(sym: str) -> list[dict]:
        # The whole per-symbol yfinance body goes through the shared guard, not
        # just `yf.Ticker(sym)` — constructing a Ticker makes no request; the
        # network happens when `_get_forward_dividend` / `_get_forward_splits`
        # touch `.dividends` / `.splits` / `.calendar`. Guarding the constructor
        # alone would be a gate that cannot fail.
        def _work() -> list[dict]:
            out: list[dict] = []
            try:
                ticker = yf.Ticker(sym)
                div_event = _get_forward_dividend(ticker, sym, today)
                if div_event:
                    out.append(div_event)
                out.extend(_get_forward_splits(ticker, sym, today))
            except Exception as exc:
                _logger.debug("dividends_calendar: error processing %s: %s", sym, exc)
            return out

        return yf_util.bounded_call(_work, []) or []

    ex = ThreadPoolExecutor(max_workers=8, thread_name_prefix="div-cal")
    futures = [ex.submit(_one, s) for s in clean_syms]
    deadline = _time.monotonic() + 25.0
    completed = 0
    for fut in futures:
        try:
            results.extend(fut.result(timeout=max(0.0, deadline - _time.monotonic())))
            completed += 1
        except Exception:
            pass
    ex.shutdown(wait=False, cancel_futures=True)

    # Sort by date ascending
    results.sort(key=lambda e: e.get("date") or "")

    # The 25s deadline shed above is correct (bounds the request path against
    # a hung yfinance call) -- but caching the SHED result at the 12h success
    # TTL is not: the missing symbols' events are indistinguishable from
    # "pays no dividend, no splits." `completed < len(futures)` is the exact
    # per-leg signal (every symbol either finished or timed out), not a
    # truthiness check on `results` (a fully-completed but genuinely
    # dividend-free batch must still get the full TTL).
    set_by_completeness(
        cache_key, results,
        complete=completed == len(futures),
        ttl_ok=_CACHE_TTL,
        ttl_partial=_CACHE_TTL_PARTIAL,
    )
    return results
